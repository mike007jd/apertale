# Apertale / LivingBook final closeout live verification

- Verification date: 2026-08-28 (Pacific/Auckland)
- Runtime targets: local production build and the public ChatGPT Site
- Data mode: sanitized local fixtures plus disposable production books
- Functional release SHA: `e44cee08af4d3cd7d4fb32fcb238bd5795266a05`
- Deployed `app/` tree: `711d5af9f9c1b411cae5e682e608aabd42014228`
- Sites source SHA: `5cd0f0bf507366c1e0a7f943dce95145355d2e89`
- Sites version: 9; deployment `appgdep_6a90eeba6bc881918085524ea0b13bb3`
- Public Site: <https://livingbook-studio-challenge-11.mike007jd2.chatgpt.site>
- Retained public work: <https://livingbook-studio-challenge-11.mike007jd2.chatgpt.site/share/6eE-mTZXYxMBZWwIdcIFaAEDaSN3YhjKohfJD8TLvpc>
- Final disposition: **GO WITH DISCLOSED HOST-EVIDENCE AND QA-CLEANUP LIMITATIONS**

The product release is public, its GitHub repository remains private, and the
merged production source is deployed. The two disclosures do not block the
public reading or creation flows:

1. the available desktop application was Codex (`com.openai.codex`), not a
   separately installed ChatGPT desktop binary. The genuine desktop in-app
   Browser host discovered the page-defined tools and executed both creation
   paths, while the final production origin independently exposed the exact six
   tools and executed `get_project_context`;
2. two sanitized, opaque QA records remain from early lifecycle assertions
   that expected the wrong successful HTTP status. Their management
   capabilities were not logged and the available Sites connector is
   deliberately read-only for D1, so no unaudited direct database deletion was
   attempted.

## Final acceptance inventory

| ID | User-facing surface / workflow | Final evidence | State |
| --- | --- | --- | --- |
| F-01 | Cold public library | Anonymous public root returned HTML 200 with the required host headers; desktop and 390x844 library UI were exercised. | PASS |
| F-02 | Sample reading | All five curated books opened and accepted forward/back navigation before returning to Books. | PASS |
| F-03 | Declarative interaction | Hover/focus/click/reveal behavior was exercised locally; public reader remains read-only. | PASS |
| F-04 | Day / Night | Creator and final public reader switched themes; production mobile root reached `data-theme=night`. | PASS |
| F-05 | Creator workshop | Full-screen Agent handoff, length/style, starter copy, Escape, and focus return were exercised. | PASS |
| F-06 | Photo handoff | Valid PNG/JPEG/WebP assets persisted; invalid input produced inline recovery; six-image and 12 MB limits are enforced. | PASS |
| F-07 | Text-led Site Tools creation | The genuine desktop Browser host created the three-spread “A Small Night Garden” through the page tool surface. | PASS WITH HOST DISCLOSURE |
| F-08 | Photo-led Site Tools creation | The host imported a sanitized composite, clean plate, family layer, and dog layer, then created the two-spread “The Afternoon We Remember” using exact browser-local asset IDs. | PASS WITH HOST DISCLOSURE |
| F-09 | Creator publication | Local UI plus production API covered Blob upload, revision publication, exact image count, resumable publication, and public link creation. | PASS |
| F-10 | Copy / revoke / republish | Copy failures recover inline; production revoke made old manifest, asset, and shell return 404; republish produced a new working link. | PASS |
| F-11 | Delete | A disposable production book returned 204 on deletion and its manifest, asset, and shell all returned 404; retry/failure ordering is covered by tests. | PASS |
| F-12 | Anonymous shared reader | Fresh public browser loaded the retained link, showed no creator controls, switched Night, and direct asset GET returned 200. Invalid or revoked tokens return a fail-closed 404. | PASS |
| F-13 | Mobile portrait reader | At 390x844 the public reader showed readable copy, artwork, Day/Night, and 56x56 navigation controls. | PASS |
| F-14 | Loading and performance | Click acknowledgement, loading feedback, prewarm, and lazy root boundaries were verified; only the already disclosed 520 kB lazy Three.js chunk warning remains. | PASS |
| F-15 | Accessibility and console | Modal Escape/focus return, live announcements, accessible names, inline recovery, and favicon were verified. | PASS |
| F-16 | Repository and delivery | Review findings were fixed; gates pass except the separate legacy cutout audit; PRs merged; repository is private; Sites v9 matches the merged functional `app/` tree. | PASS |

