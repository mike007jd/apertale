import type { BookElement, DocumentState, FocusResponse, HoverResponse, MotionPreset, SessionState, Spread } from "./types";

type IllustrationSpreadDraft = Omit<Spread, "textureUrl" | "elements"> & { image: string };
type LayeredSpreadDraft = Pick<Spread, "id" | "order" | "title" | "body" | "kicker">;

type HotspotDraft = {
  id: string;
  label: string;
  page: "left" | "right";
  x: number;
  y: number;
  color: "amber" | "aqua" | "jade" | "rose";
  hint: string;
  title: string;
  summary: string;
  facts?: Array<{ label: string; value: string }>;
  motion?: MotionPreset;
  durationMs?: number;
};

function knowledgeHotspot(draft: HotspotDraft): BookElement {
  return {
    id: draft.id,
    label: draft.label,
    kind: "decoration",
    assetId: `procedural:hotspot:${draft.color}`,
    page: draft.page,
    transform: { x: draft.x, y: draft.y, scaleX: 1, scaleY: 1, rotationDeg: 0 },
    depth: 0.12,
    locked: true,
    motion: { preset: draft.motion ?? "soft-pulse", durationMs: draft.durationMs ?? 4200, loop: true },
    interaction: {
      hover: "warm-rim",
      focus: "spotlight",
      hint: draft.hint,
      reveal: {
        kind: draft.facts?.length ? "fact-card" : "caption",
        title: draft.title,
        summary: draft.summary,
        facts: draft.facts ?? [],
      },
    },
    provenance: "sample",
  };
}

type VisualLayerDraft = {
  id: string;
  label: string;
  asset: string;
  kind?: "embedded" | "lifted";
  page: "left" | "right";
  x: number;
  y: number;
  scaleX: number;
  scaleY?: number;
  rotationDeg?: number;
  depth?: number;
  motion?: MotionPreset;
  durationMs?: number;
  hover?: HoverResponse;
  focus?: FocusResponse;
  hint: string;
  title: string;
  summary: string;
  facts?: Array<{ label: string; value: string }>;
};

function visualLayer(draft: VisualLayerDraft): BookElement {
  return {
    id: draft.id,
    label: draft.label,
    kind: draft.kind ?? "lifted",
    assetId: `/assets/generated/${draft.asset}`,
    page: draft.page,
    transform: {
      x: draft.x,
      y: draft.y,
      scaleX: draft.scaleX,
      scaleY: draft.scaleY ?? draft.scaleX,
      rotationDeg: draft.rotationDeg ?? 0,
    },
    depth: draft.depth ?? 0.1,
    locked: false,
    motion: draft.motion ? { preset: draft.motion, durationMs: draft.durationMs ?? 5200, loop: true } : undefined,
    interaction: {
      hover: draft.hover ?? "lift-glow",
      focus: draft.focus ?? "spotlight",
      hint: draft.hint,
      reveal: {
        kind: draft.facts?.length ? "fact-card" : "caption",
        title: draft.title,
        summary: draft.summary,
        facts: draft.facts ?? [],
      },
    },
    provenance: "sample",
  };
}

function layeredIllustrationSpread(draft: IllustrationSpreadDraft, cleanImage: string, elements: BookElement[]): Spread {
  const sourceAssetId = `/assets/generated/${draft.image}`;
  const cleanPlateAssetId = `/assets/generated/${cleanImage}`;
  return {
    ...draft,
    textureUrl: cleanPlateAssetId,
    artwork: { sourceAssetId, cleanPlateAssetId, separation: "inpainted-clean-plate" },
    elements,
  };
}

/**
 * Some architectural source composites already contain the only convincing
 * terrain contact, perspective, and occlusion for their monuments. Re-layering
 * those extracted subjects produced detached sticker edges and visibly
 * floating landmarks. Render the accepted source composite intact and turn
 * the authored element catalogue into restrained semantic hotspots instead.
 */
function groundedCompositeSpread(draft: IllustrationSpreadDraft, _cleanImage: string, elements: BookElement[]): Spread {
  const sourceAssetId = `/assets/generated/${draft.image}`;
  const tones = ["amber", "jade", "rose", "aqua"] as const;
  return {
    ...draft,
    textureUrl: sourceAssetId,
    // The renderer gives this field precedence over textureUrl. For these
    // shipped samples, the accepted grounded composite is deliberately the
    // final render base; the detached extraction is not allowed back on stage.
    artwork: { sourceAssetId, cleanPlateAssetId: sourceAssetId, separation: "inpainted-clean-plate" },
    elements: elements.map((element, index) => ({
      ...element,
      kind: "decoration",
      assetId: `procedural:hotspot:${tones[index % tones.length]}`,
      transform: {
        ...element.transform,
        scaleX: 0.72,
        scaleY: 0.72,
      },
      depth: 0.12,
      locked: true,
      motion: undefined,
      interaction: element.interaction ? {
        ...element.interaction,
        hover: "warm-rim",
        focus: "spotlight",
      } : undefined,
    })),
  };
}

const colosseumSpread: Spread = groundedCompositeSpread({ id: "flavian-amphitheatre", order: 0, image: "wonders-colosseum.png", kicker: "Wonders in paper · Rome, Italy", title: "The Colosseum held a city of voices.", body: "Eighty entrances fed a vast bowl of stone, while corridors below the arena moved people, scenery, and animals out of sight." }, "wonders-colosseum-clean-v2.png", [{
    id: "colosseum-procession",
    label: "Procession on the Via Labicana",
    kind: "lifted",
    assetId: "/assets/generated/wonders-colosseum-procession-cutout-v2.png",
    page: "left",
    transform: { x: 0.52, y: 0.73, scaleX: 1.72, scaleY: 1.28, rotationDeg: -1 },
    depth: 0.08,
    locked: false,
    interaction: {
      hover: "tilt-toward-pointer",
      focus: "spotlight",
      hint: "Follow the city arriving at the arena",
      reveal: {
        kind: "fact-card",
        title: "An arena fed by a city",
        summary: "Roads, entrances, and numbered arches moved large crowds around the amphitheatre without one single front door.",
        facts: [{ label: "Flow", value: "A ring of entrances distributed spectators around the building" }],
      },
    },
    provenance: "sample",
  }, {
    id: "colosseum-cypress",
    label: "Sunlit cypress",
    kind: "lifted",
    assetId: "/assets/generated/wonders-colosseum-cypress-cutout-v2.png",
    page: "right",
    transform: { x: 0.9, y: 0.52, scaleX: 1.3, scaleY: 1.42, rotationDeg: 1 },
    depth: 0.12,
    locked: false,
    interaction: {
      hover: "warm-rim",
      focus: "spotlight",
      hint: "Catch the last light on the cypress",
      reveal: {
        kind: "caption",
        title: "A living vertical",
        summary: "The cypress breaks the amphitheatre's horizontal rings and turns the sunset into a small foreground moment.",
        facts: [],
      },
    },
    provenance: "sample",
  }, knowledgeHotspot({ id: "colosseum-arena", label: "Arena floor", page: "right", x: 0.55, y: 0.56, color: "amber", hint: "Inspect what moved below the arena", title: "A stage above a machine", summary: "The wooden arena floor concealed lifts, ramps, corridors, and holding rooms in the hypogeum below.", facts: [{ label: "Hidden level", value: "The hypogeum supported scenery and animal lifts" }], motion: "slow-orbit" })]);
