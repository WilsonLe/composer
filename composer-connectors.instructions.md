---
description: "Composer connector API, UI, and failover conventions for Codex and Deepgram providers."
applyTo: "src/lib/connectors/**,src/app/api/connectors/**,src/components/composer-shell.tsx,README.md"
---

# Composer connectors

- Connector admin APIs require `COMPOSER_CONNECTOR_ADMIN_TOKEN`; accept it only as `Authorization: Bearer <token>` or `X-Composer-Admin-Token`.
- Never return raw connector secrets from public API responses. Keep Codex tokens and Deepgram API keys encrypted in the connector store.
- Connector failover order is ascending `priority`; the first enabled, `connected` provider is active and remaining enabled, `connected` providers are fallbacks.
- Existing stored connections may be missing `enabled` or `priority`; public reads should default them to enabled with a safe normalized priority.
- The browser UI may persist the admin token in local storage under `composer.adminToken`, but must not render or log the token value.
