import type { DocumentState, SessionState } from "./types";

export const initialDocument: DocumentState = {
  id: "livingbook-small-things",
  revision: 1,
  title: "A City for Small Things",
  spreads: [
    {
      id: "city-for-small-things",
      order: 0,
      textureUrl: "/assets/generated/city-spread.png",
      title: "We built a city for small things.",
      body: "Paper towers, leaf gardens, and cloud roads—just the right size for big adventures.",
      elements: [
        {
          id: "bird",
          label: "Bird",
          kind: "embedded",
          assetId: "/assets/generated/bird-cutout.png",
          page: "right",
          transform: { x: 0.58, y: 0.23, scaleX: 0.78, scaleY: 0.78, rotationDeg: -5 },
          depth: 0,
          locked: false,
          provenance: "sample",
        },
      ],
    },
    {
      id: "lantern-garden",
      order: 1,
      textureUrl: "/assets/generated/moon-garden-spread.png",
      title: "A lantern waited in the garden.",
      body: "Its amber light knew the path, even when the moon kept quiet.",
      elements: [
        {
          id: "fox",
          label: "Fox",
          kind: "embedded",
          assetId: "/assets/generated/fox-cutout.png",
          page: "right",
          transform: { x: 0.56, y: 0.57, scaleX: 0.72, scaleY: 0.72, rotationDeg: 0 },
          depth: 0,
          locked: false,
          provenance: "sample",
        },
      ],
    },
    {
      id: "river-home",
      order: 2,
      textureUrl: "/assets/generated/river-home-spread.png",
      title: "Every small road found its way home.",
      body: "The river carried one last paper boat toward the warmest window in the city.",
      elements: [],
    },
  ],
};

export const initialSession: SessionState = {
  currentSpreadIndex: 0,
  selectionId: null,
  sceneThemeId: "paper-atelier",
  preview: false,
  quality: "balanced",
};

