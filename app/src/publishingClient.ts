import { getStoredAssetBlob } from "./assetStore";
import type { DocumentState } from "./types";

export type PublicationStatus = "draft" | "publishing" | "published" | "revoked";

export type PublicationRecord = {
  documentId: string;
  bookId: string;
  manageToken: string;
  status: PublicationStatus;
  shareUrl?: string;
  publishedRevision?: number;
};

export type PublicationProgress = {
  phase: "creating" | "uploading" | "publishing";
  completed: number;
  total: number;
};

const STORAGE_PREFIX = "apertale.publication.v1:";
const LOCAL_ASSET_PATTERN = /^asset:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const BOOK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f-]{27,35}$/i;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const STATUSES = new Set<PublicationStatus>(["draft", "publishing", "published", "revoked"]);

type StoredPublicationRecord = PublicationRecord & {
  uploadedAssetIds: string[];
  shareToken?: string;
};

export class PublicationError extends Error {
  readonly name = "PublicationError";
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, options: { code: string; status?: number; retryable?: boolean }) {
    super(message);
    this.code = options.code;
    this.status = options.status ?? 0;
    this.retryable = options.retryable ?? false;
  }
}

export function collectLocalAssetIds(documentState: DocumentState): string[] {
  const ids = new Set<string>();
  const add = (value: string | undefined) => {
    if (typeof value === "string" && LOCAL_ASSET_PATTERN.test(value)) ids.add(value);
  };
  add(documentState.coverAssetId);
  add(documentState.coverTextureUrl);
  for (const spread of documentState.spreads) {
    add(spread.textureUrl);
    add(spread.artwork?.cleanPlateAssetId);
    add(spread.artwork?.sourceAssetId);
    for (const element of spread.elements) {
      add(element.assetId);
      element.frameAssetIds?.forEach(add);
    }
  }
  return [...ids];
}

export function getPublicationRecord(documentId: string): PublicationRecord | null {
  const stored = readStoredRecord(documentId);
  return stored ? toPublicRecord(stored) : null;
}

export async function publishDocument(
  documentState: DocumentState,
  onProgress?: (progress: PublicationProgress) => void,
): Promise<PublicationRecord> {
  const existing = readStoredRecord(documentState.id);
  if (existing?.status === "published") {
    if (existing.publishedRevision === documentState.revision && existing.shareUrl) {
      return toPublicRecord(existing);
    }
    throw new PublicationError(
      "This book already has a live share link. Revoke it before publishing a new revision.",
      { code: "revision_changed", status: 409, retryable: false },
    );
  }

  const blobs = await loadRequiredBlobs(documentState);
  const localAssetIds = [...blobs.keys()];

  let record = existing;
  if (!record) {
    onProgress?.({ phase: "creating", completed: 0, total: 1 });
    record = await createDraftRecord(documentState.id);
    persistRecord(record);
    onProgress?.({ phase: "creating", completed: 1, total: 1 });
  }

  const shareToken = readShareToken(record.shareToken) ?? createShareToken();
  record = {
    ...record,
    status: "publishing",
    shareToken,
    uploadedAssetIds: uniqueAssetIds(record.uploadedAssetIds),
  };
  persistRecord(record);

  const uploaded = new Set(record.uploadedAssetIds);
  const uploadedCount = () => localAssetIds.filter((assetId) => uploaded.has(assetId)).length;
  onProgress?.({ phase: "uploading", completed: uploadedCount(), total: localAssetIds.length });
  for (const assetId of localAssetIds) {
    if (!uploaded.has(assetId)) {
      await uploadAsset(record, assetId, blobs.get(assetId)!);
      uploaded.add(assetId);
      record = { ...record, uploadedAssetIds: [...uploaded] };
      persistRecord(record);
    }
    onProgress?.({ phase: "uploading", completed: uploadedCount(), total: localAssetIds.length });
  }

  onProgress?.({ phase: "publishing", completed: 0, total: 1 });
  const published = await requestJson<{ shareUrl?: string }>(
    `/api/books/${encodeURIComponent(record.bookId)}/publish`,
    {
      method: "POST",
      headers: {
        authorization: bearer(record.manageToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ manifest: documentState, shareToken }),
    },
  );
  const shareUrl = readSameOriginShareUrl(published.shareUrl, shareToken);
  if (!shareUrl) {
    throw new PublicationError("The book was published, but no share link was returned.", {
      code: "missing_share_url",
      status: 502,
      retryable: true,
    });
  }

  record = {
    ...record,
    status: "published",
    shareToken,
    shareUrl,
    publishedRevision: documentState.revision,
    uploadedAssetIds: [...uploaded],
  };
  persistRecord(record);
  onProgress?.({ phase: "publishing", completed: 1, total: 1 });
  return toPublicRecord(record);
}

