---
name: apertale-authoring
description: Create or revise polished interactive Apertale books through the site's WebMCP tool surface. Use when a user asks Codex to turn an idea, manuscript, or personal images into an illustrated story, guide, comic, photo book, or educational book in the Apertale browser.
---

# Apertale Authoring

Use Apertale as the renderer and browser-local store. Generate in the user's current Agent conversation with their own model usage; edit the book through Site Tools.

## Start and review the sketch

1. Read `get_project_context(detail: "authoring-guide")` once for the live book and the authoritative execution contract. If unavailable, ask the reader to open Apertale in a supporting browser and report the blocked connection.
2. Read [tool workflow](references/tool-workflow.md) and the relevant [recipe](references/authoring-recipes.md) before sketch review. Check creation-readiness with the structured brief, ask blocking questions together, then reuse the exact ready brief.
3. Sketch the complete rough book, end the turn, and let the reader review and mark it. After approval, follow the live guide's generation, batched handoff, creation, and minimum-check steps continuously. Read annotations only when new marks are reported; apply them to affected spreads without asking for approval again when already given.

## Complete the book

- Treat the live guide as the execution source of truth; the references explain tool usage and book-specific art direction. Reuse returned asset ids and revisions, and refresh context only for a conflict, new reader edits, or a fallback drawer import.
- Follow [minimum checks and requested polish](references/quality-bar.md). Deliver after the cover and every spread have been inspected once in the current theme and material reading failures are resolved. Keep full critique for an explicit polish request.
- Preserve successful assets and the created book during local repairs. Resume successful presentation-pending calls with the same request id, bounded by the guide's retry limit; keep undo tokens.
- Report the guide's required counts, revision, evidence, blockers, and measured stage timings. Publish only when the reader explicitly requests it through the existing publication flow.
