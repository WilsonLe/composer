---
description: "Composer embedded Pi runtime, STT turn handling, and edit-proposal conventions."
applyTo: "src/lib/composer/**,src/app/api/compose/**,src/components/composer-shell.tsx,next.config.ts,package.json,pnpm-workspace.yaml"
---

# Composer Pi runtime

- Keep Composer's embedded Pi runtime isolated from the user's default Pi config: use Composer data paths for `agentDir` and session storage, and do not read `~/.pi/agent` auth.
- Use the active Codex connector for ChatGPT OAuth credentials and keep `gpt-5.5` as the default Codex model unless the product explicitly changes it.
- The only tool exposed to the embedded agent is `propose_edit_text`; it must create pending HITL proposals and never apply text directly.
- Edit proposals are ranged character edits against the current Writing text. Accepting a proposal applies those ranges to the current draft and marks the proposal accepted.
- Only STT-derived transcript messages should trigger Pi turns. Typed chat notes may be persisted for operator context, but must not be sent to the agent.
- Deepgram is the STT source; transcriptions should use the active enabled/connected Deepgram connector by failover priority.
- Keep `@earendil-works/pi-*` packages externalized in Next server builds because the Pi runtime uses dynamic Node imports that Turbopack cannot safely bundle.
