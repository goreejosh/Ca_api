const crypto = require('crypto');
const supabaseAdmin = require('../lib/supabaseAdmin');

const DEBUG = process.env.AI_API_DEBUG === 'true';

// Simple API key authentication middleware for AI Integration API
// Looks for header: Authorization: Bearer <API_KEY>
// On success, attaches `req.apiClient` with the api_keys row (including client_id)
// On failure, responds with 401 JSON { error: true, message, code }

async function validateApiKey(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !/^Bearer\s+/i.test(authHeader)) {
    return res.status(401).json({
      error: true,
      message: 'Missing or invalid Authorization header',
      code: 'INVALID_API_KEY',
    });
  }

  const start = Date.now();

  // Extract and normalize the bearer token (case-insensitive, trims whitespace)
  const apiKey = authHeader.replace(/^Bearer\s+/i, '').trim();

  // Check if it's a test key
  const isTestKey = apiKey.startsWith('test_');

  // Hash the key to compare with database
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  if (DEBUG) {
    console.log('[AI API Auth] Processing API request', {
      path: req.path,
      isTestKey,
    });
  }

  try {
    // Look up the API key by hash (primary path)
    let { data: keyData, error } = await supabaseAdmin
      .from('api_keys')
      .select('id, client_id, name, is_test, rate_limit')
      .eq('key_hash', keyHash)
      .eq('is_active', true)
      .single();

    // Fallback: if not found via hash, attempt plaintext 'key' (legacy rows)
    if ((error || !keyData)) {
      if (DEBUG) console.log('[AI API Auth] Primary lookup miss, trying fallback');
      const fallback = await supabaseAdmin
        .from('api_keys')
        .select('id, client_id, name, is_test, rate_limit')
        .eq('key', apiKey)
        .eq('is_active', true)
        .single();
      if (!fallback.error && fallback.data) {
        keyData = fallback.data;
        error = null;
        if (DEBUG) console.log('[AI API Auth] Fallback lookup succeeded');
      }
    }

    if (error || !keyData) {
      if (DEBUG) console.warn('[AI API Auth] Invalid API key');
      return res.status(401).json({
        error: true,
        message: 'Invalid API key',
        code: 'INVALID_API_KEY',
      });
    }

    // Verify key type matches
    if (Boolean(keyData.is_test) !== Boolean(isTestKey)) {
      if (DEBUG) console.warn('[AI API Auth] Key type mismatch', { is_test: keyData.is_test, headerIsTest: isTestKey });
      return res.status(401).json({
        error: true,
        message: 'Invalid API key',
        code: 'INVALID_API_KEY',
      });
    }

    // Attach client info to request
    req.apiClient = {
      id: keyData.id,
      client_id: keyData.client_id,
      api_key_id: keyData.id,
      api_key_name: keyData.name,
      is_test: keyData.is_test,
      rate_limit: keyData.rate_limit || 100,
      key: apiKey, // used by rate limiter
    };

    // Update last_used_at timestamp (non-blocking)
    supabaseAdmin
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyData.id)
      .then(() => {})
      .catch((err) => console.error('[AI API Auth] Failed to update last_used_at:', err?.message || err));

    // Log request on finish (non-blocking; matches current_schema.sql api_logs columns)
    res.on('finish', () => {
      const ms = Date.now() - start;
      const endpoint = req.originalUrl || req.path || '';
      const ip = req.ip || req.connection?.remoteAddress || null;

      supabaseAdmin
        .from('api_logs')
        .insert([{
          api_key_id: keyData.id,
          endpoint,
          method: req.method,
          status_code: res.statusCode,
          response_time_ms: ms,
          ip_address: ip,
        }])
        .then(() => {})
        .catch((err) => {
          // Don’t spam logs unless debug
          if (DEBUG) console.warn('[AI API Auth] Failed to insert api_logs:', err?.message || err);
        });
    });

    if (DEBUG) console.log('[AI API Auth] API key validated successfully');
    next();
  } catch (err) {
    console.error('[AI API Auth] API key validation error:', err);
    return res.status(500).json({
      error: true,
      message: 'Internal server error',
      code: 'SERVER_ERROR',
    });
  }
}

// Middleware to intercept test key responses
function testKeyInterceptor(req, res, next) {
  if (!req.apiClient?.is_test) {
    return next();
  }

  // Override res.json to return test data
  const originalJson = res.json.bind(res);

  res.json = function jsonOverride(data) {
    const path = req.path || '';

    // Inventory totals endpoints
    if (path.startsWith('/inventory/totals')) {
      if (path.match(/\/inventory\/totals\/[^\/]+$/)) {
        return originalJson.call(this, {
          item_id: 'test-item-id',
          sku: req.params.sku || 'TEST-SKU',
          name: 'Test Product',
          total_on_hand: 100,
          available: 100,
          reserved: 0,
        });
      }
      return originalJson.call(this, {
        inventory: [
          { item_id: 'test-1', sku: 'TEST-SKU-001', name: 'Test Product 1', total_on_hand: 100, available: 100, reserved: 0 },
          { item_id: 'test-2', sku: 'TEST-SKU-002', name: 'Test Product 2', total_on_hand: 100, available: 100, reserved: 0 },
        ],
        total: 2,
        limit: Number(req.query.limit || 100),
        offset: Number(req.query.offset || 0),
      });
    }

    // Inventory endpoints
    if (path.includes('/inventory')) {
      return originalJson.call(this, {
        inventory: [
          { sku: 'TEST-SKU-001', name: 'Test Product 1', available: 100, reserved: 0, total_on_hand: 100 },
          { sku: 'TEST-SKU-002', name: 'Test Product 2', available: 100, reserved: 0, total_on_hand: 100 },
        ],
        total: 2,
        limit: req.query.limit || 50,
        offset: req.query.offset || 0,
      });
    }

    // Products endpoints
    if (path.includes('/products')) {
      if (req.method === 'POST') {
        return originalJson.call(this, {
          success: true,
          product: {
            id: 'test-product-id',
            ...req.body,
            created_at: new Date().toISOString(),
          },
        });
      }
      return originalJson.call(this, {
        products: [
          { id: 'test-1', sku: 'TEST-SKU-001', name: 'Test Product 1', weight: 1, weight_unit: 'lb' },
          { id: 'test-2', sku: 'TEST-SKU-002', name: 'Test Product 2', weight: 2, weight_unit: 'lb' },
        ],
        total: 2,
        limit: req.query.limit || 50,
        offset: req.query.offset || 0,
      });
    }

    // Orders endpoints
    if (path.includes('/orders')) {
      if (req.method === 'POST') {
        return originalJson.call(this, {
          success: true,
          order_id: `test-order-${Date.now()}`,
          status: 'pending',
        });
      }
      if (path.match(/\/orders\/[^\/]+$/)) {
        return originalJson.call(this, {
          order_number: req.params.orderNumber,
          order_status: 'shipped',
          tracking_number: 'TEST-TRACKING-12345',
          shipped_date: new Date().toISOString(),
        });
      }
    }

    return originalJson.call(this, data);
  };

  next();
}

module.exports = { validateApiKey, testKeyInterceptor };

