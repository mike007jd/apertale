# Apertale application

Apertale is a WebMCP-native creative canvas for living illustrated books. A person and their own ChatGPT or Codex Agent operate the same live, revisioned artifact: either side can inspect structured elements, assign safe interactions, transform or animate them, change presentation, and undo exact changes.

The page is explicitly WebMCP-enabled. In a browser without the injected runtime, the Story panel reports `WebMCP ready`; in a supported ChatGPT desktop built-in browser it reports `WebMCP connected` after the tools register.

WebMCP is agent-neutral, not universally callable. Any Agent whose browser or host implements WebMCP discovery, permission mediation, and execution can use this seven-tool surface; an arbitrary standalone Agent cannot call it merely because the page registers tools. As of 2026-08-27, OpenAI Site Tools require account/model access and the ChatGPT desktop built-in browser, with the providing page kept open.

## Current product slice

- A clean first-run editorial library with five independent generated hardcovers laid directly on the page, an Apertale Field Guide, and a shared **Create Your Own** blank-book workshop on both the library and reader surfaces.
- The workshop keeps authoring mode, book length, visual direction, and an ordered source-photo handoff on the open 3D pages. It copies an Agent-ready starter; the user supplies the story and audience in their Agent conversation instead of completing a duplicate site form. A quiet **Image handoff** fallback creates browser-local assets only when the current host cannot transfer media through WebMCP.
- Real Three.js/WebGL book scene with curved pages, cover depth, shadows, two-sided textures, pointer-driven page turns, and freeze-to-texture composition sampling so illustrated layers remain visible during forward and backward turns.
- `Paper Atelier` Day and `Midnight Desk` Night presentations over one document.
- Declarative hover, focus, reveal, and motion behavior drawn from closed reviewed presets.
- Twenty-eight sample spreads across the Guide, eight-spread landmark atlas, six-spread science book, personal story, and lantern story.
- Fourteen purpose-generated panorama spreads, transparent cut-paper layers, and a true three-frame lightning sequence; no runtime model payload or external generation credential.
- IndexedDB Blob storage for user-imported PNG/JPEG/WebP assets, with browser-local resize/compression from source files up to 12 MB to stored assets no larger than 1.5 MB, a cross-book local asset directory, stable IDs, and reload-safe object URL resolution.
- A persistent multi-book library; Sample Books are independent projects rather than unrelated spreads in one document. Curated illustrations are labeled as samples.
- Shared human/WebMCP command engine with revision checks, idempotency, visible provenance, and exact undo tokens.
- A versioned creation-readiness gate that returns blocking fields and direct questions, validates real source assets/identity constraints, and is enforced again by create.
- A shared quality rubric with deterministic checks, real-render evidence, explicit AI visual critique, a two-round repair ceiling, and fail-closed Share/Publish.
- Responsive desktop/mobile layouts, reduced-motion behavior, and 2D fallback.

## WebMCP tool surface

The page registers exactly eight project-level tools through `document.modelContext.registerTool()`:

1. `get_project_context`
2. `manage_book`
3. `compose_spread`
4. `apply_scene_patch`
5. `set_presentation`
6. `undo_project_change`
7. `sketch_storyboard`
8. `request_image_handoff`

Every mutating tool requires a `requestId`. Book and presentation mutations also require `expectedDocumentId` and `expectedRevision` from the same current context; successful document mutations include an exact `undoToken`. `sketch_storyboard` draws normalized pencil strokes on the blank 3D book and reads the reader's red annotations back through project context before changing only marked spreads. `request_image_handoff` requires an explicit asset role: `source-photo` adds reader references to the next creation brief, while `book-art` imports generated covers, spreads, clean plates, or cutouts into the reusable asset registry. `set_presentation` can acknowledge either a visible reader spread or a shelf cover; neither operation changes the document revision.

`get_project_context` defaults to a compact response. Focused details add `authoring-guide`, structured `creation-readiness`, local `assets`, a selected reveal, or the versioned `quality-review` rubric/render manifest. Create reads the guide, checks readiness, asks every blocking question, and reuses the same brief; the command runs that gate again and fails closed. A legacy personal book can use the one-time, revision-bound `adopt-creation-brief` action with the same gate; samples and books that already own a brief cannot be reclassified. After real rendering, `manage_book` explicitly begins and records at most two critique rounds. `manage_book` also opens books and assigns a validated browser-local portrait cover. `apply_scene_patch` covers Lift, transform, structured reveal, motion, interaction, add/remove, and ordering through one bounded atomic contract. A local `asset:` ID is accepted only after the IndexedDB adapter proves that it exists. Internal fine-grained commands remain shared with the human UI but are not exposed as additional WebMCP tools.

