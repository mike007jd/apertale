# Apertale release gates — checked 2026-08-28 NZST

## Current private tree

- `npm run typecheck` — passed.
- `npm test` — 4 files, 39 tests passed.
- `npm run build` — passed; the host-portable Sites bundle is currently about 165 MiB with no GLB/glTF payload. It contains five dedicated generated covers, fourteen knowledge panoramas, clean plates, and transparent foreground layers. Asset-size reduction remains an open release task.
- `npm run test:sites` — rebuilds first, then passes 7 tests including the deployment HTTP-contract verifier and artwork-uniqueness check.
- `npm run audit:cutouts` — **blocked**: 16 assets pass and 66 still-referenced v2 cutouts fail the required transparent edge padding. This is a release asset defect, not a code-gate failure.
- `npm audit --omit=dev` — 0 vulnerabilities.
- `gitleaks detect --no-git --source . --redact --exit-code 1` — passed, no leaks.
- `git diff --check` and the active-document local-link scan — passed.

Vite keeps the physical book renderer behind a lazy chunk. The latest hygiene build emits approximately 48 kB of CSS, 24 kB for the lazy physical-book module, 380 kB for the app module, and 520 kB for the Three.js vendor chunk. The Three.js warning and total host-portable bundle size remain open release-size work.

## Earlier isolated source replay

Before the current uncommitted hygiene pass, a fresh temporary export excluded `.git`, `node_modules`, and `dist`, then passed from its own working directory. Repeat this replay after the current tree is committed; the numbers below are historical evidence, not current-gate claims:

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`
5. `npm run test:sites`

## OpenAI illustration assets

- Eight landmark and six science spreads are dedicated full-spread OpenAI ImageGen illustrations. Five books use independent portrait covers rather than crops from their interiors.
- The storm spread includes three transparent ImageGen lightning frames. Runtime diagnostics observed frame indices `2` and `1` after the resting frame, proving all three frames participate in the loop.
- The runtime contains no content model loader, model identifier, GLB/glTF file, external model-generation provider, or site-owner generation key. Three.js remains only for the physical book, lighting, raycasting, particles, and page deformation.
- Compatibility-tested PNG remains the delivery format because the target in-app browser rejected the attempted WebP package. The later clean plates and independently generated foreground layers increased the current bundle to about 165 MiB; this document does not treat the earlier 21 MB checkpoint as current release truth.

## In-app browser acceptance

- The production bundle at the local preview registered and exposed exactly six Site Tools; the browser surfaced their complete schemas and descriptions.
- The first screen showed the five-cover editorial library, Field Guide, explicit **Create Your Own** action, and curated-demo disclosure.
- The full-screen blank-book workshop had autofocus, a focus trap, Escape close, focus restoration, explicit starter-copy feedback, length/style choices, and the secondary Image handoff.
- Five independent books expose `4 / 8 / 6 / 5 / 5` spreads. Every non-guide spread has an authored hover, focus, and click reveal contract.
- The landmark and science spreads fill the two-page stage, preserve a natural copy-safe region, and retain their generated paper-collage treatment in Day and Night.
- Fresh dual-sampled turns completed at 65 FPS forward and 61 FPS backward, above the 45 FPS floor. Forward emitted one `turning-leaf` composition capture; backward emitted `turning-leaf` plus `backward-base`, and three-phase visual inspection showed no blank model frame, page tear, or context-loss event.
- All five active books use independently generated portrait cover artwork. The existing six-tool WebMCP surface now supports validated, undoable active-book cover assignment through `manage_book(action: "set-cover")`.
- The repository-level `.codex/skills/apertale-authoring` skill validates and documents the complete text-led, photo-led, and illustration-led workflow through the six Site Tools.
- Day/Night, knowledge cards, the 2D/reduced-motion cover-gallery fallback, full-spread PNG loading, three-frame animation, and page-turn composition capture were verified in the user's selected in-app browser with no console warning or error.
- Book selection now acknowledges immediately on the chosen cover, blocks duplicate activation, and keeps an honest `Opening … / Preparing the illustrated pages…` status until the renderer reports its first complete frame. Diagnostics verified ordered `book:open-requested` → `book:loading` → `book:ready` events over 1.5–1.7 second cold render cycles; the library closes only after `ready`.

## Deliberately external

The repository has no remote and no new deployment was created. A judge-facing URL, public repository, recorded end-to-end Site Tool mutation/undo run, demo video, and Devpost submission remain external shared-state actions requiring the user's approval.
