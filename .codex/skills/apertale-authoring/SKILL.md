---
name: apertale-authoring
description: Create or revise polished interactive Apertale books through the site's WebMCP tool surface. Use when a user asks Codex to turn an idea, manuscript, or personal images into an illustrated story, guide, comic, photo book, or educational book in the Apertale browser.
---

# Apertale Authoring

Treat Apertale as the renderer and browser-local project store. Plan, write, inspect, and generate images in the user's current Codex conversation, then mutate the open book only through Apertale Site Tools. Apertale never spends a site-owner API key.

## Start safely

1. Call `get_project_context` before planning or changing anything. If it is unavailable, ask the user to open Apertale in the Codex built-in browser and stop without claiming a change.
2. Read `get_project_context(detail: "authoring-guide")` and follow its current authoring, evidence, handoff, review, reporting, and stopping contract.
3. Read [tool workflow](references/tool-workflow.md) before mutation. Sketch the whole rough book with `sketch_storyboard` before generating final art, revise only the spreads the reader marks in red, generate art in 2×2 sheets, and hand finals off inline through `request_image_handoff(images)` with `split`. Read [authoring recipes](references/authoring-recipes.md) for the selected idea, photo-led, preserved-photo, or illustration-led pattern.
4. Use `get_project_context(detail: "creation-readiness")` with a versioned brief. Ask its blocking questions together, re-check, and reuse the exact ready brief for creation.

## Mutate with evidence

- Prepare every required cover, spread, clean plate, and layer before creating the book. Use only asset ids returned by the runtime asset context.
- Keep each mutation's `requestId`, expected document id, and revision together. Refresh context after document mutations; resolve conflicts from the refreshed state.
- Treat `presentation.status: "pending"` as saved but visually unconfirmed. Resume with the same request id.
- Claim generation, import, rendering, or publication only from returned ids, tool results, or an explicit pending-handoff result.

## Finish

Run the [quality bar](references/quality-bar.md) against actual shelf and spread renders. Complete at most two critique rounds, stop for required source material or a user decision when blockers remain, and publish only after explicit user approval when the current report says `publishAllowed: true`.

Return the report required by the runtime authoring guide, including the active revision, evidence inspected, asset provenance, remaining handoffs or blockers, and undo tokens for reversible changes.