const pyramidSpread = groundedCompositeSpread({ id: "great-pyramid-of-giza", order: 1, image: "wonders-pyramid.png", kicker: "Wonders in paper · Giza, Egypt", title: "A horizon built from stone.", body: "More than two million blocks rise toward a missing capstone, keeping Khufu's monument visible across forty-five centuries." }, "wonders-pyramid-clean-v2.png", [
  visualLayer({ id: "pyramid-main", label: "Khufu's pyramid", asset: "wonders-pyramid-main-cutout-v2.png", page: "right", x: 0.12, y: 0.5, scaleX: 1.72, scaleY: 1.48, hint: "Lift the pyramid from the desert", title: "A mountain made by hands", summary: "The monument's immense triangular silhouette turns more than two million blocks into one legible form.", facts: [{ label: "Original height", value: "About 146.6 metres" }] }),
  visualLayer({ id: "pyramid-caravan", label: "Desert caravan", asset: "wonders-pyramid-caravan-cutout-v3.png", page: "left", x: 0.64, y: 0.7, scaleX: 1.08, scaleY: 0.72, rotationDeg: -2, hover: "warm-rim", focus: "spotlight", hint: "Inspect the caravan on the plateau", title: "Scale across the plateau", summary: "The caravan makes the plateau's distance and the monument's size feel immediate while staying anchored to its route." }),
  visualLayer({ id: "pyramid-sun", label: "Setting sun", asset: "wonders-pyramid-sun-cutout-v2.png", page: "left", x: 0.36, y: 0.36, scaleX: 0.4, motion: "soft-pulse", hover: "warm-rim", focus: "spotlight", hint: "Warm the edge of the desert", title: "Stone changes with the light", summary: "Low sunlight reveals the rhythm of casing blocks and desert ridges." }),
  knowledgeHotspot({ id: "pyramid-capstone", label: "Missing capstone", page: "right", x: 0.22, y: 0.25, color: "amber", hint: "Trace the pyramid to its missing peak", title: "A vanished summit", summary: "The outer casing and capstone are gone, leaving the stepped core masonry visible today.", facts: [{ label: "Original height", value: "About 146.6 metres" }], motion: "soft-pulse" }),
]);

const greatWallSpread = groundedCompositeSpread({ id: "great-wall-of-china", order: 2, image: "wonders-great-wall.png", kicker: "Living wonders · Northern China", title: "A wall follows the mountains.", body: "Watchtowers punctuate ridgelines while tamped earth, brick, and stone adapt to each slope, pass, desert, and grassland." }, "wonders-great-wall-clean-v2.png", [
  visualLayer({ id: "great-wall-ribbon", label: "Winding wall", asset: "wonders-great-wall-ribbon-cutout-v2.png", page: "right", x: 0.46, y: 0.53, scaleX: 1.48, scaleY: 1.55, hint: "Trace the wall over the ridge", title: "Built to follow terrain", summary: "The wall bends with ridgelines instead of forcing one straight geometry across the mountains." }),
  visualLayer({ id: "great-wall-tower", label: "Nearest watchtower", asset: "wonders-great-wall-tower-cutout-v2.png", page: "right", x: 0.8, y: 0.62, scaleX: 1.02, scaleY: 1.08, focus: "spotlight", hint: "Inspect the nearest watchtower", title: "A node in a long network", summary: "Towers provided shelter, observation and places to relay smoke or fire signals." }),
  visualLayer({ id: "great-wall-sun", label: "Mountain sun", asset: "wonders-great-wall-sun-cutout-v2.png", page: "left", x: 0.43, y: 0.25, scaleX: 0.34, motion: "soft-pulse", hover: "warm-rim", focus: "spotlight", hint: "Wake the mountain light", title: "A long view", summary: "Warm light separates near forest from the many blue paper ridges beyond." }),
  knowledgeHotspot({ id: "great-wall-watchtower", label: "Signal route", page: "right", x: 0.61, y: 0.4, color: "amber", hint: "Follow the signal between towers", title: "A line of sight", summary: "Watchtowers gave defenders shelter, observation, and places to relay smoke or fire signals.", facts: [{ label: "Network", value: "Walls, passes, forts, and towers formed one system" }], motion: "soft-pulse" }),
]);

const petraSpread = groundedCompositeSpread({ id: "petra-treasury", order: 3, image: "wonders-petra.png", kicker: "Living wonders · Petra, Jordan", title: "A façade waits inside the rock.", body: "Beyond the narrow Siq, the Nabataeans carved columns and pediments directly from rose sandstone." }, "wonders-petra-clean-v2.png", [
  visualLayer({ id: "petra-treasury-facade", label: "The Treasury", asset: "wonders-petra-treasury-cutout-v2.png", page: "right", x: 0.57, y: 0.52, scaleX: 1.35, scaleY: 1.5, focus: "spotlight", hint: "Inspect the carved façade", title: "Carved, not assembled", summary: "The façade was cut downward from one sandstone face rather than built from separate blocks.", facts: [{ label: "Material", value: "Rose-red sandstone" }] }),
  visualLayer({ id: "petra-sunbeam", label: "Siq sunbeam", asset: "wonders-petra-light-cutout-v2.png", page: "right", x: 0.24, y: 0.34, scaleX: 0.64, scaleY: 1.35, motion: "soft-pulse", hover: "warm-rim", focus: "spotlight", hint: "Catch the light entering the canyon", title: "Light reveals the entrance", summary: "The narrow Siq turns one shaft of sunlight into a dramatic threshold." }),
  visualLayer({ id: "petra-path-stones", label: "Stones on the path", asset: "wonders-petra-stones-cutout-v2.png", page: "right", x: 0.6, y: 0.78, scaleX: 0.95, scaleY: 0.48, hint: "Disturb the stones before the Treasury", title: "A path through sandstone", summary: "Small foreground stones make the enormous carved opening feel reachable." }),
  knowledgeHotspot({ id: "petra-urn", label: "Stone urn", page: "right", x: 0.55, y: 0.3, color: "rose", hint: "Inspect the highest carved detail", title: "Carved from the cliff", summary: "The façade was cut downward from a single rock face rather than assembled from blocks.", facts: [{ label: "Material", value: "Rose-red sandstone" }], motion: "soft-pulse" }),
]);

