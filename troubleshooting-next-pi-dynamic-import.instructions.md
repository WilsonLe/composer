---
description: "Next.js/Turbopack build errors when Composer API routes import the embedded Pi runtime."
applyTo: "next.config.ts,src/lib/composer/**,src/app/api/compose/**,package.json"
---

# Next Pi dynamic imports

- Symptom: `pnpm build` compiles, then page-data collection prints `Cannot find module as expression is too dynamic` after server routes import `@earendil-works/pi-*`.
- Root cause: Pi packages use dynamic Node imports that Turbopack cannot safely bundle into Next server chunks.
- Fix: keep Pi packages in `next.config.ts` `serverExternalPackages` (`@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`).
- Verification: rerun `pnpm typecheck` and `pnpm build`; page-data collection should complete without the dynamic-module errors.
