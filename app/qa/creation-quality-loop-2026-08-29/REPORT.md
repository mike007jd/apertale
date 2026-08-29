# Creation quality loop live verification

- Started: 2026-08-29 00:44 NZST / 2026-08-28T12:44Z
- Target: local production-equivalent Vite app at `http://127.0.0.1:5173/`
- Data: sanitized browser-local book and imported checked-in art
- Protected actions: public publish/deploy, production data changes, and deletion of existing QA books are excluded

## User-facing inventory

| Surface / workflow | Acceptance | Finite edge cases | Evidence |
|---|---|---|---|
| Library → Create Your Own | Workshop opens in the same app and describes Agent ownership honestly | no WebMCP runtime; photo mode without treatment | baseline/workshop screenshot + visible text |
| Workshop readiness handoff | UI says the brief must be finished in Codex and provides concrete questions | premise/audience absent by design; photo identity/crop decisions absent | screenshot + registered-tool response |
| Creation readiness Site Tool | Incomplete brief returns `ready: false`, blocking fields, and direct questions | missing source asset; storybook label with photo sources | captured tool JSON |
| Create fail-closed | The same incomplete brief cannot create or change revision/library | repeated request id; mismatched spread count | captured tool JSON + state assertion |
| Complete creation | One sanitized ready brief creates a personal book using the same contract | cover/final base/layer binding; revision freshness | visible book + captured tool JSON |
| Real rendering | Shelf cover and every spread produce current-revision evidence | WebGL and faithful 2D fallback live; load failure contract | screenshots + render evidence JSON + regression tests |
| Quality review | Explicit begin shows checking; every visual criterion uses real-frame evidence | record without begin; second round without patch; stale revision | UI screenshot + tool JSON |
| Publish blocker | A deterministic or visual blocker keeps Publish disabled | warning-only report; existing same-revision public recovery | UI screenshot + tests |
| Repair ceiling | One patch enables round two; remaining blocker stops for material/decision; no round three | unchanged revision; duplicate begin/record | tool JSON + tests |
| Publish-ready | A current-revision sample-ready report with no blocker enables Publish | recorded warning is allowed; no public publish click | final screenshot + quality report |
| Persistence / compatibility | Personal workflow state survives refresh; samples and existing public reads are unchanged | invalid local sidecar; existing published revision | refresh smoke + full tests |

## Live result

PASS for the authorized local scope. The in-app browser exposed the real six
WebMCP tools from the changed build; no mocked tool adapter or test-only page was
used.

1. An incomplete photo-keepsake brief returned `ready: false` with direct
   questions for book type, premise, audience, photo treatment, sources, and
   identity boundaries. Calling create with that brief returned
   `creation_not_ready`; active book, revision, and library count were unchanged.
2. The same live tool path created the sanitized one-spread personal QA book
   **The Starlight Stitch** with an exact stored illustrated-story brief,
   dedicated cover, original 2:1 composite, clean plate, and two transparent
   interactive layers.
3. Round 1 at revision 13 recorded three visual blockers: the two foreground
   characters duplicated characters already baked into the base, harming
   composition, scale/occlusion, and sample value. The Publish panel showed the
   blocked state and kept publication unavailable.
4. The repair used built-in ImageGen to remove all plush characters from the
   original composite while preserving the attic, lamp, stitched star, crop,
   palette, and lighting. The generated plate was imported through the visible
   **Add** handoff as `asset:6a2047af-7d09-4c2c-8f19-be391979cff2`; the original
   composite remains `asset:0e3b38ca-be2b-4853-92d2-62b0090534cc`. A second
   revision moved Niu Niu clear of the text safety zone.
5. Round 2 at revision 15 passed every deterministic check and every visual
   criterion except one recorded warning: the foreground friends are brighter
   and flatter than the midnight clean plate. The report is sample-ready with
   `blockerCount: 0`, `warningCount: 1`, and `publishAllowed: true`.
6. The real Publish panel displayed **Ready with notes** and an enabled
   **Publish and share** button. The button was not clicked. Reloading the app
   preserved the revision-15 ready report. Existing QA books and public content
   were neither deleted nor changed.
7. The same revision was reopened through the forced `?fallback=1` path. The
   visible 2D composition used the 1774×887 final clean plate plus both expected
   decoded foreground layers; copy and the interaction directory remained
   readable. The live `quality-review` detail then returned revision-15 spread
   evidence with `surface: "fallback"`. `09-fallback-render.jpg` and
   `fallback-render.json` retain the real frame, image load dimensions, and
   evidence record.
8. A second sanitized local draft was created without a final base to exercise
   the terminal failure path. The loading overlay count settled to zero, the
   visible page showed **Visual review unavailable**, and `quality-review`
   contained no spread render evidence for revision 16. This draft was not
   published; `10-fallback-unavailable.jpg` and `fallback-unavailable.json`
   preserve the result.

Built-in ImageGen edit target:
`/Users/haoshengli/.codex/generated_images/01a04543-3687-7303-ac85-1dd2988b3235/exec-f437ac04-7c2a-442b-86ff-5b85fd674ada.png`.
The accepted output and full edit prompt are preserved as
`starlight-clean-plate.png` in this evidence directory and in the session tool
record. The prompt requested a precise-object edit: remove all five plush
characters, reconstruct only the occluded attic/table background, retain the
stitched star and every composition/lighting invariant, and add no text or new
subjects.

## Gate result

- `npm run typecheck`: passed.
- `npm test`: 15 files / 111 tests passed.
- `npm run test:sites`: production build passed; Worker/Sites 17/17 passed;
  generated catalog matched all 149 bundled assets. The existing Three.js
  520.13 kB chunk warning remains informational.
- `npm run audit:cutouts`: reached only the known separate asset-production
  gate, with 16 current v3 assets passing and 66 referenced legacy v2 assets
  failing. This feature did not edit, pad, delete, or reclassify those assets.

Independent whole-diff review completed PASS after three read-only review/fix
passes. The final pass confirmed the bounded cycle reset, stale/pending render
evidence rejection, browser/Worker interaction parity, revision-checked open,
fallback success evidence, fallback terminal failure state, and collision-safe
fallback load keys. No confirmed finding remains in this feature diff.
