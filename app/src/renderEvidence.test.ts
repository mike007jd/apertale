import { describe, expect, it } from "vitest";
import { fallbackAssetPlan, fallbackImageLoadKeys, fallbackRenderComplete, sceneAssetsReadyForEvidence } from "./renderEvidence";
import type { Spread } from "./types";

const spread = (): Spread => ({
  id: "opening",
  order: 0,
  title: "Opening",
  body: "A rendered opening.",
  textureUrl: "/legacy.png",
  artwork: {
    cleanPlateAssetId: "/clean.png",
    sourceAssetId: "/composite.png",
    separation: "inpainted-clean-plate",
  },
  elements: [{
    id: "character",
    label: "Character",
    kind: "lifted",
    assetId: "/character.png",
    page: "left",
    transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotationDeg: 0 },
    depth: 0.1,
    locked: false,
    provenance: "agent",
  }, {
    id: "hotspot",
    label: "Hotspot",
    kind: "decoration",
    assetId: "procedural:hotspot:amber",
    page: "right",
    transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotationDeg: 0 },
    depth: 0.1,
    locked: false,
    provenance: "agent",
  }],
});

describe("render evidence readiness", () => {
  it("uses the final clean plate and real foreground layers for fallback rendering", () => {
    const plan = fallbackAssetPlan(spread());
    expect(plan.baseAssetId).toBe("/clean.png");
    expect(plan.foreground.map((element) => element.id)).toEqual(["character"]);
    expect(fallbackRenderComplete(2, new Set(["base", "character"]), false)).toBe(true);
    expect(fallbackRenderComplete(2, new Set(["base"]), false)).toBe(false);
    expect(fallbackRenderComplete(2, new Set(["base", "character"]), true)).toBe(false);
    const collisionSafeKeys = fallbackImageLoadKeys("revision-4", ["base"]);
    expect(collisionSafeKeys).toEqual(["base:revision-4", "layer:base"]);
    expect(new Set(collisionSafeKeys).size).toBe(2);
  });

  it("rejects WebGL evidence while an expected texture is pending, incomplete, or failed", () => {
    const expected = ["character", "hotspot"];
    const complete = new Map([
      ["character", { loaded: 1, total: 1 }],
      ["hotspot", { loaded: 0, total: 0 }],
    ]);
    expect(sceneAssetsReadyForEvidence(expected, new Set(), new Set(), complete)).toBe(true);
    expect(sceneAssetsReadyForEvidence(expected, new Set(["character"]), new Set(), complete)).toBe(false);
    expect(sceneAssetsReadyForEvidence(expected, new Set(), new Set(), new Map([
      ["character", { loaded: 0, total: 1 }],
      ["hotspot", { loaded: 0, total: 0 }],
    ]))).toBe(false);
    expect(sceneAssetsReadyForEvidence(expected, new Set(), new Set(["character:texture:0"]), complete)).toBe(false);
  });
});
