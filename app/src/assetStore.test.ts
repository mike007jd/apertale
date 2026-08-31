import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireAssetPreviewUrl, acquireAssetUrl, getAssetMetadata, getStoredAssetBlob, isStoredAssetId, listAssetMetadata, releaseAssetUrls, storeLocalImages } from "./assetStore";

const imageOptimizer = vi.hoisted(() => ({ analyzeStoredImage: vi.fn(), optimizeImportedImage: vi.fn() }));

vi.mock("./imageOptimizer", () => ({
  MAX_SOURCE_IMAGE_BYTES: 12_000_000,
  IMAGE_ANALYSIS_VERSION: 1,
  analyzeStoredImage: imageOptimizer.analyzeStoredImage,
  optimizeImportedImage: imageOptimizer.optimizeImportedImage,
}));

const cutoutAnalysis = {
  version: 1 as const,
  hasTransparency: true,
  hasMeaningfulAlpha: true,
  transparentPixelRatio: 0.6,
  transparentBorderRatio: 1,
  visiblePixelRatio: 0.4,
};

function installAssetDatabase(options: { forbidGetAll?: boolean; getGate?: Promise<void> } = {}) {
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
        get: (id: string) => {
          const request: Record<string, unknown> = {};
          void (options.getGate ?? Promise.resolve()).then(() => {
            request.result = records.get(id);
            (request.onsuccess as (() => void) | undefined)?.();
            (transaction.oncomplete as (() => void) | undefined)?.();
          });
          return request;
        },
        getAll: () => {
          if (options.forbidGetAll) throw new Error("getAll must not materialize the blob store");
          const request: Record<string, unknown> = {};
          queueMicrotask(() => {
            request.result = [...records.values()];
            (request.onsuccess as (() => void) | undefined)?.();
            (transaction.oncomplete as (() => void) | undefined)?.();
          });
          return request;
        },
        openCursor: () => {
          const request: Record<string, unknown> = {};
          const values = [...records.values()];
          let index = 0;
          const advance = () => {
            if (index >= values.length) {
              request.result = null;
              (request.onsuccess as (() => void) | undefined)?.();
              (transaction.oncomplete as (() => void) | undefined)?.();
              return;
            }
            const value = values[index];
            index += 1;
            request.result = { value, continue: () => queueMicrotask(advance) };
            (request.onsuccess as (() => void) | undefined)?.();
          };
          queueMicrotask(advance);
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
  releaseAssetUrls();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  imageOptimizer.analyzeStoredImage.mockReset();
  imageOptimizer.optimizeImportedImage.mockReset();
});

