const express = require('express');
const router = express.Router();

const supabaseAdmin = require('../lib/supabaseAdmin');
const { getStoreIdString } = require('../lib/storeHelpers');

// POST /returns - Create a return
// Expects body:
// {
//   created_at, id, method_code, order_number, reason_code,
//   items: [{ sku, quantity }], rma,
//   tracking: { company, number, url }
// }
router.post('/returns', async (req, res) => {
  const clientId = req.apiClient?.client_id;
  const apiKeyId = req.apiClient?.api_key_id || null;
  const body = req.body || {};

  if (!clientId) {
    return res.status(401).json({ error: true, message: 'Unauthorized', code: 'UNAUTHORIZED' });
  }

  // Basic validation
  if (!body.order_number) {
    return res.status(400).json({ error: true, message: 'order_number is required', code: 'VALIDATION_ERROR' });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return res.status(400).json({ error: true, message: 'items array is required', code: 'VALIDATION_ERROR' });
  }
  if (!body.items.every((it) => it && it.sku && Number.isFinite(Number(it.quantity)) && Number(it.quantity) > 0)) {
    return res.status(400).json({ error: true, message: 'items must include sku and positive quantity', code: 'VALIDATION_ERROR' });
  }

  try {
    // Resolve store ownership by order_number scoped to client's store_id if available
    let resolvedOrderId = null;
    try {
      const { data: clientRow } = await supabaseAdmin
        .from('clients')
        .select('store_id')
        .eq('id', clientId)
        .maybeSingle();

      const clientStoreId = getStoreIdString(clientRow?.store_id);
      if (clientStoreId) {
        const { data: orderRow } = await supabaseAdmin
          .from('orders')
          .select('order_id, store_id')
          .eq('order_number', body.order_number)
          .eq('store_id', clientStoreId)
          .maybeSingle();
        resolvedOrderId = orderRow?.order_id || null;
      }
    } catch (_) {
      // Ownership resolution failure should not block creating a return; proceed without order_id
    }

    const tracking = body.tracking || {};
    const rawPayload = body;

    // Insert return row
    const { data: returnRow, error: retErr } = await supabaseAdmin
      .from('returns')
      .insert({
        client_id: clientId,
        api_key_id: apiKeyId,
        external_created_at: body.created_at ? new Date(body.created_at).toISOString() : null,
        external_id: body.id || null,
        method_code: body.method_code || null,
        reason_code: body.reason_code || null,
        rma: body.rma || null,
        order_number: body.order_number,
        order_id: resolvedOrderId,
        tracking_company: tracking.company || null,
        tracking_number: tracking.number || null,
        tracking_url: tracking.url || null,
        tracking: tracking || null,
        raw_payload: rawPayload,
        status: 'pending',
      })
      .select('*')
      .single();

    if (retErr) {
      return res.status(500).json({ error: true, message: 'Failed to create return', code: 'SERVER_ERROR' });
    }

    const items = body.items.map((it) => ({
      return_id: returnRow.id,
      sku: String(it.sku),
      quantity: Number(it.quantity),
      order_line_id: it.order_line_id || null,
      image_url: it.image_url || null,
    }));

    if (items.length) {
      const { error: itErr } = await supabaseAdmin
        .from('return_items')
        .insert(items);
      if (itErr) {
        // Rollback is not trivial without transaction support; log and continue
        console.error('[ClientReturnsApi] Failed to insert return_items:', itErr);
      }
    }

    return res.status(201).json({
      success: true,
      return: {
        id: returnRow.id,
        status: returnRow.status,
        order_number: returnRow.order_number,
        rma: returnRow.rma,
        tracking_number: returnRow.tracking_number,
      },
    });
  } catch (err) {
    console.error('[ClientReturnsApi] error:', err?.message || err);
    return res.status(500).json({ error: true, message: 'Server error', code: 'SERVER_ERROR' });
  }
});

module.exports = router;

