---
description: "Safely identifying and removing stale Composer Next.js processes after port or service changes."
applyTo: "scripts/composer-service.sh,README.md,.pi/skills/manage-composer-server/**,composer-server.instructions.md"
---

# Stale Composer instances

- Symptom: Composer service changes appear applied, but old `next-server` or `pnpm start` processes still listen on a previous port such as `3000`.
- Root cause: a previous manual smoke test or service run can leave an orphaned Composer-owned Next.js process after the service is reconfigured.
- Safety rule: do not kill every `next-server`; other local tools may use Next.js. Confirm Composer ownership by checking `readlink -f /proc/<pid>/cwd` points at the Composer checkout or by checking the process is part of `composer.service`.
- Fix: stop/restart `composer.service` first. Kill only Composer-owned stale processes that are not part of the active `composer.service` cgroup and are listening on non-default ports.
- Verification: `ss -ltnp` should show Composer only on the configured default port, and `curl -fsS http://127.0.0.1:<port>/` should return the Composer page.
