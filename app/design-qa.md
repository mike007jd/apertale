# Apertale Design QA

## Comparison target

- Source visual truth, Day: `../docs/assets/livingbook-day-theme-reference.png`
- Source visual truth, Night: `../docs/assets/livingbook-night-theme-reference.png`
- Browser-rendered Day implementation: `qa/implementation-day-final-clean.png`
- Browser-rendered Night implementation: `qa/implementation-night-final-clean.png`
- Three.js page-turn evidence: `qa/implementation-page-turn-pass5.png`
- Fresh bounded page-turn evidence: `qa/audit-2026-08-26/05-page-turn-corrected.png`
- Fresh product-audit states: `qa/audit-2026-08-26/01-day-start.png`, `02-bird-selected.png`, `03-bird-lifted.png`, and `06-night-spread.png`
- Mobile implementation: `qa/implementation-mobile-selected-pass2.png`
- Forced WebGL/reduced-motion fallback: `qa/implementation-fallback-final.png`
- Page-turn performance record: `qa/PERFORMANCE.md`
- Editable Figma baseline: [Apertale — Product Design v1.1, current product states](https://www.figma.com/design/3Kq19oItsbBczMIeB739cO/Apertale-%E2%80%94-Product-Design-v1.1?node-id=7-6)
- Current real-scene cover captures: `qa/apertale-atlas-preview-cover.png` and `qa/apertale-science-preview-cover.png`

## Normalization

- Desktop source pixels: 1487 × 1058.
- Desktop implementation pixels: 1487 × 1058.
- CSS viewport: 1487 × 1058; browser viewport override at density 1 for equal-pixel comparison.
- Mobile implementation pixels/CSS viewport: 390 × 844 at density 1.
- State: Day spread 1 with Bird selected; Night spread 2 with Fox selected; editor mode.
- Full-view Day comparison: `qa/comparison-day-final.png`
- Full-view Night comparison: `qa/comparison-night-final.png`
- Focused Bird/control comparison: `qa/focus-day-final.png`

The desktop comparisons use the same viewport, crop, theme, selected element, and editor state. The reference page-turn pose is separately compared against the implementation’s captured deforming-page midpoint because a transient animation frame cannot also be the stable full-view selection baseline.

## Required fidelity surfaces

- Fonts and typography: passed. The implementation uses a bookish system serif stack for the wordmark/story display and Avenir/system sans for controls. Hierarchy, line height, wrapping, weight, and control copy remain legible at desktop and responsive sizes. The exact reference typeface is not bundled, so the closest platform serif fallback is an accepted P3 optical difference.
- Spacing and layout rhythm: passed. The book is the dominant full-screen object; top controls, page arrows, selection tools, and bottom prompt preserve the reference hierarchy without clipping. The final Three.js camera fit keeps the physical book clear of persistent controls at 1487 × 1058 and fits the full spread at 390 × 844.
- Colors and visual tokens: passed. Day retains warm paper/off-white/green/accent-red tokens; Night switches to dark wood, amber light, cream type, and gold accent without changing document revision. Night is intentionally darker and more amber than the blue reference, classified as P3 cinematic polish rather than an actionable mismatch.
- Image quality and asset fidelity: passed. All visible story art, cutouts, and backgrounds are real generated raster assets; controls use Phosphor icons. No placeholder art, emoji, CSS drawings, handcrafted SVG illustrations, or gradient substitutes are present. Cutout alpha edges and selection overlays are clean.
- Copy and content: passed. Product copy is coherent and standalone: story titles/body, `Ask ChatGPT`, `Lift`, `Lock`, `Story`, theme labels, prompt states, revision/status text, and Preview all describe real working behavior.
- Icons: passed. Visible icons share one stroke family and remain aligned at desktop/mobile sizes; mobile icon-only controls have explicit accessible names.
- States and interactions: passed. Day/Night, selection, Lift, lock, scale, rotate, motion, drag, page arrows, pointer page drag, keyboard arrows/Escape, Story Outline, Preview, action status, Undo/redo token behavior, and 2D fallback paths are implemented.
- Accessibility and responsiveness: passed. Focus-visible rings, semantic buttons/group/status/region labels, reduced-motion behavior, touch targets, responsive control labels, full-book mobile fit, and accessible icon-only names were checked.

## Findings

No actionable P0, P1, or P2 findings remain.

Accepted P3 differences:

- The generated city layout and title wrap are not pixel-identical to the concept image, but they preserve the same subject, collage treatment, hierarchy, crop quality, and control anatomy.
- The Night palette is more amber/dark than the reference’s blue moonlight. This is an intentional `Midnight Desk` presentation choice and keeps text/selection contrast usable.
- Mobile shows the entire two-page spread rather than inventing a separate single-page composition; small printed story copy is a deliberate desktop-editor trade-off, while core targets and controls remain operable.

## Comparison history

### Pass 1 — blocked

- P1: the initial WebGL book still read as a flat rectangle, with insufficient page bow, cover thickness, and physical perspective. Evidence: `qa/implementation-day-pass1.png` and `qa/comparison-day-pass1.png`.
- P1: the first page-turn midpoint exposed a blank underlying page and mirrored back-face text. Evidence: `qa/implementation-page-turn-pass2.png`.
- P2: the narrow viewport cropped most of the spread and hid meaningful content. Evidence: `qa/implementation-mobile-pass1.png`.
- P2: icon-only mobile theme/preview controls lost accessible names.

Fixes: added segmented curved open-page geometry, an oblique camera fit, thicker cover/page blocks and gutter; generated explicit flipped back-face canvases; exposed the next underlying spread during turns; replaced the accelerating turn with a slower sine ease; added aspect-aware camera fitting; and added explicit mobile `aria-label` values.

### Pass 2 — blocked

- P2: selecting an element without dragging still committed an edit and created a misleading Undo status.
- P2: the browser console reported deprecated Three.js `Clock` and `PCFSoftShadowMap` usage.
- P2: successful document changes exposed undo tokens through WebMCP but did not offer a visible human Undo control.

Fixes: added a two-pixel drag threshold, visible Undo/redo actions, usable inverse undo records, a versioned clean sample store, manual frame-delta timing, and `PCFShadowMap`.

### Pass 3 — passed

- Post-fix visual evidence: `qa/implementation-day-final-clean.png`, `qa/implementation-night-final-clean.png`, `qa/implementation-page-turn-pass5.png`, and `qa/implementation-mobile-selected-pass2.png`.
- Full-view combined evidence: `qa/comparison-day-final.png` and `qa/comparison-night-final.png`.
- Focused evidence: `qa/focus-day-final.png` confirms real cutout fidelity, selection treatment, and control anatomy.
- A fresh browser reload produced no new console errors or warnings.
- The forced fallback route rendered its 2D book, created no WebGL canvas, and remained operable with reduced motion.
- Local page-turn diagnostics measured 121 FPS forward and 120 FPS backward against the 45 FPS acceptance floor.

### Pass 4 — fresh audit, passed after one fix

- P1 found: the full-distance page deformation could approach the camera and visually balloon beyond the physical cover at the midpoint. Evidence: `qa/audit-2026-08-26/04-page-turn-midpoint.png`.
- Fix: page displacement is now bounded relative to the book depth while retaining the curved sheet, shadow, and two-sided transition. The geometry has direct bounds tests. Evidence: `qa/audit-2026-08-26/05-page-turn-corrected.png`.
- Fresh Day, selected Bird, lifted Bird, corrected turn, and Night browser states were captured as local audit evidence. The Figma file now includes a current Apertale Auto Layout board for Day, the four-book Library, and Night; Figma MCP verified frame `7:6` and its rendered output.
- WebMCP context now returns the compact book outline and current-spread element list promised by the PRD, and rejects attempts to mutate a hidden-spread element.

### Pass 5 — multi-book and authoring expansion, passed locally

- Replaced the single mixed demo with a shelf of four independent Sample Books. Each book preserves its own spreads and revisions when the user switches books.
- Reworked the page centreline after a real midpoint screenshot exposed strip reversal/self-intersection. Forward and backward midpoint captures now show one continuous leaf; a property test rejects non-adjacent segment intersections throughout the turn.
- Added procedural Great Pyramid and volcano cross-section plates alongside the Colosseum, each with Day/Night lighting, hover response, click focus, and an accessible fact card.
- Imported a real PNG through the browser file chooser, confirmed its stable `asset:` id was stored in IndexedDB, reloaded the page, and verified the cutout reappeared with no `asset:resolve-failed` diagnostic. The QA import was then removed by restoring the untouched revision-1 sample.
- Added `apply_scene_patch` for atomic add/update/remove/reorder operations, full-patch undo, locked-element checks, and arbitrary-URL rejection.
- Final page-turn diagnostic: 821 ms, 121 FPS on the acceptance browser. The reduced-motion forced fallback changed spreads immediately with no WebGL canvas.
- Library modal opens with focus on its close control, traps Tab inside the dialog, and closes with Escape.

### Pass 6 — release interaction audit, passed after two fixes

- P2 found and fixed: the expanded element panel overlapped the horizontal selection toolbar and made `Lock` unreachable. The panel now follows the toolbar's left/right clearance and sits below it; a fresh browser run confirmed `Unlock` appears and scale/rotate controls become disabled while locked.
- Rejected a WebP package-size optimization after the target Codex in-app browser emitted `EncodingError` and rendered blank pages. The final runtime keeps the compatible original PNG artwork; a new PNG-only tab produced no console warnings or errors.
- Replaced the Atlas and Science CSS-gradient shelf placeholders with optimized captures of their real live Colosseum and volcano scenes. All four Sample Book covers now use project-owned raster artwork.
- Fresh interaction run passed the four-book Library, structured Colosseum card, continuous Atlas page turn, Great Pyramid, Night, Preview/Escape, Story/Escape, form-safe arrow keys, and 2D/reduced-motion immediate navigation.

## Primary interactions tested

- Select Bird/Fox through the WebGL raycaster.
- Lift an element and verify visible status plus usable Undo/redo.
- Open More controls and inspect scale, rotate, and motion inputs.
- Turn pages with buttons and pointer drag; capture a readable two-sided mid-turn frame.
- Switch Day/Night and confirm the document revision is presentation-independent.
- Enter/exit Preview without changing the current spread.
- Navigate with keyboard arrows and dismiss selection/Preview with Escape.
- Verify responsive selection and controls at 390 × 844.
- Verify all six project-level WebMCP definitions, registration signals, compact JSON output, input validation, idempotency, abort cleanup, and field-aware atomic patch undo in automated tests.

## Implementation checklist

- [x] Match selected Day/Night visual direction with real assets.
- [x] Preserve the sparse, book-dominant editor hierarchy.
- [x] Implement real Three.js depth and deforming two-sided page turns.
- [x] Implement the shared human/WebMCP command and undo model.
- [x] Verify desktop, mobile, accessibility, interactions, and console.
- [x] Verify the forced 2D/reduced-motion fallback and instrument both page-turn directions.
- [x] Pass type, unit, production build, and Sites worker gates.

final result: passed
