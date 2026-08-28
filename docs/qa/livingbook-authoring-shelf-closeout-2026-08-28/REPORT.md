# LivingBook authoring and shelf closeout — Live Verify

Date: 2026-08-28  
Target: local production build, then deployed public Site and share reader  
Status: complete — merged, deployed, and production Live Verify passed

## Workflow inventory

| ID | Workflow | Required evidence | Status |
| --- | --- | --- | --- |
| LV-01 | First-time library with curated samples only | No empty `Your books` tab; Explore shelf is immediately visible | PASS — evidence 01; 5 curated cards, 0 tabs, 0 page overflow |
| LV-02 | Returning creator with one or more authored books | `Your books` is the default section and authored books are not mixed below samples | PASS — evidence 02; `The Starlight Stitch` is the only card in the selected personal section |
| LV-03 | Switch `Your books` / `Explore` | Visible shelf, selected state, counts, keyboard semantics, and cards all match the active section | PASS — live DOM: 1 personal / 5 curated; click and ArrowLeft update selection, roving tab index, focus, and card set |
| LV-04 | Short landscape side-browser shelf | Header and actions remain visible; the shelf itself scrolls vertically; no page-level clipping | PASS — evidence 03 at 760×432; page overflow is 0 and shelf reached `scrollTop 30 / max 30` |
| LV-05 | Mobile portrait shelf and reader | Cards remain usable, controls fit, and reader content remains reachable | PASS — evidence 02 and 04 at 390×844; no horizontal or page-level overflow; reader navigation reached spread 4/6 |
| LV-06 | Site Tools authoring preflight | Six tools remain discoverable; create is rejected before `authoring-guide` and the guide becomes available | PASS — genuine in-app host discovered exactly 6 tools; preflight bypass rejected; book id and revision 9 stayed unchanged; guide returned 11 hard gates |
| LV-07 | Public Site smoke | Anonymous visitor can load the Site over HTTPS | PASS — Sites version 13; browser `GET /` 200 with required WebMCP headers; evidence 05 shows the deployed personal-first shelf |
| LV-08 | Public share reader smoke | Anonymous visitor can load the published book and navigate it | PASS — retained Starlight link returns 200, exposes no Publish/Create controls, turns to spread 2/6, and switches to Night; evidence 06 |

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

## Release

- Pull request: <https://github.com/mike007jd/apertale/pull/12>
- Merge commit: `7720ca42582884d6a844c7b32ed51e9b21e128d3`
- GitHub repository visibility: private
- Sites deployment: public version 13, succeeded
- Public Site: <https://livingbook-studio-challenge-11.mike007jd2.chatgpt.site/>
- Public Starlight reader: <https://livingbook-studio-challenge-11.mike007jd2.chatgpt.site/share/EuyDfVjurmjTsnZxAHNmmZJ-8eYCaB-Ofn4Eb84wK_U>
- Local and remote feature branches from PR #12 were removed after merge.

## Automated evidence

- Full Vitest suite: 62 passed across 10 files.
- Built Sites contract suite: 14 passed.
- TypeScript typecheck and production build: passed.
- `git diff --check`: passed.
- `npm run verify:deployment -- https://livingbook-studio-challenge-11.mike007jd2.chatgpt.site`: passed for Apertale 1.1.0, exact six tools, `Origin-Agent-Cluster: ?1`, and `Permissions-Policy: tools=(self)`.
- Production in-app host: exact six Site Tools discovered; pre-guide create rejected; active Starlight id and revision 15 remained unchanged; authoring guide returned the required 1 cover, one full-spread image per spread, and 11 hard gates.
- `npm run audit:cutouts`: unchanged known separate asset gate — 16 v3 assets pass while 66 referenced legacy v2 cutouts fail transparent-padding/edge quality. No image asset changed in this closeout; see `app/qa/RELEASE_GATES_2026-08-27.md` and the prior final-closeout ledger.

## Public-share page-turn corrective release

A production follow-up found that the anonymous `/share/...` reader committed
the next spread immediately and always passed `turn={null}` to the 3D book.
The public work therefore changed content without the physical leaf turn used
by the main reader.

- Claude Opus 5 implemented the public-reader motion controller and direct UI
  wiring. Cursor CLI with Grok 4.6 High hardened navigation, gesture,
  reduced-motion, and disposal behavior. Codex independently reviewed the
  combined implementation through a final GO verdict.
- The public reader now captures the current and destination spreads, animates
  the 3D leaf, commits the new spread only after settlement, and locks both
  navigation surfaces while the turn is in flight.
- Per-direction readiness keeps a turn unavailable until its adjacent artwork
  is decoded. Static fallback and reduced-motion readers navigate immediately
  instead of waiting for an invisible animation.
- Review fixes cover React Strict Mode effect replay, stale animation frames,
  loading-canvas gesture bypass, slow-network blank leaves, and readiness
  invalidation after a committed turn.
- Automated gates: TypeScript passed; 79 Vitest tests passed across 11 files;
  14 built Sites contract tests passed; production build and `git diff --check`
  passed.
- Production Live Verify on the retained Starlight link: at 80 ms after both a
  forward and backward click, the old spread remained announced and both page
  controls were disabled. After settlement, the destination spread was
  announced, backward navigation re-enabled, and diagnostics recorded
  `page-turn:capture` with `role: shared-spread-rt` plus a shared-surface turn
  summary.
- Corrective PR: <https://github.com/mike007jd/apertale/pull/14>; merge commit
  `8d2284344d09fd96f199c303f1e7c1572a991bc3`.
- Sites version 14; deployment
  `appgdep_6a9125b8597081918c6485e70537233d`; production HTTP contract and the
  exact six Site Tools passed again.

## Evidence

- `evidence/01-first-visit-explore-1280x720.png`
- `evidence/02-your-books-390x844.png`
- `evidence/03-your-books-760x432-scrolled.png`
- `evidence/04-reader-390x844-spread-4.png`
- `evidence/05-production-your-books-1280x720.png`
- `evidence/06-production-starlight-night-spread-2.png`
