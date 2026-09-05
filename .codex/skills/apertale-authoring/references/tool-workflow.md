# Apertale Site Tools workflow

Apertale exposes a compact manifest-backed tool catalog. Compose complex work through this sequence.

## 1. Inspect

Call `get_project_context`:

- default/compact for the active book, outline, spread, elements, theme, revision, and capabilities;
- `detail: "authoring-guide"` before any create flow; obey the returned two-phase quality contract even when this skill is not installed;
- `detail: "creation-readiness"` with the structured brief before sketch review; ask blocking questions together and re-check until `ready: true`, then retain that brief;
- `detail: "assets"` only after a drawer transfer (a `request_image_handoff` without `images`); inline results carry ids, sizes, and alpha flags, so retain them across batches and create when all required assets are verified;
- `detail: "selected-reveal"` only when revising the selected element's knowledge card.
- `detail: "quality-review"` only for explicitly requested full polish; use its rubric, render manifest, and round state;
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

When the reader reports new red marks, read them once. The reader may draw red marks on any spread. Read them from compact `get_project_context` (`storyboard.spreads[].annotations`): each carries `page` (`left`, `right`, `both`), `shape` (`loop` encloses something, `stroke` underlines, crosses, or points), `bounds`, and `near`, the labels it touches. A loop around `"boat"` means change that thing; a stroke across it means remove or move it; a mark with no `near` label is a new element the reader wants there. Then call `sketch_storyboard(action: "update")` for only the marked spreads, passing the `expectedStoryboardRevision` you read together with `resolvedAnnotations` for the spreads you incorporated. A `storyboard_conflict` result means the reader drew more after your read: read again, then retry with a fresh `requestId`. A mark is scoped to its spread: an element the reader adds on spread 1 appears in that quadrant only, never in the character bible, the cover or the other quadrants, and the sheet prompt says so explicitly for the other quadrants, unless the reader asks for it everywhere. Generate final compositions in that later turn after approval and any requested revisions. Reuse the approved brief and returned storyboard revision; start ImageGen without another confirmation. Read the page again only for new marks or a reported conflict. Follow the live guide for import batch limits and retain ids across batches.

## 3. Execute the approved plan

The live `authoring-guide` hard gates own generation, handoff, minimum inspection, and repair policy. Follow those steps instead of adding a second checklist from this document.

- Generate the cover and interior sheets concurrently from the approved character bible. As each interior sheet finishes, its clean-plate and cutout requests can start together. Keep image-tool-required reference reads, and let the browser handle pixel admission.
- Plan enough cutout sheets for the selected interaction density. Keep the selected page count and layer density; reduce optional art only when the reader requests it.
- Prepare the complete asset set before layout. Hand off inline using the planned batches, retaining each result's ids and names. Each split sheet produces four assets in reading order; plan at most 50 resulting assets per call, separately from the 50 reader-visible asset limit on the finished book. For example, 12 spreads with 3 unique layers each need 61 imported assets (1 cover + 24 composite/base + 36 layers) but render 49: use two import batches, then create once.
- Encode once to WebP for transport when needed; preserve PNG/JPEG when encoding is unavailable and the file fits. Follow the host's supported timeout option for larger calls. The page performs splitting, chroma keying, trimming, compression, and real-alpha validation.
- Match partial results by filename, retain accepted ids, and send only missing or rejected replacements with a fresh requestId. When every planned asset is verified, create directly from those results.
- When inline transfer is unavailable, open the drawer and use the host file chooser; if that is unavailable, open the actual asset folder and ask for one drag. Read assets once after this fallback import.

## 4. Create once, then revise locally

Use `manage_book(action: "create")` with the ready `creationBrief`, `coverAssetId`, complete spread copy, each background, and the agreed interactive layer count. The tool validates the finished manifest before saving it. Preserve a successfully created book when its presentation is pending: retry that exact request once with the same requestId; if still pending, report the saved book as visually unconfirmed.

Each background binds `sourceAssetId` to the composite, `cleanPlateAssetId` to the final base, and `personalSourceAssetId` to a declared reader photo when applicable. Keep the book-type separation. Use the returned ids directly; the minimum pipeline needs no additional asset-list read after inline import.

Place a cutout from its approved sketch body ellipse (centre `cx, cy`, height `eh`):

- `page = cx < 0.5 ? "left" : "right"`
- `x = (cx − (page === "right" ? 0.5 : 0)) × 2`, `y = cy`
- `scaleX = scaleY = min(1.8, eh / heightAtScale1)` using the handoff result.

Use `compose_spread` for later text corrections, `apply_scene_patch` for one coherent scene repair, and `set-cover` for a cover correction. Carry the document id and revision returned by each successful mutation forward; a conflict requires one context refresh and reconciliation with the reader's edits. Preserve exact undo tokens.

## 5. Inspect and deliver

Follow the live guide and [minimum checks](quality-bar.md): present the cover and each spread once in the current theme, inspect the actual frames, and deliver when material reading failures are absent. Keep accepted assets and review only the surfaces changed by a repair. Full rubric submission and dual-theme polish are explicit follow-up work.

## 6. Record stage timings

Use timestamps already available in host execution and the existing `webmcp:tool-*` diagnostics (`durationMs` on success, failure, or cancellation). Record sketch-approved-to-complete wall time, initial image-generation wait, import time, final inspection time, and repair time including regeneration. Count concurrent waits once and exclude repair time from the initial stages. Include create/layout time in the total; do not attribute it to image generation.

Keep timing notes in the current run's report using the existing executor clock; timing itself adds no page calls or validation rounds. When the host does not expose a measurement, label it unavailable. Compare only runs with equivalent spread counts and interaction density; report tool-call counts separately from elapsed time.
