import { getStoredAssetBlob, isStoredAssetId } from "./assetStore";
import {
  PUBLICATION_BOOK_ID_PATTERN as BOOK_ID_PATTERN,
  SUPPORTED_IMAGE_TYPES as ALLOWED_IMAGE_TYPES,
  PUBLICATION_TOKEN_PATTERN as TOKEN_PATTERN,
} from "./bookElementGrammar";
import {
  bookLifecycleLockManager,
  bookLifecycleLockName,
  storedLibraryDocumentMatches,
} from "./bookLifecycle";
import { listStoredPublishedAssetIds } from "./projectArtifact";
import type { DocumentState } from "./types";

type PublicationStatus = "draft" | "publishing" | "published" | "revoked" | "deleting";
type RemotePublicationStatus = PublicationStatus | "deleted";
type RemoteRecordResolution =
  | { kind: "owned"; status: RemotePublicationStatus }
  | { kind: "definitely-not-owned"; error: PublicationError };

export type PublicationRecord = {
  documentId: string;
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
const STATUSES = new Set<PublicationStatus>(["draft", "publishing", "published", "revoked", "deleting"]);
const REMOTE_STATUSES = new Set<RemotePublicationStatus>([...STATUSES, "deleted"]);

type StoredPublicationRecord = PublicationRecord & {
  bookId: string;
  manageToken: string;
  uploadedAssetIds: string[];
  attemptAssetIds?: string[];
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

class PublicationIntentCleanupError extends Error {
  readonly originalError: unknown;
  readonly documentId: string;
  readonly expectedRaw: string;

  constructor(originalError: unknown, documentId: string, expectedRaw: string) {
    super("A newly created publication intent must be cleaned up under its lifecycle lock.");
    this.name = "PublicationIntentCleanupError";
    this.originalError = originalError;
    this.documentId = documentId;
    this.expectedRaw = expectedRaw;
  }
}

export function getPublicationRecord(documentId: string): PublicationRecord | null {
  const stored = readStoredRecord(documentId);
  return stored ? toPublicRecord(stored) : null;
}

export async function publishDocument(
  documentState: DocumentState,
  onProgress?: (progress: PublicationProgress) => void,
): Promise<PublicationRecord> {
  const lockManager = requirePublicationLockManager();
  try {
    ensureSynchronousPublicationIntent(documentState);
  } catch (error) {
    if (!(error instanceof PublicationIntentCleanupError)) throw error;
    await lockManager.request(bookLifecycleLockName(error.documentId), { mode: "exclusive" }, () => {
      clearStoredRecordIfRawMatches(error.documentId, error.expectedRaw);
    });
    throw error.originalError;
  }
  return withPublicationLock(documentState.id, () => publishDocumentLocked(documentState, onProgress));
}

async function publishDocumentLocked(
  documentState: DocumentState,
  onProgress?: (progress: PublicationProgress) => void,
): Promise<PublicationRecord> {
  // The record may have been deleted while this call waited for the Web Lock.
  // Re-establish it synchronously before any blob or network await so creation
  // undo always sees publication intent throughout the locked workflow.
  const existing = ensureSynchronousPublicationIntent(documentState, true);
  if (existing?.status === "published") {
    if (existing.publishedRevision === documentState.revision && existing.shareUrl) {
      return toPublicRecord(existing);
    }
    throw new PublicationError(
      "This book already has a live share link. Revoke it before sharing a new revision.",
      { code: "revision_changed", status: 409, retryable: false },
    );
  }

  let record = existing;
  if (record?.status === "publishing") {
    const shareToken = readShareToken(record.shareToken);
    if (!shareToken) {
      throw new PublicationError("The interrupted publication has no valid share capability.", {
        code: "missing_capability",
        status: 409,
        retryable: false,
      });
    }
    onProgress?.({ phase: "publishing", completed: 0, total: 1 });
    let reconciled: { status?: string; shareUrl?: string; publishedRevision?: number };
    try {
      reconciled = await requestJson<{ status?: string; shareUrl?: string; publishedRevision?: number }>(
        `/api/books/${encodeURIComponent(record.bookId)}/publish/reconcile`,
        {
          method: "POST",
          headers: {
            authorization: bearer(record.manageToken),
            "content-type": "application/json",
          },
          body: JSON.stringify({ shareToken }),
        },
      );
    } catch (error) {
      if (!(error instanceof PublicationError) || error.status !== 404) throw error;
      // A previous replacement deleted the remote attempt but failed before
      // its new capability reached localStorage. Mark the missing generation
      // resumable; the current asset plan below will rotate it to a fresh id.
      record = {
        ...record,
        status: "revoked",
        shareToken: undefined,
        shareUrl: undefined,
        publishedRevision: undefined,
      };
      persistRecord(record);
      reconciled = { status: "revoked" };
    }
    if (reconciled.status === "published") {
      const shareUrl = readSameOriginShareUrl(reconciled.shareUrl, shareToken);
      const publishedRevision = readPublishedRevision(reconciled.publishedRevision);
      if (!shareUrl || !publishedRevision) {
        throw new PublicationError("The publishing service could not restore the committed share link.", {
          code: "invalid_publish_response",
          status: 502,
          retryable: true,
        });
      }
      record = { ...record, status: "published", shareUrl, publishedRevision };
      persistRecord(record);
      onProgress?.({ phase: "publishing", completed: 1, total: 1 });
      return toPublicRecord(record);
    }
    if (reconciled.status === "publishing") {
      // The server has atomically claimed this same share capability. Keep the
      // durable local attempt intact and resume its uploads/commit below.
    } else if (reconciled.status === "revoked") {
      record = {
        ...record,
        status: "revoked",
        shareToken: undefined,
        shareUrl: undefined,
        publishedRevision: undefined,
      };
      persistRecord(record);
    } else {
      throw new PublicationError("The publishing service returned an unknown recovery state.", {
        code: "invalid_publish_response",
        status: 502,
        retryable: true,
      });
    }
  }

  const blobs = await loadRequiredBlobs(documentState);
  const localAssetIds = [...blobs.keys()];
  const attemptAssetIds = canonicalAssetIds(localAssetIds);

  if (record && (
    record.status === "revoked"
    || record.status === "deleting"
    || !sameAssetPlan(record.attemptAssetIds, attemptAssetIds)
  )) {
    record = await replaceRemoteAttempt(record, attemptAssetIds);
  }

  if (record.status === "draft") {
    onProgress?.({ phase: "creating", completed: 0, total: 1 });
    await ensureDraftRecord(record);
    onProgress?.({ phase: "creating", completed: 1, total: 1 });
  }

  const shareToken = readShareToken(record.shareToken) ?? createShareToken();
  record = {
    ...record,
    status: "publishing",
    shareToken,
    shareUrl: undefined,
    publishedRevision: undefined,
    attemptAssetIds,
    uploadedAssetIds: uniqueAssetIds(record.uploadedAssetIds).filter((assetId) => attemptAssetIds.includes(assetId)),
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
  const published = await requestJson<{ shareUrl?: string; publishedRevision?: number }>(
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
  const publishedRevision = readPublishedRevision(published.publishedRevision);
  if (!shareUrl || !publishedRevision) {
    throw new PublicationError("The book was published, but its share response was incomplete.", {
      code: "invalid_publish_response",
      status: 502,
      retryable: true,
    });
  }

  record = {
    ...record,
    status: "published",
    shareToken,
    shareUrl,
    publishedRevision,
    uploadedAssetIds: [...uploaded],
  };
  persistRecord(record);
  onProgress?.({ phase: "publishing", completed: 1, total: 1 });
  return toPublicRecord(record);
}

export async function revokePublication(documentId: string): Promise<PublicationRecord> {
  return withPublicationLock(documentId, async () => {
    const record = requireStoredRecord(documentId);
    const shareToken = readShareToken(record.shareToken);
    if (!shareToken) {
      throw new PublicationError("The saved publication has no valid share capability to revoke.", {
        code: "missing_capability",
        status: 409,
        retryable: false,
    });
  }
  await requestJson(`/api/books/${encodeURIComponent(record.bookId)}/revoke`, {
    method: "POST",
    headers: {
      authorization: bearer(record.manageToken),
      "content-type": "application/json",
    },
    body: JSON.stringify({ shareToken }),
  });
  const revoked: StoredPublicationRecord = {
    documentId: record.documentId,
    bookId: record.bookId,
    manageToken: record.manageToken,
    status: "revoked",
    uploadedAssetIds: [],
    attemptAssetIds: undefined,
  };
  persistRecord(revoked);
  return toPublicRecord(revoked);
  });
}

export async function deletePublication(documentId: string): Promise<void> {
  return withPublicationLock(documentId, async () => {
    const record: StoredPublicationRecord = {
      ...requireStoredRecord(documentId),
      status: "deleting",
      shareToken: undefined,
      shareUrl: undefined,
      publishedRevision: undefined,
    };
    // Persist the terminal intent before the request. If delivery becomes
    // uncertain, any later publish rotates to a new server generation instead
    // of racing the delayed DELETE against a reused id.
    const deletingRaw = persistRecord(record);
    const remote = await ensureRemoteRecord(record);
    if (remote.kind === "definitely-not-owned") {
      clearStoredRecordIfRawMatches(documentId, deletingRaw);
      return;
    }
    if (remote.status !== "deleted") {
      await deleteRemoteAttempt(record);
    }
    clearStoredRecordIfRawMatches(documentId, deletingRaw);
  });
}

async function deleteRemoteAttempt(record: StoredPublicationRecord) {
  const response = await apiRequest(`/api/books/${encodeURIComponent(record.bookId)}`, {
    method: "DELETE",
    headers: { authorization: bearer(record.manageToken) },
  });
  if (response.status === 204) {
    return;
  }
  throw await errorFromResponse(response);
}

async function replaceRemoteAttempt(record: StoredPublicationRecord, attemptAssetIds: string[]) {
  const replacement = createDraftRecord(record.documentId, attemptAssetIds);
  const remote = await ensureRemoteRecord(record);
  if (remote.kind === "owned" && remote.status !== "deleted") {
    await deleteRemoteAttempt(record);
  }
  // Replace the capability in one write. Keeping the old record until the
  // remote delete succeeds leaves every interruption resumable and gives
  // creation undo a publication intent with no empty-key race window.
  persistRecord(replacement);
  return replacement;
}

function storageKey(documentId: string) {
  return `${STORAGE_PREFIX}${documentId}`;
}

async function withPublicationLock<T>(documentId: string, work: () => Promise<T>): Promise<T> {
  return requirePublicationLockManager().request(bookLifecycleLockName(documentId), { mode: "exclusive" }, work);
}

function requirePublicationLockManager() {
  const lockManager = bookLifecycleLockManager();
  if (!lockManager) {
    throw new PublicationError("This browser cannot safely coordinate publication across tabs.", {
      code: "locking_unavailable",
      status: 503,
      retryable: false,
    });
  }
  return lockManager;
}

function requireCurrentLibraryDocument(documentState: DocumentState) {
  if (!storedLibraryDocumentMatches(documentState)) {
    throw new PublicationError(
      "This book is no longer the current saved library revision. Reopen it before sharing.",
      { code: "book_unavailable", status: 409, retryable: false },
    );
  }
}

function ensureSynchronousPublicationIntent(
  documentState: DocumentState,
  ownsLifecycleLock = false,
) {
  requireCurrentLibraryDocument(documentState);
  const existing = readStoredRecord(documentState.id);
  if (existing) return existing;
  const created = createDraftRecord(
    documentState.id,
    canonicalAssetIds(listStoredPublishedAssetIds(documentState)),
  );
  const createdRaw = persistRecord(created);
  try {
    requireCurrentLibraryDocument(documentState);
  } catch (error) {
    if (ownsLifecycleLock) {
      clearStoredRecordIfRawMatches(created.documentId, createdRaw);
      throw error;
    }
    throw new PublicationIntentCleanupError(error, created.documentId, createdRaw);
  }
  return created;
}

function toPublicRecord(record: StoredPublicationRecord): PublicationRecord {
  const publicRecord: PublicationRecord = {
    documentId: record.documentId,
    status: record.status,
  };
  if (record.shareUrl) publicRecord.shareUrl = record.shareUrl;
  if (typeof record.publishedRevision === "number") publicRecord.publishedRevision = record.publishedRevision;
  return publicRecord;
}

function uniqueAssetIds(values: string[] | undefined) {
  return [...new Set((values ?? []).filter(isStoredAssetId))];
}

function canonicalAssetIds(values: string[] | undefined) {
  return uniqueAssetIds(values).sort();
}

function sameAssetPlan(left: string[] | undefined, right: string[]) {
  return Array.isArray(left) && canonicalAssetIds(left).join("\n") === right.join("\n");
}

function tokenFromBytes(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
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

function readPublishedRevision(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : undefined;
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
      shareUrl: status === "published" ? allowedShareUrl : undefined,
      publishedRevision: status === "published" && typeof publishedRevision === "number"
        ? publishedRevision
        : undefined,
      uploadedAssetIds: Array.isArray(parsed.uploadedAssetIds)
        ? uniqueAssetIds(parsed.uploadedAssetIds.filter((assetId): assetId is string => typeof assetId === "string"))
        : [],
      attemptAssetIds: Array.isArray(parsed.attemptAssetIds)
        ? canonicalAssetIds(parsed.attemptAssetIds.filter((assetId): assetId is string => typeof assetId === "string"))
        : undefined,
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

function serializeStoredRecord(record: StoredPublicationRecord) {
  return JSON.stringify({
    documentId: record.documentId,
    bookId: record.bookId,
    manageToken: record.manageToken,
    status: record.status,
    shareToken: record.shareToken,
    shareUrl: record.shareUrl,
    publishedRevision: record.publishedRevision,
    uploadedAssetIds: uniqueAssetIds(record.uploadedAssetIds),
    attemptAssetIds: record.attemptAssetIds ? canonicalAssetIds(record.attemptAssetIds) : undefined,
  } satisfies StoredPublicationRecord);
}

function persistRecord(record: StoredPublicationRecord) {
  try {
    const raw = serializeStoredRecord(record);
    const key = storageKey(record.documentId);
    localStorage.setItem(key, raw);
    if (localStorage.getItem(key) !== raw) throw new Error("Publication record write was not durable.");
    return raw;
  } catch {
    throw new PublicationError("The creator capability could not be saved in this browser.", {
      code: "storage_unavailable",
      status: 500,
      retryable: true,
    });
  }
}

function clearStoredRecordIfRawMatches(documentId: string, expectedRaw: string) {
  try {
    const key = storageKey(documentId);
    if (localStorage.getItem(key) !== expectedRaw) return false;
    localStorage.removeItem(key);
    return localStorage.getItem(key) === null;
  } catch {
    throw new PublicationError("The local creator record could not be cleared.", {
      code: "storage_unavailable",
      status: 500,
      retryable: true,
    });
  }
}

async function loadRequiredBlobs(documentState: DocumentState) {
  const assetIds = listStoredPublishedAssetIds(documentState);
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
      `Upload every referenced local asset before sharing (${missing.length} missing).`,
      { code: "missing_assets", status: 409, retryable: false },
    );
  }
  return blobs;
}

function createDraftRecord(documentId: string, attemptAssetIds: string[]): StoredPublicationRecord {
  const bookId = crypto.randomUUID();
  const manageToken = tokenFromBytes(crypto.getRandomValues(new Uint8Array(32)));
  if (!BOOK_ID_PATTERN.test(bookId) || !TOKEN_PATTERN.test(manageToken)) {
    throw new PublicationError("A private draft capability could not be created in this browser.", {
      code: "invalid_draft",
      retryable: true,
    });
  }
  return {
    documentId,
    bookId,
    manageToken,
    status: "draft",
    uploadedAssetIds: [],
    attemptAssetIds: canonicalAssetIds(attemptAssetIds),
  };
}

async function ensureDraftRecord(record: StoredPublicationRecord) {
  const remote = await ensureRemoteRecord(record);
  if (remote.kind === "definitely-not-owned") {
    clearStoredRecordIfRawMatches(record.documentId, serializeStoredRecord(record));
    throw remote.error;
  }
  if (remote.status !== "draft") {
    throw new PublicationError("The publishing service returned an invalid draft record.", {
      code: "invalid_draft",
      status: 502,
      retryable: true,
    });
  }
}

async function ensureRemoteRecord(record: StoredPublicationRecord): Promise<RemoteRecordResolution> {
  let payload: { bookId?: string; status?: string };
  try {
    payload = await requestJson<{ bookId?: string; status?: string }>("/api/books", {
      method: "POST",
      headers: {
        authorization: bearer(record.manageToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ bookId: record.bookId }),
    });
  } catch (error) {
    if (error instanceof PublicationError && (
      (error.status === 409 && error.code === "book_exists")
      || (error.status === 429 && (error.code === "creation_limit" || error.code === "creation_rate"))
    )) {
      return { kind: "definitely-not-owned", error };
    }
    throw error;
  }
  if (
    payload.bookId !== record.bookId
    || typeof payload.status !== "string"
    || !REMOTE_STATUSES.has(payload.status as RemotePublicationStatus)
  ) {
    throw new PublicationError("The publishing service returned an invalid draft record.", {
      code: "invalid_draft",
      status: 502,
      retryable: true,
    });
  }
  return { kind: "owned", status: payload.status as RemotePublicationStatus };
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
    retryable: response.status === 429 || response.status >= 500 || (response.status === 409 && code === "delete_conflict"),
  });
}
