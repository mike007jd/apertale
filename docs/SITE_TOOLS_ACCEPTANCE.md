# Apertale — deployed Site Tools acceptance

This is the authoritative post-deployment acceptance run. It separates the portable HTTP build contract from the host-only WebMCP loop that can be proven only inside an eligible ChatGPT desktop built-in browser.

## 1. Verify the deployed HTTP contract

Run from `app/` against the exact judge-facing URL:

```bash
npm run verify:deployment -- https://PUBLIC_APERTALE_URL/
```

The command must return `ok: true`, the exact seven tool names, `Origin-Agent-Cluster: ?1`, `Permissions-Policy: tools=(self)`, and `hostLoop: required`. A 401, redirect to private sign-in, missing header, wrong product manifest, or missing tool identifier fails this gate.

This check proves the deployed artifact and document policy. It does not claim that ChatGPT injected `document.modelContext` or discovered the tools.

## 2. Verify Site Tools in ChatGPT

1. Use the current ChatGPT desktop app's built-in browser—not Chrome—and enable **Browser settings → Permissions → Enable site tools**.
2. Open the exact public URL from step 1. Do not use an embedded iframe; Site Tools from embedded content are not supported.
3. Confirm the address-bar Site Tools arrow appears.
4. Open the Story panel and confirm the status changes from **WebMCP ready** to **WebMCP connected**.
5. Open the address-bar tool list and record exactly these seven names:
   - `get_project_context`
   - `manage_book`
   - `compose_spread`
   - `apply_scene_patch`
   - `set_presentation`
   - `undo_project_change`
   - `request_image_handoff`

Create flows must call `get_project_context` with `detail: "authoring-guide"`, then `detail: "creation-readiness"`. Blocking results are user questions, not permission to generate; create must reuse the same ready brief and rerun the same gate. Before create, every finished cover, spread background, clean plate, layer, and frame must exist as a verified browser-local asset. Full-spread composition targets the approximately 1.62:1 stage; 1.45–2.10 is only the compatible admission range. After deduplication, the reader-visible cover, resolved final base for each spread, rendered layers, and frames together must total at most 50 uploaded assets. Author-only source and personal-photo provenance remains private and is excluded unless selected for rendering. `manage_book(action: "create")` accepts one complete, publishable finished-book manifest and commits it atomically; a text-only shell, missing artwork, deferred required art, or incomplete interaction contract returns a structured failure without adding it to the shelf, changing the document, or opening the reader. When direct host media transfer is unavailable, `request_image_handoff` opens a reader-mediated import drawer and returns browser-local asset ids without changing the document revision. `assetUse: "source-photo"` adds reader references to the next brief; `assetUse: "book-art"` imports generated covers, spreads, clean plates, or cutouts without changing the brief. `compose_spread` and `apply_scene_patch` are reserved for bounded changes discovered after the complete book exists. After actual rendering, the Agent reads `detail: "quality-review"`, explicitly calls `manage_book(action: "begin-critique")`, inspects real frames, and records the critique. Share stays closed until the current revision's report allows publication.

`ok: true` with `presentation.status: "pending"` means the mutation is already durable but the requested visible frame was not confirmed. Retry the exact same `requestId`; never create a duplicate with a new id.

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
- the tool schema rejects a create request that contains only title, text, and a ready brief before execution; the adapter repeats that fail-closed check, so it cannot add a shelf item, change the revision, or present the reader.
- a structurally valid manifest that still violates a complete-artifact invariant returns `creation_artifact_incomplete` with exact issues and likewise leaves the visible project untouched.

For a personal draft created before lifecycle metadata existed, run the same readiness check and call `manage_book(action: "adopt-creation-brief")` at the current revision. The action must pass once, reject a second adoption, reject curated samples, and allow the normal render → critique → publish-ready path without guessing photo policy.

### Request an image handoff

Prompt:

> I need two browser-local images for this book: a portrait cover and one full-spread illustration. Ask me to provide them and wait for the result.

Required evidence:

- `request_image_handoff` receives a unique `requestId`, `assetUse: "book-art"`, and a plain-language reason that names the two needed images.
- The focused artwork drawer opens with that reason, and the tool call remains pending until the reader chooses files or dismisses it.
- A provided result returns one or more real `asset:` ids; the Agent refreshes `get_project_context(detail: "assets")` before referencing them.
- A mixed batch returns `status: "partial"` with exact accepted, rejected, and storage-failed counts. Only accepted ids are returned, and the artwork drawer remains open for replacements instead of presenting the handoff as complete.
- The handoff does not change the document revision. A dismissed request returns a structured dismissal rather than a false success.

### Create the complete book atomically

Prompt:

> Using the same brief that just passed readiness, create a complete temporary illustrated book called Site Tools Acceptance with one spread called The Observatory. Explain concisely how a telescope gathers light. In the single create request, include the verified browser-local portrait cover, an original composite composed for the approximately 1.62:1 stage, its purpose-built clean plate, and two native-alpha layers imported through Image handoff. Give one layer a gentle float, warm hover rim, spotlight focus, and a fact card. Do not create a text-only shell or defer required artwork to later patches.

Required evidence:

- `get_project_context(detail: "authoring-guide")` is read and obeyed before `manage_book` create.
- `manage_book` validates every referenced asset and returns a new book and undo token only after the cover, background, source reference, two layers, and explicit interaction all pass together.
- the original composite and clean plate each fall within the 1.45–2.10 admission range and are visibly composed for the approximately 1.62:1 stage rather than merely stretched to pass validation.
- all unique reader-visible cover, resolved final-base, rendered layer, and frame ids total at most 50 uploaded assets; a 51st distinct rendered id rejects the create atomically, while author-only provenance remains private and uncharged.
- the newly created shelf cover is visibly illustrated, and opening the book immediately shows the finished spread without requiring `compose_spread` or `apply_scene_patch`.
- any invalid asset, missing required layer, or missing explicit interaction rejects the whole request; neither the library nor the active document changes.
- Hover and click produce visible renderer behavior and a structured fact card.

If frame inspection finds a bounded defect after creation, use `compose_spread` for text/layout changes or one atomic `apply_scene_patch` for artwork behavior. Each repair must use the current stable spread and element ids plus the current revision; no URL, model reference, script, HTML, GLSL, or executable expression is accepted.

### Render, critique, patch, and publish gate

Prompt:

> Render the shelf cover and every spread. Read Apertale's quality review, inspect the actual frames, record evidence for every visual criterion, fix blockers, and re-check. Stop after two rounds if you need material or a decision. Do not publish; tell me whether this revision is publish-ready.

Required evidence:

- A non-pending `set_presentation(surface: "shelf")` result confirms the current cover is visible; each non-pending reader-spread result confirms that spread is visible. `presentation.status: "pending"` must be resumed with the same `requestId` and cannot count as visual evidence. Shelf cover and every current spread emit separate render evidence, and the returned manifest identifies their URL/locators.
- Deterministic results cover structural facts; the Agent uses visible frames or screenshots for cover appeal, composition on the approximately 1.62:1 stage, readability, consistency, photo fidelity, crop/skew/occlusion/scale, alpha edges, coherence, and promotional value.
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

> Switch Apertale to Night, enter Preview, and show the current reader spread without editing book content.

Required evidence:

- `set_presentation(surface: "reader")` changes the shared presentation fields and acknowledges the unobstructed reader surface.
- Document revision does not change.
- Night lighting, Preview controls, page turn, and click reveal remain functional.

### Cleanup

Run this story in a disposable browser profile or dedicated acceptance Site state. The original book-creation undo token is intentionally valid only before later edits; after any critique repair or scene mutation, it must conflict rather than delete newer work. Retain the temporary book as evidence through recording, then clear the disposable Site data after acceptance if desired.

### Recording release pass

For an explicitly disposable, non-sensitive book, continue beyond publish-ready before recording:

1. Open **Publish**, choose **Publish and share**, and confirm the panel displays one complete same-origin `/share/:token` URL.
2. Keep the full URL visible; copying or opening it is optional for the filmed flow.
3. Off camera, request the share page, `/api/shared/:token`, and at least one referenced uploaded asset without creator credentials. All must succeed, while the returned manifest remains read-only and matches the published revision.
4. Reload the creator page and confirm the publication panel restores the same URL. Do not revoke or delete this evidence book until recording is complete.

## 4. Capture evidence

Record all of the following before declaring the host gate passed:

- Public URL and UTC timestamp.
- ChatGPT desktop app version, account/workspace class, and selected model.
- Screenshot of the address-bar list with exactly seven tools.
- Screen recording containing the prompts, visible tool activity, resulting book changes, human drag, exact undo, and presentation switch.
- Screenshots of the incomplete readiness questions, checking/blocked state, every visually inspected cover/spread, and final publish-ready or needs-material state.
- Structured readiness response, quality render manifest, both critique round results when a repair was needed, and final quality report.
- JSON from `window.apertaleDiagnostics()` showing `webmcp:registered` with `registered: 7` plus tool start/success events.
- Console warning/error count after a fresh reload.

The gate fails if any required mutation is performed only through clicks, if the page and Agent operate different state, if the tool list is incomplete, or if the judge-facing URL is not anonymously reachable.

## Current official host boundary

OpenAI's current Site Tools documentation states that tools are discovered from the page open in the ChatGPT desktop built-in browser, operate on that live page and signed-in session, and are not available in Chrome. Availability still depends on account and selected-model support. See [Using site tools in the ChatGPT desktop app](https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app).
