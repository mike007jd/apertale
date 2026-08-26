import type { DocumentState, SessionState, Spread } from "./types";

const colosseumSpread: Spread = {
  id: "flavian-amphitheatre",
  order: 0,
  kicker: "Wonders in paper · Rome, Italy",
  title: "The Colosseum rises off the page.",
  body: "Eighty arches, four storeys of travertine, and a hidden world of corridors beneath the sand. Turn it, light it, and read what Rome built in eight short years.",
  elements: [{
    id: "colosseum",
    label: "Colosseum",
    kind: "lifted",
    assetId: "model:flavian-amphitheatre",
    modelId: "flavian-amphitheatre",
    page: "right",
    transform: { x: 0.5, y: 0.58, scaleX: 1, scaleY: 1, rotationDeg: 0 },
    depth: 0.08,
    locked: false,
    interaction: {
      hover: "tilt-toward-pointer",
      focus: "orbit-inspect",
      hint: "Hover to turn it, click to inspect",
      reveal: {
        kind: "fact-card",
        title: "Flavian Amphitheatre",
        summary: "Rome's largest amphitheatre, begun under Vespasian and opened by Titus with a hundred days of games.",
        facts: [
          { label: "Opened", value: "AD 80" },
          { label: "Capacity", value: "about 50,000 spectators" },
          { label: "Ground arches", value: "80 numbered entrances" },
          { label: "Built from", value: "Travertine, tuff, brick-faced concrete" },
          { label: "Below the sand", value: "The hypogeum, added under Domitian" },
        ],
        source: "Rome, Italy · Flavian Amphitheatre, AD 70–80",
      },
    },
    provenance: "sample",
  }],
};

const pyramidSpread: Spread = {
  id: "great-pyramid-of-giza",
  order: 1,
  kicker: "Wonders in paper · Giza, Egypt",
  title: "A horizon built from stone.",
  body: "More than two million blocks rise toward a missing capstone. Turn the monument, trace its ascending passage, and inspect a royal chamber hidden above the desert.",
  elements: [{
    id: "great-pyramid",
    label: "Great Pyramid",
    kind: "lifted",
    assetId: "model:great-pyramid",
    modelId: "great-pyramid",
    page: "right",
    transform: { x: 0.5, y: 0.59, scaleX: 0.96, scaleY: 0.96, rotationDeg: 0 },
    depth: 0.08,
    locked: false,
    interaction: {
      hover: "tilt-toward-pointer",
      focus: "orbit-inspect",
      hint: "Hover to read the courses, click to inspect",
      reveal: {
        kind: "fact-card",
        title: "Great Pyramid of Khufu",
        summary: "The largest pyramid at Giza was built as the tomb of Pharaoh Khufu and remained the tallest human-made structure for millennia.",
        facts: [
          { label: "Built", value: "c. 26th century BCE" },
          { label: "Original height", value: "about 146.6 metres" },
          { label: "Base", value: "about 230.3 metres on each side" },
          { label: "Core", value: "Limestone blocks with finer casing stone" },
          { label: "Interior", value: "Ascending passage, Grand Gallery, chambers" },
        ],
        source: "Giza, Egypt · conceptual interior overlay",
      },
    },
    provenance: "sample",
  }],
};

const citySpread: Spread = {
  id: "city-for-small-things",
  order: 0,
  textureUrl: "/assets/generated/city-spread.png",
  title: "We built a city for small things.",
  body: "Paper towers, leaf gardens, and cloud roads—just the right size for big adventures.",
  elements: [{
    id: "bird",
    label: "Bird",
    kind: "embedded",
    assetId: "/assets/generated/bird-cutout.png",
    page: "right",
    transform: { x: 0.58, y: 0.23, scaleX: 0.78, scaleY: 0.78, rotationDeg: -5 },
    depth: 0,
    locked: false,
    interaction: {
      hover: "lift-glow",
      focus: "spotlight",
      hint: "Lift the bird, then let it fly",
      reveal: { kind: "caption", title: "Bird", summary: "A cut-paper chickadee, ready to be lifted off the page and flown across the city.", facts: [] },
    },
    provenance: "sample",
  }],
};