export async function revokePublication(documentId: string): Promise<PublicationRecord> {
  const record = requireStoredRecord(documentId);
  await requestJson(`/api/books/${encodeURIComponent(record.bookId)}/revoke`, {
    method: "POST",
    headers: { authorization: bearer(record.manageToken) },
  });
  const revoked: StoredPublicationRecord = {
    documentId: record.documentId,
    bookId: record.bookId,
    manageToken: record.manageToken,
    status: "revoked",
    uploadedAssetIds: uniqueAssetIds(record.uploadedAssetIds),
  };
  persistRecord(revoked);
  return toPublicRecord(revoked);
}

export async function deletePublication(documentId: string): Promise<void> {
  const record = requireStoredRecord(documentId);
  const response = await apiRequest(`/api/books/${encodeURIComponent(record.bookId)}`, {
    method: "DELETE",
    headers: { authorization: bearer(record.manageToken) },
  });
  if (response.status === 204 || response.status === 404) {
    clearStoredRecord(documentId);
    return;
  }
  throw await errorFromResponse(response);
}

function storageKey(documentId: string) {
  return `${STORAGE_PREFIX}${documentId}`;
}

function toPublicRecord(record: StoredPublicationRecord): PublicationRecord {
  const publicRecord: PublicationRecord = {
    documentId: record.documentId,
    bookId: record.bookId,
    manageToken: record.manageToken,
    status: record.status,
  };
  if (record.shareUrl) publicRecord.shareUrl = record.shareUrl;
  if (typeof record.publishedRevision === "number") publicRecord.publishedRevision = record.publishedRevision;
  return publicRecord;
}

function uniqueAssetIds(values: string[] | undefined) {
  return [...new Set((values ?? []).filter((assetId) => LOCAL_ASSET_PATTERN.test(assetId)))];
}

function tokenFromBytes(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function createShareToken() {
  const token = tokenFromBytes(crypto.getRandomValues(new Uint8Array(32)));
  if (!TOKEN_PATTERN.test(token)) {
    throw new PublicationError("A share token could not be created in this browser.", {
      code: "invalid_request",
      retryable: true,
    });
  }
  return token;
}

function readShareToken(value: unknown) {
  return typeof value === "string" && TOKEN_PATTERN.test(value) ? value : undefined;
}

function readSameOriginShareUrl(value: unknown, shareToken?: string) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const origin = globalThis.location?.origin;
  if (!origin) return undefined;
  try {
    const url = new URL(value);
    const match = /^\/share\/([A-Za-z0-9_-]{43})$/u.exec(url.pathname);
    if (
      url.origin !== origin
      || url.search !== ""
      || url.hash !== ""
      || !match
      || (shareToken && match[1] !== shareToken)
    ) {
      return undefined;
    }
    return `${origin}/share/${match[1]}`;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readStoredRecord(documentId: string): StoredPublicationRecord | null {
  if (typeof documentId !== "string" || documentId.length === 0 || typeof localStorage === "undefined") return null;
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageKey(documentId));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const status = parsed.status;
    const manageToken = parsed.manageToken;
    const bookId = parsed.bookId;
    if (typeof status !== "string" || !STATUSES.has(status as PublicationStatus)) return null;
    if (typeof manageToken !== "string" || !TOKEN_PATTERN.test(manageToken)) return null;
    if (typeof bookId !== "string" || !BOOK_ID_PATTERN.test(bookId)) return null;
    const storedDocumentId = parsed.documentId;
    if (typeof storedDocumentId === "string" && storedDocumentId !== documentId) return null;
    const shareUrl = parsed.shareUrl;
    const publishedRevision = parsed.publishedRevision;
    const shareToken = readShareToken(parsed.shareToken);
    if (typeof parsed.shareToken !== "undefined" && !shareToken) return null;
    let allowedShareUrl: string | undefined;
    if (typeof shareUrl !== "undefined") {
      allowedShareUrl = readSameOriginShareUrl(shareUrl, shareToken);
      if (!allowedShareUrl || allowedShareUrl.includes(manageToken)) return null;
    }
    if (typeof publishedRevision !== "undefined" && (typeof publishedRevision !== "number" || !Number.isSafeInteger(publishedRevision) || publishedRevision < 1)) {
      return null;
    }
    return {
      documentId,
      bookId,
      manageToken,
      status: status as PublicationStatus,
      shareToken,
      shareUrl: allowedShareUrl,
      publishedRevision: typeof publishedRevision === "number" ? publishedRevision : undefined,
      uploadedAssetIds: Array.isArray(parsed.uploadedAssetIds)
        ? uniqueAssetIds(parsed.uploadedAssetIds.filter((assetId): assetId is string => typeof assetId === "string"))
        : [],
    };
  } catch {
    return null;
  }
}

function requireStoredRecord(documentId: string): StoredPublicationRecord {
  const record = readStoredRecord(documentId);
  if (!record) {
    throw new PublicationError("This book has no saved creator capability on this browser.", {
      code: "missing_capability",
      status: 404,
      retryable: false,
    });
  }
  return record;
}

