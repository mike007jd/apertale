import { describe, expect, it } from "vitest";
import {
  dedicatedCoverRendered,
  fallbackAssetPlan,
  fallbackImageLoadKeys,
  fallbackRenderComplete,
  readerRenderMatches,
  readerSceneStructureKey,
  resourceAttemptIsCurrent,
  sceneFailureMatches,
  resolvedCoverAsset,
  sceneAssetsReadyForEvidence,
  shelfCoverMatches,
  shelfCoverTarget,
  spreadResourceIndexes,
  type ReaderRenderEvidence,
  type ResolvedCoverAsset,
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
    const resolved: ResolvedCoverAsset = { assetId: personalBook.coverAssetId, url: "blob:cover" };
    expect(dedicatedCoverRendered(personalBook, resolved)).toBe(true);
    // An unresolvable dedicated cover falls back to a bundled placeholder;
    // that load must not satisfy the cover-evidence blocker.
    expect(dedicatedCoverRendered(personalBook, undefined)).toBe(false);
    expect(dedicatedCoverRendered(personalBook, { ...resolved, assetId: "asset:22345678-1234-4234-8234-123456789abc" })).toBe(false);
    expect(dedicatedCoverRendered({ sample: false }, resolved)).toBe(false);
    expect(dedicatedCoverRendered({ sample: true, coverAssetId: personalBook.coverAssetId }, resolved)).toBe(false);
  });

  it("keeps a replacement cover pending until that exact asset resolves", () => {
    const book = {
      id: "book-one",
      revision: 5,
      sample: false,
      coverAssetId: "asset:22345678-1234-4234-8234-123456789abc",
      coverTextureUrl: "/assets/generated/day-background.png",
    };
    const stale = {
      [book.id]: {
        assetId: "asset:12345678-1234-4234-8234-123456789abc",
        url: "blob:old-cover",
      },
    };
    expect(resolvedCoverAsset(book, stale)).toBeUndefined();
    expect(shelfCoverTarget(book, stale)).toBeUndefined();
    expect(shelfCoverTarget(book, {})).toBeUndefined();

    const current = { [book.id]: { assetId: book.coverAssetId, url: "blob:new-cover" } };
    expect(shelfCoverTarget(book, current)).toEqual({
      documentId: book.id,
      revision: book.revision,
      assetId: book.coverAssetId,
      url: "blob:new-cover",
    });
  });

  it("uses the bundled shelf derivative while preserving curated cover identity", () => {
    const book = {
      id: "atlas",
      revision: 1,
      sample: true,
      coverTextureUrl: "/assets/covers/atlas-of-living-wonders-v2.png",
    };
    expect(shelfCoverTarget(book, {})).toEqual({
      documentId: "atlas",
      revision: 1,
      assetId: book.coverTextureUrl,
      url: "/assets/covers/shelf/atlas-of-living-wonders-v2.webp",
    });
  });

  it("uses the final clean plate and real foreground layers for fallback rendering", () => {
    const plan = fallbackAssetPlan(spread());
    expect(plan.baseAssetId).toBe("/clean.png");
    expect(plan.foreground.map((element) => element.id)).toEqual(["character"]);
    expect(fallbackRenderComplete(["base", "character"], new Set(["base", "character"]), false)).toBe(true);
    expect(fallbackRenderComplete(["base", "character"], new Set(["base"]), false)).toBe(false);
    expect(fallbackRenderComplete(["base", "character"], new Set(["old-base", "old-character"]), false)).toBe(false);
    expect(fallbackRenderComplete(["base", "character"], new Set(["base", "character"]), true)).toBe(false);
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

  it("keeps renderer resources inside the current three-spread window", () => {
    expect(spreadResourceIndexes(0, 12, false)).toEqual([0]);
    expect(spreadResourceIndexes(0, 12, true)).toEqual([0, 1]);
    expect(spreadResourceIndexes(6, 12, true)).toEqual([5, 6, 7]);
    expect(spreadResourceIndexes(11, 12, true)).toEqual([10, 11]);
  });

  it("rejects retired async callbacks after an element leaves and re-enters the resource window", () => {
    const retiredAttempt = Symbol("retired");
    const currentAttempt = Symbol("current");
    const desired = new Set(["character"]);
    const active = new Map([["character", currentAttempt]]);

    expect(resourceAttemptIsCurrent("character", desired, retiredAttempt, active)).toBe(false);
    expect(resourceAttemptIsCurrent("character", desired, currentAttempt, active)).toBe(true);
    desired.clear();
    expect(resourceAttemptIsCurrent("character", desired, currentAttempt, active)).toBe(false);
  });

  it("does not demote the current scene when a retired renderer reports its own failure", () => {
    const currentReadiness = { backward: true, forward: true };
    const afterRetiredFailure = sceneFailureMatches("scene-b", "scene-a")
      ? { backward: false, forward: false }
      : currentReadiness;
    expect(afterRetiredFailure).toBe(currentReadiness);
    expect(sceneFailureMatches("scene-b", "scene-a")).toBe(false);
    expect(sceneFailureMatches("scene-b", "scene-b")).toBe(true);
    expect(sceneFailureMatches(null, "scene-a")).toBe(false);
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

  it("rebuilds the reader scene when the effective cover changes", () => {
    const snapshot = {
      document: {
        id: "book-one",
        revision: 4,
        title: "Book one",
        coverAssetId: "asset:12345678-1234-4234-8234-123456789abc",
        spreads: [spread()],
      },
      session: {
        currentSpreadIndex: 0,
        selectionId: null,
        sceneThemeId: "paper-atelier" as const,
        preview: false,
        quality: "balanced" as const,
      },
      lastAction: null,
    };
    const before = readerSceneStructureKey(snapshot, "reader");
    const after = readerSceneStructureKey({
      ...snapshot,
      document: {
        ...snapshot.document,
        revision: 5,
        coverAssetId: "asset:22345678-1234-4234-8234-123456789abc",
      },
    }, "reader");
    expect(after).not.toBe(before);
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
      documentId: "book-one",
      revision: 4,
      assetId: "asset:12345678-1234-4234-8234-123456789abc",
      url: "blob:cover",
      renderElement: {
        isConnected: true,
        complete: true,
        naturalWidth: 800,
        getBoundingClientRect: () => rect(40),
      },
    };
    const target = {
      documentId: cover.documentId,
      revision: cover.revision,
      assetId: cover.assetId,
      url: cover.url,
    };

    expect(shelfCoverMatches(cover, target, viewport)).toBe(true);
    expect(shelfCoverMatches(cover, { ...target, assetId: "asset:22345678-1234-4234-8234-123456789abc" }, viewport)).toBe(false);
    expect(shelfCoverMatches(cover, { ...target, revision: 5 }, viewport)).toBe(false);
    expect(shelfCoverMatches({ ...cover, renderElement: { ...cover.renderElement, isConnected: false } }, target, viewport)).toBe(false);
    expect(shelfCoverMatches({ ...cover, renderElement: { ...cover.renderElement, complete: false } }, target, viewport)).toBe(false);
    expect(shelfCoverMatches({ ...cover, renderElement: { ...cover.renderElement, naturalWidth: 0 } }, target, viewport)).toBe(false);
    expect(shelfCoverMatches({ ...cover, renderElement: { ...cover.renderElement, getBoundingClientRect: () => rect(900) } }, target, viewport)).toBe(false);
  });
});