const chichenSpread = groundedCompositeSpread({ id: "chichen-itza", order: 4, image: "wonders-chichen-itza.png", kicker: "Living wonders · Yucatán, Mexico", title: "A calendar climbs in stone.", body: "Four stairways rise toward the temple of Kukulcán, where architecture, astronomy, ritual, and trade meet." }, "wonders-chichen-itza-clean-v2.png", [
  visualLayer({ id: "chichen-pyramid", label: "El Castillo", asset: "wonders-chichen-itza-pyramid-cutout-v2.png", page: "right", x: 0.45, y: 0.58, scaleX: 1.52, scaleY: 1.34, focus: "spotlight", hint: "Inspect the stairways from the clearing", title: "A calendar in architecture", summary: "Four stairways organise the pyramid around the cardinal directions." }),
  visualLayer({ id: "chichen-leaves", label: "Yucatán leaves", asset: "wonders-chichen-itza-leaves-cutout-v2.png", page: "right", x: 0.83, y: 0.75, scaleX: 0.9, scaleY: 0.72, hint: "Brush the jungle edge aside", title: "A monument in a living forest", summary: "The foreground canopy keeps the stone pyramid connected to the Yucatán landscape." }),
  visualLayer({ id: "chichen-sun", label: "Golden disc", asset: "wonders-chichen-itza-sun-cutout-v2.png", page: "right", x: 0.78, y: 0.2, scaleX: 0.34, motion: "soft-pulse", hover: "warm-rim", focus: "spotlight", hint: "Shift the light over the stair", title: "Seasonal light", summary: "Changing sunlight alters how the stepped geometry reads across the year." }),
  knowledgeHotspot({ id: "chichen-stair", label: "Calendar stair", page: "right", x: 0.52, y: 0.58, color: "amber", hint: "Count the rhythm of the steps", title: "Time made architectural", summary: "The stepped form is often read as a calendar-like composition tied to seasonal observation.", facts: [{ label: "Four sides", value: "Stairways organise the pyramid around the cardinal directions" }], motion: "slow-orbit" }),
]);

const machuSpread = groundedCompositeSpread({ id: "machu-picchu", order: 5, image: "wonders-machu-picchu.png", kicker: "Living wonders · Andes, Peru", title: "A city balances above the clouds.", body: "Terraces hold steep ground while fitted stone rooms, drains, channels, and ritual spaces step between peaks." }, "wonders-machu-picchu-clean-v2.png", [
  visualLayer({ id: "machu-citadel", label: "Citadel and peak", asset: "wonders-machu-picchu-citadel-cutout-v2.png", page: "right", x: 0.45, y: 0.58, scaleX: 1.55, scaleY: 1.42, focus: "spotlight", hint: "Inspect the citadel above the valley", title: "Architecture balanced on a ridge", summary: "Terraces, rooms and mountain silhouette lock into one carefully drained composition." }),
  visualLayer({ id: "machu-leaves", label: "Andean foreground", asset: "wonders-machu-picchu-leaves-cutout-v2.png", page: "right", x: 0.84, y: 0.74, scaleX: 0.82, scaleY: 0.9, hint: "Part the foreground leaves", title: "A living edge", summary: "The plant layer frames the archaeological site as part of an active mountain ecosystem." }),
  visualLayer({ id: "machu-cloud-bank", label: "Cloud bank", asset: "wonders-machu-picchu-cloud-cutout-v2.png", page: "left", x: 0.42, y: 0.63, scaleX: 1.32, scaleY: 0.92, motion: "fly-across", durationMs: 11000, hint: "Send the clouds through the valley", title: "A city above weather", summary: "Moving cloud reveals and conceals the steep drop beyond the terraces." }),
  knowledgeHotspot({ id: "machu-terrace", label: "Mountain terrace", page: "right", x: 0.48, y: 0.64, color: "jade", hint: "Follow water through the terraces", title: "A mountain made habitable", summary: "Terraces stabilised slopes, managed water, and created usable ground high in the Andes.", facts: [{ label: "Engineering", value: "Drainage layers protected the settlement from heavy rain" }], motion: "soft-pulse" }),
]);

const tajSpread = groundedCompositeSpread({ id: "taj-mahal", order: 6, image: "wonders-taj-mahal.png", kicker: "Living wonders · Agra, India", title: "Marble holds a changing sky.", body: "A white dome, four minarets, gardens, and water align around a precise riverfront axis." }, "wonders-taj-mahal-clean-v2.png", [
  visualLayer({ id: "taj-monument", label: "Taj Mahal", asset: "wonders-taj-mahal-monument-cutout-v2.png", page: "right", x: 0.38, y: 0.42, scaleX: 1.5, scaleY: 1.22, focus: "spotlight", hint: "Light the marble silhouette", title: "Perfected symmetry", summary: "The dome and four minarets read as one balanced riverfront composition." }),
  visualLayer({ id: "taj-flowers", label: "Lotus border", asset: "wonders-taj-mahal-flowers-cutout-v2.png", page: "left", x: 0.72, y: 0.78, scaleX: 1.32, scaleY: 0.7, hint: "Wake the paper flowers", title: "A garden at the page edge", summary: "The flower border turns the formal axis into an intimate foreground view." }),
  visualLayer({ id: "taj-reflection", label: "Reflecting pool", asset: "wonders-taj-mahal-pool-cutout-v2.png", page: "right", x: 0.5, y: 0.72, scaleX: 1.08, scaleY: 0.72, motion: "soft-pulse", hover: "warm-rim", hint: "Ripple the reflection", title: "An axis doubled in water", summary: "The pool extends the monument toward the viewer while reflecting changing sky." }),
  knowledgeHotspot({ id: "taj-dome", label: "Marble dome", page: "right", x: 0.5, y: 0.34, color: "aqua", hint: "Watch the dome catch the light", title: "A double dome", summary: "The exterior dome creates the monument's high silhouette while an inner shell shapes the chamber below.", facts: [{ label: "Surface", value: "White marble changes character with the light" }], motion: "soft-pulse" }),
]);

const christSpread = groundedCompositeSpread({ id: "christ-the-redeemer", order: 7, image: "wonders-christ-redeemer.png", kicker: "Living wonders · Rio de Janeiro, Brazil", title: "Open arms above the city.", body: "The Art Deco figure stands on Corcovado while mountain, bay, ocean, and streets unfold below." }, "wonders-christ-redeemer-clean-v2.png", [
  visualLayer({ id: "corcovado-statue", label: "Christ the Redeemer", asset: "wonders-christ-redeemer-statue-cutout-v2.png", page: "right", x: 0.66, y: 0.43, scaleX: 1.22, scaleY: 1.42, focus: "spotlight", hint: "Light the statue above the bay", title: "A figure made by its horizon", summary: "The open-arm silhouette gains meaning from the vast city, mountains and Atlantic below." }),
  visualLayer({ id: "sugarloaf-island", label: "Sugarloaf Mountain", asset: "wonders-christ-redeemer-sugarloaf-cutout-v2.png", page: "left", x: 0.76, y: 0.56, scaleX: 1.02, scaleY: 0.74, hint: "Inspect the bay's landmark", title: "A granite landmark in the water", summary: "Sugarloaf gives Rio's bay an unmistakable middle-distance silhouette." }),
  visualLayer({ id: "rio-foreground-leaves", label: "Tropical foreground", asset: "wonders-christ-redeemer-leaves-cutout-v2.png", page: "right", x: 0.84, y: 0.76, scaleX: 0.9, scaleY: 0.68, hint: "Part the leaves over the city", title: "A viewpoint inside a forest", summary: "Foreground vegetation connects Corcovado to Tijuca National Park." }),
  knowledgeHotspot({ id: "corcovado-view", label: "Corcovado view", page: "right", x: 0.58, y: 0.38, color: "aqua", hint: "Look beyond the statue to the bay", title: "A landmark made by its horizon", summary: "The elevated viewpoint connects the monument visually with Rio's mountains, bay, and Atlantic coast.", facts: [{ label: "Setting", value: "Corcovado rises within Tijuca National Park" }], motion: "soft-pulse" }),
]);

