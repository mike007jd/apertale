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

### Pass 7 — bookshelf-first audit, superseded by Pass 9

- Replaced the editor-first entrance with a clean five-book 3D shelf: the Field Guide is first, four curated Sample Books follow, and **Create in Codex** is the unambiguous primary authoring path. The 2D/reduced-motion path now presents the same real cover gallery instead of an empty stage.
- Expanded the independent books to `4 / 8 / 6 / 5 / 5` spreads. Every non-guide spread now contains an authored interactive element with a visible hover response, focus treatment, and click reveal.
- Rebuilt the turning leaf as one watertight two-sided mesh. Five-point capture shows the upcoming spread throughout the turn without a split or blank flash; two production turns measured 58 and 56 FPS against the 45 FPS floor.
- Verified distinct Day and Night material/VFX treatments, including the moonlit Great Wall knowledge-card state. Current captures: `qa/apertale-atlas-day-current.png` and `qa/apertale-atlas-night-current.png`.
- This pass briefly evaluated runtime models; Pass 9 removed that direction and its assets from the active project after the product scope returned to OpenAI-generated illustration.
- The production bundle registered exactly six WebMCP Site Tools in the selected in-app browser with no diagnostic failures. The remaining host-driven create/compose/patch/presentation/undo recording is an external acceptance step after deployment approval.
- Current evidence is summarized in `qa/RELEASE_GATES_2026-08-27.md`.

### Pass 8 — editorial library and shared-stage turn sampling, superseded by Pass 9

- Replaced the literal furniture-style 3D shelf with a clean editorial gallery of five direct, clickable hardcovers. Each cover is a dedicated independently generated 2:3 asset; no interior crop, flat-color stand-in, or shelf prop remains in the active first-run experience. Same-state before/after comparison: `qa/audit-2026-08-27/17-bookshelf-to-editorial-gallery-comparison.png`; current evidence: `qa/audit-2026-08-27/11-flat-gallery-pass2.png` and `qa/apertale-library-current.png`.
- Forward turns freeze the outgoing composition onto the watertight deforming leaf while the destination spread appears only as its page is revealed.
- Backward turns use a second frozen render target for the outgoing base page while the previous composed page rides the turning leaf.
- Fresh diagnostics measured 65 FPS forward and 61 FPS backward. Both directions emitted the expected `turning-leaf` capture; backward also emitted `backward-base`.
- Added validated, conflict-safe cover assignment and undo through the existing `manage_book` Site Tool, preserving the six-tool surface.
- Added and validated `.codex/skills/apertale-authoring`, which teaches Codex the complete text-, photo-, and illustration-led authoring workflow through those six tools.

### Pass 9 — OpenAI illustration-only runtime, current

- Removed all runtime models, GLBs, model manifests, model identifiers, provider workflow text, and external 3D-generation dependencies. The archived material remains recoverable outside the repository in the system Trash.
- Replaced the Atlas and science placeholders with fourteen dedicated 2:1 ImageGen panoramas kept as compatibility-tested PNG. Each image composes across the gutter and preserves a natural left-page copy-safe region.
- Added a real transparent three-frame lightning sequence to the storm spread. The renderer swaps the checked-in frames, preserves hover/click interaction, and holds the resting frame under reduced motion.
- Kept Three.js only for the physical book, page deformation, offscreen full-spread composition, lighting, particles, raycasting, and frozen page-turn sampling.
- Rewrote the WebMCP contract and repository skill around browser-local image assets, illustrated layers, and frame sequences. No site-owner model key or external model provider is part of the product path.
- Migrated older browser-local sample forks in place: legacy model elements are removed, current illustration textures are restored, and shipped frame sequences are added without overwriting reader-authored transforms or interactions.
- Palette-optimised the compatibility PNG set after preserving the originals in a recoverable archive. That checkpoint reached roughly 21 MB; later clean plates and independently generated foreground layers expanded the current bundle, so asset-size reduction remains open. A fresh in-app browser run verified the library, Day/Night spreads, transparent lightning frames, knowledge card, and page-turn composition captures with no console warning or error.
- Current combined reference comparisons are `qa/audit-2026-08-27-rt/final-day-reference-comparison.png` and `qa/audit-2026-08-27-rt/final-night-reference-comparison.png`. The illustrated runtime preserves the reference's book-dominant hierarchy and cinematic theme split while intentionally replacing pop-up content models with full-spread OpenAI illustration.

### Pass 10 — honest open-book loading feedback, superseded by Pass 17

