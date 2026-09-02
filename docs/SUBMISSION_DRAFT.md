# Apertale — Devpost Submission Draft

> Prepared: 2026-08-27 NZST · Revised: 2026-09-02 NZST
> Only destinations that have passed `CHALLENGE_READINESS.md` are filled below.

## Project name

Apertale

## Tagline

Open a page. Enter a world.

## Short description

Apertale is a WebMCP-native canvas where a person and their Codex Agent create the same interactive 3D book together. Before any final art exists, the Agent sketches the whole rough book in pencil on the blank pages the person is looking at; the person answers with a red pencil on the same paper; the Agent reads those marks back as meaning, not coordinates, and redraws only what was marked. Then it creates the finished book, and both keep editing the same revisioned artifact with visible provenance and exact undo.

## Why this is a strong WebMCP use case

The Agent draws on a real web page. The person draws back. The Agent understands the drawing.

That loop is only possible with WebMCP. A plain MCP server has no page: it can return a storyboard as JSON, but nobody can pick up a pencil on it. Browser automation has a page but no semantics: it can move a cursor across pixels, but it cannot know that the red loop the reader just drew sits on the right page, encloses the thing labelled `boat`, and therefore means "change the boat". Apertale's `sketch_storyboard` tool gives the Agent a small planning vocabulary (labelled boxes, ellipses, arrows, text, a horizon line) in normalized spread coordinates, and the page reveals each mark stroke by stroke on the open 3D book. When the reader has handed over photos, a box can name the photo it will hold, and the page ghosts that photo inside the pencil box, so the plan reads as "this picture goes here" without the Agent ever moving image bytes. The reader's red marks come back through `get_project_context` already interpreted: which `page`, whether the stroke is a `loop` or a `stroke`, its `bounds`, and `near`, the labels it touches, nearest first. The Agent revises only the marked spreads, and the page clears exactly those marks and says so.

Creative direction begins as intent—"build a moonlit atlas from my travel photos," "open the volcano to explain its layers"—but the result has to become precise visual state. WebMCP lets the Agent read stable book, spread, element, asset, and revision IDs, apply bounded changes to the artifact the person is touching, and hand back an undo token for each change. The person keeps direct manipulation, conflicts are detected rather than overwritten, and every Agent action is narrated on the page as it happens.

## What people and Agents do together

- The person opens **Create Your Own** and copies a starter brief into Codex. The Agent calls `get_project_context`, and the page shows "Codex found this page".
- The Agent calls `sketch_storyboard` once for the whole plan. The blank 3D book draws the pencil marks in order while the person watches; the page reports "Codex sketched 4 spreads".
- The person picks up the red pencil, circles the boat, and strikes through the lighthouse. No typing.
- The Agent reads the marks back as "right page, loop around `boat`" and "left page, stroke across `lighthouse`", revises only that spread with the storyboard revision it read, and the page reports "Codex applied your marks on spread 2".
- The Agent generates final art in the user's own conversation as 2×2 sheets, hands every final into the page in one `request_image_handoff` call as inline WebP data URLs (the page splits each sheet into four tiles and trims cutouts to their subject), and creates the complete book atomically with `manage_book`.
- The person drags a finished element by hand; the Agent inspects the new position and adds motion without moving it.
- Exact undo removes the Agent's motion patch while the later human position remains.
- Day/Night, Preview, and page navigation change presentation without touching the document revision, and the page narrates them as the Agent's actions.

## WebMCP implementation

Apertale registers exactly eight semantic tools through `document.modelContext.registerTool()`: `get_project_context`, `manage_book`, `compose_spread`, `apply_scene_patch`, `set_presentation`, `undo_project_change`, `sketch_storyboard`, and `request_image_handoff`. They register as one fail-closed lifecycle group, handle registration and execution cancellation, and declare explicit read-only and untrusted-content hints.

All mutations use validated JSON schemas, stable IDs, and `requestId`. Document mutations add expected revision checks, atomic commits, compact results, and exact undo tokens. `sketch_storyboard` carries its own storyboard revision: clearing the reader's marks through `resolvedAnnotations` requires the `expectedStoryboardRevision` the Agent read, so a mark drawn after that read is never cleared unseen; a `storyboard_conflict` result tells the Agent to read again. `request_image_handoff` takes an explicit `assetUse`: `source-photo` adds reader references to the next creation brief, `book-art` imports generated covers, spreads, clean plates, and cutouts into the reusable asset registry, and the call returns as soon as the drop target is visible. `get_project_context` supplies compact, selected-reveal, local-asset, authoring-guide, creation-readiness, quality-review, and storyboard detail modes; compact context carries every storyboard mark as a labelled box plus the interpreted red marks, never freehand geometry. Local asset IDs are revalidated against IndexedDB before a patch commits. Agent-authored content is declarative data. Arbitrary JavaScript, HTML, GLSL, event expressions, and remote asset URLs are rejected. The host sends an origin-keyed agent-cluster policy and keeps `tools` limited to the same origin.

The browser owns the revisioned project and renders it through React, TypeScript, Three.js, Canvas, IndexedDB, and a 2D/reduced-motion fallback. Apertale contains no owner-funded OpenAI API key; the supporting ChatGPT desktop built-in browser supplies the user's Agent session.