const citySpread = layeredIllustrationSpread({ id: "city-for-small-things", order: 0, image: "city-spread.png", title: "We built a city for small things.", body: "Paper towers, leaf gardens, and cloud roads—just the right size for big adventures." }, "story-city-clean-v2.png", [
  visualLayer({ id: "bird", label: "Young city builder", asset: "story-city-boy-cutout-v3.png", kind: "embedded", page: "left", x: 0.64, y: 0.57, scaleX: 0.9, scaleY: 1.12, hover: "lift-glow", focus: "spotlight", hint: "Help place the smallest house", title: "A city begins at hand scale", summary: "The builder makes the paper skyline feel touchable and invites the reader into the act of making." }),
  visualLayer({ id: "city-flower-towers", label: "Giant paper flowers", asset: "story-city-flowers-cutout-v3.png", page: "right", x: 0.78, y: 0.51, scaleX: 0.82, scaleY: 1.18, hint: "Wake the flowers beside the rooftops", title: "A garden taller than houses", summary: "Overscaled flowers turn the city into a place built for small things." }),
  visualLayer({ id: "city-cloud-family", label: "Cloud family", asset: "story-city-clouds-cutout-v3.png", page: "right", x: 0.35, y: 0.22, scaleX: 1.1, scaleY: 0.62, motion: "fly-across", durationMs: 9000, hint: "Send the clouds across the paper sky", title: "Three clouds, three speeds", summary: "Separate paper clouds create a gentle parallax path above the city." }),
  knowledgeHotspot({ id: "paper-tower", label: "Paper tower", page: "right", x: 0.77, y: 0.61, color: "amber", hint: "Wake the smallest tower", title: "A city scaled for small adventures", summary: "Layered paper shapes turn a familiar skyline into a place explored one detail at a time.", motion: "soft-pulse" }),
]);

