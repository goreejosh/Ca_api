const express = require('express');
const router = express.Router();
const axios = require('axios');

const supabaseAdmin = require('../lib/supabaseAdmin');
const { getShipStationAuthHeader } = require('../lib/shipstation/shipstationHelpers');
const { getStoreIdString } = require('../lib/storeHelpers');

// PATCH /orders/:orderNumber/address
router.patch('/orders/:orderNumber/address', async (req, res) => {
  const clientId = req.apiClient.client_id;
  const { orderNumber } = req.params;
  const shipTo = req.body || {};

  if (!orderNumber) return res.status(400).json({ error: true, message: 'orderNumber required', code: 'VALIDATION_ERROR' });

  try {
    // 1) Get client's store_id
    const { data: clientRow, error: clientErr } = await supabaseAdmin
      .from('clients')
      .select('store_id')
      .eq('id', clientId)
      .single();

    if (clientErr) throw clientErr;
    const clientStoreId = getStoreIdString(clientRow?.store_id);
    if (!clientStoreId) {
      return res.status(403).json({ error: true, message: 'Client store not configured', code: 'FORBIDDEN_ORDER' });
    }

    // 2) Resolve ShipStation order_id and order store from our DB by order_number scoped to client's store_id
    const { data: orderRow, error: findErr } = await supabaseAdmin
      .from('orders')
      .select('order_id, store_id')
      .eq('order_number', orderNumber)
      .eq('store_id', clientStoreId)
      .maybeSingle();

    if (findErr) throw findErr;
    if (!orderRow) return res.status(404).json({ error: true, message: 'Order not found', code: 'ORDER_NOT_FOUND' });

    // 3) Fetch current order from ShipStation (to build valid payload and verify store)
    const authHeader = getShipStationAuthHeader();
    const partnerHeader = { 'x-partner': '6a23ce72-08b6-45cf-b9cb-e59ac4aa4cc5' };
    const { data: ssOrder } = await axios.get(`https://ssapi.shipstation.com/orders/${orderRow.order_id}`, {
      headers: { Authorization: authHeader, ...partnerHeader },
    });

    if (!ssOrder) return res.status(404).json({ error: true, message: 'ShipStation order not found', code: 'ORDER_NOT_FOUND' });

    // Verify order store belongs to this client (DB first, fallback to SS)
    const dbOrderStoreId = getStoreIdString(orderRow.store_id);
    const ssOrderStoreId = getStoreIdString(ssOrder?.advancedOptions?.storeId || ssOrder?.storeId);
    const effectiveOrderStoreId = dbOrderStoreId || ssOrderStoreId;
    if (!effectiveOrderStoreId || effectiveOrderStoreId !== clientStoreId) {
      return res.status(403).json({ error: true, message: 'Order does not belong to your store', code: 'FORBIDDEN_ORDER' });
    }

    // 4) Send update to ShipStation via vendored update service
    const { updateShipStationOrder } = require('../lib/shipstation/shipstationOrderUpdateService');
    await updateShipStationOrder({ orderId: String(orderRow.order_id), overrides: { shipTo } });

    // 5) Update our DB address fields and raw_order_data.shipTo for shipping modal
    // First fetch current raw_order_data for safe merge
    let updatedRaw = null;
    try {
      const { data: orderDataRow, error: rawErr } = await supabaseAdmin
        .from('orders')
        .select('raw_order_data')
        .eq('order_number', orderNumber)
        .eq('store_id', clientStoreId)
        .maybeSingle();
      if (!rawErr && orderDataRow && orderDataRow.raw_order_data) {
        const currentRaw = orderDataRow.raw_order_data || {};
        updatedRaw = { ...currentRaw, shipTo };
      }
    } catch (_) {}

    const updatePayload = {
      ship_to_name: shipTo.name || null,
      ship_to_street1: shipTo.street1 || null,
      ship_to_street2: shipTo.street2 || null,
      ship_to_city: shipTo.city || null,
      ship_to_state: shipTo.state || null,
      ship_to_postal_code: shipTo.postalCode || null,
      ship_to_country: shipTo.country || null,
      ship_to_phone: shipTo.phone || null,
      ship_to_address_verified: null,
      last_synced_at: new Date().toISOString(),
    };
    if (updatedRaw) updatePayload.raw_order_data = updatedRaw;

    const { error: dbErr } = await supabaseAdmin
      .from('orders')
      .update(updatePayload)
      .eq('order_number', orderNumber)
      .eq('store_id', clientStoreId);

    if (dbErr) throw dbErr;

    return res.json({ success: true, message: 'Address updated' });
  } catch (err) {
    console.error('[ClientUpdateAddressApi] error:', err.response?.data || err.message);
    return res.status(err.response?.status || 500).json({ error: true, message: 'Server error', code: 'SERVER_ERROR' });
  }
});

module.exports = router;

