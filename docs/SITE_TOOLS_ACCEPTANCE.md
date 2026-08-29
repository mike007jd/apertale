# Apertale — deployed Site Tools acceptance

This is the authoritative post-deployment acceptance run. It separates the portable HTTP build contract from the host-only WebMCP loop that can be proven only inside an eligible ChatGPT desktop built-in browser.

## 1. Verify the deployed HTTP contract

Run from `app/` against the exact judge-facing URL:

```bash
npm run verify:deployment -- https://PUBLIC_APERTALE_URL/
```

The command must return `ok: true`, the exact six tool names, `Origin-Agent-Cluster: ?1`, `Permissions-Policy: tools=(self)`, and `hostLoop: required`. A 401, redirect to private sign-in, missing header, wrong product manifest, or missing tool identifier fails this gate.

This check proves the deployed artifact and document policy. It does not claim that ChatGPT injected `document.modelContext` or discovered the tools.

## 2. Verify Site Tools in ChatGPT

1. Use the current ChatGPT desktop app's built-in browser—not Chrome—and enable **Browser settings → Permissions → Enable site tools**.
2. Open the exact public URL from step 1. Do not use an embedded iframe; Site Tools from embedded content are not supported.
3. Confirm the address-bar Site Tools arrow appears.
4. Open the Story panel and confirm the status changes from **WebMCP ready** to **WebMCP connected**.
5. Open the address-bar tool list and record exactly these six names:
   - `get_project_context`
   - `manage_book`
   - `compose_spread`
   - `apply_scene_patch`
   - `set_presentation`
   - `undo_project_change`

Create flows must call `get_project_context` with `detail: "authoring-guide"`, then `detail: "creation-readiness"`. Blocking results are user questions, not permission to generate; create must reuse the same ready brief and reruns the same gate. After actual rendering, the Agent reads `detail: "quality-review"`, explicitly calls `manage_book(action: "begin-critique")`, inspects real frames, and records the critique. Those details and actions remain inside the existing six-tool catalog. Share stays closed until the current revision's report allows publication.

If the arrow is absent, first verify that the selected account and model have Site Tools access; then refresh the page after enabling the permission. Do not reinterpret ordinary browser automation as a passing WebMCP run.

## 3. Execute the shared-state acceptance story

Use one conversation and one open Apertale tab.

### Read and open

Prompt:

> Inspect the current Apertale project. Tell me the active book, spread, revision, and reusable local assets. Then open Atlas of Living Wonders without changing its contents.

Required evidence:

- `get_project_context` is called before mutation, including `detail: "authoring-guide"` before create and `detail: "assets"` when binding imported art.
- `manage_book` opens the Atlas shelf item.
- The same visible page changes immediately and reports an Agent-authored action.

### Readiness must ask, then pass

First prompt:

> I want a keepsake from some family photos. Start creating it now.

Required evidence:

- `creation-readiness` returns `ready: false`, blocking fields, and direct questions covering the missing premise/audience, photo treatment, source assets, and identity policy as applicable.
- `manage_book(action: "create")` with the incomplete brief returns `creation_not_ready` and does not change the library or revision.
- The Agent asks the returned questions naturally instead of inventing decisive defaults.

Then answer with a complete brief. For the illustrated path, explicitly choose generated scenes that preserve identity; for the preserved-photo path, explicitly choose source-true layouts, face changes disabled, and the permitted crop/colour policy. Required evidence:

- readiness becomes true only after every actual source asset exists in the browser registry;
- changing the label to `illustrated-storybook` cannot bypass missing assets, `sourceUse`, or identity checks;
- the returned asset needs distinguish generated interiors from preserved original-photo layouts.
- every finished spread retains an original composite in `sourceAssetId`, while declared user-photo provenance uses the separate `personalSourceAssetId` identity gate.

For a personal draft created before lifecycle metadata existed, run the same readiness check and call `manage_book(action: "adopt-creation-brief")` at the current revision. The action must pass once, reject a second adoption, reject curated samples, and allow the normal render → critique → publish-ready path without guessing photo policy.