const volcanoSpread = layeredIllustrationSpread({ id: "inside-a-volcano", order: 0, image: "science-volcano.png", kicker: "How the world works · Earth science", title: "A mountain opens to show its fire.", body: "Magma gathers below the cone, rises through branching conduits, and meets layers left by earlier eruptions." }, "science-volcano-clean-v2.png", [
  visualLayer({ id: "volcano-ash-plume", label: "Eruption plume", asset: "science-volcano-plume-cutout-v2.png", page: "right", x: 0.73, y: 0.29, scaleX: 0.92, scaleY: 1.04, motion: "soft-pulse", hover: "warm-rim", hint: "Wake the ash plume", title: "A column driven upward", summary: "Hot gas and fragments rise until the plume spreads into cooler air." }),
  visualLayer({ id: "volcano-conduit", label: "Branching conduit", asset: "science-volcano-conduit-cutout-v2.png", page: "right", x: 0.43, y: 0.57, scaleX: 0.7, scaleY: 1.24, focus: "spotlight", hint: "Trace magma through the mountain", title: "More than one route upward", summary: "Magma can branch into dikes and side vents while the main conduit feeds the summit." }),
  visualLayer({ id: "volcano-magma-reservoir", label: "Magma reservoir", asset: "science-volcano-chamber-cutout-v2.png", page: "right", x: 0.51, y: 0.78, scaleX: 0.88, scaleY: 0.55, motion: "soft-pulse", hover: "warm-rim", hint: "Press the reservoir below the cone", title: "Magma waits under pressure", summary: "A reservoir can feed branching conduits before an eruption reaches the surface.", facts: [{ label: "Motion", value: "Gas expansion and buoyancy help magma rise" }] }),
  knowledgeHotspot({ id: "magma-chamber", label: "Pressure point", page: "right", x: 0.5, y: 0.69, color: "rose", hint: "Follow pressure beneath the cone", title: "Pressure changes the route", summary: "Fractures open when pressure overcomes the surrounding rock.", motion: "soft-pulse", durationMs: 2600 }),
]);
const tectonicSpread = layeredIllustrationSpread({ id: "tectonic-plates-in-motion", order: 1, image: "science-tectonics.png", kicker: "How the world works · Dynamic Earth", title: "Continents ride on moving rock.", body: "Rigid plates drift over hotter mantle, opening oceans, building mountains, and concentrating earthquakes at their boundaries." }, "science-tectonics-clean-v2.png", [
  visualLayer({ id: "mantle-upwelling", label: "Mantle upwelling", asset: "science-tectonics-upwelling-cutout-v2.png", page: "left", x: 0.72, y: 0.72, scaleX: 1.25, scaleY: 0.62, motion: "soft-pulse", hover: "warm-rim", hint: "Lift the hot mantle toward the crust", title: "Heat rises inside Earth", summary: "Hotter mantle deforms and circulates slowly beneath the rigid plates." }),
  visualLayer({ id: "tectonic-plume", label: "Rising plume", asset: "science-tectonics-plume-cutout-v2.png", page: "right", x: 0.54, y: 0.63, scaleX: 0.48, scaleY: 0.9, hint: "Follow the narrow plume upward", title: "A focused route for heat", summary: "A buoyant plume can transfer heat toward the lithosphere over very long timescales." }),
  visualLayer({ id: "tectonic-volcano", label: "Boundary volcano", asset: "science-tectonics-volcano-cutout-v2.png", page: "right", x: 0.77, y: 0.34, scaleX: 0.62, scaleY: 0.82, focus: "spotlight", hint: "Inspect the volcano above the boundary", title: "Surface evidence of deep motion", summary: "Volcanism makes the movement and melting below a plate boundary visible." }),
  knowledgeHotspot({ id: "plate-boundary", label: "Plate boundary", page: "right", x: 0.5, y: 0.55, color: "rose", hint: "Inspect where two plates meet", title: "Most action happens at the edge", summary: "Plate boundaries concentrate deformation, earthquakes, volcanism, and mountain building.", facts: [{ label: "Three patterns", value: "Divergent, convergent, and transform motion" }], motion: "slow-orbit", durationMs: 5200 }),
]);
const waterCycleSpread = layeredIllustrationSpread({ id: "water-cycle", order: 2, image: "science-water-cycle.png", kicker: "How the world works · Water", title: "The same water keeps travelling.", body: "Sunlight lifts water, clouds carry it, and gravity returns it through rain, snow, rivers, soil, and sea." }, "science-water-cycle-clean-v2.png", [
  visualLayer({ id: "water-cycle-sun", label: "Sun and evaporation", asset: "science-water-cycle-sun-cutout-v2.png", page: "left", x: 0.28, y: 0.31, scaleX: 0.57, scaleY: 0.95, motion: "soft-pulse", hover: "warm-rim", focus: "spotlight", hint: "Warm the water into vapour", title: "Sunlight starts the lift", summary: "Solar energy gives surface water enough energy to enter the atmosphere as vapour." }),
  visualLayer({ id: "water-cycle-cloud-layer", label: "Rain and snow cloud", asset: "science-water-cycle-cloud-cutout-v2.png", page: "right", x: 0.43, y: 0.29, scaleX: 1.24, scaleY: 0.8, motion: "fly-across", durationMs: 9200, hint: "Move the cloud across the watershed", title: "Water changes state", summary: "Cooling vapour condenses into droplets and ice that can fall as rain or snow." }),
  visualLayer({ id: "water-cycle-river", label: "River to the sea", asset: "science-water-cycle-river-cutout-v2.png", page: "right", x: 0.64, y: 0.68, scaleX: 0.72, scaleY: 1.02, hint: "Follow the river downhill", title: "Gravity closes the loop", summary: "Runoff gathers in channels and carries water back toward lakes and ocean." }),
  knowledgeHotspot({ id: "water-cycle-cloud", label: "Condensing cloud", page: "right", x: 0.58, y: 0.28, color: "aqua", hint: "Follow water into the cloud", title: "A cycle with many paths", summary: "Water can pause in ice, soil, groundwater, lakes, living things, and air.", facts: [{ label: "Cycle", value: "Evaporation, condensation, precipitation, collection" }], motion: "soft-pulse", durationMs: 4800 }),
]);
const stormSpread: Spread = {
  ...layeredIllustrationSpread({ id: "inside-a-storm", order: 3, image: "science-storm.png", kicker: "How the world works · Weather", title: "A storm builds a vertical engine.", body: "Warm moist air rises while rain-cooled air descends, organising cloud, ice, rain, and electrical charge." }, "science-storm-clean-v2.png", []),
  elements: [
    visualLayer({ id: "storm-updraft-layer", label: "Warm updraft", asset: "science-storm-updraft-cutout-v2.png", page: "left", x: 0.58, y: 0.5, scaleX: 1.3, scaleY: 1.34, motion: "gentle-float", durationMs: 3200, hover: "warm-rim", hint: "Follow warm air up the storm", title: "The storm's rising engine", summary: "Warm moist air accelerates upward, carrying water high enough to freeze into ice.", facts: [{ label: "Fuel", value: "Latent heat released by condensation strengthens the updraft" }] }),
    visualLayer({ id: "storm-ice-layer", label: "Ice crystal canopy", asset: "science-storm-ice-cutout-v2.png", page: "right", x: 0.37, y: 0.29, scaleX: 1.02, scaleY: 0.9, motion: "fly-across", durationMs: 8800, hint: "Drift through the ice canopy", title: "Charge separates in ice", summary: "Collisions between ice particles help sort electrical charge through the cloud." }),
    knowledgeHotspot({ id: "storm-updraft", label: "Updraft core", page: "left", x: 0.67, y: 0.48, color: "amber", hint: "Inspect the rising core", title: "Air becomes a vertical engine", summary: "Strong updrafts keep droplets and ice aloft while the storm grows.", motion: "soft-pulse", durationMs: 3200 }), {
    id: "lightning-sequence",
    label: "Lightning pulse",
    kind: "lifted",
    assetId: "/assets/generated/storm-lightning-rest.png",
    frameAssetIds: [
      "/assets/generated/storm-lightning-rest.png",
      "/assets/generated/storm-lightning-1.png",
      "/assets/generated/storm-lightning-2.png",
      "/assets/generated/storm-lightning-3.png",
      "/assets/generated/storm-lightning-2.png",
      "/assets/generated/storm-lightning-rest.png",
    ],
    page: "right",
    transform: { x: 0.58, y: 0.46, scaleX: 0.5, scaleY: 0.95, rotationDeg: 0 },
    depth: 0.08,
    locked: false,
    interaction: {
      hover: "warm-rim",
      focus: "spotlight",
      hint: "Hover to charge the cloud; click to read the flash",
      reveal: {
        kind: "fact-card",
        title: "A lightning discharge",
        summary: "Charge separation inside the storm creates an electric field strong enough to ionise a path through the air.",
        facts: [
          { label: "Visible phase", value: "A return stroke brightens the channel" },
          { label: "Heat", value: "The channel rapidly heats the surrounding air" },
          { label: "Thunder", value: "Expanding air produces the pressure wave we hear" },
        ],
        source: "Conceptual storm illustration · timing slowed for clarity",
      },
    },
    provenance: "sample",
  }],
};
const oceanSpread = layeredIllustrationSpread({ id: "ocean-circulation", order: 4, image: "science-ocean.png", kicker: "How the world works · Ocean", title: "The ocean moves heat around Earth.", body: "Wind drives surface currents while differences in temperature and salinity move deeper water between basins." }, "science-ocean-clean-v2.png", [
  visualLayer({ id: "warm-surface-currents", label: "Warm surface currents", asset: "science-ocean-warm-current-cutout-v2.png", page: "left", x: 0.52, y: 0.52, scaleX: 1.2, scaleY: 1.14, motion: "slow-orbit", hover: "warm-rim", hint: "Follow heat away from the tropics", title: "Wind steers the surface", summary: "Surface currents redistribute solar heat across ocean basins." }),
  visualLayer({ id: "ocean-earth-diagram", label: "Ocean world", asset: "science-ocean-globe-cutout-v2.png", page: "right", x: 0.1, y: 0.49, scaleX: 1.3, scaleY: 1.25, focus: "orbit-inspect", hint: "Rotate the ocean world", title: "One connected ocean", summary: "Currents cross named basins but together form a connected global system." }),
  visualLayer({ id: "cold-deep-currents", label: "Cold deep currents", asset: "science-ocean-cold-current-cutout-v2.png", page: "right", x: 0.72, y: 0.55, scaleX: 1.1, scaleY: 1.2, motion: "slow-orbit", hint: "Send dense water into the deep", title: "A slow conveyor of heat", summary: "Cold salty water sinks and helps connect deep circulation between basins.", facts: [{ label: "Driver", value: "Density changes with temperature and salinity" }] }),
  knowledgeHotspot({ id: "ocean-current", label: "Deep current", page: "right", x: 0.54, y: 0.63, color: "aqua", hint: "Inspect the sinking branch", title: "Density starts the descent", summary: "Cooling and sea-ice formation can make high-latitude water dense enough to sink.", motion: "slow-orbit", durationMs: 6200 }),
]);
const solarSpread = layeredIllustrationSpread({ id: "solar-system-scale", order: 5, image: "science-solar-system.png", kicker: "How the world works · Space", title: "Gravity writes an orbital rhythm.", body: "Eight planets fall continuously around the Sun, each keeping its own distance, direction, and tempo." }, "science-solar-system-clean-v2.png", [
  visualLayer({ id: "solar-sun", label: "The Sun", asset: "science-solar-sun-cutout-v2.png", page: "left", x: 0.82, y: 0.46, scaleX: 0.98, motion: "soft-pulse", hover: "warm-rim", focus: "spotlight", hint: "Wake the system's star", title: "Nearly all the mass is here", summary: "The Sun's gravity dominates the solar system and keeps the planets in orbit." }),
  visualLayer({ id: "solar-jupiter", label: "Jupiter", asset: "science-solar-jupiter-cutout-v2.png", page: "right", x: 0.42, y: 0.42, scaleX: 0.58, motion: "slow-orbit", focus: "orbit-inspect", hint: "Inspect the largest planet", title: "A giant among planets", summary: "Jupiter is the solar system's largest planet and has a powerful gravitational influence." }),
  visualLayer({ id: "solar-saturn", label: "Saturn and rings", asset: "science-solar-saturn-cutout-v2.png", page: "right", x: 0.62, y: 0.7, scaleX: 0.72, scaleY: 0.56, motion: "slow-orbit", focus: "orbit-inspect", hint: "Tilt Saturn's ring plane", title: "Countless pieces make the rings", summary: "Saturn's rings are composed of ice and rock particles orbiting together." }),
  knowledgeHotspot({ id: "orbital-rhythm", label: "Orbital rhythm", page: "right", x: 0.58, y: 0.48, color: "amber", hint: "Trace one path around the Sun", title: "Falling around the Sun", summary: "An orbit combines forward motion with continuous gravitational fall toward the Sun.", facts: [{ label: "Tempo", value: "More distant planets take longer to complete an orbit" }], motion: "slow-orbit", durationMs: 7200 }),
]);