describe("asset store blob access", () => {
  it("maps bundled covers to shelf-sized derivatives without opening IndexedDB", async () => {
    const open = vi.fn();
    vi.stubGlobal("indexedDB", { open });

    const lease = await acquireAssetPreviewUrl("/assets/covers/atlas-of-living-wonders-v2.png");

    expect(lease).toMatchObject({
      assetId: "/assets/covers/atlas-of-living-wonders-v2.png",
      url: "/assets/covers/shelf/atlas-of-living-wonders-v2.webp",
    });
    lease.release();
    expect(open).not.toHaveBeenCalled();
  });

  it("single-flights, caches, and releases a shelf preview for a local cover", async () => {
    const records = installAssetDatabase();
    const id = "asset:02345678-1234-4234-8234-123456789abc";
    const source = new Blob([new Uint8Array(32)], { type: "image/png" });
    const preview = new Blob([new Uint8Array(8)], { type: "image/webp" });
    records.set(id, { id, name: "portrait.png", type: source.type, size: source.size, createdAt: "2026-08-31T00:00:00.000Z", blob: source });
    const close = vi.fn();
    const decode = vi.fn().mockResolvedValue({ width: 800, height: 1200, close });
    const drawImage = vi.fn();
    const convertToBlob = vi.fn().mockResolvedValue(preview);
    vi.stubGlobal("createImageBitmap", decode);
    vi.stubGlobal("OffscreenCanvas", class {
      constructor(public width: number, public height: number) {}
      getContext() { return { drawImage }; }
      convertToBlob = convertToBlob;
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:preview-one").mockReturnValueOnce("blob:preview-two");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const [first, second] = await Promise.all([acquireAssetPreviewUrl(id), acquireAssetPreviewUrl(id)]);

    expect(first.url).toBe("blob:preview-one");
    expect(second.url).toBe(first.url);
    expect(decode).toHaveBeenCalledOnce();
    expect(drawImage).toHaveBeenCalledWith(expect.objectContaining({ width: 800, height: 1200 }), 0, 0, 384, 576);
    expect(convertToBlob).toHaveBeenCalledWith({ type: "image/webp", quality: 0.84 });
    expect(close).toHaveBeenCalledOnce();
    expect(records.get(id)).toMatchObject({
      previewBlob: preview,
      previewWidth: 384,
      previewHeight: 576,
      previewVersion: 1,
    });
    first.release();
    expect(revokeObjectUrl).not.toHaveBeenCalled();
    second.release();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:preview-one");

    const cached = await acquireAssetPreviewUrl(id);
    expect(cached.url).toBe("blob:preview-two");
    expect(decode).toHaveBeenCalledOnce();
    cached.release();
  });

  it("falls back to the original local cover when preview encoding is unavailable", async () => {
    const records = installAssetDatabase();
    const id = "asset:12345678-1234-4234-8234-123456789abe";
    const source = new Blob([new Uint8Array(32)], { type: "image/png" });
    records.set(id, { id, name: "fallback.png", type: source.type, size: source.size, createdAt: "2026-08-31T00:00:00.000Z", blob: source });
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("decoder unavailable")));
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:full-cover-fallback");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const lease = await acquireAssetPreviewUrl(id);

    expect(lease.url).toBe("blob:full-cover-fallback");
    expect(createObjectUrl).toHaveBeenCalledWith(source);
    expect(records.get(id)).not.toHaveProperty("previewBlob");
    lease.release();
  });

  it("single-flights concurrent URL leases and revokes after the last release", async () => {
    const records = installAssetDatabase();
    const id = "asset:12345678-1234-4234-8234-123456789abc";
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    records.set(id, { id, name: "cover.png", type: "image/png", size: blob.size, createdAt: "2026-08-31T00:00:00.000Z", blob });
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:shared-cover");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const [first, second] = await Promise.all([acquireAssetUrl(id), acquireAssetUrl(id)]);

    expect(first.url).toBe("blob:shared-cover");
    expect(second.url).toBe(first.url);
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    first.release();
    expect(revokeObjectUrl).not.toHaveBeenCalled();
    second.release();
    expect(revokeObjectUrl).toHaveBeenCalledOnce();
  });

  it("does not let a pending URL acquisition revive a released generation", async () => {
    let releaseGet!: () => void;
    const getGate = new Promise<void>((resolve) => { releaseGet = resolve; });
    const records = installAssetDatabase({ getGate });
    const id = "asset:22345678-1234-4234-8234-123456789abc";
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    records.set(id, { id, name: "late.png", type: "image/png", size: blob.size, createdAt: "2026-08-31T00:00:00.000Z", blob });
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:late");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const pending = acquireAssetUrl(id);
    await Promise.resolve();
    releaseAssetUrls();
    releaseGet();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("does not let an old lease release a replacement generation", async () => {
    const records = installAssetDatabase();
    const id = "asset:32345678-1234-4234-8234-123456789abc";
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    records.set(id, { id, name: "replace.png", type: "image/png", size: blob.size, createdAt: "2026-08-31T00:00:00.000Z", blob });
    vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:old").mockReturnValueOnce("blob:new");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const oldLease = await acquireAssetUrl(id);
    releaseAssetUrls();
    const newLease = await acquireAssetUrl(id);
    oldLease.release();

    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenLastCalledWith("blob:old");
    newLease.release();
    expect(revokeObjectUrl).toHaveBeenLastCalledWith("blob:new");
  });

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
      sourceWidth: 640,
      sourceHeight: 960,
      analysis: cutoutAnalysis,
      originalSize: 400,
      optimized: false,
    });

    const result = await storeLocalImages([invalid, valid], { assetUse: "book-art", limit: 1 });

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
      sourceWidth: 640,
      sourceHeight: 960,
      analysis: cutoutAnalysis,
      optimized: false,
      assetUse: "book-art",
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

    await expect(storeLocalImages(broken, { assetUse: "source-photo", limit: 1 })).resolves.toEqual({
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
      sourceWidth: 1_536,
      sourceHeight: 947,
      analysis: { ...cutoutAnalysis, hasTransparency: false, hasMeaningfulAlpha: false },
      originalSize: file.size,
      optimized: false,
    }));

    const result = await storeLocalImages(selected, { assetUse: "book-art", limit: 2 });

    expect(result).toMatchObject({ rejected: 1, failed: 0 });
    expect(result.assets).toHaveLength(2);
    expect(imageOptimizer.optimizeImportedImage).toHaveBeenCalledTimes(2);
  });

  it("lazily analyzes and caches legacy metadata only for requested assets", async () => {
    const records = installAssetDatabase();
    const id = "asset:12345678-1234-4234-8234-123456789abc";
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    records.set(id, {
      id,
      name: "legacy-cutout.png",
      type: "image/png",
      size: blob.size,
      createdAt: "2026-08-28T00:00:00.000Z",
      blob,
      previewBlob: new Blob([new Uint8Array(1)], { type: "image/webp" }),
      previewWidth: 384,
      previewHeight: 576,
      previewVersion: 1,
    });
    imageOptimizer.analyzeStoredImage.mockResolvedValue({ width: 800, height: 900, analysis: cutoutAnalysis });

    await expect(getAssetMetadata([id])).resolves.toEqual([
      expect.objectContaining({ id, width: 800, height: 900, analysis: cutoutAnalysis }),
    ]);
    await expect(getAssetMetadata([id])).resolves.toEqual([
      expect.objectContaining({ id, width: 800, height: 900, analysis: cutoutAnalysis }),
    ]);
    expect(imageOptimizer.analyzeStoredImage).toHaveBeenCalledTimes(1);
    expect(records.get(id)).toMatchObject({ width: 800, height: 900, analysis: cutoutAnalysis });
    expect((await getAssetMetadata([id]))[0]).not.toHaveProperty("previewBlob");
  });

  it("backfills original canvas dimensions for a verified unoptimized legacy asset without decoding it again", async () => {
    const records = installAssetDatabase();
    const id = "asset:12345678-1234-4234-8234-123456789abd";
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    records.set(id, {
      id,
      name: "legacy-original.png",
      type: "image/png",
      size: blob.size,
      createdAt: "2026-08-28T00:00:00.000Z",
      blob,
      width: 1_536,
      height: 947,
      analysis: cutoutAnalysis,
      optimized: false,
    });

    await expect(getAssetMetadata([id])).resolves.toEqual([
      expect.objectContaining({ id, sourceWidth: 1_536, sourceHeight: 947 }),
    ]);
    expect(imageOptimizer.analyzeStoredImage).not.toHaveBeenCalled();
    expect(records.get(id)).toMatchObject({ sourceWidth: 1_536, sourceHeight: 947 });
  });

  it("lists only bounded recent metadata without materializing every stored blob", async () => {
    const records = installAssetDatabase({ forbidGetAll: true });
    const blob = new Blob([new Uint8Array(1_000_000)], { type: "image/png" });
    const ids = [1, 2, 3].map((serial) => `asset:${serial.toString().padStart(8, "0")}-1234-4234-8234-123456789abc`);
    ids.forEach((id, index) => records.set(id, {
      id,
      name: `${index}.png`,
      type: "image/png",
      size: blob.size,
      createdAt: `2026-08-${String(28 + index).padStart(2, "0")}T00:00:00.000Z`,
      blob,
      previewBlob: new Blob([new Uint8Array(1)], { type: "image/webp" }),
      previewVersion: 1,
    }));

    const metadata = await listAssetMetadata(2);

    expect(metadata.map((asset) => asset.id)).toEqual([ids[2], ids[1]]);
    expect(metadata.every((asset) => !("blob" in asset))).toBe(true);
    expect(metadata.every((asset) => !("previewBlob" in asset))).toBe(true);
  });
});
