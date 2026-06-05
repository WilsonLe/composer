---
description: "Composer local service management conventions for user-level systemd, local config, and persistent connector data."
applyTo: "scripts/composer-service.sh,ops/**,.pi/skills/manage-composer-server/**,README.md,.env.example,package.json"
---

# Composer server management

- Manage the local server through `scripts/composer-service.sh`; avoid hand-writing ad hoc systemd units.
- The committed systemd asset is a template at `ops/systemd/composer.service.template`; the installer renders it to `~/.config/systemd/user/composer.service`.
- Use a user-level service (`systemctl --user`) named `composer.service`; do not require sudo for normal local service management.
- Keep service config and secrets in `~/.config/composer/composer.env` with `0600` permissions. Do not print the secret values in logs or final reports.
- Persist connector data outside the checkout at `~/.local/share/composer/connectors.json` via `CONNECTOR_STORE_PATH`.
- Default the local listener to `COMPOSER_HOSTNAME=127.0.0.1` and `PORT=42456` unless the user explicitly chooses a different binding.
- When removing stale instances after service or port changes, kill only Composer-owned processes confirmed by cwd or `composer.service` cgroup membership; do not kill unrelated `next-server` processes.
- Validate service changes with `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `scripts/composer-service.sh doctor` when systemd is available.
