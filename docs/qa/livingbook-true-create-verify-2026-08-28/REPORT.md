# Apertale True Create Your Own — Live Verify

- Started: 2026-08-28 15:57 NZST
- Target: local production-equivalent web build, then public ChatGPT Site
- Branch baseline: `1c5dc4b`
- Data mode: sanitized local assets plus project-owned/generated test art
- Protected actions: public deploy and destructive production deletion only within the user's already-authorized closeout scope

## User-facing inventory v0

| ID | Surface / workflow | Acceptance | Edge cases | Evidence |
|---|---|---|---|---|
| CYO-01 | Library creation entry | Primary CTA reads **Create your own** and opens the workshop | narrow right-side browser, mobile | PASS — 01, 06, 14 |
| CYO-02 | Browser/runtime guidance | Independent browsers get a short truthful handoff; Codex built-in browser gets a ready state; no Safari-specific copy | tool runtime absent/present | PASS for live Codex ready state and source copy; external-browser visual pending production |
| CYO-03 | Creation setup | Idea, Photos, and Idea + photos are selectable with exact spread count and visual direction | mode switching preserves intentional choices | PASS — 02, 05, 14 |
| CYO-04 | Photo handoff | Ordered previews support add, reorder, and remove; invalid files fail visibly | empty, 12-image limit, long names | PASS — 04, 05; explicit one-image selection survived reload and did not reselect 12 historical assets |
| CYO-05 | Creation brief | Copied brief contains stable ordered asset IDs and the two-phase inspect/story/plan/ImageGen/layout/evidence gates | idea with no assets; photo-led sources | `creationBrief.test.ts` — 6 cases |
| CYO-06 | Semantic output contract | Photo-led completion requires one generated portrait cover plus one original full-spread artwork per spread; a raw right-page photo dump is rejected | explicit literal photo-album exception only | source review + prompt tests |
| CYO-07 | Responsive workshop | No horizontal overflow, clipped controls, unreadable copy, or sub-44px primary targets | desktop, Codex side pane, 390x844 | PASS — 0px horizontal overflow; close 44×44; primary 522×48 at 760×900; 05, 14 |
| CYO-08 | Full book result | One coherent six-spread story uses the five reference characters, generated cover, six generated panoramas, readable text, and purposeful interactions | page turns, Preview, reload | PASS locally — revision 9; 02 interactive layers per spread; 07–13 |
| CYO-09 | Site Tools | Exact six tools remain discoverable and can create, cover, patch, present, inspect, and undo | revision conflict/failure stays explicit | PASS locally — fresh discovery includes six tools and `manage_book.required = requestId, expectedRevision, action`; production rerun pending |
| CYO-10 | Publish/share lifecycle | Creator can publish, copy link, revoke, and delete; anonymous reader is read-only | revoked/deleted links fail safely | pending |

## Generated regression story

`The Starlight Stitch`: a six-spread illustrated story built from five user-supplied plush-character reference images. The test asset set contains one purpose-built portrait cover and six purpose-built 2:1 spread illustrations created with ImageGen. Source photos remain provenance/reference material rather than finished right-page art.

### Local Site Tools result

- Book: `book-the-starlight-stitch-5a1f32a8`
- Final revision: `9`
- Cover: `asset:4b37cb3c-0907-4aa3-968f-dba78b365856`
- Spread art, in order:
  1. `asset:0e3b38ca-be2b-4853-92d2-62b0090534cc`
  2. `asset:52af99ea-7532-4fd3-a5e4-5c2e49e8a89c`
  3. `asset:bfe481d9-77db-446f-afd3-c162d9bd2a5a`
  4. `asset:40776a38-f5d4-45f1-9448-fa36615bb709`
  5. `asset:ae0b6cf0-2c74-4e7a-82f2-e19cbdcda693`
  6. `asset:24609ed9-6561-4e52-a9bd-cf64e4b9febd`
- Each spread has two small interactive source-reference layers with warm-rim hover, spotlight focus, gentle-float motion, and a reader-facing caption. The generated panorama—not a raw upload—is the full-spread scene.
- Last spread undo token: `c34421a7-a8b4-4693-bc77-c29a11f54e44`

## Gate status

- Targeted prompt/WebMCP/asset tests: PASS — 9 tests
- Full test suite: PASS — 56 tests across 8 files
- Typecheck: PASS
- Production build: PASS
- Responsive live GUI: PASS locally — desktop, 760×900, 390×844
- Real Site Tools complete-book run: PASS locally; production rerun pending
- Public publish/share lifecycle: pending

## Final verdict

HOLD until live GUI, real Site Tools, publishing, merge, and deployment evidence are complete.