Deterministic checks prove structural facts such as cover/final-base presence, an original-composite reference, separate personal-photo provenance, 2–4 foreground layers, meaningful interaction, text bounds, and current-revision render events. WebGL waits for the exact spread asset/texture set; the 2D fallback composes the same final base and non-procedural foregrounds, and neither path records evidence after a load failure. These checks do not claim aesthetic quality. The Agent must inspect real cover/spread frames for composition, readability, consistency, photo fidelity, alpha edges, and promotional value, then submit evidence-backed blocker/warn/note results. Blockers close Share; recorded warnings may proceed only in a sample-ready report. The Worker accepts checked-in `/assets/...` references only from the generated bundled-asset catalog and revalidates the same brief/provenance policy.

The eight registration promises are treated as one fail-closed set. One registration failure aborts the shared lifecycle signal and removes any partial registration. Both Vite and the deployment Worker send `Origin-Agent-Cluster: ?1` and `Permissions-Policy: tools=(self)`.

## Run and verify

```bash
npm ci
npm run dev
npm run verify:release
npm run verify:assets
npm run verify:deployment -- https://PUBLIC_APERTALE_URL/
```

Use Node.js `^22.12.0` or `>=24.0.0`; CI and the current local baseline use Node 24.18.0. Node 20 is intentionally excluded because it is [end-of-life](https://nodejs.org/en/about/previous-releases). `npm run verify:release` is the deterministic code, type, unit, production-build, and Worker/Sites gate. `npm run verify:assets` is a separate visual-production audit and currently exits non-zero for 41 referenced legacy v2 layers that need regeneration rather than padding-only repair. Twenty-five retired layers were removed after their sample spreads moved to grounded composite artwork.

`npm run audit:cutouts` and `npm run optimize:assets` shell out to the ImageMagick 7 CLI, so they require a `magick` executable on `PATH` (install ImageMagick 7, for example with `brew install imagemagick` on macOS); without it the audit reports an ImageMagick inspection failure for every file.

`npm run optimize:assets` is a maintenance command that rewrites checked-in runtime images. Use it only for a deliberate asset-optimization batch and review the generated diff.

The production build is emitted as a host-portable bundle:

- `dist/client/app-shell`
- `dist/server/index.js`
- `dist/.openai/hosting.json`
- every numbered migration under `dist/.openai/drizzle/`

## Architecture map

- `src/ThreeBook.tsx` — Three.js physical-book renderer, page geometry, illustrated layer raycasting, theme lighting, frame animation, and dual-surface turn sampling.
- `src/interaction.ts` — closed declarative interaction vocabulary and renderer traits.
- `src/imageOptimizer.ts` — browser-local resize/compression with alpha-aware PNG/JPEG output and a 1.5 MB storage ceiling.
- `src/assetStore.ts` — IndexedDB Blob persistence, optimization metadata, and safe object URL resolution.
- `src/bookEngine.ts` — authoritative document/session state, persistence, revision checks, idempotency, and exact undo.
- `src/pageTurn.ts` — shared editor/reader page-turn session lifecycle and physical-page geometry helpers.
- `src/creationWorkshop.ts` — creation setup state, ordered local-asset restoration, and brief materialization.
- `src/authoringContract.ts` and `src/creationBrief.ts` — versioned readiness ownership, direct questions, and site-native Agent instructions.
- `src/qualityContract.ts` and `worker/qualityRubric.json` — advisory quality rubric, deterministic/visual boundary, render manifest, and report validation.
- `src/projectArtifact.ts` — location-aware traversal of every asset-bearing project field.
- `src/webmcp.ts` — WebMCP registrations backed by the shared command engine.
- `src/App.tsx` — accessible React editor, knowledge cards, themes, selection tools, outline, and responsive controls.
- `src/sampleBook.ts` — independent Sample Book catalog and their initial spreads.

Three.js is loaded as a lazy production chunk so the editor shell can render before the WebGL engine finishes loading.

The repository-level [Apertale Authoring skill](../.codex/skills/apertale-authoring/SKILL.md) teaches Agents the text-led, photo-led, and illustration-led workflows, the seven-tool sequence, host-first media transfer with an explicit handoff fallback, revision discipline, and optional quality review.

## Current technical baseline

Checked against current primary sources on 2026-08-27:

- WebMCP imperative API: `document.modelContext.registerTool()` with registration and execution `AbortSignal` support — [Chrome documentation](https://developer.chrome.com/docs/ai/webmcp/imperative-api) and [WebMCP specification](https://github.com/webmachinelearning/webmcp)
- WebMCP security annotations, origin exposure, and character budgets — [Chrome security guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
- ChatGPT site-tool host behavior — [OpenAI Help Center](https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app)
- Type declarations: `webmcp-types@0.1.5`
- Renderer: `three@0.185.1`
- UI/runtime: `react@19.2.0`, `vite@6.4.3`

The public Site and anonymous share reader were live-verified on 2026-08-28. Treat any republish as an explicit release action. No owner OpenAI API key is embedded.
