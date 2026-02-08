const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const supabaseAdmin = require('../lib/supabaseAdmin');
const { validateApiKey } = require('../middleware/aiApiAuth');
const aiRedisRateLimit = require('../middleware/aiRedisRateLimit');

router.use(validateApiKey);
router.use(aiRedisRateLimit);

function generateSecret() {
  return crypto.randomBytes(32).toString('hex');
}

// POST /webhooks - register webhook
router.post('/webhooks', async (req, res) => {
  const apiKeyId = req.apiClient.id;
  const { url, events } = req.body || {};

  if (!url || !Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: true, message: 'url and events[] required', code: 'VALIDATION_ERROR' });
  }

  const secret = generateSecret();
  try {
    const { data, error } = await supabaseAdmin
      .from('api_webhooks')
      .insert({ api_key_id: apiKeyId, url, events, secret })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ id: data.id, url: data.url, events: data.events, secret: data.secret });
  } catch (err) {
    console.error('[AI API] webhook register error:', err.message);
    res.status(500).json({ error: true, message: 'Server error', code: 'SERVER_ERROR' });
  }
});

// GET /webhooks - list webhooks for this key
router.get('/webhooks', async (req, res) => {
  const apiKeyId = req.apiClient.id;
  try {
    const { data, error } = await supabaseAdmin
      .from('api_webhooks')
      .select('id, url, events, is_active, created_at')
      .eq('api_key_id', apiKeyId);
    if (error) throw error;
    res.json({ webhooks: data });
  } catch (err) {
    console.error('[AI API] webhook list error:', err.message);
    res.status(500).json({ error: true, message: 'Server error', code: 'SERVER_ERROR' });
  }
});

module.exports = router;

