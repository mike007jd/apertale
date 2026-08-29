# Apertale Site Tools workflow

Apertale exposes six tools. Keep the tool set compact and compose complex work through this sequence.

## 1. Inspect

Call `get_project_context`:

- default/compact for the active book, outline, spread, elements, theme, revision, and capabilities;
- `detail: "authoring-guide"` before any create flow; obey the returned two-phase quality contract even when this skill is not installed;
- `detail: "creation-readiness"` with the structured brief before create; ask every blocking question and re-check until `ready: true`;
- `detail: "assets"` after direct host media transfer or the workshop's explicit **Image handoff** fallback;
- `detail: "selected-reveal"` only when revising the selected element's knowledge card.
- `detail: "quality-review"` after the current cover and every spread have rendered; use its rubric, deterministic checks, render manifest, and round state.

Treat returned book, spread, and element ids as stable identifiers. Never invent an existing id.
Read the returned capabilities as a runtime contract. In particular, use `full-spread-illustration-stage` for cross-gutter composition and `layered-image-interaction` for hover/click planning.

## 2. Open, create, or set the cover

Use `manage_book`:

- `action: "open"` with a library `bookId`;
- `action: "create"` with a complete 1–12 spread plan;
- `action: "adopt-creation-brief"` once for a legacy personal book that has no stored brief, using the same readiness-passed brief and inspected revision;
- `action: "set-cover"` with `expectedRevision` and a validated browser-local `coverAssetId`.
- `action: "begin-critique"` before inspecting and recording one quality-review round;
- `action: "record-critique"` with every visual rubric criterion after inspecting actual rendered frames.

Draft all spread titles, kickers, and body copy before `create`. A normal first pass is 4–8 spreads. The maximum is 12. Pass the same creation brief that returned `ready: true`; Apertale runs that readiness gate again before mutation.

Image generation does not happen inside this tool. Generate the cover and illustrated spreads in the user's current Agent conversation. For a preserved-photo album, prepare source-true layouts and keep identity/crop/colour within the approved policy. Prefer a host-supported media transfer; when the host cannot transfer the image through WebMCP, provide a PNG/JPEG/WebP source no larger than 12 MB and ask the user to use **Image handoff** once. Apertale resizes and compresses the source locally to at most 1.5 MB before storage. Then refresh assets and bind the returned optimized ids.

## 3. Refine copy

Use `compose_spread` to change one existing spread's title, kicker, or body without disturbing its scene. Refresh context after each call because every document mutation advances the revision.

## 4. Build the scene

Use one atomic `apply_scene_patch` per coherent spread edit. It can add, update, remove, or reorder up to 24 elements.

The only supported scene source is a validated browser-local or bundled asset id. Every image-led spread records the original composite in `sourceAssetId` and the final repaired/preserved base in `cleanPlateAssetId`. A declared user photo belongs in `personalSourceAssetId`; this keeps identity provenance separate from the generated composite. Use `inpainted-clean-plate` for generated illustrated separations and `preserved-photo-layout` for an approved source-true album base. Generate native-alpha transparent cutouts in the user's current conversation before patching the scene. For GPT-Image-2 request `background: "transparent"` with PNG or WebP output. Use the workshop's **Image handoff** fallback only when direct host transfer is unavailable, then refresh asset context.

Before importing a cutout, inspect the actual pixels rather than trusting the file extension: the subject must be visible, complete, and padded; the background must be genuinely transparent; the edge must not contain a rectangular matte, chroma spill, detached crop fragments, or a baked glow intended to be supplied by the runtime hover effect. Reject and regenerate failed output.

The renderer places illustrated layers in one full-spread stage and maps the composition onto both paper pages. `transform.x` and `transform.y` are stage coordinates, not DOM positions. Compose around the gutter and verify interaction hit targets after placement.

Interaction vocabulary:

- hover: `none`, `lift-glow`, `tilt-toward-pointer`, `warm-rim`;
- focus: `none`, `spotlight`, `rise-and-center`, `orbit-inspect`;
- reveal: `none`, `caption`, `fact-card`;
- motion: `gentle-float`, `fly-across`, `water-bob`, `soft-pulse`, `slow-orbit`.

Use a reveal when interaction teaches, identifies, or advances the story. Keep illustrated subjects still by default and signal interaction with hover light or a short lift. Use `water-bob` for a boat that should remain on its local patch of water; reserve traversal for a subject whose route stays visually valid. Do not add motion merely to make every object move.

## 5. Present

Use `set_presentation` for `paper-atelier` (Day), `midnight-desk` (Night), Preview, and `spreadId` navigation during visual review. Presentation changes do not advance the document revision.

## 6. Critique, patch, and publish gate

1. Render the cover on the shelf and visit every spread in the current revision.
2. Call `get_project_context(detail: "quality-review")`.
3. Call `manage_book(action: "begin-critique")` for the returned current revision and next round.
4. Treat deterministic failures as real blockers. Use the host browser/screenshot capability for composition, readability, consistency, photo fidelity, crop/skew/occlusion, alpha edges, coherence, and premium-sample value; the schema does not make aesthetic judgments.
5. Record every visual criterion once with evidence location and a suggested patch for blocker/warn results.
6. Patch, render, read the refreshed quality context, and explicitly begin the next check when needed. Round two is the final automated critique round.
7. Stop for source material or a user decision when blockers remain. Share is available only when `publishAllowed: true`; recorded warnings may proceed.

## 7. Undo

Use `undo_project_change` with the current revision and the exact returned undo token. Undo is conflict-aware and will preserve newer edits. Record replacement undo tokens returned by successful undo operations.

## Failure handling

- Revision conflict: call `get_project_context`, reconcile the user's latest state, and issue a new request id.
- Missing asset: try the host's media transfer. If it is unavailable, ask for the workshop's explicit **Image handoff** fallback, then refresh asset context.
- Legacy brief missing: run creation readiness from the visible document and user decisions, then use `adopt-creation-brief` once. Stop rather than inventing photo treatment, identity, crop, or colour permissions.
- Unsupported asset type: keep the spread illustrated and report the boundary; do not claim that Apertale imported it.
- Partial scene failure: do not simulate success. Use the returned undo token if the committed change should be reversed.
