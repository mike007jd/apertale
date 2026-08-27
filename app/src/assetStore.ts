import { optimizeImportedImage } from "./imageOptimizer";

const DATABASE_NAME = "apertale-assets";
const DATABASE_VERSION = 1;
const STORE_NAME = "assets";
const ASSET_PREFIX = "asset:";

type StoredAssetMetadata = {
  id: string;
  name: string;
  type: string;
  size: number;
  originalSize?: number;
  width?: number;
  height?: number;
  optimized?: boolean;
  createdAt: string;
};

type StoredAsset = StoredAssetMetadata & { blob: Blob };

const objectUrls = new Map<string, string>();

export function isStoredAssetId(value: string) {
  return value.startsWith(ASSET_PREFIX);
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

export async function storeLocalImage(file: File): Promise<StoredAssetMetadata> {
  const optimizedImage = await optimizeImportedImage(file);
  const metadata: StoredAssetMetadata = {
    id: `${ASSET_PREFIX}${crypto.randomUUID()}`,
    name: optimizedImage.name.slice(0, 128) || "Imported image",
    type: optimizedImage.blob.type,
    size: optimizedImage.blob.size,
    originalSize: optimizedImage.originalSize,
    width: optimizedImage.width,
    height: optimizedImage.height,
    optimized: optimizedImage.optimized,
    createdAt: new Date().toISOString(),
  };
  await withStore("readwrite", (store) => store.put({ ...metadata, blob: optimizedImage.blob } satisfies StoredAsset));
  return metadata;
}

async function getStoredAsset(assetId: string) {
  if (!isStoredAssetId(assetId)) return null;
  return (await withStore<StoredAsset | undefined>("readonly", (store) => store.get(assetId))) ?? null;
}

export async function resolveAssetUrl(assetId: string) {
  if (!isStoredAssetId(assetId)) return assetId;
  const cached = objectUrls.get(assetId);
  if (cached) return cached;
  const stored = await getStoredAsset(assetId);
  if (!stored) throw new Error(`Local asset ${assetId} is missing.`);
  const url = URL.createObjectURL(stored.blob);
  objectUrls.set(assetId, url);
  return url;
}

export async function getAssetMetadata(assetIds: string[]) {
  const uniqueIds = [...new Set(assetIds.filter(isStoredAssetId))];
  const records = await Promise.all(uniqueIds.map(getStoredAsset));
  return records.filter((record): record is StoredAsset => Boolean(record)).map(({ blob: _blob, ...metadata }) => metadata);
}

export async function listAssetMetadata(limit = 24) {
  if (!globalThis.indexedDB) return [];
  const records = await withStore<StoredAsset[]>("readonly", (store) => store.getAll());
  return records
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, Math.max(0, Math.min(24, limit)))
    .map(({ blob: _blob, ...metadata }) => metadata);
}

export function releaseAssetUrls() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
}