function persistRecord(record: StoredPublicationRecord) {
  try {
    localStorage.setItem(storageKey(record.documentId), JSON.stringify({
      documentId: record.documentId,
      bookId: record.bookId,
      manageToken: record.manageToken,
      status: record.status,
      shareToken: record.shareToken,
      shareUrl: record.shareUrl,
      publishedRevision: record.publishedRevision,
      uploadedAssetIds: uniqueAssetIds(record.uploadedAssetIds),
    } satisfies StoredPublicationRecord));
  } catch {
    throw new PublicationError("The creator capability could not be saved in this browser.", {
      code: "storage_unavailable",
      status: 500,
      retryable: true,
    });
  }
}

function clearStoredRecord(documentId: string) {
  try {
    localStorage.removeItem(storageKey(documentId));
  } catch {
    throw new PublicationError("The local creator record could not be cleared.", {
      code: "storage_unavailable",
      status: 500,
      retryable: true,
    });
  }
}

async function loadRequiredBlobs(documentState: DocumentState) {
  const assetIds = collectLocalAssetIds(documentState);
  const blobs = new Map<string, Blob>();
  const missing: string[] = [];
  for (const assetId of assetIds) {
    const blob = await getStoredAssetBlob(assetId);
    if (!blob || blob.size < 1) {
      missing.push(assetId);
      continue;
    }
    const contentType = blob.type.split(";", 1)[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      throw new PublicationError(`Local asset ${assetId} is not a PNG, JPEG, or WebP image.`, {
        code: "unsupported_asset",
        status: 415,
        retryable: false,
      });
    }
    blobs.set(assetId, blob);
  }
  if (missing.length > 0) {
    throw new PublicationError(
      `Upload every referenced local asset before publishing (${missing.length} missing).`,
      { code: "missing_assets", status: 409, retryable: false },
    );
  }
  return blobs;
}

async function createDraftRecord(documentId: string): Promise<StoredPublicationRecord> {
  const payload = await requestJson<{ bookId?: string; manageToken?: string }>("/api/books", {
    method: "POST",
  });
  if (typeof payload.bookId !== "string" || !BOOK_ID_PATTERN.test(payload.bookId)) {
    throw new PublicationError("The draft book id was invalid.", { code: "invalid_draft", status: 502, retryable: true });
  }
  if (typeof payload.manageToken !== "string" || !TOKEN_PATTERN.test(payload.manageToken)) {
    throw new PublicationError("The creator capability was invalid.", { code: "invalid_draft", status: 502, retryable: true });
  }
  return {
    documentId,
    bookId: payload.bookId,
    manageToken: payload.manageToken,
    status: "draft",
    uploadedAssetIds: [],
  };
}

async function uploadAsset(record: StoredPublicationRecord, assetId: string, blob: Blob) {
  const contentType = blob.type.split(";", 1)[0].trim().toLowerCase();
  const response = await apiRequest(
    `/api/books/${encodeURIComponent(record.bookId)}/assets/${encodeURIComponent(assetId)}`,
    {
      method: "PUT",
      headers: {
        authorization: bearer(record.manageToken),
        "content-type": contentType,
      },
      body: blob,
    },
  );
  if (response.ok) return;
  const error = await errorFromResponse(response);
  if (error.code === "asset_exists" && error.status === 409) return;
  throw error;
}

function bearer(manageToken: string) {
  return `Bearer ${manageToken}`;
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await apiRequest(path, init);
  if (response.status === 204) return {} as T;
  if (!response.ok) throw await errorFromResponse(response);
  const payload: unknown = await response.json().catch(() => null);
  if (!isRecord(payload) || payload.ok !== true) {
    throw new PublicationError("The publishing service returned an unexpected response.", {
      code: "request_failed",
      status: response.status,
      retryable: response.status >= 500,
    });
  }
  return payload as T;
}

function resolveApiUrl(path: string) {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("?")) {
    throw new PublicationError("Publishing requests must stay on same-origin API paths.", {
      code: "invalid_request",
      retryable: false,
    });
  }
  const origin = globalThis.location?.origin;
  return origin ? new URL(path, origin).toString() : path;
}

async function apiRequest(path: string, init: RequestInit) {
  try {
    return await fetch(resolveApiUrl(path), {
      ...init,
      cache: "no-store",
      redirect: "error",
    });
  } catch (error) {
    if (error instanceof PublicationError) throw error;
    throw new PublicationError("Book storage is temporarily unavailable.", {
      code: "storage_unavailable",
      status: 503,
      retryable: true,
    });
  }
}

async function errorFromResponse(response: Response) {
  const payload: unknown = await response.json().catch(() => null);
  const record = isRecord(payload) ? payload : {};
  const message = typeof record.message === "string" && record.message.trim().length > 0
    ? record.message
    : "The publishing request failed.";
  const code = typeof record.code === "string" && record.code.trim().length > 0
    ? record.code
    : "request_failed";
  return new PublicationError(message, {
    code,
    status: response.status,
    retryable: response.status === 429 || response.status === 503 || (response.status === 409 && code === "delete_conflict"),
  });
}