### Compose and patch

Prompt:

> Using the same brief that just passed readiness, create a temporary illustrated book called Site Tools Acceptance with one spread called The Observatory. Compose a concise explanation of how a telescope gathers light. Use a dedicated portrait cover, an original 2:1 composite reference, its purpose-built clean plate, and two browser-local native-alpha layers imported through Image handoff. Give one layer a gentle float, warm hover rim, spotlight focus, and a fact card. Use the current revision for every mutation.

Required evidence:

- `get_project_context(detail: "authoring-guide")` is read and obeyed before `manage_book` create.
- `manage_book` returns a new book and undo token.
- `compose_spread` updates the visible spread using its stable ID.
- `apply_scene_patch` commits one bounded atomic patch using the validated browser-local image asset id; no URL, model reference, script, HTML, GLSL, or executable expression is accepted.
- Hover and click produce visible renderer behavior and a structured fact card.

### Render, critique, patch, and publish gate

Prompt:

> Render the shelf cover and every spread. Read Apertale's quality review, inspect the actual frames, record evidence for every visual criterion, fix blockers, and re-check. Stop after two rounds if you need material or a decision. Do not publish; tell me whether this revision is publish-ready.

Required evidence:

- Shelf cover and every current spread emit render evidence, and the returned manifest identifies their URL/locators.
- Deterministic results cover structural facts; the Agent uses visible frames or screenshots for cover appeal, 2:1 composition, readability, consistency, photo fidelity, crop/skew/occlusion/scale, alpha edges, coherence, and promotional value.
- `begin-critique` visibly enters checking state. `record-critique` returns blocker/warn/note results with evidence and suggested patches.
- A blocker disables Share/Publish. After a patch changes the revision, one final review round is available; no third round is accepted.
- A sample-ready report with no blocker enables Share/Publish. Recorded warnings may remain. This acceptance stops at publish-ready and does not deploy or create public content.

### Human correction and exact undo

1. Drag the created element by hand to a visibly different position.
2. Ask ChatGPT:

> Inspect the new position. Change only the element's motion to soft pulse, then undo that motion patch while preserving my manual position.

Required evidence:

- The Agent re-reads current context after the human change.
- The scene patch changes only motion.
- `undo_project_change` removes that motion change.
- The later human transform remains unchanged.

### Presentation

Prompt:

> Switch Apertale to Night and enter Preview without editing book content.

Required evidence:

- `set_presentation` changes both shared presentation fields atomically.
- Document revision does not change.
- Night lighting, Preview controls, page turn, and click reveal remain functional.

### Cleanup

Run this story in a disposable browser profile or dedicated acceptance Site state. The original book-creation undo token is intentionally valid only before later edits; after compose and scene mutations, it must conflict rather than delete newer work. Retain the temporary book as evidence through recording, then clear the disposable Site data after acceptance if desired.

## 4. Capture evidence

Record all of the following before declaring the host gate passed:

- Public URL and UTC timestamp.
- ChatGPT desktop app version, account/workspace class, and selected model.
- Screenshot of the address-bar list with exactly six tools.
- Screen recording containing the prompts, visible tool activity, resulting book changes, human drag, exact undo, and presentation switch.
- Screenshots of the incomplete readiness questions, checking/blocked state, every visually inspected cover/spread, and final publish-ready or needs-material state.
- Structured readiness response, quality render manifest, both critique round results when a repair was needed, and final quality report.
- JSON from `window.apertaleDiagnostics()` showing `webmcp:registered` with `registered: 6` plus tool start/success events.
- Console warning/error count after a fresh reload.

The gate fails if any required mutation is performed only through clicks, if the page and Agent operate different state, if the tool list is incomplete, or if the judge-facing URL is not anonymously reachable.

## Current official host boundary

OpenAI's current Site Tools documentation states that tools are discovered from the page open in the ChatGPT desktop built-in browser, operate on that live page and signed-in session, and are not available in Chrome. Availability still depends on account and selected-model support. See [Using site tools in the ChatGPT desktop app](https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app).
