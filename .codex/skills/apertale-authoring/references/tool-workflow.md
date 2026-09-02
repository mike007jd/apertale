# Apertale Site Tools workflow

Apertale exposes a compact manifest-backed tool catalog. Compose complex work through this sequence.

## 1. Inspect

Call `get_project_context`:

- default/compact for the active book, outline, spread, elements, theme, revision, and capabilities;
- `detail: "authoring-guide"` before any create flow; obey the returned two-phase quality contract even when this skill is not installed;
- `detail: "creation-readiness"` with the structured brief before create; ask every blocking question and re-check until `ready: true`;
- `detail: "assets"` after direct host media transfer or a completed `request_image_handoff`;
- `detail: "selected-reveal"` only when revising the selected element's knowledge card.
- `detail: "quality-review"` after the current cover and every spread have rendered; use its rubric, deterministic checks, render manifest, and round state;
- `detail: "storyboard"` only when you need the full pencil stroke geometry back. Compact context already carries `storyboard.revision`, per-spread stroke counts, captions, and every red annotation the reader drew.

Treat returned book, spread, and element ids as stable identifiers. Never invent an existing id.
Read the returned capabilities as a runtime contract. In particular, use `full-spread-illustration-stage` for cross-gutter composition and `layered-image-interaction` for hover/click planning.

## 2. Sketch the storyboard before final art

Call `sketch_storyboard(action: "replace")` once with every planned spread. Each spread is an illustrator's rough thumbnail, not a diagram: a short `caption` and 14–24 `marks` (hard cap 36; under 12 reads as an empty page, over 24 reads as noise). Coordinates run x 0 → 1 from the left page's outer edge through the gutter at 0.5 to the right outer edge, y 0 → 1 top to bottom. The book pencils marks in array order, so list them back to front.

Build every spread in this order:

1. Ground: one `line` horizon or ground line across both pages (2–6 points; cross the gutter freely) and 1–2 contour `line`s (hill, shore, road, table edge; 4–12 points).
2. Background masses: 3–5 `ellipse`/`rect` for clouds, sun or moon, trees, buildings, distant props. Label only what the story names.
3. Midground props: 2–4 labelled `rect`/`ellipse` (`"basket"`, `"door"`).
4. Foreground characters with gesture: per character a head `ellipse`, a body `ellipse` at least 0.3 of the spread height (they are the reason the page exists; a small character becomes mush once the sheet is split), and 2–3 limb or tail `line`s (2–4 points each). Label only the body ellipse with the character's name. Overlap freely.
5. Motion and mood: 2–4 `line`s of 3–6 points (wind, speed, rain, rays, scatter); one `arrow` for the main action or gaze labelled with a verb (`"gust lifts basket"`); optionally one `arrow` labelled `"light"` from the light source.
6. Text: one `rect` labelled `"text"` for the copy zone (usually the left page, 0.3–0.45 wide) and one `label` (size `"l"`) with the working title inside it, at least 0.06 below that rect's top edge. No other `label` marks; story beats go in `caption`.

Rules: no frame rect around the page, the page is the frame. Labels are scarce: at most 6 per spread, on each character's body ellipse, the key props, the `text` rect, and the action arrow only. Never label the horizon, contours, heads, limbs, motion lines, or background masses; an unlabelled shape is pencilled light as construction, a labelled one heavy as a subject the reader can mark. Shape labels are pencilled inside the shape (rect: top-left corner, ellipse: centre), so keep them to 1–3 words and never put a labelled shape's top-left corner inside another labelled shape's top-left corner. Reuse every label word verbatim when you generate the final art; the reader's red marks come back addressed to those labels. `line` is for what the vocabulary lacks: 2–20 points, no detailed silhouettes. The blank 3D book draws the marks one after another and the workshop opens on the reader's screen; the call never waits for review, so end your turn right after the replace call: tell the reader the pencil book is on the pages and ask them to circle changes in red or say continue. Generate nothing until their next message.

The reader may draw red marks on any spread. Read them from compact `get_project_context` (`storyboard.spreads[].annotations`): each carries `page` (`left`, `right`, `both`), `shape` (`loop` encloses something, `stroke` underlines, crosses, or points), `bounds`, and `near`, the labels it touches. A loop around `"boat"` means change that thing; a stroke across it means remove or move it; a mark with no `near` label is a new element the reader wants there. Then call `sketch_storyboard(action: "update")` for only the marked spreads, passing the `expectedStoryboardRevision` you read together with `resolvedAnnotations` for the spreads you incorporated. A `storyboard_conflict` result means the reader drew more after your read: read again, then retry with a fresh `requestId`. Generate final compositions only in that later turn, after the marked spreads are revised.

## 3. Hand images to the page

