# Composer

Mobile-first Next.js + shadcn app for Composer.

The `/` page includes the Composer drafting surface plus connector menus for Codex and Deepgram setup. The writing runtime is intentionally disabled until the Pi-agent composing slice lands.

## Development

```bash
pnpm install
pnpm dev
```

Copy `.env.example` to `.env.local` before using connector APIs in development.

## Local systemd service

Composer includes a user-level systemd manager script:

```bash
scripts/composer-service.sh doctor
scripts/composer-service.sh install
scripts/composer-service.sh status
scripts/composer-service.sh logs
```

`install` runs `pnpm install --frozen-lockfile`, builds the app, renders `~/.config/systemd/user/composer.service`, and starts `composer.service` with `systemctl --user`.

Default local service paths:

- Config/env: `~/.config/composer/composer.env`
- Connector data: `~/.local/share/composer/connectors.json`
- Unit file: `~/.config/systemd/user/composer.service`
- URL: `http://127.0.0.1:42456`

The installer creates missing `CONNECTOR_ENCRYPTION_KEY` and `COMPOSER_CONNECTOR_ADMIN_TOKEN` values in the env file. Do not commit or print that file.

Future Pi sessions can load the project skill at `.pi/skills/manage-composer-server/SKILL.md` for service management.

## Connector UI and backend foundation

Open `http://127.0.0.1:42456/`, choose **Connectors**, and paste the local `COMPOSER_CONNECTOR_ADMIN_TOKEN` from your environment file. The browser stores that token in local storage under `composer.adminToken` and sends it as a bearer token to the local connector APIs; the app does not render the token back to the page.


Connector credentials are stored in a local encrypted JSON file at `.data/connectors.json` by default in development. The systemd service stores them at `~/.local/share/composer/connectors.json`. Both paths are outside git tracking.

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
curl -X POST http://localhost:42456/api/connectors/codex/authorizations \
  -H "Authorization: Bearer $COMPOSER_CONNECTOR_ADMIN_TOKEN"
```

Open the returned `authUrl`, complete OpenAI login, then paste the callback URL into:

```bash
curl -X POST http://localhost:42456/api/connectors/codex/connections \
  -H "Authorization: Bearer $COMPOSER_CONNECTOR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"authorizationId":"<id>","callbackInput":"<callback-url>"}'
```

### Deepgram speech-to-text connector login

Verify and save a Deepgram API key:

```bash
curl -X POST http://localhost:42456/api/connectors/deepgram/connections \
  -H "Authorization: Bearer $COMPOSER_CONNECTOR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"<deepgram-api-key>","name":"Deepgram"}'
```

List saved connections and failover readiness:

```bash
curl http://localhost:42456/api/connectors \
  -H "Authorization: Bearer $COMPOSER_CONNECTOR_ADMIN_TOKEN"

curl http://localhost:42456/api/connectors/codex/connections \
  -H "Authorization: Bearer $COMPOSER_CONNECTOR_ADMIN_TOKEN"

curl http://localhost:42456/api/connectors/deepgram/connections \
  -H "Authorization: Bearer $COMPOSER_CONNECTOR_ADMIN_TOKEN"
```

Manage failover settings with `PATCH /api/connectors/{codex|deepgram}/connections/{id}` and JSON fields such as `enabled` and `priority`. Composer treats the first enabled, connected provider by ascending `priority` as active; remaining enabled, connected providers are fallbacks. Delete saved credentials with `DELETE /api/connectors/{codex|deepgram}/connections/{id}`.
