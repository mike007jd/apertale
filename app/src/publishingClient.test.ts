import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStoredAssetBlob } from "./assetStore";
import {
  collectLocalAssetIds,
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
}));

const getBlob = vi.mocked(getStoredAssetBlob);

const COVER_ID = "asset:12345678-1234-4234-8234-123456789abc";
const TEXTURE_ID = "asset:22345678-1234-4234-8234-123456789abc";
const CLEAN_ID = "asset:32345678-1234-4234-8234-123456789abc";
const SOURCE_ID = "asset:42345678-1234-4234-8234-123456789abc";
const ELEMENT_ID = "asset:52345678-1234-4234-8234-123456789abc";
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
        sourceAssetId: SOURCE_ID,
        separation: "inpainted-clean-plate",
      },
      title: "Home",
      body: "A remembered afternoon.",
      elements: [{
        id: "photo",
        label: "Family photo",
        kind: "lifted",
        assetId: ELEMENT_ID,
        frameAssetIds: [FRAME_A_ID, FRAME_B_ID],
        page: "right",
        transform: { x: 0.5, y: 0.5, scaleX: 0.8, scaleY: 0.8, rotationDeg: 0 },
        depth: 0.1,
        locked: false,
        provenance: "human",
      }],
    }],
    ...overrides,
  };
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

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "cache-control": "private, no-store" },
  });
}

function installShareApi() {
  const books = new Map<string, FakeBook>();
  const requests: Request[] = [];
  let bookSerial = 0;
  let deleteMode: "ok" | "fail" = "ok";
  let dropNextPublishResponse = false;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request
      ? input
      : new Request(new URL(String(input), "https://apertale.test"), init);
    requests.push(request.clone());
    const url = new URL(request.url, "https://apertale.test");
    const auth = request.headers.get("authorization");

    if (request.method === "POST" && url.pathname === "/api/books") {
      const bookId = `aaaaaaaa-bbbb-4ccc-8ddd-${String(++bookSerial).padStart(12, "0")}`;
      const manageToken = `${"a".repeat(42)}${bookSerial}`;
      books.set(bookId, { manageToken, status: "draft", assets: new Set() });
      return jsonResponse(201, { ok: true, bookId, manageToken, status: "draft" });
    }

    const assetMatch = /^\/api\/books\/([^/]+)\/assets\/([^/]+)$/u.exec(url.pathname);
    if (assetMatch && request.method === "PUT") {
      const book = books.get(assetMatch[1]);
      const assetId = decodeURIComponent(assetMatch[2]);
      if (!book || auth !== `Bearer ${book.manageToken}`) {
        return jsonResponse(404, { ok: false, code: "not_found", message: "The book was not found." });
      }
      if (book.assets.has(assetId)) {
        return jsonResponse(409, {
          ok: false,
          code: "asset_exists",
          message: "Asset ids are immutable; upload changed content with a new asset id.",
        });
      }
      book.assets.add(assetId);
      return jsonResponse(200, { ok: true, bookId: assetMatch[1], assetId, byteSize: 8 });
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
        if (book.revision === payload.manifest?.revision && book.shareToken === shareToken) {
          return jsonResponse(200, {
            ok: true,
            bookId: publishMatch[1],
            status: "published",
            shareUrl: `https://apertale.test/share/${shareToken}`,
          });
        }
        return jsonResponse(409, {
          ok: false,
          code: "invalid_state",
          message: "Only a draft or revoked book can be published.",
        });
      }
      if (book.status !== "draft" && book.status !== "revoked") {
        return jsonResponse(409, {
          ok: false,
          code: "invalid_state",
          message: "Only a draft or revoked book can be published.",
        });
      }
      book.status = "published";
      book.revision = payload.manifest?.revision;
      book.shareToken = shareToken;
      if (dropNextPublishResponse) {
        dropNextPublishResponse = false;
        throw new TypeError("Failed to fetch");
      }
      return jsonResponse(200, {
        ok: true,
        bookId: publishMatch[1],
        status: "published",
        shareUrl: `https://apertale.test/share/${shareToken}`,
      });
    }

    const revokeMatch = /^\/api\/books\/([^/]+)\/revoke$/u.exec(url.pathname);
    if (revokeMatch && request.method === "POST") {
      const book = books.get(revokeMatch[1]);
      if (!book || auth !== `Bearer ${book.manageToken}`) {
        return jsonResponse(404, { ok: false, code: "not_found", message: "The book was not found." });
      }
      book.status = "revoked";
      book.shareToken = undefined;
      return jsonResponse(200, { ok: true, bookId: revokeMatch[1], status: "revoked" });
    }

    const deleteMatch = /^\/api\/books\/([^/]+)$/u.exec(url.pathname);
    if (deleteMatch && request.method === "DELETE") {
      const book = books.get(deleteMatch[1]);
      if (!book || auth !== `Bearer ${book.manageToken}`) {
        return jsonResponse(404, { ok: false, code: "not_found", message: "The book was not found." });
      }
      if (deleteMode === "fail") {
        return jsonResponse(503, {
          ok: false,
          code: "storage_unavailable",
          message: "Book storage is temporarily unavailable.",
        });
      }
      books.delete(deleteMatch[1]);
      return new Response(null, { status: 204, headers: { "cache-control": "private, no-store" } });
    }

    return jsonResponse(404, { ok: false, code: "not_found", message: "Not found." });
  });

  vi.stubGlobal("fetch", fetchMock);
  return {
    books,
    requests,
    fetchMock,
    failDeletes() { deleteMode = "fail"; },
    succeedDeletes() { deleteMode = "ok"; },
    loseNextPublishResponse() { dropNextPublishResponse = true; },
  };
}

