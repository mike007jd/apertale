# Apertale — WebMCP Challenge Readiness

> Status: product closeout complete; challenge-submission gates remain
>
> Checked: 2026-08-30 NZST
> Official deadline: 2026-09-03 1:00 p.m. PDT

This matrix is the current delivery truth for Apertale. A row is only marked passed when its evidence exists in the current workspace or live destination.

## Product and engineering

| Gate | State | Current evidence |
|---|---|---|
| Five independent books | Passed | The Field Guide plus four Sample Books have unique IDs and spread counts `4 / 8 / 6 / 5 / 5`; switching books preserves each book's own revision and edits. |
| Three.js open book and page turn | Passed locally | Five-point browser capture shows the next page during the turn without tearing; five geometry regressions reject endpoint drift and centreline self-intersection. Production turns measured 58 and 56 FPS against the 45 FPS floor. |
| Illustrated knowledge samples | Passed locally | Eight landmark and six science panoramas are dedicated ImageGen spreads kept as compatibility-tested PNG; the storm includes a transparent three-frame lightning sequence. The runtime ships no GLB/model payload. |
| Human and Agent share project state | Passed locally | Both paths use the same revisioned `BookEngine`, validation, provenance, idempotency, conflict handling, and exact undo records. |
| WebMCP tool catalog | Seven locally; six last verified in production | The current runtime registers the prior six document/presentation tools plus `request_image_handoff`. The final public-origin host evidence predates that addition and proves the prior exact six-tool list only; the seven-tool surface requires a fresh post-deployment host run. |
| WebMCP lifecycle and security contract | Passed locally; production refresh pending | All seven registrations are awaited as one fail-closed set, tolerate a host without an execution `AbortSignal`, validate inputs again in code, return compact strings, and carry explicit `readOnlyHint` / `untrustedContentHint` annotations. The already-verified public Worker emits `Origin-Agent-Cluster: ?1` and `Permissions-Policy: tools=(self)` for the prior deployment. |
| Deployment HTTP verifier | Prior deployment passed; seven-tool rerun pending | `npm run verify:deployment -- URL` passed against the public Site after v9 for Apertale 1.1.0, the prior six identifiers, and both required host policy headers. The verifier now derives the seven-tool catalog from the manifest and must run again after this source state is deployed. |
| Image import and persistence | Passed locally | PNG/JPEG/WebP sources up to 12 MB are alpha-aware resized/compressed in the browser to at most 1.5 MB, persist in IndexedDB under stable IDs with optimization metadata, are discoverable across books, and are accepted by scene patches only after the trusted local adapter confirms the ID exists. |
| Day/Night, hover, click, drag, Preview | Passed | Story spreads and the animated storm carry authored hover, focus, click, motion, and reveal contracts; final public mobile verification switched the shared reader to Night while keeping the reader read-only. |
| Reduced motion and 2D fallback | Passed locally | Forced fallback route and reduced-motion navigation passed; the shelf falls back to a real cover gallery instead of an empty centre. |
| Accessibility baseline | Passed locally | Named controls, keyboard page navigation, modal autofocus, focus trap, Escape close, and semantic fallback navigation. |
| Local code quality gates | Passed except the separate cutout gate below | The current simplify-plus-hygiene tree passed typecheck, 132/132 Vitest tests, production build, 19/19 built Sites tests, and `git diff --check`. The current creation-quality-loop verification record is [`../app/qa/creation-quality-loop-2026-08-29/REPORT.md`](../app/qa/creation-quality-loop-2026-08-29/REPORT.md); earlier dated QA screenshot evidence was pruned from the working tree on 2026-09-01 (recover from git history at commit `abec1ea` or earlier); the release-gate and performance text records remain under [`../app/qa/`](../app/qa/). The 2026-08-28 production closeout record remains in [`qa/livingbook-final-closeout-2026-08-28/REPORT.md`](qa/livingbook-final-closeout-2026-08-28/REPORT.md). |
| Runtime cutout asset gate | Blocked | The current alpha/padding audit passes 16 assets and rejects 41 still-referenced v2 cutouts after 25 retired cutouts were removed. Contact-sheet review also found clipped subjects, detached fragments, and edge contamination, so the remaining set requires genuine regeneration rather than padding-only repair. |

## External challenge delivery

| Gate | State | Current evidence / completion condition |
|---|---|---|
| Editable Figma final baseline | Passed | [`Apertale — Product Design v1.1`](https://www.figma.com/design/3Kq19oItsbBczMIeB739cO/Apertale-%E2%80%94-Product-Design-v1.1?node-id=7-6) contains the editable Day, Library, and Night layout baseline. Runtime implementation has since expanded the library from four samples to a Guide plus four samples without changing the approved anatomy and tokens. |
| Real ChatGPT WebMCP host run | Prior six-tool run passed; seven-tool rerun pending | The genuine desktop in-app Browser host discovered the prior exact six tools, created separate text-led and photo-led books, and called the final production `get_project_context`. Only `com.openai.codex` was installed, so this is not mislabeled as a separately installed ChatGPT desktop binary. A fresh run must also exercise `request_image_handoff` after deployment. |
| Working judge-accessible live URL | Passed | `https://livingbook-studio-challenge-11.mike007jd2.chatgpt.site/` is public, returns HTML 200, and serves the retained anonymous share link recorded in the final QA report. |
| Public source repository | Deliberately private | The configured GitHub repository remains private by explicit product requirement. This satisfies the closeout request but does not satisfy the challenge's public-source submission condition. |
| Public demo video under 3 minutes | Missing | Record after the final live host run; include audio, a human request in ChatGPT, visible WebMCP calls, the resulting book, direct manipulation, and exact undo. |
| Source-true submission media | Passed locally | [`SUBMISSION_MEDIA.md`](SUBMISSION_MEDIA.md) selects current implementation captures, captions, alt text, and the six required recording beats without using historical mockups as product evidence. |
| Devpost submission | Missing | Requires the verified live URL, public repository, public video, project description, and explicit final submit action. |

## Official requirements used for this gate

According to the current official pages, judging covers usefulness, originality, execution, thoughtful WebMCP use, and human-Agent experience. The submission requires a working live URL, explanatory text, a public demo video shorter than three minutes with audio, and a public open-source repository containing source, assets, instructions, and a visible license.

- [OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/)
- [Official Devpost requirements](https://webmcp.devpost.com/)
- [OpenAI: Using site tools in the ChatGPT desktop app](https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app)
- [Chrome WebMCP Imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- [Chrome WebMCP tool security](https://developer.chrome.com/docs/ai/webmcp/secure-tools)

## Release stop condition

The project is ready to submit only when every external-delivery row is passed against its real destination. Local product completion alone is not submission completion.

Use [`SITE_TOOLS_ACCEPTANCE.md`](SITE_TOOLS_ACCEPTANCE.md) as the exact deployment and host-loop evidence procedure.
