---
name: apertale-authoring
description: Create or revise polished interactive Apertale books through the site's six WebMCP tools. Use when a user asks Codex to turn an idea, manuscript, or personal images into an illustrated story, guide, comic, photo book, or educational book in the Apertale browser.
---

# Apertale Authoring

Treat Apertale as the renderer and browser-local project store. Do all planning, writing, image analysis, and generation in the user's current Codex conversation, then mutate the open book only through Apertale Site Tools.

Host-side prompt/photo-to-complete-book authoring is the required Create Your Own path. In-page owner-funded generation is out of scope. Apertale never spends a site-owner API key.

## Start safely

1. Call `get_project_context` before planning or changing anything.
2. If the tool is unavailable, ask the user to open Apertale in the Codex built-in browser. Do not claim that a book was changed.
3. Identify the authoring mode:
   - **idea:** text-led idea, outline, manuscript, lesson, or story prompt.
   - **photos:** user images are the primary source material.
   - **both:** written idea plus selected photos.
4. Read `get_project_context(detail: "authoring-guide")`, then call `get_project_context(detail: "creation-readiness")` with a versioned brief.
5. Ask the returned blocking questions together in one concise turn. Re-check readiness after the user answers. Use recommendations as optional defaults only when they do not change identity, source-photo treatment, audience, or the book's central promise.
6. Reuse the exact brief that returned `ready: true` in `manage_book(action: "create")`. The command engine enforces the same gate and returns `creation_not_ready` when material information is missing.
7. Collect the user's story, audience, and source images in the Agent conversation. Do not ask them to repeat the same brief inside Apertale. Treat the workshop's selected length, visual direction, authoring mode, photo treatment, and ordered source-asset ids as constraints.
8. Follow the creation and review contract below. Complete asset preparation before book mutation.

Read [tool workflow](references/tool-workflow.md) before changing the project. For idea, photo, and illustrated patterns, read [authoring recipes](references/authoring-recipes.md).

## Two-phase creation contract

### Phase 1 — inspect, plan, and prepare assets

Complete this phase in the current Codex conversation before any `manage_book` create or `apply_scene_patch` call:

1. Inspect the sources and user prompt. Never invent unseen photo content.
2. Define audience or the assumption used, then a complete story arc with beginning, development, turn, and ending.
3. Plan the title, dedicated generated portrait cover, every spread, and ordered provenance.
4. Use the host ImageGen/image editing capability to make a dedicated portrait cover.
5. For `illustrated-storybook` and `photo-led-keepsake`, make one purpose-built generated full-spread artwork per spread. Use personal photos as identity-faithful references under the agreed policy.
6. For `preserved-photo-album`, prepare one source-true 2:1 original-photo layout per spread. Preserve people and photo geometry, apply only the authorised crop/colour policy, and use `preserved-photo-layout` when setting the background.
7. For every image-led spread, retain the original composite in `sourceAssetId` and the final plate in `cleanPlateAssetId`. When a declared personal photo informed the spread, record that photo separately in `personalSourceAssetId`; never overload the composite field with identity provenance.

Required generated-art and provenance counts:

- generated cover count: **1**
- generated full-spread count: **the agreed spread count for illustrated storybook/photo-led keepsake; 0 for preserved-photo-album**
- preserved original-photo layout count: **the agreed spread count for preserved-photo-album**
- provenance entries: **1 cover + one entry per spread**

Hard rejection: placing an uploaded source photo on the right page, or treating a raw import as the finished interior artwork, is not a completed photo-led book.

### Phase 2 — layout, render, and review through Site Tools

Only after the complete asset plan and generated art set exist:

1. Re-check `creation-readiness`, then create the book with the same completed brief.
   For an existing personal book that predates the lifecycle metadata, use the one-time `adopt-creation-brief` action at the inspected revision instead of recreating or guessing its brief.
