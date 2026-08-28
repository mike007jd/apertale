# Apertale

**Open a page. Enter a world.**

Apertale is a WebMCP-native canvas for interactive books. A person describes what they want in their own ChatGPT or Codex conversation; the host Agent uses Apertale's structured tools to compose, animate, and revise the same live book the person can turn, inspect, and edit directly.

![Apertale Day presentation showing a panoramic illustrated world inside an open book](app/qa/apertale-atlas-day-current.png)

The application provides the medium—Three.js book rendering, assets, safe interaction presets, project state, and exact undo. The user's ChatGPT session in a supporting host provides the intelligence and model usage. The project contains no shared owner-funded OpenAI API key and no fake in-page AI composer. Direct Codex-host WebMCP availability remains host-dependent and must be verified separately.

## Current build

- An editorial five-book library that opens first, lays five independently generated hardcovers directly on the page, puts a four-spread Field Guide first, and points creation to the user's real Codex/ChatGPT conversation.
- A tactile Three.js/WebGL book with deforming page geometry and a 2D/reduced-motion fallback.
- Day and Night presentation modes over one revisioned document.
- Shared human/WebMCP command engine with revision checks, idempotency, provenance, and exact undo tokens.
- WebMCP book creation, dedicated cover assignment, spread composition, structured knowledge reveals, and atomic bounded scene patches, plus focused inspection of selected reveals and local assets.
- Versioned brief readiness that returns concrete questions and blocks create when story, source-photo, or identity-critical input is missing.
- Current-revision render evidence, a deterministic plus real-frame AI critique rubric, a two-round repair ceiling, and fail-closed Share/Publish.
- Native local PNG/JPEG/WebP import backed by IndexedDB Blob storage; source files up to 12 MB are resized and compressed in the browser to at most 1.5 MB, survive reload, remain reusable across books, and are accepted by the Agent only after a real local-store lookup.
- Declarative hover and click interactions validated against closed presets.
- Twenty-eight spreads across five independent books, including an eight-spread landmark atlas and a six-spread science book.
- Fourteen dedicated ImageGen panorama spreads for the landmark atlas and science book, plus transparent illustrated layers and a three-frame lightning sequence.
- A host-portable Sites bundle. The public Site and anonymous share reader were live-verified on 2026-08-28; any republish remains an explicit release action.

## Try the collaboration loop

In a WebMCP-enabled ChatGPT desktop built-in browser, open Apertale and try:

> Inspect this Apertale project. Tell me which book, spread, and revision are open, then switch to Atlas of Living Wonders.

> Help me create a one-spread illustrated book about the geometry of eclipses. Check whether my brief is ready, ask for anything critical, then create it with a dedicated cover, full-spread art, meaningful layers, and interaction. Inspect the rendered result, critique it, patch blockers, and stop only when it is publish-ready or needs my decision.

> Inspect my latest manual placement. Change only the object's motion, then undo your motion change without moving it back.

The first prompt proves page-grounded context and library navigation. The second proves structured authoring. The third proves that the Agent and the person share one revisioned artifact and that exact undo preserves later non-overlapping human work.

### Five independent books, two presentations

| Library | Night presentation |
|---|---|
| ![Apertale editorial library with five independent generated covers and the Field Guide first](app/qa/apertale-library-current.png) | ![Apertale Night presentation with a full-spread illustrated landmark](app/qa/apertale-atlas-night-current.png) |

## Run locally

```bash
cd app
npm install
npm run dev
```

## Verify

```bash
cd app
npm run typecheck
npm test
npm run test:sites
npm run audit:cutouts
npm run verify:deployment -- https://PUBLIC_APERTALE_URL/
```

`npm run verify:release` runs the complete local sequence. The current private tree intentionally fails its final cutout-quality gate: 66 legacy v2 layers require genuine regeneration because visual review found clipped subjects, detached fragments, or contaminated edges. See [`app/qa/RELEASE_GATES_2026-08-27.md`](app/qa/RELEASE_GATES_2026-08-27.md) rather than treating the code/build passes as release completion.

`npm run optimize:assets` is a maintenance command that rewrites checked-in runtime images. Run it only for an intentional asset-optimization change and review the resulting diff.

## Repository map

- [`app/`](app/) — React, TypeScript, Three.js, WebMCP adapter, tests, and host-portable production bundle.
- [`CONTEXT.md`](CONTEXT.md) — current domain ownership and adapter boundaries for page turns, authoring, assets, artifacts, and publishing schema.
- [`.codex/skills/apertale-authoring/`](.codex/skills/apertale-authoring/) — Codex authoring skill for planning and building books through the six Site Tools.
- [`docs/PRODUCT_ARCHITECTURE.md`](docs/PRODUCT_ARCHITECTURE.md) — active product, usage, asset, interaction, security, and delivery architecture.
- [`docs/CHALLENGE_READINESS.md`](docs/CHALLENGE_READINESS.md) — active challenge gate separating verified local work from missing external delivery.
- [`docs/ASSET_PROVENANCE.md`](docs/ASSET_PROVENANCE.md) — runtime illustration, cover, icon, reference, and user-import provenance.
- [`docs/SITE_TOOLS_ACCEPTANCE.md`](docs/SITE_TOOLS_ACCEPTANCE.md) — deployment verifier and real ChatGPT Site Tools acceptance story.
- [`docs/ELIGIBILITY_AND_BUILD_LOG.md`](docs/ELIGIBILITY_AND_BUILD_LOG.md) — challenge-period Git timeline and ownership evidence.
- [`docs/SUBMISSION_MEDIA.md`](docs/SUBMISSION_MEDIA.md) — source-true screenshots, captions, alt text, and demo-media usage.
- [`app/design-qa.md`](app/design-qa.md) — visual QA evidence and iteration history.
- [`docs/README.md`](docs/README.md) — current documentation and historical delivery evidence.

## Product boundary

The normal creation loop is bring-your-own-Agent:

1. Open Apertale in the supporting built-in browser and choose a sample or the Field Guide from the library.
2. Use **Create Your Own** to open the blank-book workshop and hand the brief to the real Agent conversation beside the browser.
3. Import source assets into the live page when needed. Apertale optimizes them locally and uploads only the assets referenced by a book when the user explicitly publishes it; this flow does not spend a site-owner model quota.
4. Ask Codex/ChatGPT to check readiness. It returns short, concrete questions instead of generating when critical input or source identity rules are missing.
5. The Agent builds through the page's WebMCP tools using the user's own account/session, renders every surface, and submits an evidence-backed critique.
6. Patch and re-check at most twice. Share opens only for the current revision when no blocker remains; otherwise the product asks for the missing material or decision.

Generated-image file transfer into a webpage is treated as an explicit import handoff until a direct host attachment bridge is verified. See the architecture document for the exact boundary.

License: [MIT](LICENSE).
