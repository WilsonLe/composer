# Composer

Initial Next.js + shadcn app for Composer.

The first-pass UI is intentionally just the centered `/` page text: `composer`.

## Development

```bash
pnpm install
pnpm dev
```

Copy `.env.example` to `.env.local` before using connector APIs.

## Connector backend foundation

Connector credentials are stored in a local encrypted JSON file at `.data/connectors.json` by default. `.data/` is gitignored.

Required environment variables:

- `CONNECTOR_ENCRYPTION_KEY` — encryption key for stored connector credentials. Generate one with `openssl rand -base64 32`.
- `COMPOSER_CONNECTOR_ADMIN_TOKEN` — bearer token required by connector API routes until the app has real user auth.

Send the admin token as either:

```http
Authorization: Bearer <token>
```

or:

```http
X-Composer-Admin-Token: <token>
```

### ChatGPT Codex login

Start a PKCE/manual callback authorization:

```bash
curl -X POST http://localhost:3000/api/connectors/codex/authorizations \
  -H "Authorization: Bearer $COMPOSER_CONNECTOR_ADMIN_TOKEN"
```

Open the returned `authUrl`, complete OpenAI login, then paste the callback URL into:

```bash
curl -X POST http://localhost:3000/api/connectors/codex/connections \
  -H "Authorization: Bearer $COMPOSER_CONNECTOR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"authorizationId":"<id>","callbackInput":"<callback-url>"}'
```

### Deepgram speech-to-text connector login

Verify and save a Deepgram API key:

```bash
curl -X POST http://localhost:3000/api/connectors/deepgram/connections \
  -H "Authorization: Bearer $COMPOSER_CONNECTOR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"<deepgram-api-key>","name":"Deepgram"}'
```

List saved connections:

```bash
curl http://localhost:3000/api/connectors/codex/connections \
  -H "Authorization: Bearer $COMPOSER_CONNECTOR_ADMIN_TOKEN"

curl http://localhost:3000/api/connectors/deepgram/connections \
  -H "Authorization: Bearer $COMPOSER_CONNECTOR_ADMIN_TOKEN"
```
