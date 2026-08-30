import { describe, expect, it } from "vitest";
import type { StoredAssetMetadata } from "./assetStore";
import { bookAssetReferenceFindings, bookAssetReferenceIssueKey, bookAssetReferenceIssues, documentAssetRoleIssues, preparedBookAssetIssues } from "./bookAssetContract";
import { spreadArtworkFit } from "./types";

const alpha = {
  version: 1 as const,
  hasTransparency: true,
  hasMeaningfulAlpha: true,
  transparentPixelRatio: 0.55,
  transparentBorderRatio: 1,
  visiblePixelRatio: 0.45,
};

const asset = (
  id: string,
  width: number,
  height: number,
  options: {
    type?: string;
    meaningfulAlpha?: boolean;
    sourceWidth?: number;
    sourceHeight?: number;
    assetUse?: StoredAssetMetadata["assetUse"];
  } = {},
): StoredAssetMetadata => ({
  id,
  name: `${id}.png`,
  type: options.type ?? "image/png",
  size: 1,
  width,
  height,
  sourceWidth: options.sourceWidth ?? width,
  sourceHeight: options.sourceHeight ?? height,
  analysis: { ...alpha, hasMeaningfulAlpha: options.meaningfulAlpha ?? true },
  assetUse: options.assetUse ?? "book-art",
  createdAt: "2026-08-30T00:00:00.000Z",
});

const layer = (id: string, assetId = id) => ({ id, label: id, assetId, page: "left" as const, hover: "lift-glow" as const });

