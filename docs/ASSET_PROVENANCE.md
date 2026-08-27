# Asset provenance

## Runtime artwork

Files under `app/public/assets/generated/` were generated specifically for this Apertale prototype during its product-design sessions. They are original project outputs rather than downloaded stock art or copied third-party illustrations:

- `day-background.png` — legacy-safe fallback art used only when a book has neither a dedicated cover nor a first-spread texture;
- `night-background.png` — the cinematic Night desk environment referenced by the presentation CSS;
- `city-spread.png` and `river-home-spread.png` — cut-paper city story spreads;
- `moon-garden-spread.png` — night garden story spread;
- `city-cloud-road-spread-v2.png` and `city-warm-window-spread-v2.png` — independently generated continuation and finale spreads for the city story;
- `lantern-moon-path-spread-v2.png`, `lantern-firefly-bridge-spread-v2.png`, `lantern-sleeping-city-spread-v2.png`, and `lantern-dawn-garden-spread-v2.png` — independently generated scenes for the Lantern Garden sequence;
- `guide-motion-spread-v2.png` — independent animation-workbench artwork for the final guide spread;
- `wonders-*.png` — eight independently generated panoramic landmark spreads;
- `science-*.png` — six independently generated panoramic science spreads; `science-storm-clean-v2.png` is the ImageGen-edited storm base with the original baked lightning and reflection removed;
- `storm-lightning-rest.png` plus `storm-lightning-1.png` through `storm-lightning-3.png` — one transparent resting frame and three transparent sequential lightning frames, composited only during the short runtime burst.
- `wonders-pyramid-caravan-cutout-v3.png` — a single caravan subject generated in its own ImageGen request; it passed the alpha and edge-padding audit. Failed pyramid and no-padding candidates are quarantined under `app/qa/rejected-assets/` and are not runtime assets.

Every newly accepted foreground asset is generated as one semantic subject in one ImageGen request. Contact sheets, sprite sheets, multi-object grids, and crops taken from them are not accepted as final runtime assets.

The release keeps PNG as its delivery format because the target Codex in-app browser rejected otherwise valid WebP encodes during a real runtime probe. An earlier palette-optimised checkpoint reached roughly 21 MB, but later clean plates and independently generated foreground layers brought the current host-portable bundle to about 165 MiB. Asset-size reduction is therefore still open; runtime references stay local and no remote image host is involved.

The five active portrait covers were generated independently for this project with OpenAI ImageGen, then resized to 768 × 1152 PNG for the library:

- `apertale-field-guide-v2.png` — coral cloth, gold tooling, open-book compass, leaf, and bird;
- `atlas-of-living-wonders-v2.png` — mineral teal, world map, landmarks, and gold routes;
- `how-the-world-works-v2.png` — celadon cutaway world with volcano, water, weather, and orbit;
- `your-story-made-alive-v2.png` — ivory photo frames, paper city, and a hand arranging the story;
- `the-lantern-garden-v2.png` — midnight indigo moon garden with fox, lantern, and fireflies.

All five prompts required a straight-on 2:3 edge-to-edge premium book cover, exact legible title, small Apertale mark, tactile paper-collage/gouache/clothbound language, and no mockup background, spine, watermark, extra subtitle, or interior-spread reuse. They are checked-in curated assets, not evidence of live generation inside the viewer.

## Generation boundary

The viewer ships no runtime 3D models and calls no external model-generation service. Full-spread artwork, cutouts, covers, and short frame sequences are curated OpenAI ImageGen outputs. New generation happens in the user's active Codex/ChatGPT conversation; Apertale receives only chosen browser-local image assets through the explicit **Image handoff** path and never uses a site-owner OpenAI key.

## Design references

The Day and Night reference images under `docs/assets/` were supplied by the user as visual direction for this project. They remain documentation-only inputs; duplicate copies were removed from `app/public/` so they are not shipped in the runtime bundle.

## UI and fonts

- Interface icons come from `@phosphor-icons/react`, distributed under the MIT License.
- The font stack uses locally available system fonts; no font binary is redistributed.

## User imports

User-imported PNG, JPEG, and WebP files remain in that user's browser IndexedDB. Apertale does not upload or relicense them, and they are not part of the repository or production bundle.
