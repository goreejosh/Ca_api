require('dotenv').config();

const express = require('express');
const cors = require('cors');

const aiApiRoutes = require('./routes/aiApiRoutes');
const aiApiDocsRoutes = require('./routes/aiApiDocs');
const aiApiWebhooksRoutes = require('./routes/aiApiWebhooks');

function buildCorsOptionsFromEnv() {
  const raw = (process.env.CORS_ALLOW_ORIGINS || '').trim();
  if (!raw) {
    return { origin: true, credentials: false };
  }
  const allow = new Set(
    raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  );

  return {
    origin(origin, cb) {
      // Allow non-browser requests (no Origin header)
      if (!origin) return cb(null, true);
      return cb(null, allow.has(origin));
    },
    credentials: false,
  };
}

function createApp() {
  const app = express();
  app.set('trust proxy', true);

  app.use(cors(buildCorsOptionsFromEnv()));
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (req, res) => res.json({ ok: true }));

  // Public docs
  app.use('/api/v1', aiApiDocsRoutes);

  // Authenticated API
  app.use('/api/v1', aiApiRoutes);
  app.use('/api/v1', aiApiWebhooksRoutes);

  // 404 JSON
  app.use((req, res) => {
    res.status(404).json({ error: true, message: 'Not found', code: 'NOT_FOUND' });
  });

  return app;
}

if (require.main === module) {
  const port = parseInt(process.env.PORT || '4000', 10);
  const app = createApp();
  app.listen(port, () => {
    console.log(`[CA_api] listening on :${port}`);
  });
}

module.exports = { createApp };

