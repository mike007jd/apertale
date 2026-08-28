# Apertale / LivingBook final closeout bug ledger

| ID | Severity | Surface | Finding / source | State | Regression oracle |
| --- | --- | --- | --- | --- | --- |
| CL-001 | P0 | Creator publish | No creator-facing Blob upload, Publish, Copy link, Revoke, or Delete integration. | FIXED; PROD RERUN PENDING | Client protocol tests plus local and production E2E. |
| CL-002 | P0 | Public delivery | Existing Site is owner-only and returns 401 anonymously. | IN PROGRESS | Anonymous root and share URL HTTP/UI checks. |
| CL-003 | P1 | Shelf | Empty gallery area intercepted primary actions. Prior verified repair imported. | FIXED, LOCAL VERIFIED | Desktop/mobile hit test and click. |
| CL-004 | P1 | Mobile reader | Portrait mode shrank the story into an unreadable postcard. | FIXED; SHARED PROD RERUN PENDING | 390x844 creator and shared-reader UI. |
| CL-005 | P1 | First open | Local open-to-ready was 5.69 seconds despite correct lazy boundaries. | FIXED, LOCAL VERIFIED | Cold-root request audit and open timing diagnostics. |
| CL-006 | P1 | Photo recovery | Persisted handoff count disappeared after reload. Prior verified repair imported. | FIXED, LOCAL VERIFIED | Import, reload, reopen. |
| CL-007 | P1 | Share error | Invalid/revoked error copy overlapped. Prior verified repair imported. | FIXED, RERUN PENDING | Invalid token desktop/mobile screenshot. |
| CL-008 | P1 | D1/R2 | Live create/upload/publish/read/revoke/delete was not exercised. | PENDING DEPLOYMENT | Disposable production book lifecycle. |
| CL-009 | P1 | Site Tools | Real ChatGPT desktop text/photo creation was not exercised. | HOST CONTRACT VERIFIED; CHATGPT DESKTOP PENDING | Six-tool host history and final project contexts. |
| CL-010 | P1 | Legacy cutouts | Existing quality audit rejects referenced v2 cutouts. | KNOWN SEPARATE ASSET GATE | `npm run audit:cutouts`. |
| CL-011 | P2 | Modal keyboard | Escape did not complete the expected shelf/modal close behavior. | FIXED, LOCAL VERIFIED | Keyboard live run. |
| CL-012 | P2 | Photo recovery | Invalid photos used blocking `window.alert`. | FIXED, LOCAL VERIFIED | Wrong-type and oversized import. |
| CL-013 | P2 | Mobile library | First fold was copy-heavy and lacked explicit book discovery cue. | FIXED, LOCAL VERIFIED | 390x844 screenshot and swipe. |
| CL-014 | P3 | Console | Missing favicon caused 404. | FIXED, LOCAL VERIFIED | Cold console. |
| CL-015 | P3 | Accessibility | Sentence concatenation could announce doubled periods. | FIXED, LOCAL VERIFIED | AX/live-region text. |
| CL-016 | P1 | Publish recovery | A committed publish whose response was lost could mint a second URL on retry. Codex review finding. | FIXED, TESTED | Persisted browser-generated share token and exact idempotent retry. |
| CL-017 | P1 | Revoke recovery | A committed revoke whose response was lost returned conflict on retry. Codex review finding. | FIXED, TESTED | Retrying a revoked record returns the same terminal state and stays fail closed. |
| CL-018 | P0 | Asset privacy | A new share token could read an older uploaded asset if its ID was known after republish. Codex review finding. | FIXED, TESTED | Shared asset reads must be referenced by the current published manifest. |
| CL-019 | P1 | Publish UI | A failed/interrupted publish retained resumable state but still displayed Not published. Codex review finding. | FIXED, TESTED | Refresh local publication state on failure and render Resume publishing. |
| CL-020 | P1 | Site Tools host | The desktop host may invoke a tool without an AbortSignal; direct dereference crashed the six-tool path. Live verification finding. | FIXED, TESTED | All tools default to an uncancelled signal while preserving real cancellation. |
