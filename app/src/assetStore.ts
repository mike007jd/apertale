import { isStoredAssetId } from "./assetId";
import { SUPPORTED_IMAGE_TYPES as SUPPORTED_SOURCE_TYPES } from "./bookElementGrammar";
import { IMAGE_ANALYSIS_VERSION, MAX_SOURCE_IMAGE_BYTES, analyzeStoredImage, optimizeImportedImage } from "./imageOptimizer";
import type { ImageContentAnalysis } from "./imageOptimizer";
import type { ImageHandoffAssetUse } from "./imageHandoff";
import { MAX_BOOK_PUBLISHABLE_ASSETS } from "./types";
import { bundledShelfCoverPreviewUrl } from "./shelfCoverPreview";

export { isStoredAssetId } from "./assetId";

const DATABASE_NAME = "apertale-assets";
const DATABASE_VERSION = 1;
const STORE_NAME = "assets";
const ASSET_PREFIX = "asset:";
const SHELF_PREVIEW_VERSION = 1;
const SHELF_PREVIEW_MAX_WIDTH = 384;
const SHELF_PREVIEW_MAX_HEIGHT = 576;
const SHELF_PREVIEW_QUALITY = 0.84;

export type StoredAssetMetadata = {
  id: string;
  name: string;
  type: string;
  size: number;
  originalSize?: number;
  width?: number;
  height?: number;
  /** Pixel dimensions decoded from the user-selected source before resizing. */
  sourceWidth?: number;
  sourceHeight?: number;
  analysis?: ImageContentAnalysis;
  optimized?: boolean;
  /** Trusted import role. Missing only on assets stored before role tracking. */
  assetUse?: ImageHandoffAssetUse;
  createdAt: string;
};

type StoredAsset = StoredAssetMetadata & {
  blob: Blob;
  previewBlob?: Blob;
  previewWidth?: number;
  previewHeight?: number;
  previewVersion?: number;
};

export type AssetUrlLease = {
  assetId: string;
  url: string;
  release: () => void;
};

type AssetUrlEntry = {
  generation: number;
  references: number;
  promise: Promise<string>;
  url?: string;
};

type AssetUrlPool = {
  label: string;
  entries: Map<string, AssetUrlEntry>;
  generation: number;
};

const assetUrlPool: AssetUrlPool = { label: "asset URL", entries: new Map(), generation: 0 };
const previewUrlPool: AssetUrlPool = { label: "asset preview URL", entries: new Map(), generation: 0 };
let previewGenerationQueue: Promise<void> = Promise.resolve();

function enqueuePreviewGeneration<T>(operation: () => Promise<T>) {
  const result = previewGenerationQueue.then(operation, operation);
  previewGenerationQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function createShelfPreviewBlob(source: Blob) {
  if (!globalThis.createImageBitmap || !globalThis.OffscreenCanvas) {
    throw new Error("Image preview decoding is unavailable in this browser.");
  }
  const bitmap = await createImageBitmap(source);
  try {
    if (bitmap.width <= 0 || bitmap.height <= 0) throw new Error("The cover has invalid dimensions.");
    const scale = Math.min(1, SHELF_PREVIEW_MAX_WIDTH / bitmap.width, SHELF_PREVIEW_MAX_HEIGHT / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The shelf preview canvas is unavailable.");
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: SHELF_PREVIEW_QUALITY });
    if (blob.size <= 0) throw new Error("The shelf preview encoder returned an empty image.");
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("IndexedDB is unavailable in this browser."));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Could not open the Apertale asset store."));
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    let result: T;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      database.close();
      reject(error);
    };
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => fail(request.error ?? new Error("The Apertale asset operation failed."));
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      database.close();
      resolve(result);
    };
    transaction.onerror = () => fail(transaction.error ?? new Error("The Apertale asset transaction failed."));
    transaction.onabort = () => fail(transaction.error ?? new Error("The Apertale asset transaction was aborted."));
  });
}

async function storeLocalImage(file: File, assetUse: ImageHandoffAssetUse): Promise<StoredAssetMetadata> {
  const optimizedImage = await optimizeImportedImage(file);
  const metadata: StoredAssetMetadata = {
    id: `${ASSET_PREFIX}${crypto.randomUUID()}`,
    name: optimizedImage.name.slice(0, 128) || "Imported image",
    type: optimizedImage.blob.type,
    size: optimizedImage.blob.size,
    originalSize: optimizedImage.originalSize,
    width: optimizedImage.width,
    height: optimizedImage.height,
    sourceWidth: optimizedImage.sourceWidth,
    sourceHeight: optimizedImage.sourceHeight,
    analysis: optimizedImage.analysis,
    optimized: optimizedImage.optimized,
    assetUse,
    createdAt: new Date().toISOString(),
  };
  await withStore("readwrite", (store) => store.put({ ...metadata, blob: optimizedImage.blob } satisfies StoredAsset));
  return metadata;
}

type LocalImageImportBatch = {
  assets: StoredAssetMetadata[];
  rejected: number;
  failed: number;
};