Generate in sheets, not one request per image: one dedicated portrait cover request; one 2×2 sheet per four consecutive spreads, each quadrant a complete 1.62:1 composition with no gutters, borders, or labels between quadrants; one matching 2×2 sheet of clean plates in the same order; one 2×2 sheet per four cutouts on a flat solid magenta backdrop (#FF00FF, no shadow, glow, or checkerboard), each subject complete and centred in its quadrant with padding and nothing crossing a quadrant edge. The generator picks the pixel size; the page upscales split tiles to at least 1024×632, so never resize locally. Keep the storyboard's scale in the final art: main characters fill at least a third of the spread height in the foreground, faces readable at thumbnail size. Spread counts are 4, 8, or 12, so every sheet is full.

Then call `request_image_handoff` with a unique `requestId`, an `assetUse`, a concise `reason`, and `images`: one entry per file with `name` and a base64 `dataUrl` (PNG/JPEG/WebP, under 12 MB each). Give every sheet `split: true` and the cutout sheet `key: true`; the page cuts it into four tiles in reading order (top-left, top-right, bottom-left, bottom-right), keys the flat backdrop into alpha where asked, stores them, and returns `assets` with their ids in that order. Send every final in one call (cover plus all sheets is a few megabytes) with a long timeout, `siteTools.call("request_image_handoff", input, { timeoutMs: 180000 })`; each call costs several seconds of host overhead, so one call beats five. The result's `assets` carry `width`, `height`, `hasMeaningfulAlpha`, and `heightAtScale1` per id, so no `detail: "assets"` refresh is needed. Compress before the page, not after: convert every final to WebP first, which keeps alpha for cutout sheets and is several times smaller than PNG, then base64 it. Target under 3 MB per data URL; only fall back to PNG when a WebP encoder is unavailable.

```python
from PIL import Image  # Pillow has WebP on this machine; cwebp is the fallback
import base64, pathlib
src = pathlib.Path("work/final-assets/spread-sheet-1.png")
Image.open(src).save(src.with_suffix(".webp"), "WEBP", quality=85, method=6)  # RGBA stays RGBA
data_url = "data:image/webp;base64," + base64.b64encode(src.with_suffix(".webp").read_bytes()).decode()
``` Use `source-photo` for reader-supplied reference images; those join the next creation brief and share its 12-photo limit. Use `book-art` for generated covers, spread composites, clean plates, and cutouts; those enter only the reusable asset registry. Bind only the returned ids. Cutout tiles are trimmed to their subject at import, so a layer's scale means the subject's size.

Only when inline bytes are impossible, call without `images`: the drawer and drop target open and the call returns at once. Then use Computer Use or a browser file chooser when available; otherwise open the actual asset directory (normally `work/final-assets`) in the user's file manager and ask the reader once to drag its files onto the visible target. After import, refresh `get_project_context(detail: "assets")`. Do not claim success until those ids appear.

## 4. Open or atomically create a complete book

Use `manage_book`:

- `action: "open"` with a library `bookId`;
- `action: "create"` with the readiness-passed brief, a verified `coverAssetId`, and one complete, publishable 1–12 spread finished-book manifest;
- `action: "adopt-creation-brief"` once for a legacy personal book that has no stored brief, using the same readiness-passed brief and inspected revision;
- `action: "set-cover"` only for a later cover correction, with `expectedDocumentId` and `expectedRevision` from one current context plus a validated browser-local `coverAssetId`;
- `action: "begin-critique"` before inspecting and recording one quality-review round;
- `action: "record-critique"` with every visual rubric criterion after inspecting actual rendered frames.

Draft all spread titles, kickers, and body copy before `create`. A first pass is 4 or 8 spreads; 12 is the maximum, and counts stay multiples of four so every 2×2 sheet is used. Pass the same creation brief that returned `ready: true`; Apertale runs that readiness gate again before mutation. Every spread must also include a prepared `background` (`sourceAssetId`, `cleanPlateAssetId`, book-type `separation`, and `personalSourceAssetId` when declared) plus 2–4 prepared native-alpha `layers`. At least one layer per spread needs an authored hover, focus, or click reveal; idle motion may support that response but cannot replace it. Compose full-spread images for the approximately 1.62:1 stage target; 1.45–2.10 is only the compatible admission range.

Image generation does not happen inside this tool. Generate the cover, composite sheets, clean-plate sheets, and cutout sheets in the user's current Agent conversation, then hand them off inline with `split` (and `key` for the cutout sheet) as described in step 3. For a preserved-photo album, prepare source-true layouts and keep identity/crop/colour within the approved policy. Hand every final off inline through `request_image_handoff(images)`; the drawer is the fallback only. Apertale resizes and compresses each source locally to at most 1.5 MB before storage. Refresh assets and bind only returned ids. Deduplicate the reader-visible cover, resolved final base for each spread, rendered layer assets, and frame assets; at most 50 distinct assets may be uploaded. Author-only source and personal-photo provenance stays private and is excluded unless selected for rendering. If any planned reader-visible asset is absent or the upload plan exceeds that limit, do not call create: a text-only or deferred-art shell is not a completed book.

If a mutation returns `ok: true` with `presentation.status: "pending"`, the document is already saved but the exact visible frame was not confirmed. Retry the same `requestId` until presentation completes. A new request id would create a duplicate instead of resuming.

## 5. Refine copy

Use `compose_spread` to change one existing spread's title, kicker, or body without disturbing its scene. Refresh context after each call because every document mutation advances the revision.

## 6. Refine the scene after visual critique

The initial scene already arrives in the atomic create manifest. Use one atomic `apply_scene_patch` per coherent post-create critique fix. It can add, update, remove, or reorder up to 24 elements.

The only supported scene source is a validated browser-local or bundled asset id. Every image-led spread records the original composite in `sourceAssetId` and the final repaired/preserved base in `cleanPlateAssetId`. A declared user photo belongs in `personalSourceAssetId`; this keeps identity provenance separate from the generated composite. Use `inpainted-clean-plate` for generated illustrated separations and `preserved-photo-layout` for an approved source-true album base. Generate native-alpha transparent cutouts in the user's current conversation before patching the scene: up to four subjects on one 2×2 sheet over a flat solid magenta backdrop, handed off with `assetUse: "book-art"`, `split: true`, and `key: true` so the page keys the backdrop out and each stored asset holds exactly one subject; then refresh asset context.

Built-in ImageGen returns opaque RGB even when asked for transparency, so never ask for it: ask for the flat magenta backdrop and let `key: true` do the matte. If a sheet still comes back with a baked checkerboard, regenerate it once naming the solid colour; keying a checkerboard locally costs minutes and eats pale subjects. Before importing a cutout, inspect the actual pixels rather than trusting the file extension: the subject must be visible, complete, and padded; the background must be genuinely transparent; the edge must not contain a rectangular matte, chroma spill, detached crop fragments, or a baked glow intended to be supplied by the runtime hover effect. Reject and regenerate failed output.

The renderer places illustrated layers in one full-spread stage and maps the composition onto both paper pages. Place each layer once, from the storyboard body ellipse of that subject (centre `cx, cy`, height `eh` in spread coordinates) and the handoff result:

- `page = cx < 0.5 ? "left" : "right"`, `transform.x = (cx − (page === "right" ? 0.5 : 0)) × 2`, `transform.y = cy`;
- `scaleX = scaleY = min(1.8, eh ÷ heightAtScale1)` where `heightAtScale1` came back with the cutout's asset id (its longer side is one world unit on a 5.18-unit-tall page).

Cutouts are trimmed to their subject at import, so this lands the subject at the size it was drawn. Do not iterate placement with patches and screenshots; one `set_presentation` per spread is the verification.

Interaction vocabulary:

- hover: `none`, `lift-glow`, `tilt-toward-pointer`, `warm-rim`;
- focus: `none`, `spotlight`, `rise-and-center`, `orbit-inspect`;
- reveal: `none`, `caption`, `fact-card`;
- motion: `gentle-float`, `fly-across`, `water-bob`, `soft-pulse`, `slow-orbit`.

Use a reveal when interaction teaches, identifies, or advances the story. Keep illustrated subjects still by default and signal interaction with hover light or a short lift. Use `water-bob` for a boat that should remain on its local patch of water; reserve traversal for a subject whose route stays visually valid. Do not add motion merely to make every object move.

## 7. Present

Use `set_presentation` for `paper-atelier` (Day), `midnight-desk` (Night), Preview, `surface: "shelf"` cover inspection, and `spreadId` reader navigation during visual review. A non-pending result confirms that the requested shelf or reader surface is visible; `presentation.status: "pending"` is not visual evidence and must be resumed with the same `requestId`. Rendering evidence remains separately observable in quality context. Presentation changes do not advance the document revision.

## 8. Critique, patch, and publish gate

1. Render the cover on the shelf and visit every spread in the current revision.
2. Call `get_project_context(detail: "quality-review")`.
3. Call `manage_book(action: "begin-critique")` for the returned current revision and next round.
4. Treat deterministic failures as real blockers. Use the host browser/screenshot capability for composition, readability, consistency, photo fidelity, crop/skew/occlusion, alpha edges, coherence, and premium-sample value; the schema does not make aesthetic judgments.
5. Record every visual criterion once with evidence location and a suggested patch for blocker/warn results.
6. Patch, render, read the refreshed quality context, and explicitly begin the next check when needed. Round two is the final automated critique round.
7. Stop for source material or a user decision when blockers remain. Share is available only when `publishAllowed: true`; recorded warnings may proceed.

## 9. Undo

Use `undo_project_change` with the current revision and the exact returned undo token. Undo is conflict-aware and will preserve newer edits. Record replacement undo tokens returned by successful undo operations.

## Failure handling

- Revision conflict: call `get_project_context`, reconcile the user's latest state, and issue a new request id.
- Missing asset: call `request_image_handoff` with the correct `assetUse` and the file inline in `images`; fall back to the drawer only when inline bytes are impossible, then refresh asset context.
- Legacy brief missing: run creation readiness from the visible document and user decisions, then use `adopt-creation-brief` once. Stop rather than inventing photo treatment, identity, crop, or colour permissions.
- Unsupported asset type: keep the spread illustrated and report the boundary; do not claim that Apertale imported it.
- Partial scene failure: do not simulate success. Use the returned undo token if the committed change should be reversed.
