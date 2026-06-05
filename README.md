# Composer

Mobile-first Next.js + shadcn app for Composer.

The `/` page uses a shadcn sidebar with two primary sections: **Compose** and **Connectors**. Compose is split between writing and AI chat history panels. Connectors is a table-first readiness view for Codex and Deepgram credentials.

## Development

```bash
pnpm install
pnpm dev
```

Copy `.env.example` to `.env.local` before saving connector credentials in development.

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

The installer creates missing `CONNECTOR_ENCRYPTION_KEY` values in the env file. Do not commit or print that file.

Future Pi sessions can load the project skill at `.pi/skills/manage-composer-server/SKILL.md` for service management.

## Connector UI and backend foundation

Open `http://127.0.0.1:42456/` and use the sidebar to choose **Connectors**. Composer is a local single-user app with no app-level auth; connector APIs are unauthenticated and rely on the default `127.0.0.1` listener. Do not expose Composer on a public interface unless another trusted layer protects it.

Connector credentials are stored in a local encrypted JSON file at `.data/connectors.json` by default in development. The systemd service stores them at `~/.local/share/composer/connectors.json`. Both paths are outside git tracking.

Required environment variables:

- `CONNECTOR_ENCRYPTION_KEY` — encryption key for stored connector credentials. Generate one with `openssl rand -base64 32`.

### ChatGPT Codex login

Start a PKCE/manual callback authorization:

```bash
curl -X POST http://localhost:42456/api/connectors/codex/authorizations
```

Open the returned `authUrl`, complete OpenAI login, then paste the callback URL into:

```bash
curl -X POST http://localhost:42456/api/connectors/codex/connections \
  -H "Content-Type: application/json" \
  -d '{"authorizationId":"<id>","callbackInput":"<callback-url>"}'
```

### Deepgram speech-to-text connector login

Verify and save a Deepgram API key:

```bash
curl -X POST http://localhost:42456/api/connectors/deepgram/connections \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"<deepgram-api-key>","name":"Deepgram"}'
```

List saved connections and failover readiness:

```bash
curl http://localhost:42456/api/connectors

curl http://localhost:42456/api/connectors/codex/connections

curl http://localhost:42456/api/connectors/deepgram/connections
```

Manage failover settings with `PATCH /api/connectors/{codex|deepgram}/connections/{id}` and JSON fields such as `enabled` and `priority`. Composer treats the first enabled, connected provider by ascending `priority` as active; remaining enabled, connected providers are fallbacks. Delete saved credentials with `DELETE /api/connectors/{codex|deepgram}/connections/{id}`.