const volcanoSpread: Spread = {
  id: "inside-a-volcano",
  order: 0,
  kicker: "How the world works · Earth science",
  title: "A mountain opens to show its fire.",
  body: "Layers of old eruptions hold a rising column of magma. Inspect the chamber, follow the conduit, and watch pressure find a path to the sky.",
  elements: [{
    id: "volcano",
    label: "Volcano cross-section",
    kind: "lifted",
    assetId: "model:volcano-cross-section",
    modelId: "volcano-cross-section",
    page: "right",
    transform: { x: 0.52, y: 0.58, scaleX: 0.95, scaleY: 0.95, rotationDeg: 0 },
    depth: 0.1,
    locked: false,
    interaction: {
      hover: "warm-rim",
      focus: "orbit-inspect",
      hint: "Hover to warm the magma, click to inspect",
      reveal: {
        kind: "fact-card",
        title: "Inside a stratovolcano",
        summary: "Magma rises through fractures, collects in chambers, and erupts when pressure overcomes the rock above it.",
        facts: [
          { label: "Magma chamber", value: "A reservoir of molten rock below the cone" },
          { label: "Conduit", value: "The main passage toward the crater" },
          { label: "Layers", value: "Alternating lava, ash, and broken rock" },
          { label: "Side vent", value: "A smaller route through the volcano's flank" },
          { label: "Plume", value: "Hot gas, ash, and fragmented material" },
        ],
        source: "Conceptual cross-section · not to scale",
      },
    },
    provenance: "sample",
  }],
};

const riverSpread: Spread = {
  id: "river-home",
  order: 1,
  textureUrl: "/assets/generated/river-home-spread.png",
  title: "Every small road found its way home.",
  body: "The river carried one last paper boat toward the warmest window in the city.",
  elements: [],
};

const lanternSpread: Spread = {
  id: "lantern-garden",
  order: 0,
  textureUrl: "/assets/generated/moon-garden-spread.png",
  title: "A lantern waited in the garden.",
  body: "Its amber light knew the path, even when the moon kept quiet.",
  elements: [{
    id: "fox",
    label: "Fox",
    kind: "embedded",
    assetId: "/assets/generated/fox-cutout.png",
    page: "right",
    transform: { x: 0.56, y: 0.57, scaleX: 0.72, scaleY: 0.72, rotationDeg: 0 },
    depth: 0,
    locked: false,
    interaction: {
      hover: "warm-rim",
      focus: "spotlight",
      hint: "Catch the lantern light on the fox",
      reveal: { kind: "caption", title: "Fox", summary: "The garden's quiet guide, warmest when the night preset is on.", facts: [] },
    },
    provenance: "sample",
  }],
};

export const sampleBooks: DocumentState[] = [
  {
    id: "apertale-atlas-of-wonders",
    revision: 1,
    title: "Atlas of Living Wonders",
    coverTextureUrl: "/assets/covers/atlas-of-living-wonders.jpg",
    spreads: [colosseumSpread, pyramidSpread],
  },
  {
    id: "apertale-how-world-works",
    revision: 1,
    title: "How the World Works",
    coverTextureUrl: "/assets/covers/how-the-world-works.jpg",
    spreads: [volcanoSpread],
  },
  { id: "apertale-your-story", revision: 1, title: "Your Story, Made Dimensional", spreads: [citySpread, riverSpread] },
  { id: "apertale-lantern-garden", revision: 1, title: "The Lantern Garden", spreads: [lanternSpread] },
];

export const initialDocument = sampleBooks[0];

export const initialSession: SessionState = {
  currentSpreadIndex: 0,
  selectionId: null,
  sceneThemeId: "paper-atelier",
  preview: false,
  quality: "balanced",
};