## Production D1 / R2 lifecycle

The production run used generated capability tokens and never logged the
management capability.

1. Created a draft, uploaded a sanitized PNG Blob to R2, and published revision
   1 into D1.
2. Read the public manifest and exact R2-backed asset from the anonymous API.
3. Revoked the first link. Its manifest, direct asset, and share shell all
   returned 404.
4. Republished revision 2 with a different share token. The retained link and
   its referenced asset return 200; assets not referenced by the current
   manifest remain private.
5. Created and deleted a second disposable book. Delete returned 204 and its
   manifest, direct asset, and share shell all returned 404.

The bounded database inspection shows three books and three assets: the
intended retained revision-2 publication, one opaque sanitized draft, and one
opaque sanitized duplicate publication. Each asset is a 17,889-byte generated
PNG and contains no personal data. The latter two are the disclosed QA cleanup
limitation.

## UI / UX evidence

- Opus 5 directly implemented the production UI in `App.tsx`,
  `SharedBookApp.tsx`, `PublicationPanel.tsx`, and `styles.css`; this was not a
  design-only advisory pass.
- The old P1 hit-area, workshop asset-count hydration, and share-error layout
  repairs were integrated and regression checked.
- Mobile uses a separate readable sheet instead of shrinking the entire spread,
  with 56 px page controls and safe portrait spacing.
- Loading acknowledgement persists until a complete frame is ready, and media
  prewarm overlaps the transition.
- Publication copy explains public-link and local capability semantics, exposes
  Copy/Revoke/Delete, and returns focus correctly after Escape.
- Final production Live Verify caught and fixed the shared-reader theme selector
  regression (`is-shared-reader` now keeps Day/Night visible while editor-only
  Preview can still hide it).

## Site Tools evidence

The final production origin exposes exactly these six page-defined tools:

1. `get_project_context`
2. `manage_book`
3. `compose_spread`
4. `apply_scene_patch`
5. `set_presentation`
6. `undo_project_change`

After Sites v9 deployed, the desktop in-app Browser fetched that exact list from
the public origin and successfully called `get_project_context`, returning the
live five-book library, current book, outline, spread, capabilities, and assets.
The separate text-led and photo-led creation runs used this same real host
injection surface rather than a shim. Computer Use enumerated only
`com.openai.codex`; its safety boundary correctly refused self-control, so this
report does not mislabel the run as a separate ChatGPT desktop binary.

## Independent Codex review

Codex reviewed the provider changes independently and fixed six release-level
issues:

- lost publish responses now retry the exact persisted share token;
- lost revoke responses are safely idempotent;
- a republished token cannot read an older unreferenced R2 asset;
- interrupted publish UI reports resumable state instead of “Not published”;
- Site Tools tolerate a host invocation without `AbortSignal`;
- the public shared reader keeps Day/Night controls visible.

No confirmed actionable finding remains in the merged release diff.

## Verification gates

- `npm run typecheck`: pass.
- `npm test`: 7 files, 50 tests passed.
- `npm run build`: pass; expected lazy Three.js size warning only.
- `npm run test:sites:built`: 14 tests passed.
- `npm run verify:deployment -- https://livingbook-studio-challenge-11.mike007jd2.chatgpt.site`: pass; product `Apertale` 1.1.0, exact six tools, `Origin-Agent-Cluster: ?1`, and `Permissions-Policy: tools=(self)`.
- `git diff --check`: pass.
- `npm run audit:cutouts`: known separate legacy asset gate, 16 pass / 66
  referenced v2 cutouts rejected for edge padding (CL-010).

## Delivery record

- PR #2: main feature integration, merged.
- PR #3: initial host-header attempt, merged.
- PR #4: Worker-routed document shell, merged.
- PR #5: extensionless internal shell, merged.
- PR #6: production verifier follows the lazy Vite chunk graph, merged.
- PR #7: public shared-reader theme controls, merged.
- Sites access mode: public.
- GitHub repository visibility: private.
- The final evidence report is delivered as a documentation-only pull request;
  it does not change the deployed `app/` tree.
