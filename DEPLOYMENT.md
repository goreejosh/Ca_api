# CA_api deployment + cutover

This service is intended to run **standalone** on a dedicated server/service, separate from the main Canvas app.

## Environment variables (required)

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (service role)
- `SHIPSTATION_API_KEY`
- `SHIPSTATION_API_SECRET`

## Environment variables (optional)

- `PORT` (default `4000`)
- `REDIS_URL` (enables rate limiting; if unset, rate limiting is skipped)
- `CORS_ALLOW_ORIGINS` (comma-separated allowlist)
- `SUPABASE_FETCH_TIMEOUT_MS`

## Deploy (Railway / nixpacks)

This repo includes `railway.json` + `nixpacks.toml`.

- Builder: nixpacks
- Start command: `npm start`
- Add env vars above to the service

## Deploy (dedicated server)

Minimal approach:

```bash
node -v  # >= 20
npm ci --only=production
PORT=4000 SUPABASE_URL=... SUPABASE_SECRET_KEY=... SHIPSTATION_API_KEY=... SHIPSTATION_API_SECRET=... npm start
```

Recommended:

- Put behind a reverse proxy (nginx/caddy) with HTTPS.
- Terminate TLS at proxy, forward to `localhost:<PORT>`.

## DNS + cutover

- Create a dedicated hostname such as `api.<your-domain>`.
- Point DNS to the dedicated service.
- Keep the legacy endpoint on the main app temporarily if partners still use it.
- Once partners are migrated, remove `/api/v1/*` mounts from the main app server.

## Notes for external partners

- Auth is via `Authorization: Bearer <api_key>`.
- Rate limit headers are returned when Redis is configured.

