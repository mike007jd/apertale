import { isStoredAssetId } from "./assetId";
import { IMAGE_ANALYSIS_VERSION, MAX_SOURCE_IMAGE_BYTES, analyzeStoredImage, optimizeImportedImage } from "./imageOptimizer";
import type { ImageContentAnalysis } from "./imageOptimizer";
import type { ImageHandoffAssetUse } from "./imageHandoff";
import { MAX_BOOK_UPLOADED_ASSETS } from "./qualityContract";

export { isStoredAssetId } from "./assetId";

const DATABASE_NAME = "apertale-assets";
const DATABASE_VERSION = 1;
const STORE_NAME = "assets";
const ASSET_PREFIX = "asset:";
const SUPPORTED_SOURCE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

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

type StoredAsset = StoredAssetMetadata & { blob: Blob };

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

const objectUrls = new Map<string, AssetUrlEntry>();
let objectUrlGeneration = 0;

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

export type LocalImageImportBatch = {
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

function releaseAssetUrlEntry(assetId: string, entry: AssetUrlEntry) {
  entry.references = Math.max(0, entry.references - 1);
  if (entry.references > 0 || objectUrls.get(assetId) !== entry) return;
  objectUrls.delete(assetId);
  if (!entry.url) return;
  URL.revokeObjectURL(entry.url);
  entry.url = undefined;
}

/**
 * Acquires one identity-safe lease for a browser-local Blob URL. Concurrent
 * consumers share the IndexedDB read and URL, while the last release revokes
 * it. Bundled/procedural references use the same API with a no-op release.
 */
export async function acquireAssetUrl(assetId: string): Promise<AssetUrlLease> {
  if (!isStoredAssetId(assetId)) return { assetId, url: assetId, release: () => undefined };
  let entry = objectUrls.get(assetId);
  if (!entry) {
    const generation = objectUrlGeneration;
    const nextEntry: AssetUrlEntry = {
      generation,
      references: 0,
      promise: Promise.resolve(""),
    };
    nextEntry.promise = getStoredAsset(assetId).then((stored) => {
      if (!stored) throw new Error(`Local asset ${assetId} is missing.`);
      if (generation !== objectUrlGeneration || objectUrls.get(assetId) !== nextEntry) {
        throw new DOMException("The asset URL request was retired.", "AbortError");
      }
      const url = URL.createObjectURL(stored.blob);
      if (generation !== objectUrlGeneration || objectUrls.get(assetId) !== nextEntry) {
        URL.revokeObjectURL(url);
        throw new DOMException("The asset URL request was retired.", "AbortError");
      }
      nextEntry.url = url;
      return url;
    });
    entry = nextEntry;
    objectUrls.set(assetId, entry);
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
        releaseAssetUrlEntry(assetId, entry);
      },
    };
  } catch (error) {
    releaseAssetUrlEntry(assetId, entry);
    throw error;
  }
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
    const { blob: _blob, ...analyzed } = await ensureAssetAnalysis(stored);
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
      const { blob: _blob, ...metadata } = cursor.value as StoredAsset;
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

export async function listAssetMetadata(limit: number = MAX_BOOK_UPLOADED_ASSETS) {
  if (!globalThis.indexedDB) return [];
  const boundedLimit = Math.max(0, Math.min(MAX_BOOK_UPLOADED_ASSETS, limit));
  if (boundedLimit === 0) return [];
  // Cursor iteration materializes at most one Blob-backed row at a time and
  // retains only bounded metadata. getAll() retained every historical Blob in
  // memory merely to return the newest 50 entries.
  return scanRecentAssetMetadata(boundedLimit);
}

export function releaseAssetUrls() {
  objectUrlGeneration += 1;
  objectUrls.forEach((entry) => {
    if (!entry.url) return;
    URL.revokeObjectURL(entry.url);
    entry.url = undefined;
  });
  objectUrls.clear();
}
