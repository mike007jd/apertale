# LivingBook authoring and shelf closeout — Live Verify

Date: 2026-08-28  
Target: local production build, then deployed public Site and share reader  
Status: local implementation and Live Verify passed; production release pending

## Workflow inventory

| ID | Workflow | Required evidence | Status |
| --- | --- | --- | --- |
| LV-01 | First-time library with curated samples only | No empty `Your books` tab; Explore shelf is immediately visible | PASS — evidence 01; 5 curated cards, 0 tabs, 0 page overflow |
| LV-02 | Returning creator with one or more authored books | `Your books` is the default section and authored books are not mixed below samples | PASS — evidence 02; `The Starlight Stitch` is the only card in the selected personal section |
| LV-03 | Switch `Your books` / `Explore` | Visible shelf, selected state, counts, keyboard semantics, and cards all match the active section | PASS — live DOM: 1 personal / 5 curated; click and ArrowLeft update selection, roving tab index, focus, and card set |
| LV-04 | Short landscape side-browser shelf | Header and actions remain visible; the shelf itself scrolls vertically; no page-level clipping | PASS — evidence 03 at 760×432; page overflow is 0 and shelf reached `scrollTop 30 / max 30` |
| LV-05 | Mobile portrait shelf and reader | Cards remain usable, controls fit, and reader content remains reachable | PASS — evidence 02 and 04 at 390×844; no horizontal or page-level overflow; reader navigation reached spread 4/6 |
| LV-06 | Site Tools authoring preflight | Six tools remain discoverable; create is rejected before `authoring-guide` and the guide becomes available | PASS — genuine in-app host discovered exactly 6 tools; preflight bypass rejected; book id and revision 9 stayed unchanged; guide returned 11 hard gates |
| LV-07 | Public Site smoke | Anonymous visitor can load the Site over HTTPS | Not run |
| LV-08 | Public share reader smoke | Anonymous visitor can load the published book and navigate it | Not run |

## Provider implementation record

- UI/UX implementation: Claude Opus 5 dispatch session `2182`.
- Authoring contract and WebMCP integration: Cursor CLI agent using Grok 4.6 High dispatch session `93027`.
- Independent integration, review, verification, and release: Codex.

## Findings and review

- P1 fixed during independent Codex review: `manage_book create` previously relied on descriptive wording and could skip the authoring guide. The registration now records a successful guide read and fails closed before it.
- The website cannot silently install a ChatGPT/Codex Skill. The no-install public contract is the same six Site Tools plus `get_project_context(detail: "authoring-guide")`; the checked-in `apertale-authoring` Skill mirrors that contract for users who explicitly install or share it.
- User books are now the primary shelf. Curated samples move to `Explore`; first-time visitors without a personal book see Explore directly instead of an empty tab.
- The library is a fixed frame with one bounded vertical shelf scroller. Desktop, short landscape, and portrait evidence all keep the document itself at zero overflow.
- The creation workshop remains deliberately light: mode, spread count, visual style, one summary line, and one primary handoff action.
- No new critical or high-severity code-review findings remain in this change set.

## Automated evidence

- Full Vitest suite: 62 passed across 10 files.
- Built Sites contract suite: 14 passed.
- TypeScript typecheck and production build: passed.
- `git diff --check`: passed.
- `npm run audit:cutouts`: unchanged known separate asset gate — 16 v3 assets pass while 66 referenced legacy v2 cutouts fail transparent-padding/edge quality. No image asset changed in this closeout; see `app/qa/RELEASE_GATES_2026-08-27.md` and the prior final-closeout ledger.

## Evidence

- `evidence/01-first-visit-explore-1280x720.png`
- `evidence/02-your-books-390x844.png`
- `evidence/03-your-books-760x432-scrolled.png`
- `evidence/04-reader-390x844-spread-4.png`