2. Import exact assets through supported host transfer or the workshop **Image handoff**, then refresh `get_project_context(detail: "assets")`.
3. Set the dedicated portrait cover.
4. Apply full-spread backgrounds and meaningful interactions.
5. Visit the shelf cover and every spread so Apertale records the current revision's real render evidence. Use `set_presentation(spreadId)` to navigate without changing the document revision.
6. Read `get_project_context(detail: "quality-review")`, then call `manage_book(action: "begin-critique")`. Use the deterministic checks and render manifest, then inspect the actual browser frames for every visual rubric item.
7. Record the structured critique with `manage_book(action: "record-critique")`. Apply suggested patches, render again, and explicitly begin the next check. Complete at most two critique rounds.
8. When blockers remain after round two, stop and tell the user which source material or decision is required. Publish only when the returned report says `publishAllowed: true`.

Never claim generation or import succeeded without evidence: returned asset ids, tool results, or an explicit pending-handoff report.

## Authoring contract

- Create a dedicated portrait cover. Never reuse an interior crop, flat color, or CSS stand-in. Prefer direct host media transfer from the Agent conversation. If the current host cannot transfer image bytes through WebMCP, ask the user to use the workshop's small **Image handoff** fallback once, refresh assets, then use `manage_book` with `action: "set-cover"`.
- Make every showcase spread intentional. Use the page as a composition, not a template slot. A preserved-photo album keeps its approved source-true layout rather than reillustrating the people in it.
- Treat each spread as one full-width illustration shared by both paper pages. Design across the gutter; keep important copy and faces clear of the fold. Use foreground, midground, and background layers to create depth without shipping runtime models.
- Give every non-guide spread at least one meaningful hover/focus/click response. Vary the interaction according to the content.
- Infer a coherent visual grammar from the user's sources—materials, edge language, palette, lighting, and depth—and apply it to generated backgrounds, isolated subjects, motion, and reveals. Do not reduce a tactile or illustrated style to generic SVG-like shapes.
- Keep prose concise enough to coexist with imagery. Prefer one idea per spread and a visible beginning, development, turn, and ending.
- Use the user's current conversation for image generation and analysis. Apertale never spends a site-owner API key.
- For GPT-Image-2 cutouts, explicitly request a transparent background and preserve the generated alpha. Make one separate ImageGen request for every final semantic subject; one request must produce exactly one asset. Never generate an atlas, contact sheet, sprite sheet, multi-object grid, or grouped cutout and crop it into finals. Reject an opaque canvas, baked checkerboard, empty subject, backing rectangle, chroma spill, detached crop fragments, or baked glow; verify the file has a real alpha channel and regenerate instead of color-keying it.
- Use only image asset ids returned by `get_project_context(detail: "assets")`. Never pass arbitrary URLs, executable content, HTML, JavaScript, shader code, or model references. WebMCP does not yet standardize binary attachment transfer across every host; report this boundary and request the smallest explicit handoff instead of pretending an attachment was imported. The fallback accepts PNG/JPEG/WebP sources up to 12 MB and optimizes them locally to at most 1.5 MB before the asset id is exposed.
- Negotiate capabilities from `get_project_context`; never assume a site-owner credential or an external generation backend. Image generation and analysis happen in the user's active Codex/ChatGPT conversation.
- Preserve `requestId`, `expectedRevision`, stable spread ids, and returned undo tokens. Refresh context after every mutation. On a revision conflict, refresh and re-plan; do not brute-force retries.
- Request explicit user approval before publication or deployment. Once approved, keep Share fail-closed until the current revision's quality report allows publication.

## Finish

Run the [quality bar](references/quality-bar.md). Report:

- the book title and exact spread count;
- generated cover count (must be 1) and the cover asset id or pending-handoff note;
- generated full-spread count for illustrated books, or preserved original-photo layout count for preserved albums, with one final base asset id per spread;
- ordered source-asset ids and user-visible names, mapped as references for illustrated books or source-true layouts for preserved albums;
- ordered provenance for cover and every spread, distinguishing user photo, generated art, and curated sample;
- which interactions, illustrated layers, and short frame sequences were added;
- any unsupported or pending handoff, with no success claim;
- the active revision and undo tokens for the last reversible changes.
- the quality-review round, blocker/warning/note counts, actual render evidence inspected, sample-readiness decision, and `publishAllowed` result.
