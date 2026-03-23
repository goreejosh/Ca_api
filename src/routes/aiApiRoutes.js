const express = require('express');
const router = express.Router();

const supabaseAdmin = require('../lib/supabaseAdmin');
const { validateApiKey, testKeyInterceptor } = require('../middleware/aiApiAuth');
const aiRedisRateLimit = require('../middleware/aiRedisRateLimit');
const { getStoreIdString } = require('../lib/storeHelpers');

// Apply middleware to all routes under this router
router.use(validateApiKey);
router.use(aiRedisRateLimit);
router.use(testKeyInterceptor);

// Mount subrouter for inventory totals (must mount before parameterized routes if overlapping)
const clientInventoryTotalsApi = require('./ClientInventoryTotalsApi');
router.use('/inventory', clientInventoryTotalsApi);
const clientInventorySingleProductTotalApi = require('./ClientInventorySingleProductTotalApi');
router.use('/inventory', clientInventorySingleProductTotalApi);
const podRoutes = require('./podRoutes');
router.use('/pod', podRoutes);
const clientUpdateAddressApi = require('./ClientUpdateAddressApi');
router.use('/', clientUpdateAddressApi);
const clientCancelOrderApi = require('./ClientCancelOrderApi');
router.use('/', clientCancelOrderApi);
const clientReturnsApi = require('./ClientReturnsApi');
router.use('/', clientReturnsApi);

// Utility function to format error responses
function errorResponse(res, status, message, code) {
  return res.status(status).json({ error: true, message, code });
}

