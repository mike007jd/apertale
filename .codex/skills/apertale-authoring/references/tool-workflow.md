# Apertale Site Tools workflow

Apertale exposes six tools. Keep the tool set compact and compose complex work through this sequence.

## 1. Inspect

Call `get_project_context`:

- default/compact for the active book, outline, spread, elements, theme, revision, and capabilities;
- `detail: "assets"` after direct host media transfer or the workshop's explicit **Image handoff** fallback;
- `detail: "selected-reveal"` only when revising the selected element's knowledge card.

Treat returned book, spread, and element ids as stable identifiers. Never invent an existing id.
Read the returned capabilities as a runtime contract. In particular, use `full-spread-illustration-stage` for cross-gutter composition and `layered-image-interaction` for hover/click planning.

## 2. Open, create, or set the cover

Use `manage_book`:

- `action: "open"` with a library `bookId`;
- `action: "create"` with a complete 1–12 spread plan;
- `action: "set-cover"` with `expectedRevision` and a validated browser-local `coverAssetId`.

Draft all spread titles, kickers, and body copy before `create`. A normal first pass is 4–8 spreads. The maximum is 12. Do not call `create` until Phase 1 is complete: inspected sources, story arc, ordered provenance, one generated portrait cover, and one original full-spread artwork per spread.

Image generation does not happen inside this tool. Generate the cover and every interior full-spread in the user's current Agent conversation. Do not place an uploaded source photo as the finished right-page artwork unless the user explicitly chose a literal photo-album treatment. Prefer a host-supported media transfer; when the host cannot transfer the image through WebMCP, provide a PNG/JPEG/WebP source no larger than 12 MB and ask the user to use **Image handoff** once. Apertale resizes and compresses the source locally to at most 1.5 MB before storage. Then call `get_project_context(detail: "assets")` and set the cover using the returned optimized asset id.

## 3. Refine copy

Use `compose_spread` to change one existing spread's title, kicker, or body without disturbing its scene. Refresh context after each call because every document mutation advances the revision.

## 4. Build the scene

Use one atomic `apply_scene_patch` per coherent spread edit. It can add, update, remove, or reorder up to 24 elements.

The only supported scene source is a validated browser-local image asset id returned by the asset context. Generate full-spread artwork and native-alpha transparent cutouts in the user's current conversation before patching the scene. For GPT-Image-2 request `background: "transparent"` with PNG or WebP output. Do not create green/blue-screen intermediates, white-background stand-ins, or color-keyed alpha. Do not treat a raw uploaded photo as the finished right-page art. Prefer direct host transfer; otherwise use the workshop's **Image handoff** fallback and refresh asset context.

Before importing a cutout, inspect the actual pixels rather than trusting the file extension: the subject must be visible, complete, and padded; the background must be genuinely transparent; the edge must not contain a rectangular matte, chroma spill, detached crop fragments, or a baked glow intended to be supplied by the runtime hover effect. Reject and regenerate failed output.

The renderer places illustrated layers in one full-spread stage and maps the composition onto both paper pages. `transform.x` and `transform.y` are stage coordinates, not DOM positions. Compose around the gutter and verify interaction hit targets after placement.

Interaction vocabulary:

- hover: `none`, `lift-glow`, `tilt-toward-pointer`, `warm-rim`;
- focus: `none`, `spotlight`, `rise-and-center`, `orbit-inspect`;
- reveal: `none`, `caption`, `fact-card`;
- motion: `gentle-float`, `fly-across`, `water-bob`, `soft-pulse`, `slow-orbit`.

Use a reveal when interaction teaches, identifies, or advances the story. Keep illustrated subjects still by default and signal interaction with hover light or a short lift. Use `water-bob` for a boat that should remain on its local patch of water; reserve traversal for a subject whose route stays visually valid. Do not add motion merely to make every object move.

## 5. Present

Use `set_presentation` for `paper-atelier` (Day), `midnight-desk` (Night), and Preview. Presentation changes do not advance the document revision.

## 6. Undo

Use `undo_project_change` with the current revision and the exact returned undo token. Undo is conflict-aware and will preserve newer edits. Record replacement undo tokens returned by successful undo operations.

## Failure handling

- Revision conflict: call `get_project_context`, reconcile the user's latest state, and issue a new request id.
- Missing asset: try the host's media transfer. If it is unavailable, ask for the workshop's explicit **Image handoff** fallback, then refresh asset context.
- Unsupported asset type: keep the spread illustrated and report the boundary; do not claim that Apertale imported it.
- Partial scene failure: do not simulate success. Use the returned undo token if the committed change should be reversed.
