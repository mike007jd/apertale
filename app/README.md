# Apertale application

Apertale is a WebMCP-native creative canvas for living illustrated books. A person and their own ChatGPT or Codex Agent operate the same live, revisioned artifact: either side can inspect structured elements, assign safe interactions, transform or animate them, change presentation, and undo exact changes.

The page is explicitly WebMCP-enabled. In a browser without the injected runtime, the Story panel reports `WebMCP ready`; in a supported ChatGPT desktop built-in browser it reports `WebMCP connected` after the tools register.

WebMCP is agent-neutral, not universally callable. Any Agent whose browser or host implements WebMCP discovery, permission mediation, and execution can use this six-tool surface; an arbitrary standalone Agent cannot call it merely because the page registers tools. As of 2026-08-27, OpenAI Site Tools require account/model access and the ChatGPT desktop built-in browser, with the providing page kept open.

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
- Responsive desktop/mobile layouts, reduced-motion behavior, and 2D fallback.

## WebMCP tool surface

The page registers exactly six project-level tools through `document.modelContext.registerTool()`:

1. `get_project_context`
2. `manage_book`
3. `compose_spread`
4. `apply_scene_patch`
5. `set_presentation`
6. `undo_project_change`

Mutating tools require a `requestId` and the current `expectedRevision`. Tool callbacks return compact JSON strings, and successful document mutations include an exact `undoToken`.

`get_project_context` defaults to a compact response and accepts focused `selected-reveal`, `assets`, or `authoring-guide` detail when the Agent needs the full knowledge card, reusable local-import directory, or the site-native two-phase create-quality contract. Create flows must read and obey `authoring-guide` before `manage_book` create; the registration session rejects create until that preflight succeeds. `manage_book` opens and creates independent books and assigns the active book a validated browser-local portrait cover. `apply_scene_patch` covers Lift, transform, structured reveal, motion, interaction, add/remove, and ordering through one bounded atomic contract. A local `asset:` ID is accepted only after the IndexedDB adapter proves that it exists. Internal fine-grained commands remain shared with the human UI but are not exposed as additional WebMCP tools.

The six registration promises are treated as one fail-closed set. One registration failure aborts the shared lifecycle signal and removes any partial registration. Both Vite and the deployment Worker send `Origin-Agent-Cluster: ?1` and `Permissions-Policy: tools=(self)`.

## Run and verify

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run test:sites
npm run audit:cutouts
npm run verify:deployment -- https://PUBLIC_APERTALE_URL/
```

`npm run verify:release` runs the complete local sequence. The current private tree intentionally fails its final cutout-quality gate: 66 legacy v2 layers need regeneration rather than padding-only repair. The code, unit, build, and Sites checks remain independently green.

`npm run optimize:assets` is a maintenance command that rewrites checked-in runtime images. Use it only for a deliberate asset-optimization batch and review the generated diff.

The production build is emitted as a host-portable bundle:

- `dist/client/app-shell`
- `dist/server/index.js`
- `dist/.openai/hosting.json`
- `dist/.openai/drizzle/0001_living_book_sharing.sql`

## Architecture map

- `src/ThreeBook.tsx` — Three.js physical-book renderer, page geometry, illustrated layer raycasting, theme lighting, frame animation, and dual-surface turn sampling.
- `src/interaction.ts` — closed declarative interaction vocabulary and renderer traits.
- `src/imageOptimizer.ts` — browser-local resize/compression with alpha-aware PNG/JPEG output and a 1.5 MB storage ceiling.
- `src/assetStore.ts` — IndexedDB Blob persistence, optimization metadata, and safe object URL resolution.
- `src/bookEngine.ts` — authoritative document/session state, persistence, revision checks, idempotency, and exact undo.
- `src/pageTurn.ts` — shared editor/reader page-turn session lifecycle and physical-page geometry helpers.
- `src/creationWorkshop.ts` — creation setup state, ordered local-asset restoration, and brief materialization.
- `src/projectArtifact.ts` — location-aware traversal of every asset-bearing project field.
- `src/webmcp.ts` — WebMCP registrations backed by the shared command engine.
- `src/App.tsx` — accessible React editor, knowledge cards, themes, selection tools, outline, and responsive controls.
- `src/sampleBook.ts` — independent Sample Book catalog and their initial spreads.

Three.js is loaded as a lazy production chunk so the editor shell can render before the WebGL engine finishes loading.

The repository-level [Apertale Authoring skill](../.codex/skills/apertale-authoring/SKILL.md) teaches Agents the text-led, photo-led, and illustration-led workflows, exact six-tool sequence, host-first media transfer with a minimal fallback, revision discipline, and final quality gate.

## Current technical baseline

Checked against current primary sources on 2026-08-27:

- WebMCP imperative API: `document.modelContext.registerTool()` with registration and execution `AbortSignal` support — [Chrome documentation](https://developer.chrome.com/docs/ai/webmcp/imperative-api) and [WebMCP specification](https://github.com/webmachinelearning/webmcp)
- WebMCP security annotations, origin exposure, and character budgets — [Chrome security guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
- ChatGPT site-tool host behavior — [OpenAI Help Center](https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app)
- Type declarations: `webmcp-types@0.1.5`
- Renderer: `three@0.185.1`
- UI/runtime: `react@19.2.0`, `vite@6.4.3`

The public Site and anonymous share reader were live-verified on 2026-08-28. Treat any republish as an explicit release action. No owner OpenAI API key is embedded.
