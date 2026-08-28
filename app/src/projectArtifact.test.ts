import { describe, expect, it } from "vitest";
import { listProjectAssetReferences, listStoredProjectAssetIds } from "./projectArtifact";
import type { DocumentState } from "./types";

describe("Project artifact asset traversal", () => {
  it("reports every cover, spread, artwork, element, and frame location", () => {
    const documentState: DocumentState = {
      id: "artifact-fixture",
      revision: 1,
      title: "Artifact fixture",
      coverAssetId: "asset:cover",
      coverTextureUrl: "/assets/cover.png",
      spreads: [{
        id: "opening",
        order: 0,
        textureUrl: "asset:texture",
        artwork: {
          cleanPlateAssetId: "asset:clean",
          sourceAssetId: "asset:source",
          separation: "inpainted-clean-plate",
        },
        title: "Opening",
        body: "A complete traversal fixture.",
        elements: [{
          id: "subject",
          label: "Subject",
          kind: "lifted",
          assetId: "asset:subject",
          frameAssetIds: ["asset:frame-1", "asset:frame-2"],
          page: "right",
          transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          depth: 0.1,
          locked: false,
          provenance: "human",
        }],
      }],
    };

    expect(listProjectAssetReferences(documentState)).toEqual([
      { assetId: "asset:cover", location: { kind: "cover", field: "coverAssetId" } },
      { assetId: "/assets/cover.png", location: { kind: "cover", field: "coverTextureUrl" } },
      { assetId: "asset:texture", location: { kind: "spread", spreadId: "opening", field: "textureUrl" } },
      { assetId: "asset:clean", location: { kind: "spread", spreadId: "opening", field: "cleanPlateAssetId" } },
      { assetId: "asset:source", location: { kind: "spread", spreadId: "opening", field: "sourceAssetId" } },
      { assetId: "asset:subject", location: { kind: "element", spreadId: "opening", elementId: "subject", field: "assetId" } },
      { assetId: "asset:frame-1", location: { kind: "element", spreadId: "opening", elementId: "subject", field: "frameAssetId", frameIndex: 0 } },
      { assetId: "asset:frame-2", location: { kind: "element", spreadId: "opening", elementId: "subject", field: "frameAssetId", frameIndex: 1 } },
    ]);
  });

  it("deduplicates only browser-local references through the Asset registry", () => {
    const localAssetId = "asset:12345678-1234-4234-8234-123456789abc";
    const documentState: DocumentState = {
      id: "local-reference-fixture",
      revision: 1,
      title: "Local reference fixture",
      coverAssetId: localAssetId,
      coverTextureUrl: localAssetId,
      spreads: [{
        id: "opening",
        order: 0,
        textureUrl: "/assets/generated/opening.png",
        title: "Opening",
        body: "",
        elements: [{
          id: "marker",
          label: "Marker",
          kind: "decoration",
          assetId: "procedural:hotspot:amber",
          page: "right",
          transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          depth: 0.1,
          locked: false,
          provenance: "sample",
        }],
      }],
    };

    expect(listStoredProjectAssetIds(documentState)).toEqual([localAssetId]);
  });
});