const riverSpread = layeredIllustrationSpread({ id: "river-home", order: 1, image: "river-home-spread.png", title: "Every small road found its way home.", body: "The river carried one last paper boat toward the warmest window in the city." }, "story-river-clean-v2.png", [
  visualLayer({ id: "river-paper-boat", label: "Red paper boat", asset: "story-river-boat-cutout-v3.png", page: "right", x: 0.22, y: 0.75, scaleX: 0.54, scaleY: 0.46, motion: "water-bob", durationMs: 4200, hint: "Rock the boat on the current", title: "A folded messenger", summary: "The bright boat carries the eye along the river toward the distant house." }),
  visualLayer({ id: "river-hill-home", label: "Hilltop home and garden", asset: "story-river-house-cutout-v3.png", page: "right", x: 0.72, y: 0.48, scaleX: 1.05, scaleY: 1.1, focus: "spotlight", hint: "Light the house above the river", title: "The warmest window", summary: "A path, house, and flower garden gather the page into one destination." }),
  visualLayer({ id: "river-golden-sun", label: "Golden sun", asset: "story-river-sun-cutout-v3.png", page: "right", x: 0.62, y: 0.18, scaleX: 0.34, motion: "soft-pulse", hover: "warm-rim", focus: "spotlight", hint: "Warm the last bend in the river", title: "A small sun for the journey", summary: "The golden paper disc repeats the warm window before the boat arrives." }),
  knowledgeHotspot({ id: "paper-boat", label: "River current", page: "right", x: 0.54, y: 0.74, color: "aqua", hint: "Follow the current home", title: "A current made from folded paper", summary: "The river is the visual path that carries the story from the city toward home.", motion: "soft-pulse" }),
]);

const cloudRoadSpread = layeredIllustrationSpread({ id: "cloud-road", order: 2, image: "city-cloud-road-spread-v2.png", title: "The cloud road opened at noon.", body: "One paper wing was enough to find the blue path above every chimney." }, "story-cloud-road-clean-v2.png", [
  visualLayer({ id: "cloud-road-plane", label: "Blue paper wing", asset: "story-cloud-plane-cutout-v3.png", page: "left", x: 0.75, y: 0.3, scaleX: 0.46, scaleY: 0.4, motion: "fly-across", durationMs: 6800, hint: "Launch the paper wing", title: "The guide takes flight", summary: "A folded blue bird shows where the cloud road begins." }),
  visualLayer({ id: "cloud-road-ribbon", label: "Winding cloud road", asset: "story-cloud-road-cutout-v3.png", page: "right", x: 0.1, y: 0.5, scaleX: 1.38, scaleY: 1.45, hint: "Open the road between the clouds", title: "A path drawn by negative space", summary: "Layered blue cloud scallops turn one white ribbon into a road through the sky." }),
  visualLayer({ id: "cloud-road-towers", label: "City beyond the clouds", asset: "story-cloud-towers-cutout-v3.png", page: "right", x: 0.7, y: 0.6, scaleX: 1.05, scaleY: 1.12, focus: "spotlight", hint: "Inspect the city at the end of the path", title: "A destination above the rooftops", summary: "The tall tower cluster gives the drifting road a clear point of arrival." }),
  knowledgeHotspot({ id: "cloud-road-marker", label: "Cloud road", page: "right", x: 0.48, y: 0.48, color: "aqua", hint: "Trace the blue edge", title: "A road that only appears at noon", summary: "The blue gap becomes navigable when the paper guide takes flight.", motion: "slow-orbit" }),
]);

const gardenGateSpread = layeredIllustrationSpread({ id: "garden-gate", order: 3, image: "city-garden-gate-spread-v2.png", title: "At dusk, the city found a garden gate.", body: "The last street became a path of lanterns, leaves, and quiet animal tracks." }, "story-garden-gate-clean-v2.png", [
  visualLayer({ id: "garden-arched-gate", label: "Leaf-framed garden gate", asset: "story-garden-gate-cutout-v3.png", page: "right", x: 0.7, y: 0.52, scaleX: 1.18, scaleY: 1.28, focus: "spotlight", hint: "Open the gate into the garden", title: "A threshold made from leaves", summary: "The arch changes the page from city street to secret garden." }),
  visualLayer({ id: "garden-fireflies", label: "Firefly cluster", asset: "story-garden-fireflies-cutout-v3.png", page: "right", x: 0.47, y: 0.48, scaleX: 0.58, motion: "soft-pulse", durationMs: 2300, hover: "warm-rim", focus: "spotlight", hint: "Gather the lights into a trail", title: "Small lights reveal the route", summary: "The fireflies pulse in a loose sequence through the open gate." }),
  visualLayer({ id: "garden-city-edge", label: "Last warm buildings", asset: "story-garden-buildings-cutout-v3.png", page: "left", x: 0.5, y: 0.44, scaleX: 1.08, scaleY: 1.2, hint: "Wake the final city windows", title: "The city remains behind", summary: "Warm windows mark the last safe landmark before the path enters leaves." }),
  knowledgeHotspot({ id: "lantern-trail", label: "Lantern trail", page: "right", x: 0.48, y: 0.68, color: "amber", hint: "Light the path through the gate", title: "Dusk becomes a trail", summary: "A sequence of warm lights leads the eye from the last city street into the garden.", motion: "soft-pulse", durationMs: 2800 }),
]);