describe("publishing client", () => {
  beforeEach(() => {
    vi.stubGlobal("location", { origin: "https://apertale.test" });
    vi.stubGlobal("localStorage", createMemoryStorage());
    getBlob.mockReset();
    getBlob.mockImplementation(async (assetId: string) => LOCAL_ASSET_PATTERN_TEST(assetId) ? PNG : null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts every local asset reference from cover, spread, artwork, elements, and frames", () => {
    expect(collectLocalAssetIds(documentState({
      coverTextureUrl: "/assets/covers/custom.png",
      spreads: [{
        ...documentState().spreads[0],
        textureUrl: "/assets/generated/clean.png",
        elements: [{
          ...documentState().spreads[0].elements[0],
          assetId: "procedural:hotspot:amber",
        }],
      }],
    }))).toEqual([COVER_ID, CLEAN_ID, SOURCE_ID, FRAME_A_ID, FRAME_B_ID]);
    expect(collectLocalAssetIds(documentState())).toEqual([
      COVER_ID,
      TEXTURE_ID,
      CLEAN_ID,
      SOURCE_ID,
      ELEMENT_ID,
      FRAME_A_ID,
      FRAME_B_ID,
    ]);
  });

  it("creates a draft, uploads each local blob once, publishes the exact manifest, and persists the creator record", async () => {
    const api = installShareApi();
    const progress: PublicationProgress[] = [];
    const record = await publishDocument(documentState(), (item) => progress.push(item));

    expect(record.status).toBe("published");
    expect(record.shareUrl).toMatch(/^https:\/\/apertale\.test\/share\/[A-Za-z0-9_-]{43}$/);
    expect(record.publishedRevision).toBe(4);
    expect(record.manageToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(record).not.toHaveProperty("shareToken");
    expect(record).not.toHaveProperty("uploadedAssetIds");
    expect(getPublicationRecord("warm-photo-story")).toEqual(record);
    expect(progress.map((item) => item.phase)).toEqual([
      "creating",
      "creating",
      "uploading",
      "uploading",
      "uploading",
      "uploading",
      "uploading",
      "uploading",
      "uploading",
      "uploading",
      "publishing",
      "publishing",
    ]);

    const methods = api.requests.map((request) => `${request.method} ${new URL(request.url, "https://apertale.test").pathname}`);
    expect(methods[0]).toBe("POST /api/books");
    expect(methods.filter((item) => item.startsWith("PUT "))).toHaveLength(7);
    expect(methods.at(-1)).toBe(`POST /api/books/${record.bookId}/publish`);
    expect(api.fetchMock.mock.calls.every(([, init]) => init?.cache === "no-store")).toBe(true);
    expect(api.requests.every((request) => !request.url.includes(record.manageToken))).toBe(true);
    expect(api.requests[0].headers.get("authorization")).toBeNull();
    expect(api.requests[1].headers.get("authorization")).toBe(`Bearer ${record.manageToken}`);
    expect(api.requests[1].headers.get("content-type")).toBe("image/png");
    const publishRequest = api.requests.at(-1)!;
    const publishBody = await publishRequest.json() as { manifest: DocumentState; shareToken: string };
    expect(publishBody.manifest).toEqual(documentState());
    expect(publishBody.shareToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(record.shareUrl).toBe(`https://apertale.test/share/${publishBody.shareToken}`);
    const stored = JSON.parse(localStorage.getItem(`apertale.publication.v1:${record.documentId}`) ?? "null") as {
      manageToken?: string;
      shareToken?: string;
      uploadedAssetIds?: string[];
    };
    expect(stored.manageToken).toBe(record.manageToken);
    expect(stored.shareToken).toBe(publishBody.shareToken);
    expect(stored.uploadedAssetIds).toHaveLength(7);
    expect(getPublicationRecord(record.documentId)).not.toHaveProperty("uploadedAssetIds");
    expect(getPublicationRecord(record.documentId)).not.toHaveProperty("shareToken");
  });

  it("returns the existing share link when the published revision is unchanged", async () => {
    const api = installShareApi();
    const first = await publishDocument(documentState());
    api.fetchMock.mockClear();
    getBlob.mockClear();
    const second = await publishDocument(documentState());
    expect(second).toEqual(first);
    expect(api.fetchMock).not.toHaveBeenCalled();
    expect(getBlob).not.toHaveBeenCalled();
  });

  it("rejects a changed revision until the live share link is revoked", async () => {
    const api = installShareApi();
    const published = await publishDocument(documentState());
    api.fetchMock.mockClear();
    getBlob.mockClear();
    const revisionError = await publishDocument(documentState({ revision: 5 })).catch((error: unknown) => error);
    expect(revisionError).toBeInstanceOf(PublicationError);
    expect(revisionError).toMatchObject({ code: "revision_changed" });
    expect(getPublicationRecord("warm-photo-story")?.shareUrl).toBe(published.shareUrl);
    expect(api.fetchMock).not.toHaveBeenCalled();
    expect(getBlob).not.toHaveBeenCalled();
  });

  it("revokes the share URL, keeps the capability, and republishes without re-uploading immutable assets", async () => {
    const api = installShareApi();
    const published = await publishDocument(documentState());
    const revoked = await revokePublication("warm-photo-story");
    expect(revoked.status).toBe("revoked");
    expect(revoked.shareUrl).toBeUndefined();
    expect(revoked.manageToken).toBe(published.manageToken);
    expect(revoked.bookId).toBe(published.bookId);

    const putCountAfterFirst = api.requests.filter((request) => request.method === "PUT").length;
    getBlob.mockImplementation(async (assetId: string) => (
      [...collectLocalAssetIds(documentState()), NEW_ID].includes(assetId) ? PNG : null
    ));
    const republished = await publishDocument(documentState({
      revision: 5,
      spreads: [{
        ...documentState().spreads[0],
        elements: [{
          ...documentState().spreads[0].elements[0],
          frameAssetIds: [FRAME_A_ID, FRAME_B_ID, NEW_ID],
        }],
      }],
    }));
    expect(republished.status).toBe("published");
    expect(republished.shareUrl).not.toBe(published.shareUrl);
    expect(republished.manageToken).toBe(published.manageToken);
    const putRequests = api.requests.filter((request) => request.method === "PUT");
    expect(putRequests).toHaveLength(putCountAfterFirst + 1);
    expect(decodeURIComponent(new URL(putRequests.at(-1)!.url, "https://apertale.test").pathname)).toContain(NEW_ID);
  });

  it("keeps the local capability after a failed delete and clears it only after success", async () => {
    const api = installShareApi();
    const published = await publishDocument(documentState());
    api.failDeletes();
    const deleteError = await deletePublication("warm-photo-story").catch((error: unknown) => error);
    expect(deleteError).toBeInstanceOf(PublicationError);
    expect(deleteError).toMatchObject({
      code: "storage_unavailable",
      retryable: true,
    });
    expect(getPublicationRecord("warm-photo-story")).toEqual(published);

    api.succeedDeletes();
    await deletePublication("warm-photo-story");
    expect(getPublicationRecord("warm-photo-story")).toBeNull();
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

  it("fails before creating a draft when a referenced local blob is missing", async () => {
    const api = installShareApi();
    getBlob.mockImplementation(async (assetId: string) => assetId === COVER_ID ? null : PNG);
    const missingError = await publishDocument(documentState()).catch((error: unknown) => error);
    expect(missingError).toBeInstanceOf(PublicationError);
    expect(missingError).toMatchObject({ code: "missing_assets" });
    expect(api.fetchMock).not.toHaveBeenCalled();
    expect(getPublicationRecord("warm-photo-story")).toBeNull();
  });

  it("recovers the same share link if the first publish response is lost after server commit", async () => {
    const api = installShareApi();
    api.loseNextPublishResponse();
    const lost = await publishDocument(documentState()).catch((error: unknown) => error);
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
    expect(putCount).toBe(7);

    const recovered = await publishDocument(documentState());
    expect(recovered.status).toBe("published");
    expect(recovered.shareUrl).toBe(`https://apertale.test/share/${stored.shareToken}`);
    expect(recovered.shareUrl).toMatch(/^https:\/\/apertale\.test\/share\/[A-Za-z0-9_-]{43}$/);
    expect(recovered).not.toHaveProperty("shareToken");
    expect(api.requests.filter((request) => request.method === "PUT")).toHaveLength(putCount);
    expect(api.requests.filter((request) => {
      const path = new URL(request.url, "https://apertale.test").pathname;
      return request.method === "POST" && path.endsWith("/publish");
    })).toHaveLength(2);
  });
});

function LOCAL_ASSET_PATTERN_TEST(assetId: string) {
  return /^asset:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assetId);
}
