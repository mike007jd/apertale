# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## LivingBook Studio decisions

- Use `public/assets/references/day-reference.png` as the primary editing-layout truth and `night-reference.png` as the same product in its cinematic night presentation preset.
- The bottom prompt is a visible ChatGPT/WebMCP command surface and status display, not a second embedded AI composer.
- Keep day and night as presentation state outside the document revision. Document mutations use the shared command engine and remain undoable across human and WebMCP actions.
- Render the book as a real WebGL scene with deforming page geometry, while preserving the 2D fallback and reduced-motion path.
- The three demo spreads and the structured bird/fox cutouts are production demo content. Use real generated/source assets and Phosphor icons; do not replace them with CSS art, emoji, text glyphs, gradients, or placeholder imagery.
- Preserve a sparse, full-screen editing surface: the book remains the dominant object, controls float at the edges, and Story Outline stays secondary.
