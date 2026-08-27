# Apertale — Challenge eligibility and build log

> Evidence date: 2026-08-26 NZST / PDT

This repository was created during the WebMCP Challenge submission period. It is not a pre-existing product being represented as challenge work.

The [official rules](https://webmcp.devpost.com/rules) define the submission period as August 25, 2026 at 11:00 a.m. PT through September 3, 2026 at 1:00 p.m. PT. The repository's first commit was authored August 26, 2026 at 12:07:42 a.m. PDT, more than thirteen hours after submissions opened. The initial working files visible in filesystem metadata were also created after the opening time.

## Initial and core milestone history

The table records the creation point and core implementation milestones; `git log` remains the complete authoritative history.

| Commit | PDT timestamp | Delivered evidence |
|---|---:|---|
| `646867d` | Aug 26, 2026, 12:07:42 a.m. | Initial LivingBook Studio Challenge Final 1.1 implementation, MIT license, React/Three.js canvas, WebMCP adapter, product specification, and first QA artifacts. |
| `f172327` | Aug 26, 2026, 12:13:07 a.m. | Verification evidence and release documentation. |
| `2d19868` | Aug 26, 2026, 1:16:21 a.m. | First deployment audit and hosting bundle. |
| `65f0797` | Aug 26, 2026, 4:44:11 a.m. | Apertale product convergence: four independent books, structured reveals, cross-book assets, procedural 3D knowledge models, strengthened WebMCP lifecycle/security, and current release evidence. |

The Git history is intentionally preserved. The public repository must publish these commits rather than squash them into an undated source dump, so judges can inspect when the project and its WebMCP implementation were created.

## Current implementation ownership and provenance

- Product code, the Three.js physical-book renderer, WebMCP contracts, tests, documentation, and UI composition are repository-owned challenge work. Earlier procedural content models remain visible only in Git history; the current runtime is illustration-only.
- Runtime art provenance and generated-asset boundaries are documented in [`ASSET_PROVENANCE.md`](ASSET_PROVENANCE.md).
- Third-party packages are declared in `app/package.json` and `app/package-lock.json`; no third-party API or private dataset is embedded.
- The repository is MIT licensed through the root [`LICENSE`](../LICENSE).
- The current app contains no shared OpenAI API key. The eligible ChatGPT host supplies the visitor's Agent session.

## Reproduce the timeline

From an anonymous clone of the eventual public repository:

```bash
git log --reverse --format='%h%x09%aI%x09%s'
git show --format=fuller --no-patch 646867d
```

The public-repository gate is passed only after an anonymous clone retains this history, shows the license at repository level, and completes the verification commands in the root README.
