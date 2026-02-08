const express = require('express');
const router = express.Router();
const axios = require('axios');

const supabaseAdmin = require('../lib/supabaseAdmin');
const { getShipStationAuthHeader } = require('../lib/shipstation/shipstationHelpers');
const { getStoreIdString } = require('../lib/storeHelpers');
const { cancelShipStationOrder } = require('../lib/shipstation/shipstationCancellationService');

// POST /orders/:orderNumber/cancel
router.post('/orders/:orderNumber/cancel', async (req, res) => {
  const clientId = req.apiClient.client_id;
  const userId = req.apiClient?.user_id || null;
  const { orderNumber } = req.params;

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
      .select('order_id, store_id, order_status')
      .eq('order_number', orderNumber)
      .eq('store_id', clientStoreId)
      .maybeSingle();

    if (findErr) throw findErr;
    if (!orderRow) return res.status(404).json({ error: true, message: 'Order not found', code: 'ORDER_NOT_FOUND' });

    // 3) Verify via ShipStation and store ownership (fallback)
    const authHeader = getShipStationAuthHeader();
    const partnerHeader = { 'x-partner': '6a23ce72-08b6-45cf-b9cb-e59ac4aa4cc5' };
    const { data: ssOrder } = await axios.get(`https://ssapi.shipstation.com/orders/${orderRow.order_id}`, {
      headers: { Authorization: authHeader, ...partnerHeader },
    });
    if (!ssOrder) return res.status(404).json({ error: true, message: 'ShipStation order not found', code: 'ORDER_NOT_FOUND' });

    const dbOrderStoreId = getStoreIdString(orderRow.store_id);
    const ssOrderStoreId = getStoreIdString(ssOrder?.advancedOptions?.storeId || ssOrder?.storeId);
    const effectiveOrderStoreId = dbOrderStoreId || ssOrderStoreId;
    if (!effectiveOrderStoreId || effectiveOrderStoreId !== clientStoreId) {
      return res.status(403).json({ error: true, message: 'Order does not belong to your store', code: 'FORBIDDEN_ORDER' });
    }

    // 4) Call vendored cancellation service (ShipStation + fallback behaviors)
    const result = await cancelShipStationOrder({
      orderId: String(orderRow.order_id),
      previousDbStatus: orderRow.order_status,
    });
    if (!result.success && !result.statusCorrected) {
      return res.status(result.status || 500).json({ error: true, message: 'Cancellation failed', details: result.details });
    }

    // 5) Update our DB orders table
    const { error: dbErr } = await supabaseAdmin
      .from('orders')
      .update({ order_status: 'cancelled', last_synced_at: new Date().toISOString() })
      .eq('order_number', orderNumber)
      .eq('store_id', clientStoreId);

    if (dbErr) throw dbErr;

    // 6) Create audit log entry for cancellation (best-effort)
    try {
      await supabaseAdmin
        .from('audit_logs')
        .insert([{
          table_name: 'orders',
          record_id: String(orderRow.order_id),
          action: 'UPDATE',
          user_id: userId,
          changed_at: new Date().toISOString(),
          old_values: { order_status: ssOrder?.orderStatus || null, order_id: orderRow.order_id },
          new_values: { order_status: 'cancelled', order_id: orderRow.order_id },
          metadata: {
            source: 'client_api',
            client_id: clientId,
            api_key_name: req.apiClient?.api_key_name || null,
          },
          ip_address: req.ip || req.connection?.remoteAddress || null,
          user_agent: req.headers['user-agent'] || null,
        }]);
    } catch (auditErr) {
      console.error('[ClientCancelOrderApi] Failed to create audit log for cancellation:', auditErr);
    }

    return res.json({ success: true, message: 'Order cancelled' });
  } catch (err) {
    console.error('[ClientCancelOrderApi] error:', err.response?.data || err.message);
    return res.status(err.response?.status || 500).json({ error: true, message: 'Server error', code: 'SERVER_ERROR' });
  }
});

module.exports = router;

