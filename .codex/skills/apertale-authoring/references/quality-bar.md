# Apertale quality bar

Use the versioned rubric returned by `get_project_context(detail: "quality-review")` before calling a book finished.

## Evidence boundary

- Apertale computes deterministic checks for the dedicated cover, original-composite/final-base provenance, separately declared personal-photo sources, 2–4 non-procedural layers per spread, bounded copy, meaningful interaction, and current-revision render evidence.
- The Agent uses actual browser screenshots or visible rendered frames for aesthetic judgments. A manifest or successful tool call does not prove composition, readability, identity fidelity, or sample-level appeal.
- Record blocker/warn/note results with the cover or spread location and a concrete patch. Recorded warnings may proceed. Blockers keep Share closed.
- Complete at most two critique → patch → re-check rounds. After round two, stop and request the missing source material or user decision.

## Narrative and content

- Title and cover promise match the actual book.
- Spread count matches the agreed or stated assumption.
- The sequence has a clear opening, progression, and ending.
- Text is readable at the default camera and does not compete with the focal scene.
- Factual reveals name a source when appropriate.
- Final asset counts are complete: 1 dedicated portrait cover plus one generated illustration or preserved source-true layout per spread, according to book type.
- Ordered provenance exists for the cover and every spread, distinguishing user photo, generated art, and curated sample.
- Each image-led spread keeps its original composite in `sourceAssetId`; a personal source appears only in `personalSourceAssetId` and must match the readiness-passed brief.
- Photo-led work does not use an uploaded source photo as the finished right-page or interior artwork unless the user explicitly chose a literal photo-album treatment.

## Visual system

- The cover is a dedicated portrait asset and remains legible in the library.
- Interior spreads have varied but coherent composition.
- Full-spread environments cross the gutter cleanly, focal subjects use the available stage, and essential copy/faces do not disappear into the fold.
- User images are not stretched, accidentally cropped, or misrepresented, and they are not treated as a lazy right-page placement.
- Generated, curated, and user-supplied material remain distinguishable in the final provenance report. Generated cover count is 1; generated full-spread count equals the spread count for illustrated/photo-led books and is 0 for a preserved-photo album.
- Day and Night each feel intentionally lit; they are not simple brightness inversions.
- Crop, skew, occlusion, anatomy, and relative scale remain natural.
- Transparent subjects have clean native-alpha edges without a rectangular matte or halo.
- The whole book is credible beside The Starlight Stitch and The Blue Road Home as a promotional sample.

## Interaction and motion

- Every non-guide showcase spread has at least one meaningful hover/focus/click response.
- Pointer hover, keyboard focus, and click reveal agree with the visual affordance.
- Motion supports the page's idea and respects reduced-motion behavior.
- Page turns show the complete outgoing illustration and layers without blank frames, tearing, duplicated subjects, or early destination pop-in.
- Forward and backward page turns both work.
- Every cutout was generated as native-alpha PNG/WebP, contains a visible complete subject with transparent padding, and has no opaque canvas, backing rectangle, chroma spill, detached crop fragments, baked glow, accidental text, or watermark. Failed generations were rejected and regenerated; color-keying is not an acceptance path.

## MCP and state safety

- Context was refreshed after mutations and final revision is known.
- Each mutation used a unique request id and the current expected revision.
- Imported assets came from `get_project_context(detail: "assets")`.
- Generation and import were never reported as successful without asset ids, tool results, or an explicit pending-handoff note.
- Reversible changes have retained undo tokens.
- No arbitrary URL, executable payload, hidden owner credential, deployment, or publication was introduced.

Stop when the current report allows publication, or when round two identifies a clearly reported material/user-decision blocker.
