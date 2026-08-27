---
name: apertale-authoring
description: Create or revise polished interactive Apertale books through the site's six WebMCP tools. Use when a user asks Codex to turn an idea, manuscript, or personal images into an illustrated story, guide, comic, photo book, or educational book in the Apertale browser.
---

# Apertale Authoring

Treat Apertale as the renderer and browser-local project store. Do all planning, writing, image analysis, and optional generation in the user's current Codex conversation, then mutate the open book only through Apertale Site Tools.

## Start safely

1. Call `get_project_context` before planning or changing anything.
2. If the tool is unavailable, ask the user to open Apertale in the Codex built-in browser. Do not claim that a book was changed.
3. Identify the authoring mode:
   - **Text-led:** idea, outline, manuscript, lesson, or story prompt.
   - **Photo-led:** user images are the primary source material.
   - **Illustration-led:** ImageGen artwork and layered paper motion carry the experience.
4. Ask at most one concise question when the answer materially changes audience, length, or source use. Otherwise select 4–8 spreads and state the assumption.
5. Collect the user's story, audience, and source images in the Agent conversation. Do not ask them to repeat the same brief inside Apertale. Treat the workshop's selected length and visual direction as constraints returned by the live page or included in its starter prompt.
6. Plan the whole book—cover, narrative arc, spread rhythm, assets, and interactions—before the first mutation.
7. Build an asset plan for every spread: full-spread illustration, interactive cutouts, short frame sequences, light/particle accents, and provenance. Prefer the smallest combination that produces the intended reading experience. Generate each cutout as a native transparent PNG/WebP; never plan a green-screen or white-background extraction pass.

Read [tool workflow](references/tool-workflow.md) before changing the project. For text-led, photo-led, and illustrated patterns, read [authoring recipes](references/authoring-recipes.md).

## Authoring contract

- Create a dedicated portrait cover. Never reuse an interior crop, flat color, or CSS stand-in. Prefer direct host media transfer from the Agent conversation. If the current host cannot transfer image bytes through WebMCP, ask the user to use the workshop's small **Image handoff** fallback once, refresh assets, then use `manage_book` with `action: "set-cover"`.
- Make every showcase spread intentional. Use the page as a composition, not a template slot.
- Treat each spread as one full-width illustration shared by both paper pages. Design across the gutter; keep important copy and faces clear of the fold. Use foreground, midground, and background layers to create depth without shipping runtime models.
- Give every non-guide spread at least one meaningful hover/focus/click response. Vary the interaction according to the content.
- Infer a coherent visual grammar from the user's sources—materials, edge language, palette, lighting, and depth—and apply it to generated backgrounds, isolated subjects, motion, and reveals. Do not reduce a tactile or illustrated style to generic SVG-like shapes.
- Keep prose concise enough to coexist with imagery. Prefer one idea per spread and a visible beginning, development, turn, and ending.
- Use the user's current conversation for image generation and analysis. Apertale never spends a site-owner API key.
- For GPT-Image-2 cutouts, explicitly request a transparent background and preserve the generated alpha. Make one separate ImageGen request for every final semantic subject; one request must produce exactly one asset. Never generate an atlas, contact sheet, sprite sheet, multi-object grid, or grouped cutout and crop it into finals. Reject an opaque canvas, baked checkerboard, empty subject, backing rectangle, chroma spill, detached crop fragments, or baked glow; verify the file has a real alpha channel and regenerate instead of color-keying it.
- Use only image asset ids returned by `get_project_context(detail: "assets")`. Never pass arbitrary URLs, executable content, HTML, JavaScript, shader code, or model references. WebMCP does not yet standardize binary attachment transfer across every host; report this boundary and request the smallest explicit handoff instead of pretending an attachment was imported.
- Negotiate capabilities from `get_project_context`; never assume a site-owner credential or an external generation backend. Image generation and analysis happen in the user's active Codex/ChatGPT conversation.
- Preserve `requestId`, `expectedRevision`, stable spread ids, and returned undo tokens. Refresh context after every mutation. On a revision conflict, refresh and re-plan; do not brute-force retries.
- Do not deploy, publish, or change shared state without explicit user approval.

## Finish

Run the [quality bar](references/quality-bar.md). Report:

- the book title and spread count;
- which source assets and generated assets were used;
- which interactions, illustrated layers, and short frame sequences were added;
- any unsupported or pending handoff;
- the active revision and undo tokens for the last reversible changes.
