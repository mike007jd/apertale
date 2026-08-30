import { afterEach, describe, expect, it, vi } from "vitest";
import { getStoredAssetBlob, isStoredAssetId, storeLocalImages } from "./assetStore";

const imageOptimizer = vi.hoisted(() => ({ optimizeImportedImage: vi.fn() }));

vi.mock("./imageOptimizer", () => ({
  MAX_SOURCE_IMAGE_BYTES: 12_000_000,
  optimizeImportedImage: imageOptimizer.optimizeImportedImage,
}));

function installAssetDatabase() {
  const records = new Map<string, unknown>();
  const database = {
    objectStoreNames: { contains: () => true },
    transaction: () => {
      const transaction: Record<string, unknown> = {};
      transaction.objectStore = () => ({
        put: (value: { id: string }) => {
          const request: Record<string, unknown> = {};
          queueMicrotask(() => {
            records.set(value.id, value);
            (request.onsuccess as (() => void) | undefined)?.();
            (transaction.oncomplete as (() => void) | undefined)?.();
          });
          return request;
        },
      });
      transaction.error = null;
      return transaction;
    },
    close: () => undefined,
  };
  vi.stubGlobal("indexedDB", {
    open: () => {
      const request: Record<string, unknown> = {};
      queueMicrotask(() => {
        request.result = database;
        (request.onsuccess as (() => void) | undefined)?.();
      });
      return request;
    },
  });
  return records;
}

afterEach(() => {
  vi.unstubAllGlobals();
  imageOptimizer.optimizeImportedImage.mockReset();
});

describe("asset store blob access", () => {
  it("treats bundled and procedural references as non-local without opening IndexedDB", async () => {
    expect(isStoredAssetId("/assets/covers/atlas-of-living-wonders-v2.png")).toBe(false);
    expect(isStoredAssetId("procedural:hotspot:amber")).toBe(false);
    await expect(getStoredAssetBlob("/assets/covers/atlas-of-living-wonders-v2.png")).resolves.toBeNull();
    await expect(getStoredAssetBlob("procedural:hotspot:amber")).resolves.toBeNull();
  });

  it("recognizes only persisted UUID asset ids", () => {
    expect(isStoredAssetId("asset:12345678-1234-4234-8234-123456789abc")).toBe(true);
    expect(isStoredAssetId("asset:harbor-dawn")).toBe(false);
    expect(isStoredAssetId("asset:12345678-1234-1234-1234-123456789abc")).toBe(false);
  });

  it("isolates rejected files and stores later valid images with metadata", async () => {
    const records = installAssetDatabase();
    const invalid = { name: "notes.txt", type: "text/plain", size: 20 } as File;
    const valid = { name: "cover.png", type: "image/png", size: 400 } as File;
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    imageOptimizer.optimizeImportedImage.mockResolvedValue({
      blob,
      name: "cover.png",
      width: 640,
      height: 960,
      originalSize: 400,
      optimized: false,
    });

    const result = await storeLocalImages([invalid, valid], 1);

    expect(result).toMatchObject({ rejected: 1, failed: 0 });
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({
      id: expect.stringMatching(/^asset:[0-9a-f-]{36}$/),
      name: "cover.png",
      type: "image/png",
      size: blob.size,
      originalSize: 400,
      width: 640,
      height: 960,
      optimized: false,
    });
    expect(records.has(result.assets[0].id)).toBe(true);
  });

  it("bounds costly processing failures by the finite import capacity", async () => {
    const broken = [1, 2, 3].map((index) => ({
      name: `broken-${index}.png`,
      type: "image/png",
      size: 400,
    } as File));
    imageOptimizer.optimizeImportedImage.mockRejectedValue(new Error("decode failed"));

    await expect(storeLocalImages(broken, 1)).resolves.toEqual({
      assets: [],
      rejected: 2,
      failed: 1,
    });
    expect(imageOptimizer.optimizeImportedImage).toHaveBeenCalledTimes(1);
  });

  it("counts every valid file beyond the finite import capacity as rejected", async () => {
    installAssetDatabase();
    const selected = [1, 2, 3].map((index) => ({
      name: `spread-${index}.png`,
      type: "image/png",
      size: 400,
    } as File));
    imageOptimizer.optimizeImportedImage.mockImplementation(async (file: File) => ({
      blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
      name: file.name,
      width: 1_536,
      height: 947,
      originalSize: file.size,
      optimized: false,
    }));

    const result = await storeLocalImages(selected, 2);

    expect(result).toMatchObject({ rejected: 1, failed: 0 });
    expect(result.assets).toHaveLength(2);
    expect(imageOptimizer.optimizeImportedImage).toHaveBeenCalledTimes(2);
  });
});
