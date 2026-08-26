# Apertale application

Apertale is a WebMCP-native creative canvas for dimensional interactive books. A person and their own ChatGPT or Codex Agent operate the same live, revisioned artifact: either side can inspect structured elements, assign safe interactions, transform or animate them, change presentation, and undo exact changes.

The page is explicitly WebMCP-enabled. In a browser without the injected runtime, the Story panel reports `WebMCP ready`; in a supported ChatGPT desktop built-in browser it reports `WebMCP connected` after the tools register.

## Current product slice

- Real Three.js/WebGL book scene with curved pages, cover depth, shadows, two-sided textures, and pointer-driven page turns.
- `Paper Atelier` Day and `Midnight Desk` Night presentations over one document.
- Declarative hover, focus, reveal, and motion behavior drawn from closed reviewed presets.
- Procedural Colosseum, Great Pyramid, and volcano knowledge dioramas with hover, click inspection, cinematic focus, and accessible fact cards.
- IndexedDB Blob storage for user-imported PNG/JPEG/WebP assets, with a cross-book local asset directory, stable IDs, and reload-safe object URL resolution.
- A persistent multi-book shelf; Sample Books are independent projects rather than unrelated spreads in one document.
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

`get_project_context` defaults to a compact response and accepts focused `selected-reveal` or `assets` detail when the Agent needs the full knowledge card or reusable local-import directory. `apply_scene_patch` covers Lift, transform, structured reveal, motion, interaction, add/remove, and ordering through one bounded atomic contract. A local `asset:` ID is accepted only after the IndexedDB adapter proves that it exists. Internal fine-grained commands remain shared with the human UI but are not exposed as additional WebMCP tools.

The six registration promises are treated as one fail-closed set. One registration failure aborts the shared lifecycle signal and removes any partial registration. Both Vite and the deployment Worker send `Origin-Agent-Cluster: ?1` and `Permissions-Policy: tools=(self)`.

## Run and verify

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm run test:sites
```

The production build is emitted as a host-portable bundle:

- `dist/client/index.html`
- `dist/server/index.js`
- `dist/.openai/hosting.json`

## Architecture map

- `src/ThreeBook.tsx` — Three.js renderer, page geometry, raycasting, theme lighting, page turns, and 3D model interaction.
- `src/models/` — repository-owned procedural knowledge models.
- `src/interaction.ts` — closed declarative interaction vocabulary and renderer traits.
- `src/assetStore.ts` — IndexedDB Blob persistence, metadata, and safe object URL resolution.
- `src/bookEngine.ts` — authoritative document/session state, persistence, revision checks, idempotency, and exact undo.
- `src/webmcp.ts` — WebMCP registrations backed by the shared command engine.
- `src/App.tsx` — accessible React editor, knowledge cards, themes, selection tools, outline, and responsive controls.
- `src/sampleBook.ts` — independent Sample Book catalog and their initial spreads.

Three.js is loaded as a lazy production chunk so the editor shell can render before the WebGL engine finishes loading.

## Current technical baseline

Checked against current primary sources on 2026-08-26:

- WebMCP imperative API: `document.modelContext.registerTool()` with registration and execution `AbortSignal` support — [Chrome documentation](https://developer.chrome.com/docs/ai/webmcp/imperative-api) and [WebMCP specification](https://github.com/webmachinelearning/webmcp)
- WebMCP security annotations, origin exposure, and character budgets — [Chrome security guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
- ChatGPT site-tool host behavior — [OpenAI Help Center](https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app)
- Type declarations: `webmcp-types@0.1.5`
- Renderer: `three@0.185.1`
- UI/runtime: `react@19.2.0`, `vite@6.4.3`

Public hosting is intentionally disabled while the product and repository are being rebuilt. No owner OpenAI API key is embedded.
