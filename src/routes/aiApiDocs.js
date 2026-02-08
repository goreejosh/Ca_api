const express = require('express');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const router = express.Router();

// Load YAML once on startup so we don't read the file on every request
let openapi = null;
let openapiLoadError = null;

(() => {
  try {
    // Define candidate paths (supports local dev, Railway, and Docker)
    const candidatePaths = [
      path.join(__dirname, '../../docs/ai_api_openapi.yaml'), // typical relative path
      path.join(process.cwd(), 'docs/ai_api_openapi.yaml'),
      '/app/docs/ai_api_openapi.yaml',
      '/workspace/docs/ai_api_openapi.yaml',
    ];

    // Remove duplicates while preserving order
    const seen = new Set();
    const pathsToCheck = candidatePaths.filter((p) => {
      if (seen.has(p)) return false;
      seen.add(p);
      return true;
    });

    for (const candidate of pathsToCheck) {
      if (fs.existsSync(candidate)) {
        const raw = fs.readFileSync(candidate, 'utf8');
        openapi = yaml.load(raw);
        console.log('[CA_api Docs] Loaded OpenAPI spec from', candidate);
        break;
      }
    }

    if (!openapi) {
      openapiLoadError = `OpenAPI spec not found. Looked in: ${pathsToCheck.join(', ')}`;
      console.error('[CA_api Docs] ' + openapiLoadError);
    }
  } catch (err) {
    openapiLoadError = err.message;
    console.error('[CA_api Docs] Failed to load OpenAPI spec:', err);
  }
})();

// GET /api/v1/openapi.json
router.get('/openapi.json', (req, res) => {
  if (openapi) {
    return res.json(openapi);
  }
  res.status(500).json({ error: 'OpenAPI specification file is missing on server', details: openapiLoadError });
});

module.exports = router;

