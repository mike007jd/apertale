# Apertale / LivingBook final closeout bug ledger

| ID | Severity | Surface | Finding / source | Final state | Regression oracle |
| --- | --- | --- | --- | --- | --- |
| CL-001 | P0 | Creator publish | No creator-facing Blob upload, Publish, Copy link, Revoke, or Delete integration. | FIXED; PROD VERIFIED | Client protocol tests, UI run, and production lifecycle. |
| CL-002 | P0 | Public delivery | Existing Site was owner-only and returned 401 anonymously. | FIXED; PROD VERIFIED | Public root and retained share return 200. |
| CL-003 | P1 | Shelf | Empty gallery area intercepted primary actions. Prior verified repair imported. | FIXED; VERIFIED | Desktop/mobile hit test and click. |
| CL-004 | P1 | Mobile reader | Portrait mode shrank the story into an unreadable postcard. | FIXED; PROD VERIFIED | 390x844 reader, readable sheet, 56 px controls. |
| CL-005 | P1 | First open | Local open-to-ready was 5.69 seconds despite correct lazy boundaries. | FIXED; VERIFIED | Loading feedback, prewarm, and cold-root inventory. |
| CL-006 | P1 | Photo recovery | Persisted handoff count disappeared after reload. Prior verified repair imported. | FIXED; VERIFIED | Import, reload, reopen. |
| CL-007 | P1 | Share error | Invalid/revoked error copy overlapped. Prior verified repair imported. | FIXED; PROD VERIFIED | Worker returns a plain fail-closed 404 before app rendering. |
| CL-008 | P1 | D1/R2 | Live create/upload/publish/read/revoke/delete was not exercised. | FIXED; PROD VERIFIED | Sanitized production lifecycle and bounded D1 inspection. |
| CL-009 | P1 | Site Tools | Real desktop-host text/photo creation was not exercised. | VERIFIED WITH HOST DISCLOSURE | Genuine desktop Browser host creation runs plus final production six-tool discovery/call; separate ChatGPT binary unavailable. |
| CL-010 | P1 | Legacy cutouts | Existing quality audit rejects referenced v2 cutouts. | KNOWN SEPARATE ASSET GATE | `npm run audit:cutouts` remains 16 pass / 66 fail. |
| CL-011 | P2 | Modal keyboard | Escape did not complete the expected shelf/modal close behavior. | FIXED; VERIFIED | Keyboard run and focus return. |
| CL-012 | P2 | Photo recovery | Invalid photos used blocking `window.alert`. | FIXED; VERIFIED | Wrong-type import reports inline recovery. |
| CL-013 | P2 | Mobile library | First fold was copy-heavy and lacked an explicit discovery cue. | FIXED; VERIFIED | 390x844 screenshot and horizontal gallery. |
| CL-014 | P3 | Console | Missing favicon caused 404. | FIXED; VERIFIED | Cold console. |
| CL-015 | P3 | Accessibility | Sentence concatenation could announce doubled periods. | FIXED; VERIFIED | AX/live-region text. |
| CL-016 | P1 | Publish recovery | A committed publish whose response was lost could mint a second URL on retry. Codex review finding. | FIXED; TESTED | Persisted browser-generated share token and exact idempotent retry. |
| CL-017 | P1 | Revoke recovery | A committed revoke whose response was lost returned conflict on retry. Codex review finding. | FIXED; TESTED | Retrying a revoked record returns the same terminal state. |
| CL-018 | P0 | Asset privacy | A new share token could read an older uploaded asset if its ID was known after republish. Codex review finding. | FIXED; TESTED | Shared reads require a current-manifest reference. |
| CL-019 | P1 | Publish UI | A failed/interrupted publish retained resumable state but displayed Not published. Codex review finding. | FIXED; TESTED | Failure refreshes local publication state and renders Resume publishing. |
| CL-020 | P1 | Site Tools host | A desktop host may invoke a tool without an AbortSignal. | FIXED; TESTED | Tools default to an uncancelled signal and preserve real cancellation. |
| CL-021 | P0 | Production headers | Static root bypassed the Worker and omitted the WebMCP document policy. | FIXED; PROD VERIFIED | Extensionless Worker-routed app shell; root 200 with both headers. |
| CL-022 | P1 | Shared reader theme | Public reader inherited editor Preview CSS and hid Day/Night. Final Live Verify finding. | FIXED; PROD VERIFIED | Shared-reader marker preserves theme controls; production Night switches at 390x844. |
| CL-023 | P3 | QA cleanup | Two sanitized lifecycle records lost their management capabilities after early harness assertions expected the wrong 2xx code. | DISCLOSED; NON-BLOCKING | Bounded D1 read shows one opaque draft and one opaque duplicate; no privileged write path is available. |
