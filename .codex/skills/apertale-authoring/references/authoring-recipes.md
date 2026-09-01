# Authoring recipes

Compose full-spread artwork for the stage's approximately 1.62:1 target. The 1.45–2.10 range is compatibility tolerance, not a composition target. Before create, deduplicate the reader-visible cover, resolved final base for each spread, rendered layers, and frames; at most 50 distinct assets may be uploaded. Author-only source and personal-photo provenance remains private and is excluded unless it is also selected for rendering. Call create once only when that manifest is one publishable finished book with no required artwork deferred.

## Text-led / idea book

1. Infer or ask for audience and intended length.
2. Write a one-sentence promise and a complete spread outline with beginning, development, turn, and ending.
3. Define a distinct visual beat for each spread before generating art.
4. Generate a dedicated 2:3 portrait cover with a legible exact title and no extra copy.
5. Generate one original purpose-built full-spread artwork for every spread. Required counts: generated cover 1, generated full-spreads equal to the agreed spread count.
6. Only after that art set exists, transfer every final, refresh the registry, and create once with the verified cover plus every spread's complete background and 2–4 layer manifest as one publishable finished book.
7. Plan foreground, midground, background, and interactive cutouts rather than placing one full-bleed image everywhere.
8. For each spread, decide which parts belong in the full-spread illustration, which become isolated interactive subjects, and whether a short 2–6 frame sequence adds meaning.
9. Add content-specific interactions and inspect both themes.

## Photo-led book

Hard rejection: placing an uploaded source photo on the right page, or using a raw import as the finished interior artwork, is not a completed book. Source photos are references and story truth unless the user explicitly asked for a literal photo-album treatment.

1. Inspect the supplied images in the current Codex conversation. Never infer unseen content.
2. Define audience or assumption and a complete story arc before choosing crops.
3. Plan title, dedicated generated portrait cover, every spread, and ordered provenance. Required generated-art counts: 1 cover + one original full-spread artwork per spread. Provenance entries: 1 cover + one per spread.
4. Use host ImageGen/image editing to make those assets. Crop, isolate, or extend source photos only as references into new compositions.
5. Keep the selected source-asset ids in the user's given order. Map each id as a reference, not as a lazy right-page placement.
6. Only after the complete art set exists, transfer generated finals through the supported host path with `assetUse: "book-art"`. When direct transfer is unavailable, call `request_image_handoff`, use Computer Use or a browser file chooser when available, and otherwise open the actual asset folder for one reader drag.
7. Refresh the asset list, then create once with exact asset ids bound to the cover and every complete spread manifest as one publishable finished book. Preserve the person's identity and source truth in provenance; do not create while any final is missing.
8. Use interaction to reveal captions, memories, dates, places, or facts—not to obscure the original photograph when a photo is cited as story truth.

## Preserved-photo album

1. Use `preserved-photo-album` and `photoPolicy.sourceUse: "preserve-original-layout"` only after the user explicitly chooses that treatment.
2. Confirm identity preservation, face changes disabled, and explicit crop and colour-correction permissions.
3. Keep the user's source-photo order. Prepare one source-true layout per spread at the approximately 1.62:1 stage target and one generated portrait cover; generated interior count is zero.
4. Set each final base with `separation: "preserved-photo-layout"`; keep the full layout/composite in `sourceAssetId`, the rendered base in `cleanPlateAssetId`, and the declared original photo provenance in `personalSourceAssetId` (these may intentionally refer to the same approved original for a preserved layout).
5. Add 2–4 restrained native-alpha foreground or interactive layers without reillustrating people or covering defining photo content.
6. Use captions, dates, places, and non-destructive overlays to create meaning. Verify identity, crop, geometry, and chronology in the actual rendered frame.

## Illustration-led book

1. Generate one coherent image near the 1.62:1 stage target for each spread; do not crop a contact sheet or stretch a portrait asset.
2. Keep the centre gutter visually continuous and reserve copy-safe space through composition rather than a pasted-on box.
3. Isolate only the subjects that benefit from hover, click, parallax, light, or motion. Preserve the full-spread background underneath so a layer never leaves a hole.
4. Use 2–6 generated frames for lightning, wing beats, water shimmer, blooming, or another small semantic change. Keep the first frame identical to the resting composition and respect reduced motion.
5. Pair factual interactions with a concise fact card and source. Narrative interactions should advance a beat or reveal a detail.

## Interaction direction

- Hover previews intent: parallax, paper lift, wind, ripple, orbit drift, or light response.
- Click/focus performs one clear action: reveal a fact, trigger a state change, advance a micro-scene, or compare illustrated layers.
- Match motion to the semantic material. Wind moves loose paper and clouds; water follows paths; planets drift along drawn orbits; buildings reveal illustrated sections or construction layers.
- Keep the same interactive target and reveal available to pointer and keyboard users. Respect reduced motion.

## Cover art direction

- portrait 2:3, straight-on, edge-to-edge cover art;
- exact book title, readable at library-card size;
- one strong visual premise, not an interior screenshot;
- tactile paper, gouache, cloth, or collage language consistent with Apertale;
- no mockup background, spine, watermark, duplicate title, or unrequested subtitle;
- assess cover independently from interior-spread art.
