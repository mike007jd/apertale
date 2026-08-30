import { describe, expect, it } from "vitest";
import {
  dedicatedCoverRendered,
  fallbackAssetPlan,
  fallbackImageLoadKeys,
  fallbackRenderComplete,
  readerRenderMatches,
  sceneAssetsReadyForEvidence,
  shelfCoverMatches,
  spreadLoadIndexes,
  type ReaderRenderEvidence,
  type ShelfCoverEvidence,
} from "./renderEvidence";
import { isProceduralElement, type Spread } from "./types";

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
  const viewport = { top: 0, right: 1280, bottom: 720, left: 0 };

  it("counts only a resolved dedicated cover as shelf cover evidence", () => {
    const personalBook = { sample: false, coverAssetId: "asset:12345678-1234-4234-8234-123456789abc" };
    expect(dedicatedCoverRendered(personalBook, "blob:cover")).toBe(true);
    // An unresolvable dedicated cover falls back to a bundled placeholder;
    // that load must not satisfy the cover-evidence blocker.
    expect(dedicatedCoverRendered(personalBook, undefined)).toBe(false);
    expect(dedicatedCoverRendered({ sample: false }, "/assets/generated/day-background.png")).toBe(false);
    expect(dedicatedCoverRendered({ sample: true, coverAssetId: personalBook.coverAssetId }, "blob:cover")).toBe(false);
  });

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

  it("uses an explicitly selected source composite without re-adding detached layers", () => {
    const grounded = spread();
    grounded.textureUrl = grounded.artwork!.sourceAssetId;
    expect(fallbackAssetPlan(grounded).baseAssetId).toBe("/clean.png");
    grounded.elements = grounded.elements.filter(isProceduralElement);
    const plan = fallbackAssetPlan(grounded);
    expect(plan.baseAssetId).toBe("/composite.png");
    expect(plan.foreground).toEqual([]);
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

  it("loads a directly selected current spread before prefetching its neighbors", () => {
    // A scene rebuilt on spread 4 may only have spreads 4 and 3 cached. A
    // direct Site Tool jump to spread 1 must request spread 1 itself; returning
    // no work here leaves the physical paper painted with spread 4 forever.
    expect(spreadLoadIndexes(0, 4, false)).toEqual([0]);
    expect(spreadLoadIndexes(0, 4, true)).toEqual([1]);
    expect(spreadLoadIndexes(2, 4, true)).toEqual([1, 3]);
  });

  it("rejects evidence from a retired reader session or rendering backend", () => {
    const evidence: ReaderRenderEvidence = {
      sceneKey: "reader-scene-after-workshop",
      renderEvidenceToken: "presentation-attempt-two",
      documentId: "book-one",
      revision: 4,
      spreadId: "opening",
      theme: "paper-atelier",
      surface: "webgl",
      locator: ".book-scene canvas",
    };
    const target = {
      sceneKey: "reader-scene-after-workshop",
      renderEvidenceToken: "presentation-attempt-two",
      documentId: "book-one",
      revision: 4,
      spreadId: "opening",
      theme: "paper-atelier" as const,
      surface: "webgl" as const,
    };

    expect(readerRenderMatches(evidence, target)).toBe(true);
    expect(readerRenderMatches(evidence, { ...target, sceneKey: "workshop-scene" })).toBe(false);
    expect(readerRenderMatches(evidence, { ...target, renderEvidenceToken: "presentation-attempt-one" })).toBe(false);
    expect(readerRenderMatches(evidence, { ...target, surface: "fallback" })).toBe(false);
  });

  it("accepts only the currently mounted, decoded, visible shelf cover", () => {
    const rect = (top: number): DOMRect => ({
      x: 20,
      y: top,
      top,
      right: 220,
      bottom: top + 280,
      left: 20,
      width: 200,
      height: 280,
      toJSON: () => ({}),
    });
    const cover: ShelfCoverEvidence = {
      url: "blob:cover",
      renderElement: {
        isConnected: true,
        complete: true,
        naturalWidth: 800,
        getBoundingClientRect: () => rect(40),
      },
    };

    expect(shelfCoverMatches(cover, "blob:cover", viewport)).toBe(true);
    expect(shelfCoverMatches({ ...cover, renderElement: { ...cover.renderElement, isConnected: false } }, "blob:cover", viewport)).toBe(false);
    expect(shelfCoverMatches({ ...cover, renderElement: { ...cover.renderElement, complete: false } }, "blob:cover", viewport)).toBe(false);
    expect(shelfCoverMatches({ ...cover, renderElement: { ...cover.renderElement, naturalWidth: 0 } }, "blob:cover", viewport)).toBe(false);
    expect(shelfCoverMatches({ ...cover, renderElement: { ...cover.renderElement, getBoundingClientRect: () => rect(900) } }, "blob:cover", viewport)).toBe(false);
  });
});