describe("prepared book asset admission", () => {
  it("contains source-true photo layouts while generated artwork fills the stage", () => {
    expect(spreadArtworkFit({ artwork: {
      sourceAssetId: "source",
      cleanPlateAssetId: "source",
      separation: "preserved-photo-layout",
    } })).toBe("contain");
    expect(spreadArtworkFit({ artwork: {
      sourceAssetId: "source",
      cleanPlateAssetId: "clean",
      separation: "inpainted-clean-plate",
    } })).toBe("cover");
  });

  it("accepts sample-shaped portrait, full-spread, and native-alpha assets", () => {
    const metadata = [
      asset("cover", 768, 1152, { type: "image/jpeg", meaningfulAlpha: false }),
      asset("source", 1536, 947, { type: "image/jpeg", meaningfulAlpha: false }),
      asset("clean", 1536, 947, { type: "image/jpeg", meaningfulAlpha: false }),
      asset("left", 600, 900),
      asset("right", 700, 800),
    ];

    expect(preparedBookAssetIssues({
      coverAssetId: "cover",
      spreads: [{
        background: { sourceAssetId: "source", cleanPlateAssetId: "clean", separation: "inpainted-clean-plate" },
        layers: [layer("left"), layer("right")],
      }],
    }, metadata)).toEqual([]);
  });

  it("keeps trusted source photos out of cover and generated-art roles", () => {
    const metadata = [
      asset("cover", 768, 1152, { type: "image/jpeg", meaningfulAlpha: false, assetUse: "source-photo" }),
      asset("source", 1536, 947, { type: "image/jpeg", meaningfulAlpha: false }),
      asset("clean", 1536, 947, { type: "image/jpeg", meaningfulAlpha: false }),
      asset("left", 600, 900),
      asset("right", 700, 800),
    ];

    expect(preparedBookAssetIssues({
      coverAssetId: "cover",
      spreads: [{
        background: { sourceAssetId: "source", cleanPlateAssetId: "clean", separation: "inpainted-clean-plate" },
        layers: [layer("left"), layer("right")],
      }],
    }, metadata)).toContain("The dedicated cover was imported as source-photo and cannot be used in this book-art role.");
  });

  it("revalidates legacy document roles before quality review", () => {
    const metadata = [
      asset("cover", 768, 1152, { type: "image/jpeg", meaningfulAlpha: false }),
      asset("source", 1536, 947, { type: "image/jpeg", meaningfulAlpha: false }),
      asset("clean", 1536, 947, { type: "image/jpeg", meaningfulAlpha: false }),
      asset("private-photo", 600, 900, { assetUse: "source-photo" }),
    ];
    const document = {
      id: "legacy-role-book",
      revision: 4,
      title: "Legacy Role Book",
      coverAssetId: "cover",
      spreads: [{
        id: "opening",
        order: 0,
        title: "Opening",
        body: "A legacy source photo must not become a reader cutout.",
        artwork: { sourceAssetId: "source", cleanPlateAssetId: "clean", separation: "inpainted-clean-plate" as const },
        elements: [{
          id: "subject",
          label: "Subject",
          kind: "lifted" as const,
          assetId: "private-photo",
          page: "right" as const,
          transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          depth: 0.1,
          locked: false,
          provenance: "agent" as const,
        }],
      }],
    };

    expect(documentAssetRoleIssues(document, metadata)).toContain(
      "Spread 1 Subject was imported as source-photo and cannot be used in this book-art role.",
    );
  });

  it("keeps bundled sample art outside browser-local metadata enforcement", () => {
    const document = {
      id: "bundled-sample",
      revision: 1,
      title: "Bundled Sample",
      coverTextureUrl: "/assets/sample-cover.jpg",
      spreads: [{
        id: "opening",
        order: 0,
        title: "Opening",
        body: "Bundled art is shipped and reviewed with the application.",
        artwork: {
          sourceAssetId: "/assets/sample-composite.jpg",
          cleanPlateAssetId: "/assets/sample-clean.jpg",
          separation: "inpainted-clean-plate" as const,
        },
        elements: [{
          id: "subject",
          label: "Subject",
          kind: "lifted" as const,
          assetId: "/assets/sample-subject.png",
          page: "right" as const,
          transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          depth: 0.1,
          locked: false,
          provenance: "agent" as const,
        }],
      }],
    };

    expect(documentAssetRoleIssues(document, [])).toEqual([]);
  });

  it("allows a declared source photo to render only as a preserved-photo layout", () => {
    const metadata = [
      asset("cover", 768, 1152, { type: "image/jpeg", meaningfulAlpha: false }),
      asset("personal", 1536, 947, { type: "image/jpeg", meaningfulAlpha: false, assetUse: "source-photo" }),
      asset("left", 600, 900),
      asset("right", 700, 800),
    ];

    expect(preparedBookAssetIssues({
      coverAssetId: "cover",
      spreads: [{
        background: {
          sourceAssetId: "personal",
          cleanPlateAssetId: "personal",
          personalSourceAssetId: "personal",
          separation: "preserved-photo-layout",
        },
        layers: [layer("left"), layer("right")],
      }],
    }, metadata, ["personal"])).toEqual([]);
  });

  it("compares original canvases rather than independently optimized blob sizes", () => {
    const metadata = [
      asset("cover", 768, 1152, { type: "image/jpeg", meaningfulAlpha: false }),
      asset("source", 2048, 1024, { type: "image/jpeg", meaningfulAlpha: false, sourceWidth: 4096, sourceHeight: 2048 }),
      asset("clean", 1664, 832, { type: "image/jpeg", meaningfulAlpha: false, sourceWidth: 4096, sourceHeight: 2048 }),
      asset("left", 600, 900),
      asset("right", 700, 800),
    ];
    const manifest = {
      coverAssetId: "cover",
      spreads: [{
        background: { sourceAssetId: "source", cleanPlateAssetId: "clean", separation: "inpainted-clean-plate" as const },
        layers: [layer("left"), layer("right")],
      }],
    };

    expect(preparedBookAssetIssues(manifest, metadata)).toEqual([]);
    metadata.find((item) => item.id === "clean")!.sourceWidth = 2048;
    metadata.find((item) => item.id === "clean")!.sourceHeight = 1024;
    expect(preparedBookAssetIssues(manifest, metadata)).toContain(
      "Spread 1 original composite and final base must use the same original canvas size.",
    );
  });

  it("fails closed when legacy optimized assets cannot prove their original canvases", () => {
    const metadata = [
      asset("cover", 768, 1152, { type: "image/jpeg", meaningfulAlpha: false }),
      { ...asset("source", 1536, 947, { type: "image/jpeg", meaningfulAlpha: false }), sourceWidth: undefined, sourceHeight: undefined, optimized: true },
      { ...asset("clean", 1536, 947, { type: "image/jpeg", meaningfulAlpha: false }), sourceWidth: undefined, sourceHeight: undefined, optimized: true },
      asset("left", 600, 900),
      asset("right", 700, 800),
    ];

    expect(preparedBookAssetIssues({
      coverAssetId: "cover",
      spreads: [{
        background: { sourceAssetId: "source", cleanPlateAssetId: "clean", separation: "inpainted-clean-plate" },
        layers: [layer("left"), layer("right")],
      }],
    }, metadata)).toContain(
      "Spread 1 original composite and final base need verified original canvas dimensions; re-import both images before continuing.",
    );
  });

  it("treats a frame sequence as one layer and allows repeated timing frames", () => {
    const metadata = [
      asset("cover", 768, 1152, { type: "image/jpeg", meaningfulAlpha: false }),
      asset("source", 1536, 947, { type: "image/jpeg", meaningfulAlpha: false }),
      asset("clean", 1536, 947, { type: "image/jpeg", meaningfulAlpha: false }),
      asset("rest", 600, 900),
      asset("flash", 600, 900),
      asset("companion", 700, 800),
    ];

    expect(preparedBookAssetIssues({
      coverAssetId: "cover",
      spreads: [{
        background: { sourceAssetId: "source", cleanPlateAssetId: "clean", separation: "inpainted-clean-plate" },
        layers: [
          { ...layer("sequence", "rest"), frameAssetIds: ["rest", "flash", "rest"] },
          layer("companion"),
        ],
      }],
    }, metadata)).toEqual([]);
  });

  it("requires assetId to name the resting frame and keeps frame assets private to one layer", () => {
    const issues = bookAssetReferenceIssues({
      coverAssetId: "cover",
      spreads: [{
        background: { sourceAssetId: "source", cleanPlateAssetId: "clean", separation: "inpainted-clean-plate" },
        layers: [
          { assetId: "unused-rest", frameAssetIds: ["actual-rest", "flash"] },
          { assetId: "actual-rest" },
        ],
      }],
    });

    expect(issues).toEqual(expect.arrayContaining([
      expect.stringMatching(/resting frame as assetId/i),
      expect.stringMatching(/distinct final assets/i),
    ]));
  });

  it("keys resting-frame violations by the actual invalid tuple, not their display text", () => {
    const finding = (assetId: string, firstFrameAssetId: string) => bookAssetReferenceFindings({
      spreads: [{ layers: [{ assetId, frameAssetIds: [firstFrameAssetId, "flash"] }] }],
    })[0];

    expect(bookAssetReferenceIssueKey(finding("rest-a", "wrong-a")))
      .not.toBe(bookAssetReferenceIssueKey(finding("rest-b", "wrong-b")));
  });

  it("rejects wrong roles, repeated finals, and opaque cutouts", () => {
    const metadata = [
      asset("cover", 1024, 1024, { type: "image/jpeg", meaningfulAlpha: false }),
      asset("shared-base", 1536, 947, { type: "image/jpeg", meaningfulAlpha: false }),
      asset("opaque-layer", 600, 900, { type: "image/jpeg", meaningfulAlpha: false }),
    ];
    const spreads = [1, 2].map((index) => ({
      background: {
        sourceAssetId: "shared-base",
        cleanPlateAssetId: "shared-base",
        separation: "inpainted-clean-plate" as const,
      },
      layers: [layer(`layer-${index}-a`, "opaque-layer"), layer(`layer-${index}-b`, "opaque-layer")],
    }));

    const issues = preparedBookAssetIssues({ coverAssetId: "cover", spreads }, metadata);

    expect(issues).toEqual(expect.arrayContaining([
      expect.stringMatching(/portrait image/i),
      expect.stringMatching(/separate from its final clean plate/i),
      expect.stringMatching(/purpose-built background/i),
      expect.stringMatching(/native-alpha PNG or WebP/i),
      expect.stringMatching(/genuine transparent padding/i),
      expect.stringMatching(/distinct final assets/i),
    ]));
  });

  it("keeps cover, background, and foreground identities disjoint across the whole book", () => {
    const issues = bookAssetReferenceIssues({
      coverAssetId: "cover",
      spreads: [{
        background: { sourceAssetId: "source-a", cleanPlateAssetId: "clean-a", separation: "inpainted-clean-plate" },
        layers: [{ assetId: "subject" }, { assetId: "clean-b" }],
      }, {
        background: { sourceAssetId: "source-b", cleanPlateAssetId: "clean-b", separation: "inpainted-clean-plate" },
        layers: [{ assetId: "subject" }, { assetId: "cover" }],
      }],
    });

    expect(issues).toEqual(expect.arrayContaining([
      expect.stringMatching(/background asset clean-b as a foreground/i),
      expect.stringMatching(/reuse its cover as a foreground/i),
    ]));
  });

  it("does not charge private source composites against the publishing asset limit", () => {
    const metadata: StoredAssetMetadata[] = [asset("cover", 768, 1152, { type: "image/jpeg", meaningfulAlpha: false })];
    const spreads = Array.from({ length: 12 }, (_, spreadIndex) => {
      const sourceAssetId = `source-${spreadIndex}`;
      const cleanPlateAssetId = `clean-${spreadIndex}`;
      metadata.push(
        asset(sourceAssetId, 1774, 887, { type: "image/jpeg", meaningfulAlpha: false }),
        asset(cleanPlateAssetId, 1536, 947, {
          type: "image/jpeg",
          meaningfulAlpha: false,
          sourceWidth: 1774,
          sourceHeight: 887,
        }),
      );
      const layers = Array.from({ length: 3 }, (_, layerIndex) => {
        const id = `layer-${spreadIndex}-${layerIndex}`;
        metadata.push(asset(id, 600, 900));
        return layer(id);
      });
      return {
        background: { sourceAssetId, cleanPlateAssetId, separation: "inpainted-clean-plate" as const },
        layers,
      };
    });

    expect(preparedBookAssetIssues({ coverAssetId: "cover", spreads }, metadata))
      .not.toContain(expect.stringMatching(/publishable limit/i));
  });

  it("still rejects more than 50 reader-rendered assets", () => {
    const metadata: StoredAssetMetadata[] = [asset("cover", 768, 1152, { type: "image/jpeg", meaningfulAlpha: false })];
    const spreads = Array.from({ length: 12 }, (_, spreadIndex) => {
      const sourceAssetId = `source-${spreadIndex}`;
      const cleanPlateAssetId = `clean-${spreadIndex}`;
      metadata.push(
        asset(sourceAssetId, 1774, 887, { type: "image/jpeg", meaningfulAlpha: false }),
        asset(cleanPlateAssetId, 1536, 947, {
          type: "image/jpeg",
          meaningfulAlpha: false,
          sourceWidth: 1774,
          sourceHeight: 887,
        }),
      );
      const layers = Array.from({ length: 4 }, (_, layerIndex) => {
        const id = `layer-${spreadIndex}-${layerIndex}`;
        metadata.push(asset(id, 600, 900));
        return layer(id);
      });
      return {
        background: { sourceAssetId, cleanPlateAssetId, separation: "inpainted-clean-plate" as const },
        layers,
      };
    });

    expect(preparedBookAssetIssues({ coverAssetId: "cover", spreads }, metadata))
      .toContain("The finished book references 61 local images, above the publishable limit of 50.");
  });
});
