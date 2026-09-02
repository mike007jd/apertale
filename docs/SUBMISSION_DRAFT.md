# Apertale — Devpost Submission Draft

> Prepared: 2026-08-27 NZST
> Only destinations that have passed `CHALLENGE_READINESS.md` are filled below.

## Project name

Apertale

## Tagline

Open a page. Enter a world.

## Short description

Apertale is a WebMCP-native canvas where a person and ChatGPT create the same interactive 3D book together. The person can turn pages, inspect, drag, import, theme, and preview directly; their Agent can inspect the exact live project, compose spreads, lift and animate structured elements, and return exact undo tokens without maintaining a hidden copy of the book.

## Why this is a strong WebMCP use case

Creative direction begins as intent—“build a moonlit atlas from my travel photos,” “open the volcano to explain its layers,” or “make the bird react when I hover”—but the result must become precise visual state. A conventional chat can describe those edits but cannot safely operate the current canvas. WebMCP lets the Agent read stable book, spread, element, asset, and revision IDs, then apply bounded changes to the same artifact the person is touching.

The website opens as a polished editorial library of curated books that anyone can explore. Its Field Guide then routes authors through **Create Your Own** to the real Agent conversation, where WebMCP adds natural-language composition, multi-step scene edits, and context-aware iteration while preserving direct manipulation, visible provenance, conflicts, and undo.

## What people and Agents do together

- A person imports a photo or cutout; the Agent asks `get_project_context` for `assets`, discovers its stable browser-local ID, and can place it in any local book.
- The Agent creates or opens an independent book, composes its narrative, and applies a bounded atomic scene patch.
- The person drags or styles the result directly; the Agent reads the resulting state before its next edit.
- Both operators see changes immediately in the same Three.js book.
- Exact undo removes the requested Agent change while preserving later non-overlapping human edits.
- Day/Night and Preview alter presentation without corrupting the document revision.

## WebMCP implementation

Apertale exposes exactly eight semantic tools:

1. `get_project_context`
2. `manage_book`
3. `compose_spread`
4. `apply_scene_patch`
5. `set_presentation`
6. `undo_project_change`
7. `sketch_storyboard`
8. `request_image_handoff`

All mutations use validated JSON schemas, stable IDs, and `requestId`. Document mutations add expected revision checks, atomic commits, compact results, and exact undo tokens; `request_image_handoff` instead resolves after the reader provides browser-local assets or dismisses the request. `get_project_context` supplies compact, selected-reveal, and local-asset detail modes; local asset IDs are revalidated against IndexedDB before a patch commits. Agent-authored content is declarative data. Arbitrary JavaScript, HTML, GLSL, event expressions, and remote asset URLs are rejected. The eight tools register as one fail-closed lifecycle group, handle registration and execution cancellation, and declare explicit read-only and untrusted-content hints. The host sends an origin-keyed agent-cluster policy and keeps `tools` limited to the same origin.

The browser owns the revisioned project and renders it through React, TypeScript, Three.js, Canvas, IndexedDB, and a 2D/reduced-motion fallback. Apertale contains no owner-funded OpenAI API key; the supporting ChatGPT host supplies the user's Agent session.

## Demo video script — target 2:20

### 0:00–0:15 — The shelf

Open Apertale and show the Field Guide plus four independent Sample Books. Point out the short curated-demo disclosure and **Create Your Own**, then enter **Atlas of Living Wonders** and turn from the Colosseum to the Great Pyramid.

### 0:15–0:35 — Shared context

In ChatGPT, ask: “Inspect this Apertale project. Tell me which book and spread are open, then make a new book called Hidden Machines.” Show `get_project_context` followed by `manage_book`, and the new independent shelf item appearing immediately.

### 0:35–1:05 — Compose with the Agent

Ask: “Compose the first spread as a cutaway clockwork city, then add one lifted focal element with a bold hover and a fact reveal.” Show `compose_spread` and one atomic `apply_scene_patch`. Return to the page and hover/click the created element.

### 1:05–1:30 — Human correction

Drag the focal element by hand. Ask ChatGPT to inspect the new position and add motion without moving it. Show the canvas update and visible Agent action state.

### 1:30–1:50 — Conflict-safe undo

Use `undo_project_change` on the Agent motion patch. Show that the motion disappears while the later human position remains.

### 1:50–2:10 — Presentation and physicality

Ask ChatGPT to switch to Night and enter Preview through `set_presentation`. Finish with a continuous Three.js page turn and a click-driven fact reveal.

### 2:10–2:20 — Close

Show the wordmark and tagline: **Apertale — Open a page. Enter a world.**

## Submission fields

- Live app URL: [https://livingbook-studio-challenge-11.mike007jd2.chatgpt.site/](https://livingbook-studio-challenge-11.mike007jd2.chatgpt.site/)
- Public repository URL: `PENDING_PUBLIC_REPOSITORY_URL`
- Public YouTube demo URL: `PENDING_PUBLIC_VIDEO_URL`
- Figma design URL: [Apertale — Product Design v1.1](https://www.figma.com/design/3Kq19oItsbBczMIeB739cO/Apertale-%E2%80%94-Product-Design-v1.1?node-id=7-6)

Do not replace a placeholder until the destination is public or supplied with judge credentials and has passed the corresponding readiness gate.

## Eligibility and reproducibility evidence

The repository was created during the official submission period. Preserve its timestamped commit history when publishing; [`ELIGIBILITY_AND_BUILD_LOG.md`](ELIGIBILITY_AND_BUILD_LOG.md) records the first commit and the challenge-period implementation milestones. Run the public URL through [`SITE_TOOLS_ACCEPTANCE.md`](SITE_TOOLS_ACCEPTANCE.md) before recording the final demo.
