import { describe, expect, it } from "vitest";
import { listProjectAssetReferences, listStoredPublishedAssetIds } from "./projectArtifact";
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
          personalSourceAssetId: "asset:personal-source",
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
      { assetId: "asset:personal-source", location: { kind: "spread", spreadId: "opening", field: "personalSourceAssetId" } },
      { assetId: "asset:subject", location: { kind: "element", spreadId: "opening", elementId: "subject", field: "assetId" } },
      { assetId: "asset:frame-1", location: { kind: "element", spreadId: "opening", elementId: "subject", field: "frameAssetId", frameIndex: 0 } },
      { assetId: "asset:frame-2", location: { kind: "element", spreadId: "opening", elementId: "subject", field: "frameAssetId", frameIndex: 1 } },
    ]);
  });

  it("keeps author-side source provenance out of the published asset plan", () => {
    const local = (serial: number) => `asset:12345678-1234-4234-8234-${String(serial).padStart(12, "0")}`;
    const documentState: DocumentState = {
      id: "private-source-fixture",
      revision: 1,
      title: "Private source fixture",
      coverAssetId: local(1),
      coverTextureUrl: local(6),
      spreads: [{
        id: "opening",
        order: 0,
        title: "Opening",
        body: "Only rendered assets leave the authoring project.",
        textureUrl: local(7),
        artwork: {
          cleanPlateAssetId: local(2),
          sourceAssetId: local(3),
          personalSourceAssetId: local(4),
          separation: "inpainted-clean-plate",
        },
        elements: [{
          id: "subject",
          label: "Subject",
          kind: "lifted",
          assetId: local(5),
          page: "right",
          transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          depth: 0.1,
          locked: false,
          provenance: "agent",
        }],
      }],
    };

    expect(listStoredPublishedAssetIds(documentState)).toEqual([local(1), local(2), local(5)]);
  });

  it("never uploads image frames attached to or mixed with procedural markers", () => {
    const local = (serial: number) => `asset:12345678-1234-4234-8234-${String(serial).padStart(12, "0")}`;
    const documentState: DocumentState = {
      id: "procedural-frame-fixture",
      revision: 1,
      title: "Procedural frame fixture",
      coverAssetId: local(1),
      spreads: [{
        id: "opening",
        order: 0,
        title: "Opening",
        body: "Malformed legacy sequences fail closed in the upload plan.",
        artwork: {
          cleanPlateAssetId: local(2),
          sourceAssetId: local(3),
          separation: "inpainted-clean-plate",
        },
        elements: [{
          id: "marker",
          label: "Marker",
          kind: "decoration",
          assetId: "procedural:hotspot:amber",
          frameAssetIds: ["procedural:hotspot:amber", local(4)],
          page: "left",
          transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          depth: 0.1,
          locked: false,
          provenance: "agent",
        }, {
          id: "subject",
          label: "Subject",
          kind: "lifted",
          assetId: local(5),
          frameAssetIds: [local(5), "procedural:hotspot:aqua", local(6)],
          page: "right",
          transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          depth: 0.1,
          locked: false,
          provenance: "agent",
        }],
      }],
    };

    expect(listStoredPublishedAssetIds(documentState)).toEqual([local(1), local(2), local(5)]);
  });
});
