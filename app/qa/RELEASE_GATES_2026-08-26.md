# Apertale release gates — 2026-08-26 NZST

## Current tree

- `npm run typecheck` — passed.
- `npm test -- --run` — 4 files, 32 tests passed.
- `npm run build` — passed; Sites bundle prepared, 19 MB total.
- `npm run test:sites` — 4 tests passed.
- `npm audit --omit=dev` — 0 vulnerabilities.
- `git diff --check` — passed.
- `gitleaks detect --no-git --source . --redact --exit-code 1` — 1.29 MB of scannable source inspected, no leaks.

Vite reports the separately lazy-loaded Three.js vendor chunk at 560.58 kB minified / 143.01 kB gzip. This is a non-blocking size warning; the application shell and `ThreeBook` adapter remain separate chunks.

## Isolated source replay

A fresh temporary export excluded `.git`, `node_modules`, and `dist`, then passed:

1. `npm ci`
2. `npm run typecheck`
3. `npm test -- --run` — 32 tests
4. `npm run build`
5. `npm run test:sites` — 4 tests

## Codex in-app browser acceptance

- Verified four independent Sample Books and real-scene library covers.
- Verified Colosseum and Great Pyramid 3D scenes, structured fact card, continuous page turn, Day/Night, Preview, Story/Escape, form-safe arrow keys, lock/disabled controls, and 2D/reduced-motion navigation.
- A fresh compatible-PNG tab produced no console warnings or errors.
- A WebP optimization probe was rejected after the target browser emitted `EncodingError` and rendered blank pages; the release retains the verified PNG artwork.
- `document.modelContext` was not injected in this local Codex browser session, so real supporting-host tool discovery remains an external gate.