/**
 * Applies the complete browser-local image admission policy while preserving
 * picker order. A bad file is isolated so later valid selections still reach
 * the registry; systemic processing/storage failures are reported separately.
 */
export async function storeLocalImages(
  files: Iterable<File>,
  options: { assetUse: ImageHandoffAssetUse; limit?: number },
): Promise<LocalImageImportBatch> {
  const maximum = Math.max(0, Math.floor(options.limit ?? Number.POSITIVE_INFINITY));
  const assets: StoredAssetMetadata[] = [];
  let rejected = 0;
  let failed = 0;
  let attempted = 0;
  for (const file of files) {
    if (!SUPPORTED_SOURCE_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_SOURCE_IMAGE_BYTES) {
      rejected += 1;
      continue;
    }
    if (attempted >= maximum) {
      rejected += 1;
      continue;
    }
    attempted += 1;
    try {
      assets.push(await storeLocalImage(file, options.assetUse));
    } catch {
      failed += 1;
    }
  }
  return { assets, rejected, failed };
}

async function getStoredAsset(assetId: string) {
  if (!isStoredAssetId(assetId)) return null;
  return (await withStore<StoredAsset | undefined>("readonly", (store) => store.get(assetId))) ?? null;
}

async function cacheStoredAssetMetadata(stored: StoredAsset) {
  try {
    await withStore("readwrite", (store) => store.put(stored));
  } catch {
    // Metadata migration is opportunistic; callers still receive the verified
    // in-memory result when IndexedDB cannot accept the cache write.
  }
}

async function ensureAssetAnalysis(stored: StoredAsset): Promise<StoredAsset> {
  if (stored.analysis?.version === IMAGE_ANALYSIS_VERSION && stored.width && stored.height) {
    if (stored.optimized !== false || (stored.sourceWidth && stored.sourceHeight)) return stored;
    const enriched = {
      ...stored,
      sourceWidth: stored.width,
      sourceHeight: stored.height,
    } satisfies StoredAsset;
    await cacheStoredAssetMetadata(enriched);
    return enriched;
  }
  try {
    const inspected = await analyzeStoredImage(stored.blob);
    const sourceDimensions = stored.optimized === false
      ? { sourceWidth: inspected.width, sourceHeight: inspected.height }
      : {};
    const enriched = { ...stored, ...inspected, ...sourceDimensions } satisfies StoredAsset;
    await cacheStoredAssetMetadata(enriched);
    return enriched;
  } catch {
    return stored;
  }
}

export async function getStoredAssetBlob(assetId: string): Promise<Blob | null> {
  const stored = await getStoredAsset(assetId);
  return stored?.blob ?? null;
}

function releaseEntry(pool: AssetUrlPool, assetId: string, entry: AssetUrlEntry) {
  entry.references = Math.max(0, entry.references - 1);
  if (entry.references > 0 || pool.entries.get(assetId) !== entry) return;
  pool.entries.delete(assetId);
  if (!entry.url) return;
  URL.revokeObjectURL(entry.url);
  entry.url = undefined;
}

function assertEntryLive(pool: AssetUrlPool, generation: number, assetId: string, entry: AssetUrlEntry) {
  if (generation !== pool.generation || pool.entries.get(assetId) !== entry) {
    throw new DOMException(`The ${pool.label} request was retired.`, "AbortError");
  }
}

/** Publishes a Blob URL onto a live entry, revoking it if the entry retired mid-flight. */
function commitEntryUrl(pool: AssetUrlPool, generation: number, assetId: string, entry: AssetUrlEntry, blob: Blob) {
  assertEntryLive(pool, generation, assetId, entry);
  const url = URL.createObjectURL(blob);
  if (generation !== pool.generation || pool.entries.get(assetId) !== entry) {
    URL.revokeObjectURL(url);
    throw new DOMException(`The ${pool.label} request was retired.`, "AbortError");
  }
  entry.url = url;
  return url;
}

async function acquireFromPool(
  pool: AssetUrlPool,
  assetId: string,
  load: (generation: number, entry: AssetUrlEntry) => Promise<string>,
): Promise<AssetUrlLease> {
  let entry = pool.entries.get(assetId);
  if (!entry) {
    const generation = pool.generation;
    const nextEntry: AssetUrlEntry = {
      generation,
      references: 0,
      promise: Promise.resolve(""),
    };
    nextEntry.promise = load(generation, nextEntry);
    entry = nextEntry;
    pool.entries.set(assetId, entry);
  }
  entry.references += 1;
  try {
    const url = await entry.promise;
    let released = false;
    return {
      assetId,
      url,
      release: () => {
        if (released) return;
        released = true;
        releaseEntry(pool, assetId, entry);
      },
    };
  } catch (error) {
    releaseEntry(pool, assetId, entry);
    throw error;
  }
}

/**
 * Acquires one identity-safe lease for a browser-local Blob URL. Concurrent
 * consumers share the IndexedDB read and URL, while the last release revokes
 * it. Bundled/procedural references use the same API with a no-op release.
 */
