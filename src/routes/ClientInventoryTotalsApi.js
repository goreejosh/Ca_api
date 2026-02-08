const express = require('express');
const router = express.Router();

const supabaseAdmin = require('../lib/supabaseAdmin');

// GET /inventory/totals - Aggregated totals per client item (uses inventory_stock_levels via unified view)
router.get('/totals', async (req, res) => {
  const clientId = req.apiClient.client_id;
  const limit = parseInt(req.query.limit, 10) || 100;
  const offset = parseInt(req.query.offset, 10) || 0;
  const skuLike = req.query.sku_like || null;

  try {
    let query = supabaseAdmin
      .from('unified_inventory')
      .select('item_id, sku, name, on_hand, available, reserved', { count: 'exact' })
      .eq('client_id', clientId)
      .eq('item_type', 'client_product');

    if (skuLike) {
      query = query.ilike('sku', `%${skuLike}%`);
    }

    const { data, count, error } = await query
      .order('sku', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const inventory = (data || []).map((row) => ({
      item_id: row.item_id,
      sku: row.sku,
      name: row.name,
      total_on_hand: row.on_hand || 0,
      available: row.available || 0,
      reserved: row.reserved || 0,
    }));

    res.json({
      inventory,
      total: count || 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[ClientInventoryTotalsApi] error:', err.message);
    res.status(500).json({ error: true, message: 'Server error', code: 'SERVER_ERROR' });
  }
});

module.exports = router;

