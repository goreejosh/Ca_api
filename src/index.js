require('dotenv').config();

const express = require('express');
const cors = require('cors');

const aiApiRoutes = require('./routes/aiApiRoutes');
const aiApiDocsRoutes = require('./routes/aiApiDocs');
const aiApiWebhooksRoutes = require('./routes/aiApiWebhooks');

// NOTE: This API is intended for external users from anywhere.
// We keep CORS wide-open (no allowlist) and rely on API keys for auth.
const CORS_OPTIONS = {
  origin: '*',
  credentials: false,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  maxAge: 86400,
};

function createApp() {
  const app = express();
  app.set('trust proxy', true);

  app.use(cors(CORS_OPTIONS));
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

