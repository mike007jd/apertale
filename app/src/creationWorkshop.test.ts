import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INITIAL_CREATION_WORKSHOP,
  MAX_WORKSHOP_ASSETS,
  buildCreationWorkshopBrief,
  readCreationWorkshopAssetOrder,
  reduceCreationWorkshop,
  restoreCreationWorkshopAssets,
  type WorkshopAsset,
} from "./creationWorkshop";

const assetStore = vi.hoisted(() => ({
  getAssetMetadata: vi.fn(),
  resolveAssetUrl: vi.fn(),
}));

vi.mock("./assetStore", async (importOriginal) => {
  const original = await importOriginal<typeof import("./assetStore")>();
  return {
    ...original,
    getAssetMetadata: assetStore.getAssetMetadata,
    resolveAssetUrl: assetStore.resolveAssetUrl,
  };
});

const id = (index: number) => `asset:12345678-1234-4234-8234-${index.toString(16).padStart(12, "0")}`;
const workshopAsset = (index: number): WorkshopAsset => ({ id: id(index), name: `Photo ${index}.png`, url: `blob:${index}` });

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  assetStore.getAssetMetadata.mockReset();
  assetStore.resolveAssetUrl.mockReset();
});

describe("creation workshop session", () => {
  it("restores unique persisted assets in the user's saved order", async () => {
    sessionStorage.setItem("apertale:workshop-asset-order:v1", JSON.stringify([id(2), "asset:invalid", id(1), id(2)]));
    assetStore.getAssetMetadata.mockResolvedValue([
      { id: id(1), name: "First.png" },
      { id: id(2), name: "Second.png" },
    ]);
    assetStore.resolveAssetUrl.mockImplementation(async (assetId: string) => `blob:${assetId}`);

    expect(readCreationWorkshopAssetOrder()).toEqual([id(2), id(1)]);
    await expect(restoreCreationWorkshopAssets()).resolves.toEqual([
      { id: id(2), name: "Second.png", url: `blob:${id(2)}` },
      { id: id(1), name: "First.png", url: `blob:${id(1)}` },
    ]);
  });

  it("keeps asset order, enforces capacity, and changes idea mode to both after import", () => {
    const incoming = Array.from({ length: MAX_WORKSHOP_ASSETS + 2 }, (_, index) => workshopAsset(index + 1));
    let state = reduceCreationWorkshop(INITIAL_CREATION_WORKSHOP, { type: "append-assets", assets: incoming });
    expect(state.mode).toBe("both");
    expect(state.assets).toHaveLength(MAX_WORKSHOP_ASSETS);

    state = reduceCreationWorkshop(state, { type: "move-asset", index: 1, direction: -1 });
    expect(state.assets.slice(0, 2).map((asset) => asset.id)).toEqual([id(2), id(1)]);
    state = reduceCreationWorkshop(state, { type: "remove-asset", assetId: id(2) });
    expect(state.assets.some((asset) => asset.id === id(2))).toBe(false);
  });

  it("keeps selected photos while idea mode excludes them from the generated brief", () => {
    const withPhotos = reduceCreationWorkshop(INITIAL_CREATION_WORKSHOP, {
      type: "append-assets",
      assets: [workshopAsset(1), workshopAsset(2)],
    });
    const photosBrief = buildCreationWorkshopBrief(withPhotos);
    expect(photosBrief.sourceAssets.map((asset) => asset.id)).toEqual([id(1), id(2)]);

    const ideaOnly = reduceCreationWorkshop(withPhotos, { type: "set-mode", mode: "idea" });
    expect(ideaOnly.assets).toHaveLength(2);
    expect(buildCreationWorkshopBrief(ideaOnly).sourceAssets).toEqual([]);
  });

  it("maps the user's explicit photo treatment to one consistent book contract", () => {
    const withPhoto = reduceCreationWorkshop(INITIAL_CREATION_WORKSHOP, {
      type: "append-assets",
      assets: [workshopAsset(1)],
    });
    const illustrated = buildCreationWorkshopBrief(reduceCreationWorkshop(withPhoto, {
      type: "set-photo-use",
      photoUse: "illustrated-keepsake",
    }));
    expect(illustrated.prompt).toContain("Book type: photo-led-keepsake");
    expect(illustrated.prompt).toContain("generated full-spread count 6");

    const preserved = buildCreationWorkshopBrief(reduceCreationWorkshop(withPhoto, {
      type: "set-photo-use",
      photoUse: "preserve-originals",
    }));
    expect(preserved.prompt).toContain("Book type: preserved-photo-album");
    expect(preserved.prompt).toContain("generated full-spread count 0");
    expect(preserved.prompt).toContain("preserved original-photo layout count 6");
    expect(preserved.prompt).not.toContain("purpose-built full-spread artwork for every spread");
  });

  it("keeps restored order when a new import reaches the reducer first", () => {
    const importedFirst = reduceCreationWorkshop(INITIAL_CREATION_WORKSHOP, {
      type: "append-assets",
      assets: [workshopAsset(3)],
    });
    const restored = reduceCreationWorkshop(importedFirst, {
      type: "restore-assets",
      assets: [workshopAsset(1), workshopAsset(2)],
    });

    expect(restored.assets.map((asset) => asset.id)).toEqual([id(1), id(2), id(3)]);
  });

  it("treats stored workshop photos as verified sources instead of asking for Image handoff", () => {
    const withPhotos = reduceCreationWorkshop(INITIAL_CREATION_WORKSHOP, {
      type: "append-assets",
      assets: [workshopAsset(1), workshopAsset(2)],
    });
    const brief = buildCreationWorkshopBrief(reduceCreationWorkshop(withPhotos, {
      type: "set-photo-use",
      photoUse: "illustrated-keepsake",
    }));

    expect(brief.readiness.blockingMissingFields.some((blocker) => blocker.reason.includes("has not verified"))).toBe(false);
    expect(brief.readiness.questions).not.toContain(
      "Please use Image handoff for the missing photos, then ask me to check readiness again.",
    );
    // Premise and audience still belong to the Agent conversation.
    expect(brief.readiness.questions).toEqual(expect.arrayContaining([
      expect.stringContaining("What is the book about"),
      expect.stringContaining("Who is this book for?"),
    ]));
  });
});