- P1 found: selecting a different book closed the library before all illustrated spreads decoded and before the replacement WebGL scene produced a complete frame. The resulting silent wait looked like a stalled site.
- The selected cover now acknowledges the click immediately with a compact `Opening` indicator. Duplicate activations, theme changes, dismissal, and other library actions are unavailable during the transition.
- For work longer than the immediate-feedback threshold, a live `Opening [book] / Preparing the illustrated pages…` status remains visible while the library safely covers the unfinished stage. The library exits only after `ThreeBook` renders a page pair and emits `book:ready`; WebGL failure falls through to the existing 2D image path.
- Loading uses the existing Phosphor icon family, bounded opacity/spin motion, and semantic timing tokens in `styles.css`. Reduced Motion keeps the status and removes sustained rotation; the preference updates when the platform setting changes and is also exercised by the forced QA route.
- Real in-app-browser diagnostics captured ordered `book:open-requested`, `book:loading`, and `book:ready` events for multiple 1.5–1.7 second book loads. The loading state exposed `role=status`, `aria-live`, `aria-busy`, native disabled controls, and no console warnings or errors. Evidence: `qa/audit-2026-08-27-rt/book-loading-feedback-final.png` and `book-loading-settled.png`.

### Pass 11 — unique spread artwork and explicit Codex CTA, current

- Audited every shipped cover and full-spread texture by URL and SHA-256. The Guide, Atlas, Science, city story, and Lantern Garden now contain no repeated full-spread image or duplicate-pixel cover; the invariant is enforced by the document-contract test.
- Replaced seven reused backgrounds with independent OpenAI ImageGen illustrations: the Guide motion page, two city-story continuations, and four Lantern Garden scenes. Background characters were removed from the four Lantern scenes so each page keeps exactly one separate hoverable/clickable cutout rather than a baked-in duplicate.
- Replaced the wide input-like Codex control with one compact coral button. Its full surface is the action, the external-link icon is subordinate, and the native button name remains `Create your own in Codex`.
- The document-contract test now rejects pixel-identical covers or full-spread illustrations. Current visual evidence remains in `qa/apertale-library-current.png` and the book-specific current captures.

### Pass 12 — desk-lamp Night, clean lightning base, and full interaction coverage, current

- Replaced the Night theme's uniform dark wash with a real warm Three.js desk-lamp spotlight and page halo. A fresh in-app-browser pass confirms the room remains dark while the full open book, copy, and interaction markers stay readable.
- Rebuilt the storm from an ImageGen-edited clean base with no baked lightning or reflection. The transparent lightning frames now play as a roughly half-second burst once per 4.6-second cycle, return to a transparent rest frame, and remain at rest under Reduced Motion.
- Added content-specific motion/hover/click hotspots to the Guide, all eight Atlas spreads, all six Science spreads, and every story spread. Every one of the 28 shipped spreads now has at least one declarative interactive element; story spreads pair their animated character with a second scene detail.
- Fresh runtime evidence confirms the storm rest state, a separately composited lightning frame, the updraft fact card, the Night lamp treatment, and an empty warning/error console. Automated interaction and document-contract tests enforce the all-spread coverage and burst/rest timing.

### Pass 13 — reversible book navigation motion, superseded by Pass 17

- Replaced the library's generic mount/unmount with one reversible shared-object sequence. After a selected book is ready, its real cover lifts from its exact library geometry, moves to the reading stage, opens into a two-page silhouette, and hands off to the rendered book. **Books** plays the inverse sequence and lands the closed cover back in that book's own slot.
- The existing loading state remains authoritative and completes before the opening choreography. While either direction runs, the library reports `aria-busy`, all competing book/theme/create controls are disabled, and rapid repeated selection cannot queue stale transitions.
- Entry and exit settle in roughly 0.78 seconds in the in-app browser. Diagnostics recorded paired `book:navigation-transition-started` and `book:navigation-transition-settled` events in both directions. Focus returns to **Books** after opening and to **Return to open book** after closing into the library.
- The forced `fallback=1&reducedMotion=1` route performs the same navigation immediately with no spatial overlay, preserves the open-book/library states, and emitted no console warnings or errors.

### Pass 14 — shared Create Your Own workbench, superseded by Pass 16

- Removed the context-free `Add` action from finished books. The library and reader now expose the same compact **Create Your Own** action and open one shared creation workspace.
- The workspace captures starting material, concept, audience, 4–12-spread length, visual direction, and up to six browser-local reference images. It produces a structured brief for the user's current Agent instead of pretending to run an embedded model.
- Imported images remain in the browser-local asset store and become available through `get_project_context(detail: assets)`. The handoff explicitly keeps the page open, uses the user's own AI access, and asks the Agent to create a new independent book rather than overwrite a curated sample.
- Fresh in-app-browser verification confirmed the live brief summary, copy-success state, library and reader entry points, absence of the old `Add` button, connected six-tool status, and an empty warning/error console.

### Pass 15 — artifact-free book navigation compositor, current

- Replaced the translucent navigation stack with one fully opaque, theme-aware transition stage. The library, old reader scene, controls, and element rail can no longer show through the moving book.
- The transition now uses the selected book's real current spread instead of a blank two-column proxy. The spread is revealed from the gutter with clipping while the cover stays front-facing and never rotates far enough to expose a mirrored backside.
- Slow-motion development audits sampled the cover lift, cover-to-spread handoff, open reveal, and reverse close. Day and Night both kept a single readable book object with no blank page, split texture, mirrored title, or mixed-screen overlap.
- Normal-speed open/close completed with competing library cards locked and an empty warning/error console. The forced `fallback=1&reducedMotion=1` route performed the same state changes with zero transition overlay. Typecheck, 38 unit tests, production build, and all 7 Sites/artwork-contract tests passed.

