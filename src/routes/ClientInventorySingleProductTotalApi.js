const express = require('express');
const router = express.Router();

const supabaseAdmin = require('../lib/supabaseAdmin');

// GET /inventory/totals/:sku - Aggregated totals for a single SKU
router.get('/totals/:sku', async (req, res) => {
  const clientId = req.apiClient.client_id;
  const { sku } = req.params;

  if (!sku) {
    return res.status(400).json({ error: true, message: 'SKU required', code: 'INVALID_SKU' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('unified_inventory')
      .select('item_id, sku, name, on_hand, available, reserved')
      .eq('client_id', clientId)
      .eq('item_type', 'client_product')
      .eq('sku', sku)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: true, message: 'SKU not found', code: 'INVALID_SKU' });
    }

    return res.json({
      item_id: data.item_id,
      sku: data.sku,
      name: data.name,
      total_on_hand: data.on_hand || 0,
      available: data.available || 0,
      reserved: data.reserved || 0,
    });
  } catch (err) {
    console.error('[ClientInventorySingleProductTotalApi] error:', err.message);
    res.status(500).json({ error: true, message: 'Server error', code: 'SERVER_ERROR' });
  }
});

module.exports = router;

