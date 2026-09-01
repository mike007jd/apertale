import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INITIAL_CREATION_WORKSHOP,
  MAX_WORKSHOP_ASSETS,
  admitWorkshopAssets,
  buildCreationWorkshopBrief,
  readCreationWorkshopAssetOrder,
  reduceCreationWorkshop,
  restoreCreationWorkshopAssets,
  type WorkshopAsset,
} from "./creationWorkshop";

const assetStore = vi.hoisted(() => ({
  acquireAssetUrl: vi.fn(),
  getAssetMetadata: vi.fn(),
}));

vi.mock("./assetStore", async (importOriginal) => {
  const original = await importOriginal<typeof import("./assetStore")>();
  return {
    ...original,
    acquireAssetUrl: assetStore.acquireAssetUrl,
    getAssetMetadata: assetStore.getAssetMetadata,
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
  assetStore.acquireAssetUrl.mockReset();
  assetStore.getAssetMetadata.mockReset();
});

describe("creation workshop session", () => {
  it("restores unique persisted assets in the user's saved order", async () => {
    sessionStorage.setItem("apertale:workshop-asset-order:v1", JSON.stringify([id(2), "asset:invalid", id(1), id(2)]));
    assetStore.getAssetMetadata.mockResolvedValue([
      { id: id(1), name: "First.png", assetUse: "source-photo" },
      { id: id(2), name: "Second.png", assetUse: "source-photo" },
    ]);
    assetStore.acquireAssetUrl.mockImplementation(async (assetId: string) => ({ assetId, url: `blob:${assetId}`, release: vi.fn() }));

    expect(readCreationWorkshopAssetOrder()).toEqual([id(2), id(1)]);
    await expect(restoreCreationWorkshopAssets()).resolves.toEqual({
      assets: [
        { id: id(2), name: "Second.png", url: `blob:${id(2)}` },
        { id: id(1), name: "First.png", url: `blob:${id(1)}` },
      ],
      leases: [
        expect.objectContaining({ assetId: id(2), url: `blob:${id(2)}` }),
        expect.objectContaining({ assetId: id(1), url: `blob:${id(1)}` }),
      ],
    });
  });

  it("drops legacy and wrong-role assets instead of certifying them as source photos", async () => {
    sessionStorage.setItem("apertale:workshop-asset-order:v1", JSON.stringify([id(1), id(2), id(3)]));
    assetStore.getAssetMetadata.mockResolvedValue([
      { id: id(1), name: "Legacy.png" },
      { id: id(2), name: "Generated.png", assetUse: "book-art" },
      { id: id(3), name: "Photo.png", assetUse: "source-photo" },
    ]);
    assetStore.acquireAssetUrl.mockImplementation(async (assetId: string) => ({ assetId, url: `blob:${assetId}`, release: vi.fn() }));

    await expect(restoreCreationWorkshopAssets()).resolves.toEqual({
      assets: [{ id: id(3), name: "Photo.png", url: `blob:${id(3)}` }],
      leases: [expect.objectContaining({ assetId: id(3), url: `blob:${id(3)}` })],
    });
    expect(assetStore.acquireAssetUrl).toHaveBeenCalledTimes(1);
  });

  it("keeps the saved order intact when a preview lease fails transiently, then restores on retry", async () => {
    const savedOrder = [id(1), id(2)];
    sessionStorage.setItem("apertale:workshop-asset-order:v1", JSON.stringify(savedOrder));
    assetStore.getAssetMetadata.mockResolvedValue(savedOrder.map((assetId, index) => ({
      id: assetId,
      name: `Saved ${index + 1}.png`,
      assetUse: "source-photo",
    })));
    const firstRelease = vi.fn();
    assetStore.acquireAssetUrl
      .mockResolvedValueOnce({ assetId: id(1), url: "blob:first", release: firstRelease })
      .mockRejectedValueOnce(new Error("transient URL failure"));

    await expect(restoreCreationWorkshopAssets()).rejects.toThrow("could not be restored");
    expect(firstRelease).toHaveBeenCalledOnce();
    expect(readCreationWorkshopAssetOrder()).toEqual(savedOrder);

    assetStore.acquireAssetUrl.mockImplementation(async (assetId: string) => ({
      assetId,
      url: `blob:${assetId}`,
      release: vi.fn(),
    }));
    await expect(restoreCreationWorkshopAssets()).resolves.toMatchObject({
      assets: savedOrder.map((assetId, index) => ({
        id: assetId,
        name: `Saved ${index + 1}.png`,
        url: `blob:${assetId}`,
      })),
    });
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

  it("admits only unique incoming previews that still fit the live strip", () => {
    const current = Array.from({ length: MAX_WORKSHOP_ASSETS - 1 }, (_, index) => workshopAsset(index + 1));
    expect(admitWorkshopAssets(current, [
      workshopAsset(1),
      workshopAsset(MAX_WORKSHOP_ASSETS),
      workshopAsset(MAX_WORKSHOP_ASSETS + 1),
    ])).toEqual([workshopAsset(MAX_WORKSHOP_ASSETS)]);
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

  it("defaults to balanced layers and carries an explicit none choice into the brief", () => {
    expect(INITIAL_CREATION_WORKSHOP.interactionDensity).toBe("balanced");
    const none = reduceCreationWorkshop(INITIAL_CREATION_WORKSHOP, {
      type: "set-interaction-density",
      interactionDensity: "none",
    });
    const prompt = buildCreationWorkshopBrief(none).prompt;
    expect(prompt).toContain("Interactive layer density: none (0 per spread)");
    expect(prompt).toContain("must use an empty layers array");
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

  it("treats stored workshop photos as verified sources instead of asking for a photo handoff", () => {
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
      "Call request_image_handoff for the missing photos, then check readiness again.",
    );
    // Premise and audience still belong to the Agent conversation.
    expect(brief.readiness.questions).toEqual(expect.arrayContaining([
      expect.stringContaining("What is the book about"),
      expect.stringContaining("Who is this book for?"),
    ]));
  });
});
