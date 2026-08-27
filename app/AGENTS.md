# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Apertale product decisions

- Use `../docs/assets/livingbook-day-theme-reference.png` as the primary editing-layout truth and `livingbook-night-theme-reference.png` as the same product in its cinematic night presentation preset.
- The bottom `Create Your Own` action opens a full-screen blank-book workshop; it is a visible Agent/WebMCP handoff, not a form modal or second embedded AI composer.
- Keep day and night as presentation state outside the document revision. Document mutations use the shared command engine and remain undoable across human and WebMCP actions.
- Render the book as a real WebGL scene with deforming page geometry, while preserving the 2D fallback and reduced-motion path.
- Treat the earlier city/bird and fox spreads as baseline technical fixtures, not the quality target. The primary showcase is a premium illustrated knowledge book with full-spread OpenAI ImageGen artwork, layered interactions, and short frame sequences.
- Every showcase element has declarative, Agent-authored hover and click behavior. Validate behavior against closed presets; never execute model-authored JavaScript, GLSL, or arbitrary URLs.
- Use real generated/source assets and Phosphor icons; do not replace production art with CSS drawings, emoji, text glyphs, gradients, or placeholder imagery.
- Users bring their own ChatGPT/Codex conversation and model usage. Do not add an owner-funded OpenAI API key or a fake in-page AI composer.
- Story requests and source photos begin in the user's Agent conversation. Prefer verified host media transfer; while WebMCP attachment transfer remains non-standard, expose one quiet **Image handoff** fallback that creates stable local `assetId` values without asking the user to repeat the brief.
- Make the first-run experience a clean editorial library of separate hardcovers laid directly on the page; do not introduce a literal furniture-style shelf. Put the built-in Guide Book first, keep every sample as an independent book, and make `Create Your Own` the unmistakable primary authoring path from both library and reader.
- Keep the fallback image handoff inside the creation workshop and visually secondary to the Agent path. Finished-book controls must not expose a context-free `Add` action.
- Give every book a dedicated generated portrait cover; never reuse an interior spread, thumbnail crop, flat color block, or CSS-drawn stand-in as cover art.
- Never style a copy action like an editable prompt field. The creation CTA opens the full-screen blank-book workshop and points to the Codex/ChatGPT conversation beside the built-in browser; copying a starter prompt is an explicit secondary action.
- Explain three supported authoring paths concisely: text-to-book with model-authored copy and ImageGen artwork, photo-led books with an explicit image import handoff, and illustration-led books with layered interactions or short frame sequences.
- Label built-in scenes honestly and quietly: `Curated samples use OpenAI-generated illustration. Create your own with Codex and ImageGen in your active conversation.` Do not imply the checked-in sample assets were generated live in the viewer.
- Keep content generation inside the OpenAI/Codex ecosystem. The runtime ships no content 3D models or external model-generation pipeline; Three.js is reserved for the physical book, page turn, lighting, particles, and raycasting.
- Opening a book must acknowledge the click immediately and keep an honest loading state visible until the first complete book frame is ready. Reduced motion preserves status text without sustained rotation.
- Keep the public deployment private until the user explicitly approves a new release. Do not expose Challenge wording in customer-facing product UI or branding.
- Preserve a sparse, full-screen editing surface: the book remains the dominant object, controls float at the edges, and Story Outline stays secondary.
- Present Night as a dark room with a local warm desk-lamp pool that keeps the entire open book readable; never darken the artwork with a uniform global wash.
- Separate time-based effects from their clean base illustration. Keep the base readable at rest, use brief authored frame bursts, and hold the rest frame under Reduced Motion.
- Give every shipped spread at least one meaningful declarative motion/hover/click element; use lightweight procedural markers for knowledge details instead of adding runtime content models.
- Keep illustrated foreground layers still by default. Signal clickability with a restrained hover rim, light, or short lift; only assign idle translation when the subject semantics and page bounds support it. Boats on water use a small local bob and never travel onto land, while people, buildings, monuments, and resting props remain still until hover or focus.
- Treat mobile as a first-class authored composition, not a scaled desktop fallback. Every primary control must acknowledge touch immediately; Day/Night must visibly select on tap and settle the complete room, lamp, book, and artwork presentation within roughly 300ms on a healthy device.
- Build every new image-led spread from three explicit asset classes: the original composite reference, an inpainted clean background plate, and 2–4 genuinely transparent foreground subjects with declarative hover/click/motion. Validate alpha and hidden-pixel repair before shipping; a procedural hotspot alone does not count as image separation.
- Generate every final foreground subject in its own ImageGen request. One request produces one semantic asset. Never generate an atlas, contact sheet, sprite sheet, multi-object grid, or grouped cutout and crop it into final subjects. Reject baked checkerboards and any PNG/WebP without a real alpha channel; quarantine the failed output instead of color-keying or shipping it.
- Treat the selected cover and the open book as one persistent object rendered inside one opaque, theme-aware transition stage. Opening moves the chosen cover to the reading stage, hands off to the real current spread from the gutter, and never exposes a mirrored cover back or blank proxy page; returning to Books reverses that path and lands the closed cover in its own library position. Keep the old reader, library, and controls visually isolated during the handoff, keep loading honest before it, lock competing navigation while it runs, restore focus at settle, and replace the spatial sequence with an immediate state change under Reduced Motion.
