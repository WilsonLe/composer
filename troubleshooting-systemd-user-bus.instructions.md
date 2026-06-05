---
description: "Diagnosing Composer user systemd failures when non-login shells cannot find the user bus."
applyTo: "scripts/composer-service.sh,ops/systemd/**,README.md,.pi/skills/manage-composer-server/**"
---

# Systemd user bus failures

- Symptom: `systemctl --user ...` fails with `Failed to connect to bus: No medium found` even though PID 1 is `systemd` and `loginctl show-user` reports an active user manager.
- Root cause: the shell lacks `XDG_RUNTIME_DIR`, so `systemctl --user` cannot find the user's systemd bus at `/run/user/<uid>`.
- Fix: service-management helpers should set `XDG_RUNTIME_DIR=/run/user/$(id -u)` when it is unset and that directory exists.
- Verification: rerun `scripts/composer-service.sh doctor`; it should report `systemd user manager: ok`.
