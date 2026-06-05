---
description: "Composer connector API, UI, and failover conventions for Codex and Deepgram providers."
applyTo: "src/lib/connectors/**,src/app/api/connectors/**,src/components/composer-shell.tsx,README.md"
---

# Composer connectors

- Composer is a local single-user app with no app-level auth; connector APIs are unauthenticated and rely on the default `127.0.0.1` listener.
- Never expose Composer on a public interface unless another trusted layer protects the app and connector APIs.
- Never return raw connector secrets from public API responses. Keep Codex tokens and Deepgram API keys encrypted in the connector store.
- Connector failover order is ascending `priority`; the first enabled, `connected` provider is active and remaining enabled, `connected` providers are fallbacks.
- Existing stored connections may be missing `enabled` or `priority`; public reads should default them to enabled with a safe normalized priority.
- Keep the primary Composer shell as a shadcn sidebar with exactly two top-level options: Compose and Connectors.
- Keep the Connectors view table-first, mirroring WilsonLe/app table density; avoid nested provider setup cards in the main Connectors content.
- Keep connector creation behind the `+ Connector` sheet so the main Connectors page remains header plus table.
