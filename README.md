# CA_api (Standalone External API)

Standalone Express service for external companies to integrate with Completeful/Canvas fulfillment via the **AI Integration Fulfillment API**.

## Endpoints

- **Health**: `GET /health`
- **OpenAPI spec**: `GET /api/v1/openapi.json`
- **API (requires Bearer API key)**:
  - `GET /api/v1/inventory`
  - `GET /api/v1/inventory/totals`
  - `GET /api/v1/inventory/totals/:sku`
  - `GET /api/v1/products`
  - `POST /api/v1/products`
  - `POST /api/v1/orders`
  - `GET /api/v1/orders/:orderNumber`
  - `PATCH /api/v1/orders/:orderNumber/address`
  - `POST /api/v1/orders/:orderNumber/cancel`
  - `POST /api/v1/returns`
  - `POST /api/v1/webhooks`
  - `GET /api/v1/webhooks`

## Environment

Create a `.env` file (see `.env.example`):

- `PORT`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SHIPSTATION_API_KEY`
- `SHIPSTATION_API_SECRET`
- `REDIS_URL` (optional, rate limit fail-open)
- `CORS_ALLOW_ORIGINS` (optional, comma-separated)
- `AI_API_DEBUG` (optional)

## Local run

```bash
npm install
npm start
```