Future: multimodal tool results. A `storyboard-image` detail that returns the rendered sketch to the Agent waits until the WebMCP specification settles binary tool outputs (spec issues #41, #86, #81); today tool results are text content, so the Agent sees its plan as labelled boxes.

## Demo video script — target 2:30

Record in the ChatGPT desktop built-in browser with Site tools enabled, Codex on the left and Apertale on the right. Every page-side receipt below is real UI, not an overlay.

### 0:00–0:10 — Montage

Three finished books in quick cuts: an Atlas spread turning, a photo-led keepsake, the anonymous read-only share page. Wordmark and tagline over the last frame.

Voice: "One sentence, or a handful of photos, can become a book that answers to your touch."

### 0:10–0:25 — The blank book

Click **Create your own**. The paper transition opens the full-screen workshop on a blank 3D book. Choose four spreads and a style, click **Copy starter prompt**, paste it into Codex, send. The workshop status turns to "Codex found this page" as `get_project_context` runs.

Page evidence: "Codex found this page"; the Site tools activity indicator shows `Get project context`.

Voice: "Codex and I are looking at the same page. Not a copy. The page."

### 0:25–0:50 — Codex draws the plan

Codex calls `sketch_storyboard`. On the right, pencil marks appear one after another on the real paper: a box labelled `boat`, an ellipse labelled `lighthouse`, an arrow for the wind, a working title. If the brief carried a reader photo, the box that will hold it shows the photo ghosted in grey pencil. Step through the four spreads with the storyboard arrows.

Page evidence: activity indicator `Sketch storyboards`; receipt "Codex sketched 4 spreads"; caption under each spread.

Voice: "This is not a screenshot. Codex is drawing on the paper I am holding. Boxes, arrows, a title. A plan I can see before any picture exists."

### 0:50–1:10 — The red pencil

Click **Mark changes**. Circle the boat on spread 2. Strike through the lighthouse. Stop marking.

Page evidence: red strokes on the page; the pencil control counts two marks.

Voice: "I do not type a correction. I draw one. A loop means change this. A line through means take it out."

### 1:10–1:30 — Codex reads the marks

In Codex, ask: "Read my marks and revise the storyboard." Codex calls `get_project_context`, then `sketch_storyboard` with `action: "update"` for spread 2 only.

Page evidence: activity indicator `Get project context`, then receipt "Codex read your 2 marks"; after the update, only spread 2 redraws, the red marks vanish, and the receipt reads "Codex applied your marks on spread 2". Show Codex's own words in the chat: "Right page, loop around boat. Left page, stroke across lighthouse."

Voice: "Codex did not receive forty coordinates. It received: right page, circled the boat. It redrew only that spread and cleared my marks."

### 1:30–1:55 — From pencil to book

Codex generates the cover, spread sheets, and cutout sheets in the conversation and calls `request_image_handoff` once with `assetUse: "book-art"` and every final inline as WebP; the page stores the tiles and answers with their ids. Codex calls `manage_book(action: "create")`. The pencil plan gives way to the finished book, and the reader opens on spread 1. Turn two pages, hover a cutout, click for the fact card.

Page evidence: image drawer; receipt "Codex created ‹title›"; "Codex turned to ‹spread›" as `set_presentation` walks the spreads.

Voice: "The plan was visible first. Then the book. Same pages."

### 1:55–2:15 — Two hands on one book

Drag the boat by hand. Ask Codex: "Keep my position and make the boat bob on the water." Codex calls `apply_scene_patch` with motion only. Then ask for `undo_project_change` on that patch: the bob stops, the boat stays where the hand left it.

Page evidence: "You moved boat"; "Codex patched 1 scene element" with **Undo**; "Codex undid a scene patch".

Voice: "We are editing the same book. Its change is undone exactly. My change stays."

### 2:15–2:30 — Night and share

Ask Codex for Night. The lamp comes up through `set_presentation` and the page reports "Codex switched to Night". Click **Publish and share**; the read-only link appears. Close on wordmark and tagline.

Voice: "A plain MCP server has no page. Browser automation has no meaning. WebMCP has both. Apertale. Open a page. Enter a world."

## Submission fields

- Live app URL: [https://livingbook-studio-challenge-11.mike007jd2.chatgpt.site/](https://livingbook-studio-challenge-11.mike007jd2.chatgpt.site/)
- Public repository URL: `PENDING_PUBLIC_REPOSITORY_URL`
- Public YouTube demo URL: `PENDING_PUBLIC_VIDEO_URL`
- Figma design URL: [Apertale — Product Design v1.1](https://www.figma.com/design/3Kq19oItsbBczMIeB739cO/Apertale-%E2%80%94-Product-Design-v1.1?node-id=7-6)

Do not replace a placeholder until the destination is public or supplied with judge credentials and has passed the corresponding readiness gate.

## Eligibility and reproducibility evidence

The repository was created during the official submission period. Preserve its timestamped commit history when publishing; [`ELIGIBILITY_AND_BUILD_LOG.md`](ELIGIBILITY_AND_BUILD_LOG.md) records the first commit and the challenge-period implementation milestones. Run the public URL through [`SITE_TOOLS_ACCEPTANCE.md`](SITE_TOOLS_ACCEPTANCE.md) before recording the final demo.