const homeWindowSpread = layeredIllustrationSpread({ id: "warm-window", order: 4, image: "city-warm-window-spread-v2.png", title: "One warm window kept the whole adventure.", body: "The city folded small enough to fit beside the bed, but every road remained ready for tomorrow." }, "story-warm-window-clean-v2.png", [
  visualLayer({ id: "warm-window-child", label: "Sleeping storyteller", asset: "story-window-child-cutout-v3.png", page: "right", x: 0.6, y: 0.62, scaleX: 1.2, scaleY: 1.14, focus: "spotlight", hint: "Settle the quilt over the story", title: "The adventure folds into sleep", summary: "The sleeping child turns the whole paper city into a remembered bedside world." }),
  visualLayer({ id: "warm-window-glow", label: "Glowing bedroom window", asset: "story-window-glow-cutout-v3.png", page: "right", x: 0.58, y: 0.28, scaleX: 0.72, scaleY: 0.78, motion: "soft-pulse", hover: "warm-rim", focus: "spotlight", hint: "Turn on the last light home", title: "A window keeps the story warm", summary: "The amber window becomes the final visual anchor of the journey." }),
  visualLayer({ id: "warm-window-boat", label: "Returned paper boat", asset: "story-window-boat-cutout-v3.png", page: "left", x: 0.75, y: 0.76, scaleX: 0.54, scaleY: 0.42, hint: "Inspect the boat beside the bed", title: "The journey returns in miniature", summary: "The same red boat now rests inside the child's folded paper world." }),
  knowledgeHotspot({ id: "warm-window-light", label: "Warm window", page: "right", x: 0.75, y: 0.34, color: "amber", hint: "Read the last glow", title: "The last light home", summary: "The brightest window closes the visual journey and makes the city safe enough to fold away.", motion: "soft-pulse", durationMs: 3000 }),
]);

const lanternSpread: LayeredSpreadDraft = {
  id: "lantern-garden",
  order: 0,
  title: "A lantern waited in the garden.",
  body: "Its amber light knew the path, even when the moon kept quiet.",
};

const moonPathSpread: LayeredSpreadDraft = {
  id: "moon-path",
  order: 1,
  title: "Moonlight drew a silver path.",
  body: "The fox stepped only where the flowers turned their faces toward the sky.",
};

const fireflyBridgeSpread: LayeredSpreadDraft = {
  id: "firefly-bridge",
  order: 2,
  title: "Fireflies became a bridge.",
  body: "Each light held its place just long enough for a careful traveller to cross the river.",
};

const sleepingCitySpread: LayeredSpreadDraft = {
  id: "sleeping-city",
  order: 3,
  title: "Below the hill, the paper city slept.",
  body: "Only one bird stayed awake to listen for the returning lantern bell.",
};

const dawnGardenSpread: LayeredSpreadDraft = {
  id: "dawn-garden",
  order: 4,
  title: "At dawn, every lantern became a flower.",
  body: "The garden kept the night's gold and gave it back as colour.",
};

const guideSpreads: LayeredSpreadDraft[] = [
  {
    id: "guide-start-in-codex",
    order: 0,
    kicker: "Apertale field guide · 01",
    title: "Start in the conversation beside this book.",
    body: "Keep Apertale open in the built-in browser beside your Codex chat, then describe what you want to make. The site exposes structured tools, so the agent can create and revise the book you see here.",
  },
  {
    id: "guide-text-to-book",
    order: 1,
    kicker: "Apertale field guide · 02",
    title: "Describe the story, not the interface.",
    body: "Give Codex a topic, audience, tone, and any must-have moments. It can draft the structure, write each spread, and plan ImageGen artwork. If the page count materially changes the result, it should ask one short question; otherwise it starts with a sensible 4–8 spread book.",
  },
  {
    id: "guide-photo-led-book",
    order: 2,
    kicker: "Apertale field guide · 03",
    title: "Turn your pictures into living layers.",
    body: "Attach or generate images in your Codex conversation. Codex can decide what to isolate, animate, reveal, or make interactive. Use Create Your Own to prepare the brief and import chosen references into this browser before handing the work to your Agent.",
  },
  {
    id: "guide-living-scenes",
    order: 3,
    kicker: "Apertale field guide · 04",
    title: "Make the illustration move with purpose.",
    body: "Codex can plan full-spread ImageGen artwork, isolate a few foreground layers, and add hover, click, parallax, light, particles, or short frame animation. The live conversation remains the author and controller of your book; Apertale is the private browser-local canvas.",
  },
];

function relayerSpread(spread: LayeredSpreadDraft, source: string, clean: string, elements: BookElement[]): Spread {
  return { ...spread, textureUrl: `/assets/generated/${clean}`, artwork: { sourceAssetId: `/assets/generated/${source}`, cleanPlateAssetId: `/assets/generated/${clean}`, separation: "inpainted-clean-plate" }, elements };
}

