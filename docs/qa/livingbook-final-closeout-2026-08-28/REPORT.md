# Apertale / LivingBook final closeout live verification

- Inventory frozen: 2026-08-28T10:15:56+12:00
- Runtime targets: local production preview and public ChatGPT Site
- Data mode: sanitized local fixtures plus disposable production books
- Source branch: `codex/livingbook-final-closeout-20260828`
- Final disposition: **LOCAL GATES PASS; PRODUCTION VERIFICATION PENDING**

This report is the evidence ledger for the final closeout. Automated checks are
supporting evidence; user-facing rows require live UI or production evidence.
The GitHub repository remains private by explicit product decision.

## Inventory v0

| ID | User-facing surface / workflow | Acceptance | Finite edge cases | Required evidence | State |
| --- | --- | --- | --- | --- | --- |
| F-01 | Cold public library | Public root opens anonymously to the five-cover editorial library; Create and Guide are clickable; no reader or Three.js/spread payload loads before intent. | 1440x900 and 390x844; reduced motion. | Network/DOM plus desktop and mobile screenshots. | LOCAL PASS; ANONYMOUS PROD PENDING |
| F-02 | Sample reading | Each of five samples opens, reaches ready, turns forward/back, returns to Books, and preserves its own state. | First and last spread; competing navigation while loading. | Live UI, diagnostics, screenshots. | LOCAL PASS |
| F-03 | Declarative interaction | Hover/focus/click/reveal remains usable and read-only Preview hides editing controls. | Pointer and keyboard; reduced motion. | Live UI and diagnostics. | LOCAL PASS |
| F-04 | Day / Night | Selection acknowledges immediately and settles a readable room, lamp, book, and artwork presentation. | Mobile portrait and reduced motion. | Live UI screenshots. | LOCAL PASS |
| F-05 | Creator workshop | Full-screen workshop is an honest Agent handoff; length/style and starter copy work; it does not imitate a chat. | Escape/focus trap; browser without WebMCP. | Live UI and accessibility tree. | LOCAL PASS |
| F-06 | Photo handoff | Valid PNG/JPEG/WebP imports inline, survives reload/reopen, and invalid input gives inline recovery without a blocking alert. | Over 12 MB, wrong type, storage failure, six-image cap. | Live UI plus IndexedDB metadata. | LOCAL PASS |
| F-07 | Text-led Site Tools creation | Real ChatGPT desktop built-in browser discovers exactly six tools and creates a disposable text-led book through the page. | Current revision and unique request IDs; no shim. | Host tool history, page state, final context. | HOST CONTRACT PASS; CHATGPT DESKTOP RUN PENDING |
| F-08 | Photo-led Site Tools creation | A sanitized image is handed off, discovered by `get_project_context(detail: assets)`, and used in a disposable photo-led book. | Missing attachment bridge; exact asset ID; provenance. | Host tool history, page state, final context. | HOST CONTRACT PASS; CHATGPT DESKTOP RUN PENDING |
| F-09 | Creator publication | Non-sample book uploads every referenced local Blob, publishes, and exposes a public share URL without exposing the manage capability. | Missing Blob, changed published revision, repeat click, API error. | UI, network, D1/R2, share URL. | PENDING |
| F-10 | Copy / revoke / republish | Copy link works; revoke makes the old manifest, asset, and shell fail closed; republish returns a different working URL without duplicate uploads. | Clipboard unavailable; new asset after revoke. | External HTTP, UI, D1/R2. | PENDING |
| F-11 | Delete | Explicitly confirmed permanent delete removes D1/R2 state; interrupted deletion is safely retryable and never leaves public bytes reachable. | R2 failure, D1 cleanup failure, retry. | Focused tests plus disposable production record. | PENDING |
| F-12 | Anonymous shared reader | A signed-out/anonymous client can open the share link, turn pages, switch theme, and use reveals without creator/edit/upload/tool controls. | Invalid and revoked token; direct asset URL. | Fresh browser context and HTTP. | PENDING |
| F-13 | Mobile portrait reader | 390x844 presents readable story title/body, meaningful artwork, and thumb-size navigation instead of a tiny postcard. | Long title/body; shared reader; safe-area height. | Mobile screenshot and UI actions. | CREATOR LOCAL PASS; SHARED PROD PENDING |
| F-14 | Loading and performance | Click is acknowledged immediately; chunk/current media prewarm overlaps transition; honest feedback persists until complete frame; cold root remains lazy. | Slow network and reduced motion. | Timing diagnostics and resource inventory. | LOCAL PASS; PROD TIMING PENDING |
| F-15 | Accessibility and console | Modal Escape/focus, accessible announcements, favicon, names, and controls are clean. | Sentence-ending punctuation; unavailable share. | AX tree, keyboard run, console. | LOCAL PASS; INVALID PROD SHARE PENDING |
| F-16 | Repository and delivery | Review has no confirmed actionable findings; gates pass apart from separately disclosed legacy asset gate; PR merges; repository is still private; public deployment matches merged SHA. | Dirty tree, source/deploy SHA mismatch. | Git/GitHub/Sites metadata and gates. | PENDING |

## Local evidence

- Production preview: 1280x720 desktop, 390x844 portrait, and 844x390 short
  landscape were exercised in the Codex in-app browser. The shelf CTAs were
  clickable, the mobile discovery cue remained above the gallery, and the
  console produced no warning or error entries.
- All five curated books opened through their visible shelf controls and
  accepted forward/back navigation before returning to Books.
- The creator mobile reader rendered a 366 px wide reading sheet with 56 px
  previous/next controls, readable copy, a working reveal card, and a readable
  Night presentation.
- The real page-defined WebMCP surface exposed exactly six tools. A three-spread
  text book was created through `manage_book`. A separate two-spread photo book
  imported a composite, clean plate, family layer, and dog layer, then used
  exact browser-local asset IDs for cover and scene construction.
- A non-image file produced an inline recoverable alert; the four valid image
  handoffs remained available after navigation and tool calls.
- The publication panel disclosed public-link and local-capability semantics,
  reported the exact image/revision count, and returned focus to Publish after
  Escape.

## Bugs and fixes

See `BUG_LEDGER.md`. The three narrow P1 repairs imported from the prior live
verification remain subject to regression verification in this run.

## Current gates

- `npm run typecheck`: pass.
- `npm test`: 7 files, 50 tests passed.
- `npm run test:sites`: 14 tests passed after a production build.
- `npm run build && npm run test:sites:built`: pass.
- `git diff --check`: pass.
- `npm run audit:cutouts`: known separate legacy asset gate, 16 pass / 66
  referenced v2 cutouts still rejected for edge padding (CL-010).

Production D1/R2, anonymous sharing, ChatGPT desktop, merged-SHA deployment,
and repository metadata evidence will be appended after deployment.
