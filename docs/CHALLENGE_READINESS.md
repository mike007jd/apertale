# Apertale — WebMCP Challenge Readiness

> Status: active release gate
>
> Checked: 2026-08-26 NZST
> Official deadline: 2026-09-03 1:00 p.m. PDT

This matrix is the current delivery truth for Apertale. A row is only marked passed when its evidence exists in the current workspace or live destination.

## Product and engineering

| Gate | State | Current evidence |
|---|---|---|
| Four independent sample books | Passed | `sampleBooks` contains four unique book IDs with spread counts `2 / 1 / 2 / 1`; switching books preserves each book's own revision and edits. |
| Three.js open book and page turn | Passed locally | Forward and backward midpoint frames show one continuous leaf; `pageTurn.test.ts` rejects centreline self-intersection across the whole turn. |
| Flagship 3D knowledge samples | Passed locally | Colosseum, Great Pyramid, and volcano are procedural Three.js scene models with structured interaction metadata. |
| Human and Agent share project state | Passed locally | Both paths use the same revisioned `BookEngine`, validation, provenance, idempotency, conflict handling, and exact undo records. |
| Six semantic WebMCP tools | Passed locally | Runtime registers only `get_project_context`, `manage_book`, `compose_spread`, `apply_scene_patch`, `set_presentation`, and `undo_project_change`. Context supports compact, selected-reveal, and local-asset detail without adding more discoverable tools. |
| WebMCP lifecycle and security contract | Passed locally | All six registrations are awaited as one fail-closed set, share a registration `AbortSignal`, accept the execution `{ signal }`, validate inputs again in code, return compact strings, and carry explicit `readOnlyHint` / `untrustedContentHint` annotations. Vite and the Sites Worker emit `Origin-Agent-Cluster: ?1` and `Permissions-Policy: tools=(self)`. |
| Deployment HTTP verifier | Passed locally | `npm run verify:deployment -- URL` rejects private/error responses, non-HTTPS production URLs, wrong branding or manifest, missing WebMCP policy headers, and bundles without all six identifiers. It passed against the fresh production preview and explicitly reports that the ChatGPT host loop is still required. |
| Image import and persistence | Passed locally | PNG/JPEG/WebP Blobs persist in IndexedDB under stable IDs, are discoverable across books, and are accepted by scene patches only after the trusted local adapter confirms the ID exists. |
| Day/Night, hover, click, drag, Preview | Passed locally | Browser interaction runs and `app/design-qa.md`. |
| Reduced motion and 2D fallback | Passed locally | Forced fallback route and reduced-motion behavior verified in browser. |
| Accessibility baseline | Passed locally | Named controls, keyboard page navigation, modal autofocus, focus trap, Escape close, and semantic fallback navigation. |
| Local quality gates | Passed | [`app/qa/RELEASE_GATES_2026-08-26.md`](../app/qa/RELEASE_GATES_2026-08-26.md) records current-tree typecheck, 32/32 Vitest tests, production build, 6/6 Sites/deployment tests, zero production dependency vulnerabilities, diff check, a 1.31 MB scannable-source secret scan, and a dependency-free isolated source replay. The lazy Three.js chunk is 560.58 kB minified / 143.01 kB gzip; the complete Sites bundle is 19 MB because compatible original PNG artwork is retained. |

## External challenge delivery

| Gate | State | Current evidence / completion condition |
|---|---|---|
| Editable Figma final baseline | Passed | [`Apertale — Product Design v1.1`](https://www.figma.com/design/3Kq19oItsbBczMIeB739cO/Apertale-%E2%80%94-Product-Design-v1.1?node-id=7-6) contains the editable Day, four-book Library, and Night layout baseline. Figma MCP metadata and a 1280 × 2778 render verify node `7:6`; runtime anatomy/tokens match, while the latest real 3D library-cover imagery is implementation polish beyond the embedded baseline screenshot. |
| Real ChatGPT WebMCP host run | Not verified | The Codex in-app browser loaded the current local title and primary controls, but `typeof document.modelContext` remained `undefined`. Official Site Tools availability depends on the account, selected model, and the built-in browser's **Enable site tools** permission. After deployment, discover exactly six tools and execute create/open, compose, patch, presentation, and exact undo in an eligible host. |
| Working judge-accessible live URL | Not live | `https://livingbook-studio-challenge-11.mike007jd2.chatgpt.site/` currently returns HTTP 401. This is intentional after the user asked to take the old branded build down. Republish only after explicit approval. |
| Public source repository | Missing destination | The local checkout has no Git remote. Source preparation passes locally: visible MIT license, a 1.31 MB scannable-source gitleaks pass with no findings, and a fresh dependency-free source export passed `npm ci`, typecheck, 32 tests, production build, and 6 Sites/deployment tests. [`ELIGIBILITY_AND_BUILD_LOG.md`](ELIGIBILITY_AND_BUILD_LOG.md) proves the first commit occurred inside the challenge period. Publishing the preserved history and then verifying a real anonymous clone remain required. |
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
