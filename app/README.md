# LivingBook Studio — Challenge Final 1.1

LivingBook Studio is a WebMCP-native creative editor for turning illustrated spreads into interactive, agent-editable books. A person and ChatGPT work on the same live document: either side can lift prepared paper elements, move or animate them, change the scene theme, and undo exact changes without creating a second copy of the book.

## Product demo

- Real Three.js/WebGL book scene with curved open pages, cover depth, shadows, two-sided page textures, and pointer-driven page turns.
- Day `Paper Atelier` and night `Midnight Desk` presentation themes share one document and do not increment document revision.
- Structured Bird and Fox cutouts support selection, Lift, drag, scale, rotation, lock, depth, and named motion presets.
- Human and WebMCP mutations use the same revisioned command engine, idempotency keys, visible provenance, conflict responses, and exact undo tokens.
- Three illustrated spreads, generated cutout assets, responsive desktop/mobile layouts, reduced-motion behavior, and a 2D fallback are included.

## WebMCP tool surface

The page registers exactly six imperative tools through `document.modelContext.registerTool()`:

1. `get_book_context`
2. `lift_element`
3. `edit_element`
4. `animate_element`
5. `set_scene_theme`
6. `undo_book_change`

Mutation calls require `requestId` and `expectedRevision`. Tool callbacks return compact JSON strings, and successful document mutations include a usable `undoToken`.

## Run and verify

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm run test:sites
```

The production build is emitted as a Sites-compatible bundle:

- `dist/client/index.html`
- `dist/server/index.js`
- `dist/.openai/hosting.json`

## Architecture

- `src/ThreeBook.tsx` — Three.js renderer, generated page textures, curved geometry, raycasting, Lift layers, theme lighting, and page-turn deformation.
- `src/bookEngine.ts` — authoritative document/session state, persistence, revision checks, idempotency, conflict-safe undo/redo, and visible action state.
- `src/webmcp.ts` — six WebMCP registrations that call the shared command engine.
- `src/App.tsx` — accessible React editing UI, preview, themes, selection tools, Story Outline, and responsive controls.
- `src/sampleBook.ts` — Challenge sample document and structured element registry.

Three.js is loaded as a lazy production chunk so the editor shell can render before the WebGL engine finishes loading.

## Current technical baseline

Checked against current primary sources on 2026-08-26:

- WebMCP imperative API: `document.modelContext.registerTool()` with registration and execution `AbortSignal` support — [WebMCP specification repository](https://github.com/webmachinelearning/webmcp)
- Type declarations: `webmcp-types@0.1.5` — [npm package](https://www.npmjs.com/package/webmcp-types)
- Renderer: `three@0.185.1`
- UI/runtime: `react@19.2.0`, `vite@6.4.2`
- Challenge requirements and judging dimensions — [OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/)

## Evidence

- Product/design specification: [../docs/LIVINGBOOK_PRD_AND_DESIGN_SPEC.md](../docs/LIVINGBOOK_PRD_AND_DESIGN_SPEC.md)
- Design QA: [design-qa.md](design-qa.md)
- Challenge handoff: [../docs/CHALLENGE_SUBMISSION_HANDOFF.md](../docs/CHALLENGE_SUBMISSION_HANDOFF.md)

The local project is deployment-ready but is not published yet. Publishing, repository creation, and submission remain explicit external actions.