### Pass 16 — blank-book Agent workshop, superseded by Pass 17

- Replaced the form modal with a full-screen blank physical book rendered by the existing Three.js scene. The open pages carry only two bounded choices—4–12 spreads and visual direction—while a compact right rail owns the Agent handoff.
- Removed duplicate story, audience, and primary photo-upload fields. The starter prompt asks for the request and source images in the user's Agent conversation, identifies the open Apertale page and selected constraints, and tells the Agent to inspect context before creating a new independent book.
- Kept one quiet **Image handoff** fallback because binary attachment transfer is not yet standardized across WebMCP hosts. It is used only when the current Agent cannot transfer media, stores PNG/JPEG/WebP in the browser-local asset directory, and never asks the user to re-enter their story.
- Fresh in-app-browser verification covered library and reader entry, length/style selection, copy feedback, return to library, Day/Night, forced 2D/Reduced Motion, one-dialog accessibility state, live six-tool discovery, and an empty warning/error console.

### Pass 17 — closed design scales, four-state controls, and a cased book that really opens, current

- Passes 10, 13 and 16 described behaviour this pass replaced, and they were being read as specification. Pass 10 said the library exits only once `ThreeBook` emits `book:ready`; readiness is now one of two exits, the other being a bounded 2600 ms failsafe, after which the cover swing plays and the shelf leaves at the end of it. Pass 13 described a CSS silhouette sequence that has been deleted. Pass 16 described an **Image handoff** control that never existed in the interface and counted six site tools; the interface says **Photos**, and there are seven.
- `styles.css` had grown 34 font sizes, 20 radii, 30 shadows and 68 spacing values. One direct token layer now owns 7 type steps, 4 radii, 3 two-layer elevations and 11 spacing steps.
- Thirteen surfaces shared one visual rule regardless of job. They now resolve to three: resting, lifted, floating. `backdrop-filter` went from 26 uses to 4. All 63 controls carry rest / hover / active / focus-visible states from one rule built on the independent `scale` property, so a control's own `transform` is never overwritten to animate it.
- The 2D transition that stood in for opening a book is gone. The case is real geometry: a spine shell, a rear board, a front board on a translating joint, endpapers, squab, and a text block whose depth follows the spread count. The book leaves and returns to its own shelf slot by unprojecting the card's rect against the live camera.
- **Not visually verified.** The Browser pane in the authoring environment was hidden for this pass, which throttles `requestAnimationFrame`, so the open and close motion has been checked only as arithmetic — continuity of position, velocity and acceleration across the whole curve — and in single frames forced through `?openProgress=`. No one has watched it run. Treat the motion as unreviewed until someone does.
- Ten defects catalogued during the same investigation are fixed with this pass: the selection ring's frame mismatch on phone portrait and its absence entirely on the 2D fallback; Preview accepting canvas drags into the document; the missing `readOnly` on the reader's book; **Ask Codex** deleted by a media query with no replacement entry point; the outline button hidden while its panel kept an authored layout; a short desktop window matching the phone score; a focus trap installed twice on the shelf; the publish panel printing one fault three times; the case, text blocks, page materials and contact shadow leaking on every scene teardown; and this document.
- Evidence for this pass is `npm run tokens:check` (4/4), `tsc --noEmit`, and the unit and site-tool suites. There is no fresh browser capture, for the reason recorded above.

## Primary interactions tested

- Select Bird/Fox through the WebGL raycaster.
- Lift an element and verify visible status plus usable Undo/redo.
- Open More controls and inspect scale, rotate, and motion inputs.
- Turn pages with buttons and pointer drag; capture a readable two-sided mid-turn frame.
- Switch Day/Night and confirm the document revision is presentation-independent.
- Enter/exit Preview without changing the current spread.
- Navigate with keyboard arrows and dismiss selection/Preview with Escape.
- Verify responsive selection and controls at 390 × 844.
- Verify all seven project-level WebMCP definitions, registration signals, compact JSON output, input validation, idempotency, abort cleanup, and field-aware atomic patch undo in automated tests.

## Implementation checklist

- [x] Match selected Day/Night visual direction with real assets.
- [x] Preserve the sparse, book-dominant editor hierarchy.
- [x] Implement real Three.js depth and deforming two-sided page turns.
- [x] Implement the shared human/WebMCP command and undo model.
- [x] Verify desktop, mobile, accessibility, interactions, and console.
- [x] Verify the forced 2D/reduced-motion fallback and instrument both page-turn directions.
- [x] Pass type, unit, production build, and Sites worker gates.

final result: passed
