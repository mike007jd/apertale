# LivingBook Studio — WebMCP Challenge Handoff

Version: Challenge Final 1.1  
Prepared: 2026-08-26

## Submission one-liner

LivingBook Studio is a cinematic 3D picture-book editor where people and ChatGPT share one live creative document: either can lift, arrange, animate, theme, and safely undo story elements while the physical book responds on screen.

## Why it is meaningfully better with an agent

Without WebMCP, a person can still select, drag, style, animate, preview, and turn pages. With WebMCP, ChatGPT can inspect the exact open spread and revision, perform multi-step creative edits through stable structured element IDs, show those changes immediately in the same UI, and return exact undo tokens. The agent augments the visual editor instead of bypassing it or maintaining a separate backend copy.

## Recommended 90-second demo

1. Open on the Day city spread and select Bird.
2. Ask ChatGPT: “Lift the bird, move it above the tallest blue tower, and make it fly across the page.”
3. Show the visible action state while the same Bird moves and animates in the book.
4. Drag Bird by hand to a better position; ask ChatGPT to inspect the new context and make a non-overlapping edit.
5. Use the returned undo token and show that the newer human transform is preserved.
6. Switch to Night through `set_scene_theme`; turn to the lantern garden and select Fox.
7. Enter Preview and finish on a physical Three.js page turn.

## Judging narrative

- Usefulness: converts natural-language creative direction into precise visual edits while keeping human controls available.
- Originality: combines WebMCP shared-state collaboration with a deforming 3D storybook rather than a form or conventional productivity surface.
- Execution: production-shaped React/TypeScript architecture, real generated assets, WebGL fallback, accessibility, responsive behavior, conflict-safe undo, tests, and Sites packaging.
- Thoughtful WebMCP: six narrow tools; inspect-before-mutate context; closed schemas; stable IDs; revisions; idempotency; abort handling; visible agent actions; exact undo tokens.
- Human-agent experience: human and agent operate the same objects and see the same immediate result, with no hidden parallel state.

## Required external submission fields

- Live app: `PENDING_DEPLOYMENT_URL`
- Public or reviewer-accessible repository: `PENDING_REPOSITORY_URL`
- Demo video: `PENDING_DEMO_VIDEO_URL`
- Figma design file: `PENDING_FIGMA_FILE`

These fields remain pending because deployment, repository publication, video upload, and Figma team placement are external/shared-state actions.

## Final external gates

- [ ] Choose the Figma team and generate the final editable design file.
- [ ] Publish the verified `app/` build through the selected host.
- [ ] Verify the deployed URL in ChatGPT’s in-app browser with all six WebMCP tools discoverable.
- [ ] Run the 90-second demo script against the deployed URL and record the video.
- [ ] Create or select the submission repository and confirm reviewer access.
- [ ] Replace the four `PENDING_...` fields above.
- [ ] Submit through Devpost before the official deadline.

## Current verified local gates

- `npm run typecheck`: passed
- `npm test`: 9 tests passed
- `npm run build`: passed
- `npm run test:sites`: 4 tests passed
- Production preview smoke: passed; Three.js canvas initialized and console logs were empty
- Desktop Day/Night visual QA: passed
- Three.js page-turn midpoint and pointer drag: passed
- Mobile 390 × 844 responsive interaction: passed
- Browser accessibility names and primary Preview/Lift/Undo interactions: passed
- Forced WebGL/reduced-motion fallback route: passed
- Local page turns: 121 FPS forward / 120 FPS backward (45 FPS floor)
- Local diagnostics ring and DOM-readable diagnostic snapshot: passed
- New console errors/warnings after final reload: none
