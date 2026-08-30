import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStoredAssetBlob, isStoredAssetId } from "./assetStore";
import { listStoredPublishedAssetIds } from "./projectArtifact";
import { QUALITY_RUBRIC, type QualityReport } from "./qualityContract";
import {
  deletePublication,
  getPublicationRecord,
  PublicationError,
  publishDocument,
  revokePublication,
  type PublicationProgress,
} from "./publishingClient";
import type { DocumentState } from "./types";

vi.mock("./assetStore", () => ({
  getStoredAssetBlob: vi.fn(),
  isStoredAssetId: (value: string) => /^asset:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
}));

const getBlob = vi.mocked(getStoredAssetBlob);

const COVER_ID = "asset:12345678-1234-4234-8234-123456789abc";
const TEXTURE_ID = "asset:22345678-1234-4234-8234-123456789abc";
const CLEAN_ID = "asset:32345678-1234-4234-8234-123456789abc";
const FRAME_A_ID = "asset:62345678-1234-4234-8234-123456789abc";
const FRAME_B_ID = "asset:72345678-1234-4234-8234-123456789abc";
const NEW_ID = "asset:82345678-1234-4234-8234-123456789abc";
const PNG = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" });

type FakeBook = {
  manageToken: string;
  status: "draft" | "published" | "revoked" | "deleting";
  assets: Set<string>;
  revision?: number;
  shareToken?: string;
  pendingShareToken?: string;
  retiredShareTokens: Set<string>;
};

function documentState(overrides: Partial<DocumentState> = {}): DocumentState {
  return {
    id: "warm-photo-story",
    revision: 4,
    title: "A Warm Photo Story",
    coverAssetId: COVER_ID,
    coverTextureUrl: COVER_ID,
    spreads: [{
      id: "spread-1",
      order: 0,
      textureUrl: TEXTURE_ID,
      artwork: {
        cleanPlateAssetId: CLEAN_ID,
        sourceAssetId: TEXTURE_ID,
        separation: "inpainted-clean-plate",
      },
      title: "Home",
      body: "A remembered afternoon.",
      elements: [{
        id: "photo",
        label: "Family photo",
        kind: "lifted",
        assetId: FRAME_A_ID,
        frameAssetIds: [FRAME_A_ID, FRAME_B_ID],
        page: "right",
        transform: { x: 0.5, y: 0.5, scaleX: 0.8, scaleY: 0.8, rotationDeg: 0 },
        depth: 0.1,
        locked: false,
        provenance: "human",
        interaction: {
          hover: "lift-glow",
          focus: "spotlight",
          reveal: { kind: "caption", title: "Home", summary: "A remembered afternoon.", facts: [] },
        },
      }, {
        id: "caption-frame",
        label: "Caption frame",
        kind: "decoration",
        assetId: "/assets/generated/story-city-clouds-cutout-v3.png",
        page: "left",
        transform: { x: 0.4, y: 0.5, scaleX: 0.8, scaleY: 0.8, rotationDeg: 0 },
        depth: 0.05,
        locked: false,
        provenance: "agent",
      }],
    }],
    ...overrides,
  };
}

function qualityReport(document: DocumentState, warning = false): QualityReport {
  const checks = QUALITY_RUBRIC.criteria.map((criterion, index) => ({
    criterionId: criterion.id,
    outcome: warning && index === 0 ? "warn" as const : "pass" as const,
    message: `${criterion.label} was checked against the rendered revision.`,
    evidence: [{
      scope: criterion.id === "cover-appeal" ? "cover" as const : "spread" as const,
      ...(criterion.id === "cover-appeal" ? {} : { spreadId: document.spreads[0].id }),
      locator: criterion.id === "cover-appeal" ? "[data-book-id] img" : ".book-scene canvas",
      description: "Rendered publication evidence",
    }],
    ...(warning && index === 0 ? { suggestedPatch: "Keep this warning recorded for publication." } : {}),
  }));
  return {
    contractVersion: 2,
    rubricVersion: 2,
    documentId: document.id,
    reviewedRevision: document.revision,
    round: 1,
    maxRounds: 2,
    creationBrief: {
      contractVersion: 2,
      bookType: "illustrated-storybook",
      premise: "A warm afternoon becomes a short illustrated story.",
      audience: "Families",
      spreadCount: document.spreads.length,
      visualDirection: "Warm paper collage",
      sourceAssets: [],
    },
    status: "ready",
    checks,
    blockerCount: 0,
    warningCount: warning ? 1 : 0,
    noteCount: 0,
    warningsRecorded: true,
    sampleReady: true,
    publishAllowed: true,
    summary: warning ? "Ready with one recorded warning." : "Ready to publish.",
  };
}

function publishReady(document: DocumentState, onProgress?: (progress: PublicationProgress) => void) {
  storeLibraryDocument(document);
  return publishDocument(document, qualityReport(document), onProgress);
}

function storeLibraryDocument(document: DocumentState) {
  localStorage.setItem("apertale.library.v4", JSON.stringify({
    activeBookId: document.id,
    documents: [document],
    sampleSourceVersion: 4,
  }));
}

function createMemoryStorage() {
  const storage = new Map<string, string>();
  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => { storage.clear(); },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function createTestLockManager() {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request<T>(name: string, _options: LockOptions, callback: () => Promise<T>) {
      const previous = tails.get(name) ?? Promise.resolve();
      const result = previous.catch(() => undefined).then(callback);
      tails.set(name, result.catch(() => undefined));
      return result;
    },
  } as Pick<LockManager, "request"> as LockManager;
}

type StoredRecordForTest = {
  documentId: string;
  bookId: string;
  manageToken: string;
  status: FakeBook["status"];
  shareToken?: string;
  uploadedAssetIds: string[];
  attemptAssetIds?: string[];
};

function storedRecord(documentId: string) {
  return JSON.parse(localStorage.getItem(`apertale.publication.v1:${documentId}`) ?? "null") as StoredRecordForTest;
}

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "cache-control": "private, no-store" },
  });
}

