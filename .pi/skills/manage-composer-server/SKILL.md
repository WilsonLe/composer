---
name: manage-composer-server
description: Manages the local Composer Next.js server as a user-level systemd service with config in ~/.config/composer and connector data in ~/.local/share/composer. Use when asked to install, start, stop, restart, inspect, tail logs, repair, or configure the Composer server/service.
---

# Manage Composer Server

Use the repository helper script instead of hand-writing systemd commands. Resolve relative paths from the Composer repository root.

## Defaults

- Service: user-level `composer.service` managed with `systemctl --user`.
- App checkout: the current Composer repository root.
- Config/env file: `~/.config/composer/composer.env` with mode `0600`.
- Persistent connector data: `~/.local/share/composer/connectors.json`.
- Unit file: `~/.config/systemd/user/composer.service` rendered from `ops/systemd/composer.service.template`.
- Default listener: `HOSTNAME=127.0.0.1`, `PORT=3000`.

## Commands

From the Composer repo root:

```bash
scripts/composer-service.sh doctor
scripts/composer-service.sh install
scripts/composer-service.sh status
scripts/composer-service.sh logs
scripts/composer-service.sh restart
scripts/composer-service.sh stop
scripts/composer-service.sh start
```

`install` runs `pnpm install --frozen-lockfile`, `pnpm build`, renders the unit, reloads the user manager, and runs `systemctl --user enable --now composer.service`.

## Environment and secrets

Do not print secrets from `~/.config/composer/composer.env`. The installer creates missing values for:

- `CONNECTOR_ENCRYPTION_KEY`
- `COMPOSER_CONNECTOR_ADMIN_TOKEN`
- `CONNECTOR_STORE_PATH`
- `PORT`
- `HOSTNAME`

If the service starts but connector API calls return 401/503, inspect whether `COMPOSER_CONNECTOR_ADMIN_TOKEN` exists in the env file without echoing the token.

## Safe workflow

1. Run `scripts/composer-service.sh doctor`.
2. Run `scripts/composer-service.sh install` after validated code is merged to the local main checkout.
3. Verify `scripts/composer-service.sh status` and `curl -fsS http://127.0.0.1:3000/`.
4. Use `scripts/composer-service.sh logs` for runtime failures.
5. Use `scripts/composer-service.sh restart` after env changes or new builds.

Use `scripts/composer-service.sh uninstall` only when explicitly asked; it removes the user unit but leaves config and data intact.
