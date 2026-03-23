const express = require('express');

const supabaseAdmin = require('../lib/supabaseAdmin');

const router = express.Router();

function errorResponse(res, status, message, code) {
  return res.status(status).json({ error: true, message, code });
}

function normalizeSku(value) {
  return String(value || '').trim();
}

function parseNumericOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const trimmed = String(value).trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function escapeLikePattern(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}

async function findProductBySku(rawSku) {
  const sku = normalizeSku(rawSku);
  if (!sku) return null;

  const { data, error } = await supabaseAdmin
    .from('products')
    .select('id, Sku, Description, FulfillmentCost, Cost')
    .ilike('Sku', escapeLikePattern(sku))
    .limit(10);

  if (error) throw error;

  return (data || []).find((row) => normalizeSku(row?.Sku).toLowerCase() === sku.toLowerCase()) || null;
}

// GET /pod/products/:sku/fulfillment-cost - case-insensitive SKU lookup
router.get('/products/:sku/fulfillment-cost', async (req, res) => {
  const rawSku = normalizeSku(req.params.sku);
  if (!rawSku) return errorResponse(res, 400, 'SKU parameter is required', 'VALIDATION_ERROR');

  try {
    const product = await findProductBySku(rawSku);
    if (!product) return errorResponse(res, 404, 'Product not found', 'PRODUCT_NOT_FOUND');

    return res.json({
      sku: product.Sku,
      fulfillment_cost: parseNumericOrNull(product.FulfillmentCost),
      fulfillment_cost_raw: product.FulfillmentCost || null,
    });
  } catch (err) {
    console.error('[POD API] fulfillment cost error:', err.message);
    return errorResponse(res, 500, 'Server error', 'SERVER_ERROR');
  }
});

// GET /pod/products/:sku/cost - case-insensitive SKU lookup
router.get('/products/:sku/cost', async (req, res) => {
  const rawSku = normalizeSku(req.params.sku);
  if (!rawSku) return errorResponse(res, 400, 'SKU parameter is required', 'VALIDATION_ERROR');

  try {
    const product = await findProductBySku(rawSku);
    if (!product) return errorResponse(res, 404, 'Product not found', 'PRODUCT_NOT_FOUND');

    return res.json({
      sku: product.Sku,
      cost: parseNumericOrNull(product.Cost),
    });
  } catch (err) {
    console.error('[POD API] cost error:', err.message);
    return errorResponse(res, 500, 'Server error', 'SERVER_ERROR');
  }
});

// GET /pod/products/:sku/inventory - sums available stock rows for the product
router.get('/products/:sku/inventory', async (req, res) => {
  const rawSku = normalizeSku(req.params.sku);
  if (!rawSku) return errorResponse(res, 400, 'SKU parameter is required', 'VALIDATION_ERROR');

  try {
    const product = await findProductBySku(rawSku);
    if (!product) return errorResponse(res, 404, 'Product not found', 'PRODUCT_NOT_FOUND');

    const { data, error } = await supabaseAdmin
      .from('inventory_stock_levels')
      .select('available')
      .eq('item_type', 'product')
      .eq('item_id', String(product.id));

    if (error) throw error;

    const available = (data || []).reduce((sum, row) => sum + (Number(row?.available) || 0), 0);

    return res.json({
      sku: product.Sku,
      available,
    });
  } catch (err) {
    console.error('[POD API] inventory error:', err.message);
    return errorResponse(res, 500, 'Server error', 'SERVER_ERROR');
  }
});

module.exports = router;