function installShareApi() {
  const books = new Map<string, FakeBook>();
  const deletedBooks = new Map<string, string>();
  const requests: Request[] = [];
  let deleteMode: "ok" | "fail" = "ok";
  let dropNextCreateResponse = false;
  let nextCreateRejection: { status: number; code: string } | null = null;
  let nextCreateFailureAfterCommit: number | null = null;
  let dropNextPublishResponse = false;
  let dropNextPublishAfterClaim = false;
  let dropNextRevokeResponse = false;
  let dropNextDeleteResponse = false;
  let nextDeleteBlock: { started: ReturnType<typeof deferred<void>>; released: ReturnType<typeof deferred<void>> } | null = null;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request
      ? input
      : new Request(new URL(String(input), "https://apertale.test"), init);
    requests.push(request.clone());
    const url = new URL(request.url, "https://apertale.test");
    const auth = request.headers.get("authorization");

    if (request.method === "POST" && url.pathname === "/api/books") {
      const payload = await request.json() as { bookId?: string };
      const bookId = payload.bookId;
      const manageToken = auth?.replace(/^Bearer /u, "");
      if (typeof bookId !== "string" || typeof manageToken !== "string") {
        return jsonResponse(400, { ok: false, code: "invalid_draft", message: "Invalid draft." });
      }
      const deletedManageToken = deletedBooks.get(bookId);
      if (deletedManageToken) {
        return deletedManageToken === manageToken
          ? jsonResponse(200, { ok: true, bookId, status: "deleted" })
          : jsonResponse(409, { ok: false, code: "book_exists", message: "Book exists." });
      }
      const existing = books.get(bookId);
      if (existing) {
        if (existing.manageToken !== manageToken) {
          return jsonResponse(409, { ok: false, code: "book_exists", message: "Book exists." });
        }
        return jsonResponse(200, { ok: true, bookId, status: existing.status });
      }
      if (nextCreateRejection) {
        const rejection = nextCreateRejection;
        nextCreateRejection = null;
        return jsonResponse(rejection.status, {
          ok: false,
          code: rejection.code,
          message: `Draft creation rejected: ${rejection.code}.`,
        });
      }
      books.set(bookId, { manageToken, status: "draft", assets: new Set(), retiredShareTokens: new Set() });
      if (nextCreateFailureAfterCommit) {
        const status = nextCreateFailureAfterCommit;
        nextCreateFailureAfterCommit = null;
        return jsonResponse(status, { ok: false, code: "storage_unavailable", message: "Create response failed after commit." });
      }
      if (dropNextCreateResponse) {
        dropNextCreateResponse = false;
        throw new TypeError("Failed to fetch");
      }
      return jsonResponse(201, { ok: true, bookId, status: "draft" });
    }

    const assetMatch = /^\/api\/books\/([^/]+)\/assets\/([^/]+)$/u.exec(url.pathname);
    if (assetMatch && request.method === "PUT") {
      const book = books.get(assetMatch[1]);
      const assetId = decodeURIComponent(assetMatch[2]);
      if (!book || auth !== `Bearer ${book.manageToken}`) {
        return jsonResponse(404, { ok: false, code: "not_found", message: "The book was not found." });
      }
      if (book.status !== "draft") {
        return jsonResponse(409, { ok: false, code: "invalid_state", message: "Only a fresh draft accepts assets." });
      }
      if (book.assets.has(assetId)) {
        return jsonResponse(409, {
          ok: false,
          code: "asset_exists",
          message: "Asset ids are immutable; upload changed content with a new asset id.",
        });
      }
      if (book.assets.size >= 50) {
        return jsonResponse(409, {
          ok: false,
          code: "asset_limit",
          message: "A book may contain at most 50 uploaded assets.",
        });
      }
      book.assets.add(assetId);
      return jsonResponse(200, { ok: true, bookId: assetMatch[1], assetId, byteSize: 8 });
    }

    const reconcileMatch = /^\/api\/books\/([^/]+)\/publish\/reconcile$/u.exec(url.pathname);
    if (reconcileMatch && request.method === "POST") {
      const book = books.get(reconcileMatch[1]);
      if (!book || auth !== `Bearer ${book.manageToken}`) {
        return jsonResponse(404, { ok: false, code: "not_found", message: "The book was not found." });
      }
      const payload = await request.json() as { shareToken?: string };
      if (book.status === "published") {
        if (payload.shareToken !== book.shareToken) {
          return jsonResponse(409, { ok: false, code: "invalid_state", message: "Share capability mismatch." });
        }
        return jsonResponse(200, {
          ok: true,
          bookId: reconcileMatch[1],
          status: "published",
          shareUrl: `https://apertale.test/share/${book.shareToken}`,
          publishedRevision: book.revision,
        });
      }
      if (book.status === "revoked") {
        return jsonResponse(200, { ok: true, bookId: reconcileMatch[1], status: "revoked" });
      }
      if (book.status !== "draft") {
        return jsonResponse(409, { ok: false, code: "invalid_state", message: "Publication cannot resume." });
      }
      if (typeof payload.shareToken === "string" && book.retiredShareTokens.has(payload.shareToken)) {
        return jsonResponse(200, { ok: true, bookId: reconcileMatch[1], status: "revoked" });
      }
      if (book.pendingShareToken && book.pendingShareToken !== payload.shareToken) {
        return jsonResponse(409, { ok: false, code: "publish_conflict", message: "Another publication owns this state." });
      }
      book.pendingShareToken = payload.shareToken;
      return jsonResponse(200, { ok: true, bookId: reconcileMatch[1], status: "publishing" });
    }

    const publishMatch = /^\/api\/books\/([^/]+)\/publish$/u.exec(url.pathname);
    if (publishMatch && request.method === "POST") {
      const book = books.get(publishMatch[1]);
      if (!book || auth !== `Bearer ${book.manageToken}`) {
        return jsonResponse(404, { ok: false, code: "not_found", message: "The book was not found." });
      }
      const payload = await request.json() as { manifest?: DocumentState; shareToken?: string };
      const shareToken = payload.shareToken;
      if (typeof shareToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(shareToken)) {
        return jsonResponse(400, { ok: false, code: "invalid_share_token", message: "A valid share token is required." });
      }
      if (book.status === "published") {
        if (book.shareToken === shareToken) {
          return jsonResponse(200, {
            ok: true,
            bookId: publishMatch[1],
            status: "published",
            shareUrl: `https://apertale.test/share/${shareToken}`,
            publishedRevision: book.revision,
          });
        }
        return jsonResponse(409, {
          ok: false,
          code: "invalid_state",
          message: "Only a draft or revoked book can be published.",
        });
      }
      if (book.status === "revoked") {
        return book.retiredShareTokens.has(shareToken)
          ? jsonResponse(409, { ok: false, code: "revoked_share", message: "A revoked share capability cannot be reused." })
          : jsonResponse(409, { ok: false, code: "invalid_state", message: "Create a fresh draft to republish." });
      }
      if (book.status !== "draft") {
        return jsonResponse(409, {
          ok: false,
          code: "invalid_state",
          message: "Only a draft or revoked book can be published.",
        });
      }
      if (book.retiredShareTokens.has(shareToken)) {
        return jsonResponse(409, {
          ok: false,
          code: "revoked_share",
          message: "A revoked share capability cannot be published again.",
        });
      }
      if (book.pendingShareToken && book.pendingShareToken !== shareToken) {
        return jsonResponse(409, {
          ok: false,
          code: "publish_conflict",
          message: "Another publication owns this state.",
        });
      }
      book.pendingShareToken = shareToken;
      if (dropNextPublishAfterClaim) {
        dropNextPublishAfterClaim = false;
        throw new TypeError("Failed to fetch");
      }
      const committed = books.get(publishMatch[1]);
      if (committed?.status === "published") {
        if (committed.shareToken !== shareToken) {
          return jsonResponse(409, { ok: false, code: "publish_conflict", message: "Publication changed." });
        }
        return jsonResponse(200, {
          ok: true,
          bookId: publishMatch[1],
          status: "published",
          shareUrl: `https://apertale.test/share/${shareToken}`,
          publishedRevision: committed.revision,
        });
      }
      book.status = "published";
      book.revision = payload.manifest?.revision;
      book.shareToken = shareToken;
      book.pendingShareToken = undefined;
      if (dropNextPublishResponse) {
        dropNextPublishResponse = false;
        throw new TypeError("Failed to fetch");
      }
      return jsonResponse(200, {
        ok: true,
        bookId: publishMatch[1],
        status: "published",
        shareUrl: `https://apertale.test/share/${shareToken}`,
        publishedRevision: book.revision,
      });
    }

    const revokeMatch = /^\/api\/books\/([^/]+)\/revoke$/u.exec(url.pathname);
    if (revokeMatch && request.method === "POST") {
      const book = books.get(revokeMatch[1]);
      if (!book || auth !== `Bearer ${book.manageToken}`) {
        return jsonResponse(404, { ok: false, code: "not_found", message: "The book was not found." });
      }
      const payload = await request.json() as { shareToken?: string };
      if (typeof payload.shareToken !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(payload.shareToken)) {
        return jsonResponse(400, { ok: false, code: "invalid_share_token", message: "A valid share token is required." });
      }
      if (book.status === "published" && book.shareToken === payload.shareToken) {
        book.retiredShareTokens.add(payload.shareToken);
        book.status = "revoked";
        book.pendingShareToken = undefined;
        book.assets.clear();
      } else if (!(book.status === "revoked" && book.retiredShareTokens.has(payload.shareToken))) {
        return jsonResponse(409, { ok: false, code: "revoke_conflict", message: "Publication changed." });
      }
      if (dropNextRevokeResponse) {
        dropNextRevokeResponse = false;
        throw new TypeError("Failed to fetch");
      }
      return jsonResponse(200, { ok: true, bookId: revokeMatch[1], status: "revoked" });
    }

    const deleteMatch = /^\/api\/books\/([^/]+)$/u.exec(url.pathname);
    if (deleteMatch && request.method === "DELETE") {
      if (nextDeleteBlock) {
        const block = nextDeleteBlock;
        nextDeleteBlock = null;
        block.started.resolve();
        await block.released.promise;
      }
      const book = books.get(deleteMatch[1]);
      if (!book || auth !== `Bearer ${book.manageToken}`) {
        return deletedBooks.get(deleteMatch[1]) === auth?.replace(/^Bearer /u, "")
          ? new Response(null, { status: 204, headers: { "cache-control": "private, no-store" } })
          : jsonResponse(409, { ok: false, code: "delete_conflict", message: "Confirm creation before deleting." });
      }
      if (deleteMode === "fail") {
        return jsonResponse(503, {
          ok: false,
          code: "storage_unavailable",
          message: "Book storage is temporarily unavailable.",
        });
      }
      deletedBooks.set(deleteMatch[1], book.manageToken);
      books.delete(deleteMatch[1]);
      if (dropNextDeleteResponse) {
        dropNextDeleteResponse = false;
        throw new TypeError("Failed to fetch");
      }
      return new Response(null, { status: 204, headers: { "cache-control": "private, no-store" } });
    }

    return jsonResponse(404, { ok: false, code: "not_found", message: "Not found." });
  });

  vi.stubGlobal("fetch", fetchMock);
  return {
    books,
    deletedBooks,
    requests,
    fetchMock,
    failDeletes() { deleteMode = "fail"; },
    succeedDeletes() { deleteMode = "ok"; },
    loseNextCreateResponse() { dropNextCreateResponse = true; },
    rejectNextCreate(status: number, code: string) { nextCreateRejection = { status, code }; },
    failNextCreateAfterCommit(status: number) { nextCreateFailureAfterCommit = status; },
    loseNextPublishResponse() { dropNextPublishResponse = true; },
    loseNextPublishAfterClaim() { dropNextPublishAfterClaim = true; },
    loseNextRevokeResponse() { dropNextRevokeResponse = true; },
    loseNextDeleteResponse() { dropNextDeleteResponse = true; },
    holdNextDelete() {
      const block = { started: deferred<void>(), released: deferred<void>() };
      nextDeleteBlock = block;
      return { started: block.started.promise, release: () => block.released.resolve() };
    },
  };
}