export async function acquireAssetUrl(assetId: string): Promise<AssetUrlLease> {
  if (!isStoredAssetId(assetId)) return { assetId, url: assetId, release: () => undefined };
  return acquireFromPool(assetUrlPool, assetId, (generation, entry) =>
    getStoredAsset(assetId).then((stored) => {
      if (!stored) throw new Error(`Local asset ${assetId} is missing.`);
      return commitEntryUrl(assetUrlPool, generation, assetId, entry, stored.blob);
    }));
}

/**
 * Acquires a shelf-only cover lease. Local covers are resized once, cached in
 * their existing IndexedDB row, and generated serially so a legacy library
 * cannot decode every full-resolution cover at the same time.
 */
export async function acquireAssetPreviewUrl(assetId: string): Promise<AssetUrlLease> {
  if (!isStoredAssetId(assetId)) {
    return { assetId, url: bundledShelfCoverPreviewUrl(assetId), release: () => undefined };
  }
  return acquireFromPool(previewUrlPool, assetId, (generation, entry) =>
    enqueuePreviewGeneration(async () => {
      const stored = await getStoredAsset(assetId);
      if (!stored) throw new Error(`Local asset ${assetId} is missing.`);
      assertEntryLive(previewUrlPool, generation, assetId, entry);

      let previewBlob = stored.previewVersion === SHELF_PREVIEW_VERSION && stored.previewBlob
        ? stored.previewBlob
        : null;
      if (!previewBlob) {
        try {
          const preview = await createShelfPreviewBlob(stored.blob);
          previewBlob = preview.blob;
          await cacheStoredAssetMetadata({
            ...stored,
            previewBlob,
            previewWidth: preview.width,
            previewHeight: preview.height,
            previewVersion: SHELF_PREVIEW_VERSION,
          });
        } catch {
          // A browser without a usable encoder still gets the real cover. The
          // fallback is intentionally uncached so a later capable browser can
          // create the smaller derivative.
          previewBlob = stored.blob;
        }
      }
      return commitEntryUrl(previewUrlPool, generation, assetId, entry, previewBlob);
    }));
}

/** Acquires an all-or-nothing ordered batch and releases partial success. */
export async function acquireAssetUrls(assetIds: readonly string[]): Promise<AssetUrlLease[]> {
  const results = await Promise.allSettled(assetIds.map(acquireAssetUrl));
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) {
    results.forEach((result) => {
      if (result.status === "fulfilled") result.value.release();
    });
    throw failure.reason;
  }
  return results.map((result) => (result as PromiseFulfilledResult<AssetUrlLease>).value);
}

export async function getAssetMetadata(assetIds: string[]) {
  const uniqueIds = [...new Set(assetIds.filter(isStoredAssetId))];
  const metadata: StoredAssetMetadata[] = [];
  // Legacy assets are decoded one at a time so upgrading a large prior batch
  // cannot spike memory in the host browser.
  for (const assetId of uniqueIds) {
    const stored = await getStoredAsset(assetId);
    if (!stored) continue;
    const {
      blob: _blob,
      previewBlob: _previewBlob,
      previewWidth: _previewWidth,
      previewHeight: _previewHeight,
      previewVersion: _previewVersion,
      ...analyzed
    } = await ensureAssetAnalysis(stored);
    metadata.push(analyzed);
  }
  return metadata;
}

async function scanRecentAssetMetadata(limit: number) {
  const database = await openDatabase();
  return new Promise<StoredAssetMetadata[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).openCursor();
    const recent: StoredAssetMetadata[] = [];
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      database.close();
      reject(error);
    };
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const {
        blob: _blob,
        previewBlob: _previewBlob,
        previewWidth: _previewWidth,
        previewHeight: _previewHeight,
        previewVersion: _previewVersion,
        ...metadata
      } = cursor.value as StoredAsset;
      recent.push(metadata);
      recent.sort((left, right) => (
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
      ));
      if (recent.length > limit) recent.pop();
      cursor.continue();
    };
    request.onerror = () => fail(request.error ?? new Error("The Apertale asset scan failed."));
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      database.close();
      resolve(recent);
    };
    transaction.onerror = () => fail(transaction.error ?? new Error("The Apertale asset transaction failed."));
    transaction.onabort = () => fail(transaction.error ?? new Error("The Apertale asset transaction was aborted."));
  });
}

export async function listAssetMetadata(limit: number = MAX_BOOK_PUBLISHABLE_ASSETS) {
  if (!globalThis.indexedDB) return [];
  const boundedLimit = Math.max(0, Math.min(MAX_BOOK_PUBLISHABLE_ASSETS, limit));
  if (boundedLimit === 0) return [];
  // Cursor iteration materializes at most one Blob-backed row at a time and
  // retains only bounded metadata. getAll() retained every historical Blob in
  // memory merely to return the newest 50 entries.
  return scanRecentAssetMetadata(boundedLimit);
}

export function releaseAssetUrls() {
  for (const pool of [assetUrlPool, previewUrlPool]) {
    pool.generation += 1;
    pool.entries.forEach((entry) => {
      if (!entry.url) return;
      URL.revokeObjectURL(entry.url);
      entry.url = undefined;
    });
    pool.entries.clear();
  }
}
