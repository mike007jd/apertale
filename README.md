# LivingBook Studio

LivingBook Studio is a WebMCP-native, Three.js picture-book editor built for the OpenAI WebMCP Challenge. People and ChatGPT operate the same live, revisioned book: both can lift prepared paper elements, transform or animate them, switch the scene theme, and safely undo exact changes.

## Start locally

```bash
cd app
npm install
npm run dev
```

## Verify the submission build

```bash
cd app
npm run typecheck
npm test
npm run build
npm run test:sites
```

## Repository map

- [`app/`](app/) — React, TypeScript, Three.js, six WebMCP tools, tests, and Sites-compatible production bundle.
- [`app/README.md`](app/README.md) — architecture, tool contract, package baseline, and verification commands.
- [`app/design-qa.md`](app/design-qa.md) — same-viewport Product Design QA evidence and iteration history.
- [`docs/LIVINGBOOK_PRD_AND_DESIGN_SPEC.md`](docs/LIVINGBOOK_PRD_AND_DESIGN_SPEC.md) — Challenge Final 1.1 product/design specification.
- [`docs/CHALLENGE_SUBMISSION_HANDOFF.md`](docs/CHALLENGE_SUBMISSION_HANDOFF.md) — demo narrative and remaining external submission gates.
- [`docs/COMPLETION_AUDIT.md`](docs/COMPLETION_AUDIT.md) — requirement-by-requirement proof and the exact external blockers.

## WebMCP tools

`get_book_context`, `lift_element`, `edit_element`, `animate_element`, `set_scene_theme`, and `undo_book_change` are registered through `document.modelContext.registerTool()` when the host browser supports WebMCP.

The human UI remains fully usable without WebMCP. Add `?fallback=1&reducedMotion=1` to the local URL to exercise the verified 2D/reduced-motion path.

## Status

The local source, visual QA, automated gates, host-portable build, and submission copy are ready. Figma team placement, live hosting, anonymous production verification, repository publication, demo-video upload, and Devpost submission require explicit external destination/authorization.

License: [MIT](LICENSE).