// GET /inventory - List inventory with pagination
router.get('/inventory', async (req, res) => {
  const clientId = req.apiClient.client_id;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const offset = parseInt(req.query.offset, 10) || 0;
  const skuLike = req.query.sku_like || null; // optional filter

  try {
    let query = supabaseAdmin
      .from('view_client_inventory_summary')
      .select('*', { count: 'exact' })
      .eq('client_id', clientId);

    if (skuLike) {
      query = query.ilike('sku', `%${skuLike}%`);
    }

    const { data, count, error } = await query
      .order('sku', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      inventory: data,
      total: count,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[AI API] list inventory error:', err.message);
    return errorResponse(res, 500, 'Server error', 'SERVER_ERROR');
  }
});

// GET /products - List products for client (pagination optional)
router.get('/products', async (req, res) => {
  const clientId = req.apiClient.client_id;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const offset = parseInt(req.query.offset, 10) || 0;

  try {
    const { data, error, count } = await supabaseAdmin
      .from('client_inventory')
      .select('*', { count: 'exact' })
      .eq('client_id', clientId)
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      products: data,
      total: count,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[AI API] products error:', err.message);
    return errorResponse(res, 500, 'Server error', 'SERVER_ERROR');
  }
});

// POST /products - Add new product
router.post('/products', async (req, res) => {
  const clientId = req.apiClient.client_id;
  const body = req.body || {};
  const required = ['sku', 'name', 'weight', 'weight_unit'];
  for (const field of required) {
    if (!body[field]) return errorResponse(res, 400, `Missing field ${field}`, 'VALIDATION_ERROR');
  }

  try {
    // Ensure SKU uniqueness for this client
    const { count } = await supabaseAdmin
      .from('client_inventory')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('sku', body.sku);

    if (count && count > 0) {
      return errorResponse(res, 409, 'SKU already exists', 'DUPLICATE_SKU');
    }

    const { data, error } = await supabaseAdmin
      .from('client_inventory')
      .insert({
        client_id: clientId,
        sku: body.sku,
        client_sku: body.sku,
        name: body.name,
        weight: body.weight,
        weight_unit: body.weight_unit,
        storage_length: body.dimensions?.length || null,
        storage_width: body.dimensions?.width || null,
        storage_height: body.dimensions?.height || null,
        unit_cost: body.unit_cost || null,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, product: data });
  } catch (err) {
    console.error('[AI API] create product error:', err.message);
    return errorResponse(res, 500, 'Server error', 'SERVER_ERROR');
  }
});

// POST /orders - Create new order
router.post('/orders', async (req, res) => {
  const clientId = req.apiClient.client_id;
  const order = req.body || {};

  // Basic validation
  if (!order.order_number || !Array.isArray(order.items) || order.items.length === 0) {
    return errorResponse(res, 400, 'Invalid order payload', 'VALIDATION_ERROR');
  }

  try {
    // Resolve client store_id (ShipStation store)
    const { data: clientRow, error: clientErr } = await supabaseAdmin
      .from('clients')
      .select('store_id')
      .eq('id', clientId)
      .single();
    if (clientErr) throw clientErr;
    const clientStoreId = getStoreIdString(clientRow?.store_id);
    if (!clientStoreId) {
      return errorResponse(res, 403, 'Client store not configured', 'FORBIDDEN_ORDER');
    }

    // Check inventory availability for each item
    for (const item of order.items) {
      const { data } = await supabaseAdmin
        .from('view_client_inventory_summary')
        .select('available')
        .eq('client_id', clientId)
        .eq('sku', item.sku)
        .maybeSingle();

      const avail = data?.available || 0;
      if (avail < item.quantity) {
        return errorResponse(res, 400, `Insufficient inventory for ${item.sku}`, 'INSUFFICIENT_INVENTORY');
      }
    }

    // Create order in ShipStation (required because orders.order_id has no default in DB)
    const { buildManualOrderCreatePayload } = require('../lib/shipstation/shipstationOrderCreateMapper');
    const { createShipStationOrder } = require('../lib/shipstation/shipstationOrderCreateService');
    const { getShipStationOrder } = require('../lib/shipstation/shipstationOrdersApi');

    const { ssPayload, createdIso } = buildManualOrderCreatePayload({
      orderNumber: order.order_number,
      storeId: clientStoreId,
      customer: order.customer || {},
      shippingAddress: order.shipping_address || {},
      items: order.items || [],
      internalNotes: order.internal_notes || '',
      shippingMethod: order.shipping_method || null,
      requestedShippingService: order.requested_shipping_service || null,
    });

    const created = await createShipStationOrder({ payload: ssPayload });
    if (!created?.orderId) {
      return errorResponse(res, 502, 'ShipStation did not return an orderId', 'SHIPSTATION_ERROR');
    }

    // Best-effort refetch to get stable orderItemId values
    let ssOrder = created;
    try {
      const fetched = await getShipStationOrder(String(created.orderId));
      if (fetched?.orderId) ssOrder = fetched;
    } catch (_) {}

    // Persist order in DB
    const { data: savedOrder, error: orderErr } = await supabaseAdmin
      .from('orders')
      .insert({
        order_id: Number(ssOrder.orderId),
        store_id: Number(clientStoreId),
        client_id: clientId,
        order_number: ssOrder.orderNumber || order.order_number,
        order_date: createdIso,
        order_status: ssOrder.orderStatus || 'awaiting_shipment',
        raw_order_data: ssOrder,
        customer_name: order.customer?.name || null,
        ship_to_name: ssPayload.shipTo?.name || null,
        ship_to_postal_code: ssPayload.shipTo?.postalCode || null,
        last_synced_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (orderErr) throw orderErr;

    // Insert order items (best-effort)
    try {
      const items = Array.isArray(ssOrder.items) && ssOrder.items.length ? ssOrder.items : order.items;
      const itemRows = (items || []).map((it) => ({
        order_id: Number(ssOrder.orderId),
        shipstation_order_item_id: it.orderItemId || null,
        line_item_key: it.lineItemKey || null,
        sku: it.sku || null,
        name: it.name || null,
        quantity: it.quantity != null ? Number(it.quantity) : null,
        unit_price: it.unitPrice != null ? Number(it.unitPrice) : (it.unit_price != null ? Number(it.unit_price) : null),
        raw_item_data: it || {},
      }));
      if (itemRows.length) {
        const { error: itemErr } = await supabaseAdmin.from('order_items').insert(itemRows);
        if (itemErr) console.error('[AI API] order_items insert error:', itemErr.message);
      }
    } catch (e) {
      console.error('[AI API] order_items insert exception:', e?.message || e);
    }

    res.status(201).json({ success: true, order_id: String(savedOrder.order_id), status: savedOrder.order_status || 'awaiting_shipment' });
  } catch (err) {
    console.error('[AI API] create order error:', err.message);
    return errorResponse(res, 500, 'Server error', 'SERVER_ERROR');
  }
});

// GET /orders/:orderNumber - Retrieve order status
router.get('/orders/:orderNumber', async (req, res) => {
  const clientId = req.apiClient.client_id;
  const orderNumber = req.params.orderNumber;

  try {
    // Resolve store ownership by order_number scoped to client's store_id
    const { data: clientRow, error: clientErr } = await supabaseAdmin
      .from('clients')
      .select('store_id')
      .eq('id', clientId)
      .single();
    if (clientErr) throw clientErr;
    const clientStoreId = getStoreIdString(clientRow?.store_id);
    if (!clientStoreId) {
      return errorResponse(res, 403, 'Client store not configured', 'FORBIDDEN_ORDER');
    }

    const { data, error } = await supabaseAdmin
      .from('orders')
      .select('order_number, order_status, tracking_number, actual_ship_date')
      .eq('order_number', orderNumber)
      .eq('store_id', clientStoreId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return errorResponse(res, 404, 'Order not found', 'ORDER_NOT_FOUND');

    res.json({
      order_number: data.order_number,
      order_status: data.order_status,
      tracking_number: data.tracking_number,
      shipped_date: data.actual_ship_date,
    });
  } catch (err) {
    console.error('[AI API] get order error:', err.message);
    return errorResponse(res, 500, 'Server error', 'SERVER_ERROR');
  }
});

module.exports = router;