describe("publishing client", () => {
  beforeEach(() => {
    vi.stubGlobal("location", { origin: "https://apertale.test" });
    vi.stubGlobal("navigator", { locks: createTestLockManager() });
    vi.stubGlobal("localStorage", createMemoryStorage());
    storeLibraryDocument(documentState());
    getBlob.mockReset();
    getBlob.mockImplementation(async (assetId: string) => isStoredAssetId(assetId) ? PNG : null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a draft, uploads each local blob once, publishes the exact manifest, and persists the creator record", async () => {
    const api = installShareApi();
    const progress: PublicationProgress[] = [];
    const record = await publishReady(documentState(), (item) => progress.push(item));

    expect(record.status).toBe("published");
    expect(record.shareUrl).toMatch(/^https:\/\/apertale\.test\/share\/[A-Za-z0-9_-]{43}$/);
    expect(record.publishedRevision).toBe(4);
    expect(record).not.toHaveProperty("manageToken");
    expect(record).not.toHaveProperty("bookId");
    expect(record).not.toHaveProperty("shareToken");
    expect(record).not.toHaveProperty("uploadedAssetIds");
    expect(getPublicationRecord("warm-photo-story")).toEqual(record);
    const stored = storedRecord(record.documentId);
    expect(stored.manageToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(progress.map((item) => item.phase)).toEqual([
      "creating",
      "creating",
      ...Array.from({ length: listStoredPublishedAssetIds(documentState()).length + 1 }, () => "uploading" as const),
      "publishing",
      "publishing",
    ]);

    const methods = api.requests.map((request) => `${request.method} ${new URL(request.url, "https://apertale.test").pathname}`);
    expect(methods[0]).toBe("POST /api/books");
    expect(methods.filter((item) => item.startsWith("PUT "))).toHaveLength(
      listStoredPublishedAssetIds(documentState()).length,
    );
    expect(methods.at(-1)).toBe(`POST /api/books/${stored.bookId}/publish`);
    expect(api.fetchMock.mock.calls.every(([, init]) => init?.cache === "no-store")).toBe(true);
    expect(api.requests.every((request) => !request.url.includes(stored.manageToken))).toBe(true);
    expect(api.requests[0].headers.get("authorization")).toBe(`Bearer ${stored.manageToken}`);
    await expect(api.requests[0].json()).resolves.toEqual({ bookId: stored.bookId });
    expect(api.requests[1].headers.get("authorization")).toBe(`Bearer ${stored.manageToken}`);
    expect(api.requests[1].headers.get("content-type")).toBe("image/png");
    const publishRequest = api.requests.at(-1)!;
    const publishBody = await publishRequest.json() as { manifest: DocumentState; shareToken: string; quality: QualityReport };
    expect(publishBody.manifest).toEqual(documentState());
    expect(publishBody.shareToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(publishBody.quality).toEqual(qualityReport(documentState()));
    expect(record.shareUrl).toBe(`https://apertale.test/share/${publishBody.shareToken}`);
    expect(stored.shareToken).toBe(publishBody.shareToken);
    expect(stored.uploadedAssetIds).toHaveLength(listStoredPublishedAssetIds(documentState()).length);
    expect(getPublicationRecord(record.documentId)).not.toHaveProperty("uploadedAssetIds");
    expect(getPublicationRecord(record.documentId)).not.toHaveProperty("shareToken");

    const lateUpload = await fetch(`/api/books/${stored.bookId}/assets/${NEW_ID}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${stored.manageToken}`, "content-type": "image/png" },
      body: PNG,
    });
    expect(lateUpload.status).toBe(409);
    await expect(lateUpload.json()).resolves.toMatchObject({ code: "invalid_state" });
  });

  it("shares one synchronously persisted draft across cold concurrent publication", async () => {
    const api = installShareApi();
    const [first, second] = await Promise.all([
      publishReady(documentState()),
      publishReady(documentState()),
    ]);

    expect(first).toEqual(second);
    expect(api.books.size).toBe(1);
    expect(api.requests.filter((request) => (
      request.method === "POST"
      && new URL(request.url, "https://apertale.test").pathname === "/api/books"
    ))).toHaveLength(1);
    expect(api.requests.filter((request) => new URL(request.url, "https://apertale.test").pathname.endsWith("/publish"))).toHaveLength(1);
  });

  it("makes first-publication intent visible before the first blob read settles", async () => {
    const api = installShareApi();
    let resolveCover: ((blob: Blob) => void) | undefined;
    const pendingCover = new Promise<Blob>((resolve) => { resolveCover = resolve; });
    getBlob.mockImplementation(async (assetId: string) => (
      assetId === COVER_ID ? pendingCover : PNG
    ));

    const publishing = publishReady(documentState());

    expect(getPublicationRecord("warm-photo-story")).toMatchObject({ status: "draft" });
    expect(api.fetchMock).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(getBlob).toHaveBeenCalledWith(COVER_ID));
    resolveCover?.(PNG);
    await expect(publishing).resolves.toMatchObject({ status: "published" });
  });

  it("clears its own draft intent when the saved book disappears before the first async boundary", async () => {
    const api = installShareApi();
    const originalSetItem = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, "setItem").mockImplementation((key: string, value: string) => {
      originalSetItem(key, value);
      if (key === "apertale.publication.v1:warm-photo-story") {
        localStorage.removeItem("apertale.library.v4");
      }
    });

    await expect(publishDocument(documentState(), qualityReport(documentState()))).rejects.toMatchObject({
      code: "book_unavailable",
      retryable: false,
    });
    expect(getPublicationRecord("warm-photo-story")).toBeNull();
    expect(api.fetchMock).not.toHaveBeenCalled();
    expect(getBlob).not.toHaveBeenCalled();
  });

  it("fails closed before persistence when cross-tab publication locking is unavailable", async () => {
    const api = installShareApi();
    vi.stubGlobal("navigator", {});

    await expect(publishReady(documentState())).rejects.toMatchObject({
      code: "locking_unavailable",
      retryable: false,
    });
    expect(api.fetchMock).not.toHaveBeenCalled();
    expect(getBlob).not.toHaveBeenCalled();
    expect(getPublicationRecord("warm-photo-story")).toBeNull();
  });

  it("reuses the same locally persisted draft after its create response is lost", async () => {
    const api = installShareApi();
    api.loseNextCreateResponse();
    const interrupted = await publishReady(documentState()).catch((error: unknown) => error);
    expect(interrupted).toBeInstanceOf(PublicationError);
    expect(interrupted).toMatchObject({ code: "storage_unavailable", retryable: true });
    const savedDraft = getPublicationRecord("warm-photo-story");
    expect(savedDraft).toMatchObject({ status: "draft" });
    const savedPrivateDraft = storedRecord("warm-photo-story");
    expect(api.books.size).toBe(1);

    const published = await publishReady(documentState());
    expect(published).toMatchObject({ status: "published" });
    expect(storedRecord("warm-photo-story")).toMatchObject({
      bookId: savedPrivateDraft.bookId,
      manageToken: savedPrivateDraft.manageToken,
    });
    expect(api.books.size).toBe(1);
    const creates = api.requests.filter((request) => new URL(request.url, "https://apertale.test").pathname === "/api/books");
    expect(creates).toHaveLength(2);
    await expect(creates[0].clone().json()).resolves.toEqual(await creates[1].clone().json());
    expect(creates[0].headers.get("authorization")).toBe(creates[1].headers.get("authorization"));
  });

  it.each([
    [409, "book_exists"],
    [429, "creation_limit"],
    [429, "creation_rate"],
  ])("clears a definitely unowned draft after %i %s and retries with a fresh identity", async (status, code) => {
    const api = installShareApi();
    api.rejectNextCreate(status, code);

    await expect(publishReady(documentState())).rejects.toMatchObject({ status, code });
    expect(getPublicationRecord("warm-photo-story")).toBeNull();

    await expect(publishReady(documentState())).resolves.toMatchObject({ status: "published" });
    const creates = api.requests.filter((request) => (
      request.method === "POST"
      && new URL(request.url, "https://apertale.test").pathname === "/api/books"
    ));
    expect(creates).toHaveLength(2);
    const [firstBody, secondBody] = await Promise.all(creates.map((request) => request.clone().json() as Promise<{ bookId: string }>));
    expect(secondBody.bookId).not.toBe(firstBody.bookId);
    expect(creates[1].headers.get("authorization")).not.toBe(creates[0].headers.get("authorization"));
  });

  it.each([500, 503])("preserves the exact capability after an uncertain %i create response", async (status) => {
    const api = installShareApi();
    api.failNextCreateAfterCommit(status);

    await expect(publishReady(documentState())).rejects.toMatchObject({
      code: "storage_unavailable",
      status,
      retryable: true,
    });
    const interrupted = storedRecord("warm-photo-story");
    await expect(publishReady(documentState())).resolves.toMatchObject({ status: "published" });
    expect(storedRecord("warm-photo-story")).toMatchObject({
      bookId: interrupted.bookId,
      manageToken: interrupted.manageToken,
    });
    const creates = api.requests.filter((request) => new URL(request.url, "https://apertale.test").pathname === "/api/books");
    expect(creates).toHaveLength(2);
    await expect(creates[0].clone().json()).resolves.toEqual(await creates[1].clone().json());
    expect(creates[0].headers.get("authorization")).toBe(creates[1].headers.get("authorization"));
  });

  it("returns the existing share link when the published revision is unchanged", async () => {
    const api = installShareApi();
    const first = await publishReady(documentState());
    api.fetchMock.mockClear();
    getBlob.mockClear();
    const second = await publishDocument(documentState(), null);
    expect(second).toEqual(first);
    expect(api.fetchMock).not.toHaveBeenCalled();
    expect(getBlob).not.toHaveBeenCalled();
  });

  it("rejects a changed revision until the live share link is revoked", async () => {
    const api = installShareApi();
    const published = await publishReady(documentState());
    api.fetchMock.mockClear();
    getBlob.mockClear();
    const changed = documentState({ revision: 5 });
    storeLibraryDocument(changed);
    const revisionError = await publishDocument(changed, null).catch((error: unknown) => error);
    expect(revisionError).toBeInstanceOf(PublicationError);
    expect(revisionError).toMatchObject({ code: "revision_changed" });
    expect(getPublicationRecord("warm-photo-story")?.shareUrl).toBe(published.shareUrl);
    expect(api.fetchMock).not.toHaveBeenCalled();
    expect(getBlob).not.toHaveBeenCalled();
  });

  it("revokes the share URL, clears remote copies, and republishes the current asset set", async () => {
    const api = installShareApi();
    const published = await publishReady(documentState());
    const publishedPrivate = storedRecord("warm-photo-story");
    const revoked = await revokePublication("warm-photo-story");
    expect(revoked.status).toBe("revoked");
    expect(revoked.shareUrl).toBeUndefined();
    expect(revoked).not.toHaveProperty("manageToken");
    expect(revoked).not.toHaveProperty("bookId");
    expect(storedRecord("warm-photo-story")).toMatchObject({
      manageToken: publishedPrivate.manageToken,
      bookId: publishedPrivate.bookId,
      uploadedAssetIds: [],
    });

    const putCountAfterFirst = api.requests.filter((request) => request.method === "PUT").length;
    getBlob.mockImplementation(async (assetId: string) => (
      [...listStoredPublishedAssetIds(documentState()), NEW_ID].includes(assetId) ? PNG : null
    ));
    const republishDocument = documentState({
      revision: 5,
      spreads: [{
        ...documentState().spreads[0],
        elements: [{
          ...documentState().spreads[0].elements[0],
          frameAssetIds: [FRAME_A_ID, FRAME_B_ID, NEW_ID],
        }],
      }],
    });
    const republished = await publishReady(republishDocument);
    expect(republished.status).toBe("published");
    expect(republished.shareUrl).not.toBe(published.shareUrl);
    const republishedPrivate = storedRecord("warm-photo-story");
    expect(republishedPrivate.manageToken).not.toBe(publishedPrivate.manageToken);
    expect(republishedPrivate.bookId).not.toBe(publishedPrivate.bookId);
    const putRequests = api.requests.filter((request) => request.method === "PUT");
    expect(putRequests).toHaveLength(putCountAfterFirst + listStoredPublishedAssetIds(republishDocument).length);
    expect(decodeURIComponent(new URL(putRequests.at(-1)!.url, "https://apertale.test").pathname)).toContain(NEW_ID);
  });

  it("retries revocation with the same share capability after the response is lost", async () => {
    const api = installShareApi();
    await publishReady(documentState());
    const shareToken = storedRecord("warm-photo-story").shareToken;
    api.loseNextRevokeResponse();

    await expect(revokePublication("warm-photo-story")).rejects.toMatchObject({
      code: "storage_unavailable",
      retryable: true,
    });
    expect(storedRecord("warm-photo-story")).toMatchObject({ status: "published", shareToken });
    await expect(revokePublication("warm-photo-story")).resolves.toMatchObject({ status: "revoked" });

    const revokeRequests = api.requests.filter((request) => new URL(request.url).pathname.endsWith("/revoke"));
    expect(revokeRequests).toHaveLength(2);
    await expect(Promise.all(revokeRequests.map((request) => request.json()))).resolves.toEqual([
      { shareToken },
      { shareToken },
    ]);
  });

  it("fails safely when a legacy published record has no revocation capability", async () => {
    const api = installShareApi();
    localStorage.setItem("apertale.publication.v1:warm-photo-story", JSON.stringify({
      documentId: "warm-photo-story",
      bookId: "123e4567-e89b-42d3-a456-426614174099",
      manageToken: "z".repeat(43),
      status: "published",
      shareUrl: `https://apertale.test/share/${"y".repeat(43)}`,
      publishedRevision: 4,
      uploadedAssetIds: [],
    }));

    await expect(revokePublication("warm-photo-story")).rejects.toMatchObject({
      code: "missing_capability",
      retryable: false,
    });
    expect(api.fetchMock).not.toHaveBeenCalled();
    expect(storedRecord("warm-photo-story")).toMatchObject({ status: "published" });
  });

  it("keeps the local capability after a failed delete and clears it only after success", async () => {
    const api = installShareApi();
    await publishReady(documentState());
    const privateRecord = storedRecord("warm-photo-story");
    api.failDeletes();
    const deleteError = await deletePublication("warm-photo-story").catch((error: unknown) => error);
    expect(deleteError).toBeInstanceOf(PublicationError);
    expect(deleteError).toMatchObject({
      code: "storage_unavailable",
      retryable: true,
    });
    expect(getPublicationRecord("warm-photo-story")).toMatchObject({ status: "deleting" });
    expect(getPublicationRecord("warm-photo-story")?.shareUrl).toBeUndefined();
    expect(storedRecord("warm-photo-story")).toMatchObject({
      status: "deleting",
      bookId: privateRecord.bookId,
      manageToken: privateRecord.manageToken,
    });

    api.succeedDeletes();
    await deletePublication("warm-photo-story");
    expect(getPublicationRecord("warm-photo-story")).toBeNull();
  });

  it("finishes an acknowledged remote deletion after its response is lost", async () => {
    const api = installShareApi();
    await publishReady(documentState());
    const privateRecord = storedRecord("warm-photo-story");
    api.loseNextDeleteResponse();

    await expect(deletePublication("warm-photo-story")).rejects.toMatchObject({
      code: "storage_unavailable",
      retryable: true,
    });
    expect(api.books.has(privateRecord.bookId)).toBe(false);
    expect(api.deletedBooks.get(privateRecord.bookId)).toBe(privateRecord.manageToken);
    expect(getPublicationRecord("warm-photo-story")).toMatchObject({ status: "deleting" });

    await deletePublication("warm-photo-story");
    expect(getPublicationRecord("warm-photo-story")).toBeNull();
    expect(api.requests.filter((request) => request.method === "DELETE")).toHaveLength(1);
  });

  it("confirms a local-only draft before permanently deleting it", async () => {
    const api = installShareApi();
    const bookId = "123e4567-e89b-42d3-a456-426614174088";
    const manageToken = "x".repeat(43);
    localStorage.setItem("apertale.publication.v1:warm-photo-story", JSON.stringify({
      documentId: "warm-photo-story",
      bookId,
      manageToken,
      status: "draft",
      uploadedAssetIds: [],
      attemptAssetIds: [],
    }));

    await deletePublication("warm-photo-story");

    expect(getPublicationRecord("warm-photo-story")).toBeNull();
    expect(api.books.has(bookId)).toBe(false);
    expect(api.deletedBooks.get(bookId)).toBe(manageToken);
    expect(api.requests.slice(-2).map((request) => request.method)).toEqual(["POST", "DELETE"]);
  });

  it.each([
    [409, "book_exists"],
    [429, "creation_limit"],
    [429, "creation_rate"],
  ])("clears a definitely unowned legacy draft after %i %s without deleting a foreign book", async (status, code) => {
    const api = installShareApi();
    api.rejectNextCreate(status, code);
    localStorage.setItem("apertale.publication.v1:warm-photo-story", JSON.stringify({
      documentId: "warm-photo-story",
      bookId: "123e4567-e89b-42d3-a456-426614174087",
      manageToken: "w".repeat(43),
      status: "draft",
      uploadedAssetIds: [],
      attemptAssetIds: [],
    }));

    await expect(deletePublication("warm-photo-story")).resolves.toBeUndefined();
    expect(getPublicationRecord("warm-photo-story")).toBeNull();
    expect(api.requests.filter((request) => request.method === "DELETE")).toHaveLength(0);
  });

  it("rotates to a fresh server generation before publishing after a post-commit delete response is lost", async () => {
    const api = installShareApi();
    await publishReady(documentState());
    const previous = storedRecord("warm-photo-story");
    api.loseNextDeleteResponse();
    await expect(deletePublication("warm-photo-story")).rejects.toMatchObject({ code: "storage_unavailable" });
    expect(api.deletedBooks.get(previous.bookId)).toBe(previous.manageToken);

    await expect(publishReady(documentState())).resolves.toMatchObject({ status: "published" });
    const replacement = storedRecord("warm-photo-story");
    expect(replacement.bookId).not.toBe(previous.bookId);
    expect(replacement.manageToken).not.toBe(previous.manageToken);
    expect(api.books.has(previous.bookId)).toBe(false);
    expect(api.books.get(replacement.bookId)?.status).toBe("published");
    expect(api.requests.filter((request) => request.method === "DELETE")).toHaveLength(1);
  });

  it("recreates publication intent before blob work after waiting behind deletion", async () => {
    const api = installShareApi();
    await publishReady(documentState());
    const heldDelete = api.holdNextDelete();
    const deleting = deletePublication("warm-photo-story");
    await heldDelete.started;

    let resolveCover: ((blob: Blob) => void) | undefined;
    const pendingCover = new Promise<Blob>((resolve) => { resolveCover = resolve; });
    getBlob.mockImplementation(async (assetId: string) => assetId === COVER_ID ? pendingCover : PNG);
    const republishing = publishReady(documentState());
    heldDelete.release();
    await deleting;
    await vi.waitFor(() => expect(getBlob).toHaveBeenCalledWith(COVER_ID));

    expect(getPublicationRecord("warm-photo-story")).toMatchObject({ status: "draft" });
    resolveCover?.(PNG);
    await expect(republishing).resolves.toMatchObject({ status: "published" });
  });

  it("ignores malformed local publication state instead of using a broken capability", () => {
    localStorage.setItem("apertale.publication.v1:warm-photo-story", "{not-json");
    expect(getPublicationRecord("warm-photo-story")).toBeNull();
    localStorage.setItem("apertale.publication.v1:warm-photo-story", JSON.stringify({
      documentId: "other-book",
      bookId: "not-a-uuid",
      manageToken: "short",
      status: "published",
      shareUrl: "https://apertale.test/share/secret",
    }));
    expect(getPublicationRecord("warm-photo-story")).toBeNull();
  });

  it("keeps a recoverable local draft when a referenced local blob is missing", async () => {
    const api = installShareApi();
    getBlob.mockImplementation(async (assetId: string) => assetId === COVER_ID ? null : PNG);
    const missingError = await publishReady(documentState()).catch((error: unknown) => error);
    expect(missingError).toBeInstanceOf(PublicationError);
    expect(missingError).toMatchObject({ code: "missing_assets" });
    expect(api.fetchMock).not.toHaveBeenCalled();
    expect(getPublicationRecord("warm-photo-story")).toMatchObject({ status: "draft" });
  });

  it("fails the quality gate before reading blobs or creating a draft", async () => {
    const api = installShareApi();
    const blocked = await publishDocument(documentState(), null).catch((error: unknown) => error);
    expect(blocked).toBeInstanceOf(PublicationError);
    expect(blocked).toMatchObject({ code: "quality_blocked", retryable: false });
    expect(getBlob).not.toHaveBeenCalled();
    expect(api.fetchMock).not.toHaveBeenCalled();
  });

  it("publishes when warnings are explicitly recorded in an otherwise passing critique", async () => {
    installShareApi();
    const document = documentState();
    const record = await publishDocument(document, qualityReport(document, true));
    expect(record.status).toBe("published");
  });

  it("recovers the same share link if the first publish response is lost after server commit", async () => {
    const api = installShareApi();
    api.loseNextPublishResponse();
    const lost = await publishReady(documentState()).catch((error: unknown) => error);
    expect(lost).toBeInstanceOf(PublicationError);
    expect(lost).toMatchObject({ code: "storage_unavailable", retryable: true });
    expect(getPublicationRecord("warm-photo-story")).toMatchObject({ status: "publishing" });
    expect(getPublicationRecord("warm-photo-story")).not.toHaveProperty("shareToken");
    const stored = JSON.parse(localStorage.getItem("apertale.publication.v1:warm-photo-story") ?? "null") as {
      shareToken?: string;
      uploadedAssetIds?: string[];
    };
    expect(stored.shareToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const putCount = api.requests.filter((request) => request.method === "PUT").length;
    expect(putCount).toBe(listStoredPublishedAssetIds(documentState()).length);

    getBlob.mockClear();
    const changed = documentState({ revision: 5 });
    storeLibraryDocument(changed);
    const recovered = await publishDocument(changed, null);
    expect(recovered.status).toBe("published");
    expect(recovered.publishedRevision).toBe(4);
    expect(recovered.shareUrl).toBe(`https://apertale.test/share/${stored.shareToken}`);
    expect(recovered.shareUrl).toMatch(/^https:\/\/apertale\.test\/share\/[A-Za-z0-9_-]{43}$/);
    expect(recovered).not.toHaveProperty("shareToken");
    expect(api.requests.filter((request) => request.method === "PUT")).toHaveLength(putCount);
    expect(getBlob).not.toHaveBeenCalled();
    expect(api.requests.filter((request) => {
      const path = new URL(request.url, "https://apertale.test").pathname;
      return request.method === "POST" && path.endsWith("/publish");
    })).toHaveLength(1);
    expect(api.requests.some((request) => new URL(request.url, "https://apertale.test").pathname.endsWith("/publish/reconcile"))).toBe(true);
  });

  it("resumes the same server-side publish claim after the original client disappears", async () => {
    const api = installShareApi();
    api.loseNextPublishAfterClaim();
    await expect(publishReady(documentState())).rejects.toMatchObject({
      code: "storage_unavailable",
      retryable: true,
    });

    expect(getPublicationRecord("warm-photo-story")).toMatchObject({ status: "publishing" });
    const originalToken = storedRecord("warm-photo-story").shareToken;
    const resumed = await publishReady(documentState());

    expect(resumed.status).toBe("published");
    expect(resumed.shareUrl).toBe(`https://apertale.test/share/${originalToken}`);
    const publishBodies = await Promise.all(api.requests
      .filter((request) => new URL(request.url, "https://apertale.test").pathname.endsWith("/publish"))
      .map((request) => request.json() as Promise<{ shareToken: string }>));
    expect(publishBodies).toHaveLength(2);
    expect(new Set(publishBodies.map((body) => body.shareToken))).toEqual(new Set([originalToken]));
  });

  it("replaces an interrupted draft when its legal reader asset plan changes", async () => {
    const api = installShareApi();
    const interruptedDocument = documentState();
    expect(listStoredPublishedAssetIds(interruptedDocument)).toHaveLength(4);
    api.loseNextPublishAfterClaim();
    await expect(publishReady(interruptedDocument)).rejects.toMatchObject({ code: "storage_unavailable", retryable: true });
    const interrupted = storedRecord(interruptedDocument.id);
    expect(interrupted.uploadedAssetIds).toHaveLength(4);
    expect(api.books.get(interrupted.bookId)?.assets.size).toBe(4);

    const replacementAssetId = "asset:0000ffff-1234-4234-8234-123456789abc";
    const changed = documentState({
      revision: 5,
      spreads: [{
        ...interruptedDocument.spreads[0],
        elements: [{
          ...interruptedDocument.spreads[0].elements[0],
          frameAssetIds: [FRAME_A_ID, replacementAssetId],
        }, interruptedDocument.spreads[0].elements[1]],
      }],
    });
    expect(listStoredPublishedAssetIds(changed)).toHaveLength(4);
    const published = await publishReady(changed);

    expect(published).toMatchObject({ status: "published", publishedRevision: 5 });
    const replacement = storedRecord(changed.id);
    expect(replacement.bookId).not.toBe(interrupted.bookId);
    expect(replacement.manageToken).not.toBe(interrupted.manageToken);
    expect(api.books.has(interrupted.bookId)).toBe(false);
    expect(api.books.get(replacement.bookId)?.assets.size).toBe(4);
    expect(api.requests.filter((request) => request.method === "PUT")).toHaveLength(8);
  });

  it("rotates a definitely unowned changed-plan draft without deleting a foreign book", async () => {
    const api = installShareApi();
    api.rejectNextCreate(409, "book_exists");
    const foreignBookId = "123e4567-e89b-42d3-a456-426614174086";
    localStorage.setItem("apertale.publication.v1:warm-photo-story", JSON.stringify({
      documentId: "warm-photo-story",
      bookId: foreignBookId,
      manageToken: "v".repeat(43),
      status: "draft",
      uploadedAssetIds: [],
      attemptAssetIds: [NEW_ID],
    }));

    await expect(publishReady(documentState())).resolves.toMatchObject({ status: "published" });
    expect(storedRecord("warm-photo-story").bookId).not.toBe(foreignBookId);
    expect(api.requests.filter((request) => request.method === "DELETE")).toHaveLength(0);
  });

  it("rotates a legacy draft with no asset-plan fingerprint before uploading", async () => {
    const api = installShareApi();
    const legacyBookId = "123e4567-e89b-42d3-a456-426614174099";
    const legacyManageToken = "z".repeat(43);
    api.books.set(legacyBookId, {
      manageToken: legacyManageToken,
      status: "draft",
      assets: new Set(listStoredPublishedAssetIds(documentState())),
      retiredShareTokens: new Set(),
    });
    localStorage.setItem("apertale.publication.v1:warm-photo-story", JSON.stringify({
      documentId: "warm-photo-story",
      bookId: legacyBookId,
      manageToken: legacyManageToken,
      status: "draft",
      uploadedAssetIds: listStoredPublishedAssetIds(documentState()),
    }));

    const published = await publishReady(documentState());

    expect(published.status).toBe("published");
    expect(api.books.has(legacyBookId)).toBe(false);
    expect(storedRecord("warm-photo-story").bookId).not.toBe(legacyBookId);
  });

  it("uses a new share capability when recovery finds that the interrupted link was revoked", async () => {
    const api = installShareApi();
    api.loseNextPublishResponse();
    await expect(publishReady(documentState())).rejects.toMatchObject({ retryable: true });
    const saved = JSON.parse(localStorage.getItem("apertale.publication.v1:warm-photo-story") ?? "null") as {
      bookId: string;
      shareToken: string;
    };
    const serverBook = api.books.get(saved.bookId);
    expect(serverBook?.status).toBe("published");
    serverBook!.retiredShareTokens.add(saved.shareToken);
    serverBook!.status = "revoked";
    serverBook!.pendingShareToken = undefined;

    const staleStored = storedRecord("warm-photo-story") as StoredRecordForTest & {
      shareUrl?: string;
      publishedRevision?: number;
    };
    localStorage.setItem("apertale.publication.v1:warm-photo-story", JSON.stringify({
      ...staleStored,
      shareUrl: `https://apertale.test/share/${saved.shareToken}`,
      publishedRevision: 4,
    }));
    const changed = documentState({ revision: 5 });
    storeLibraryDocument(changed);
    await expect(publishDocument(changed, null)).rejects.toMatchObject({ code: "quality_blocked" });
    expect(getPublicationRecord("warm-photo-story")).toEqual({
      documentId: "warm-photo-story",
      status: "revoked",
    });
    expect(storedRecord("warm-photo-story")).not.toHaveProperty("shareUrl");
    expect(storedRecord("warm-photo-story")).not.toHaveProperty("publishedRevision");

    const republished = await publishReady(documentState({ revision: 5 }));

    expect(republished.status).toBe("published");
    expect(republished.publishedRevision).toBe(5);
    expect(republished.shareUrl).not.toBe(`https://apertale.test/share/${saved.shareToken}`);
  });
});
