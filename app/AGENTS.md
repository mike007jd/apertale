# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Apertale product decisions

- Use `../docs/assets/livingbook-day-theme-reference.png` as the primary editing-layout truth and `livingbook-night-theme-reference.png` as the same product in its cinematic night presentation preset.
- The bottom prompt is a visible ChatGPT/WebMCP command surface and status display, not a second embedded AI composer.
- Keep day and night as presentation state outside the document revision. Document mutations use the shared command engine and remain undoable across human and WebMCP actions.
- Render the book as a real WebGL scene with deforming page geometry, while preserving the 2D fallback and reduced-motion path.
- Treat the earlier city/bird and fox spreads as baseline technical fixtures, not the quality target. The primary showcase is a premium interactive 3D knowledge book whose spread opens into a dimensional landmark or scientific diorama.
- Every showcase element has declarative, Agent-authored hover and click behavior. Validate behavior against closed presets; never execute model-authored JavaScript, GLSL, or arbitrary URLs.
- Use real generated/source assets and Phosphor icons; do not replace production art with CSS drawings, emoji, text glyphs, gradients, or placeholder imagery.
- Users bring their own ChatGPT/Codex conversation and model usage. Do not add an owner-funded OpenAI API key or a fake in-page AI composer.
- Photo input begins with a native user file picker and a stable local `assetId`. Keep ImageGen-to-page transfer behind an explicit import handoff until the host supports a verified direct attachment contract.
- Keep the public deployment private until the user explicitly approves a new release. Do not expose Challenge wording in customer-facing product UI or branding.
- Preserve a sparse, full-screen editing surface: the book remains the dominant object, controls float at the edges, and Story Outline stays secondary.