const lanternLayeredSpreads = [
  relayerSpread(lanternSpread, "moon-garden-spread.png", "lantern-garden-clean-v2.png", [
    visualLayer({ id: "lantern-child", label: "Lantern bearer", asset: "lantern-garden-child-cutout-v2.png", page: "left", x: 0.7, y: 0.62, scaleX: 0.75, hint: "Walk into the moon garden", title: "A traveller carrying warmth", summary: "The hand lantern makes the child's next step readable in the dark." }),
    visualLayer({ id: "lantern-hanging", label: "Hanging lantern", asset: "lantern-garden-hanging-lantern-cutout-v2.png", page: "right", x: 0.62, y: 0.25, scaleX: 0.42, motion: "soft-pulse", hover: "warm-rim", focus: "spotlight", hint: "Light the lantern under the branch", title: "A warm destination", summary: "The hanging lantern anchors the night garden." }),
    visualLayer({ id: "lantern-moon", label: "Full moon", asset: "lantern-garden-moon-cutout-v2.png", page: "left", x: 0.45, y: 0.2, scaleX: 0.36, hint: "Raise the moon over the path", title: "Cool light, warm journey", summary: "Moonlight balances the amber lamps below." }),
  ]),
  relayerSpread(moonPathSpread, "lantern-moon-path-spread-v2.png", "lantern-moon-path-clean-v2.png", [
    visualLayer({ id: "moon-path-crescent", label: "Crescent moon", asset: "lantern-moon-path-moon-cutout-v2.png", page: "right", x: 0.75, y: 0.18, scaleX: 0.3, hint: "Turn the crescent over the garden", title: "The path's cool compass", summary: "The crescent sets the direction of the silver path." }),
    visualLayer({ id: "moon-path-flowers", label: "Silver flower path", asset: "lantern-moon-path-flower-path-cutout-v2.png", page: "right", x: 0.12, y: 0.58, scaleX: 1.3, scaleY: 1.35, hint: "Let the flowers face the moon", title: "A road written in flowers", summary: "Pale blossoms make a navigable ribbon through the dark." }),
    visualLayer({ id: "moon-path-fireflies", label: "Moon-path fireflies", asset: "lantern-moon-path-fireflies-cutout-v2.png", page: "left", x: 0.62, y: 0.47, scaleX: 0.55, motion: "soft-pulse", durationMs: 2300, hover: "warm-rim", hint: "Gather the lights", title: "Tiny moving waypoints", summary: "Fireflies add a second, warmer route beside moonlight." }),
  ]),
  relayerSpread(fireflyBridgeSpread, "lantern-firefly-bridge-spread-v2.png", "lantern-firefly-bridge-clean-v2.png", [
    visualLayer({ id: "firefly-bridge-layer", label: "Firefly bridge", asset: "lantern-firefly-bridge-firefly-bridge-cutout-v2.png", page: "left", x: 0.62, y: 0.55, scaleX: 1.25, scaleY: 0.72, motion: "soft-pulse", durationMs: 2200, hover: "warm-rim", hint: "Build the bridge from light", title: "A crossing made of moments", summary: "Hundreds of warm points hold one temporary arc." }),
    visualLayer({ id: "bridge-stone-lantern", label: "Stone lantern", asset: "lantern-firefly-bridge-stone-lantern-cutout-v2.png", page: "right", x: 0.5, y: 0.5, scaleX: 0.55, scaleY: 0.85, hint: "Wake the lantern at the river", title: "A steady light beside motion", summary: "The stone lantern gives the flickering bridge a fixed endpoint." }),
    visualLayer({ id: "bridge-distant-lights", label: "Distant lanterns", asset: "lantern-firefly-bridge-distant-lanterns-cutout-v2.png", page: "right", x: 0.78, y: 0.42, scaleX: 0.72, motion: "soft-pulse", hover: "warm-rim", hint: "Find the far bank", title: "The destination glows", summary: "A distant cluster makes the crossing feel possible." }),
  ]),
  groundedCompositeSpread({ ...sleepingCitySpread, image: "lantern-sleeping-city-spread-v2.png" }, "lantern-sleeping-city-clean-v2.png", [
    visualLayer({ id: "sleeping-city-moon", label: "City moon", asset: "lantern-sleeping-city-moon-cutout-v2.png", page: "left", x: 0.35, y: 0.2, scaleX: 0.34, hint: "Lift the moon above the roofs", title: "Quiet time over the city", summary: "The moon keeps the skyline readable after the windows dim." }),
    visualLayer({ id: "sleeping-clocktower-layer", label: "Clocktower", asset: "lantern-sleeping-city-clocktower-cutout-v2.png", page: "right", x: 0.34, y: 0.48, scaleX: 0.65, scaleY: 1.2, focus: "spotlight", hint: "Listen for the last bell", title: "One tower keeps time", summary: "The clocktower remains the city's night landmark." }),
    visualLayer({ id: "sleeping-warm-lights", label: "Last warm lights", asset: "lantern-sleeping-city-warm-lights-cutout-v2.png", page: "right", x: 0.72, y: 0.6, scaleX: 0.92, motion: "soft-pulse", durationMs: 2800, hover: "warm-rim", hint: "Wake one last window", title: "The city is not entirely asleep", summary: "A few lamps hold a safe route through the dark." }),
  ]),
  relayerSpread(dawnGardenSpread, "lantern-dawn-garden-spread-v2.png", "lantern-dawn-garden-clean-v2.png", [
    visualLayer({ id: "dawn-lotus", label: "Lantern lotus garden", asset: "lantern-dawn-garden-lotus-cutout-v2.png", page: "left", x: 0.62, y: 0.62, scaleX: 1.22, scaleY: 1.15, hint: "Open the lantern flowers", title: "Night turns into colour", summary: "Warm lamps become luminous paper blossoms at dawn." }),
    visualLayer({ id: "dawn-seedpods", label: "Lantern seedpods", asset: "lantern-dawn-garden-seedpods-cutout-v2.png", page: "right", x: 0.34, y: 0.55, scaleX: 0.95, scaleY: 1.12, hint: "Sway the seedpod lights", title: "The garden keeps the stars", summary: "Blue and amber pods preserve the night's palette." }),
    visualLayer({ id: "dawn-sunrise", label: "Rising sun", asset: "lantern-dawn-garden-sunrise-cutout-v2.png", page: "right", x: 0.76, y: 0.26, scaleX: 0.42, motion: "soft-pulse", hover: "warm-rim", focus: "spotlight", hint: "Bring morning over the garden", title: "A new light replaces the lanterns", summary: "The sunrise closes the night journey without erasing its glow." }),
  ]),
];

const guideSources = ["guide-codex", "guide-text", "guide-photo", "guide-motion"] as const;
const guideObjects = [
  [["robot", "Guide robot"], ["open-book", "Dimensional book"], ["doorway", "Glowing doorway"]],
  [["child", "Story runner"], ["story-frame", "Framed story"], ["sparks", "Story sparks"]],
  [["kite", "Red kite"], ["family", "Family group"], ["dog", "Paper dog"]],
  [["picture-book", "Open picture book"], ["sailboat", "Paper sailboat"], ["scene-cards", "Scene cards"]],
] as const;
const guideLayeredSpreads = guideSpreads.map((spread, index) => relayerSpread(spread, `${guideSources[index]}-spread-v2.png`, `${guideSources[index]}-clean-v2.png`, guideObjects[index].map(([asset, label], objectIndex) => visualLayer({ id: `${guideSources[index]}-${asset}`, label, asset: `${guideSources[index]}-${asset}-cutout-v2.png`, page: objectIndex === 0 ? "left" : "right", x: objectIndex === 0 ? 0.62 : objectIndex === 1 ? 0.36 : 0.76, y: objectIndex === 1 ? 0.52 : 0.42, scaleX: objectIndex === 1 ? 0.9 : 0.58, motion: asset === "sparks" ? "soft-pulse" : asset === "sailboat" ? "water-bob" : undefined, hint: `Explore ${label.toLowerCase()}`, title: label, summary: "A separate semantic layer that responds to hover and focus while explaining how the book is made." }))));

export const sampleBooks: DocumentState[] = [
  {
    id: "apertale-field-guide",
    revision: 1,
    title: "The Apertale Field Guide",
    coverTextureUrl: "/assets/covers/apertale-field-guide-v2.png",
    spreads: guideLayeredSpreads,
  },
  {
    id: "apertale-atlas-of-wonders",
    revision: 1,
    title: "Atlas of Living Wonders",
    coverTextureUrl: "/assets/covers/atlas-of-living-wonders-v2.png",
    spreads: [colosseumSpread, pyramidSpread, greatWallSpread, petraSpread, chichenSpread, machuSpread, tajSpread, christSpread],
  },
  {
    id: "apertale-how-world-works",
    revision: 1,
    title: "How the World Works",
    coverTextureUrl: "/assets/covers/how-the-world-works-v2.png",
    spreads: [volcanoSpread, tectonicSpread, waterCycleSpread, stormSpread, oceanSpread, solarSpread],
  },
  {
    id: "apertale-your-story",
    revision: 1,
    title: "Your Story, Made Alive",
    coverTextureUrl: "/assets/covers/your-story-made-alive-v2.png",
    spreads: [citySpread, riverSpread, cloudRoadSpread, gardenGateSpread, homeWindowSpread],
  },
  {
    id: "apertale-lantern-garden",
    revision: 1,
    title: "The Lantern Garden",
    coverTextureUrl: "/assets/covers/the-lantern-garden-v2.png",
    spreads: lanternLayeredSpreads,
  },
];

// The bookshelf is the first visual experience; keep the Atlas open behind it
// so closing the shelf reveals a complete interactive showcase immediately.
export const initialDocument = sampleBooks[1];

export const initialSession: SessionState = {
  currentSpreadIndex: 0,
  selectionId: null,
  sceneThemeId: "paper-atelier",
  preview: false,
  quality: "balanced",
};
