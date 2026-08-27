import assert from "node:assert/strict";
import test from "node:test";
import { createBookShareApi } from "../worker/bookShareApi.js";

class MemoryRepository {
  books = new Map();
  assets = new Map();

  async createBook({ id, manageTokenHash, now }) {
    this.books.set(id, { id, manageTokenHash, status: "draft", created_at: now });
  }

  async findManagedBook(id, manageTokenHash) {
    const book = this.books.get(id);
    return book?.manageTokenHash === manageTokenHash ? book : null;
  }

  async insertAsset(asset) {
    if (this.assets.has(`${asset.bookId}:${asset.assetId}`)) throw new Error("duplicate asset id");
    this.assets.set(`${asset.bookId}:${asset.assetId}`, {
      ...asset,
      object_key: asset.objectKey,
      content_type: asset.contentType,
      byte_size: asset.byteSize,
    });
  }

  async listAssetIds(bookId) {
    return [...this.assets.values()].filter((asset) => asset.bookId === bookId).map((asset) => asset.assetId);
  }

  async publishBook({ id, manageTokenHash, shareTokenHash, title, revision, manifestJson, now }) {
    const book = await this.findManagedBook(id, manageTokenHash);
    if (!book || !["draft", "revoked"].includes(book.status)) return false;
    Object.assign(book, {
      shareTokenHash,
      status: "published",
      title,
      revision,
      manifest_json: manifestJson,
      published_at: now,
    });
    return true;
  }

  async findPublishedBook(shareTokenHash) {
    return [...this.books.values()].find((book) => book.shareTokenHash === shareTokenHash && book.status === "published") ?? null;
  }

  async findPublishedAsset(shareTokenHash, assetId) {
    const book = await this.findPublishedBook(shareTokenHash);
    return book ? this.assets.get(`${book.id}:${assetId}`) ?? null : null;
  }

  async revokeBook({ id, manageTokenHash, now }) {
    const book = await this.findManagedBook(id, manageTokenHash);
    if (!book || book.status !== "published") return false;
    Object.assign(book, { shareTokenHash: null, status: "revoked", revoked_at: now });
    return true;
  }

  async markDeleting({ id, manageTokenHash }) {
    const book = await this.findManagedBook(id, manageTokenHash);
    if (!book) return false;
    book.status = "deleting";
    book.shareTokenHash = null;
    return true;
  }

  async listAssets(bookId) {
    return [...this.assets.values()].filter((asset) => asset.bookId === bookId);
  }

  async deleteBook({ id, manageTokenHash }) {
    const book = await this.findManagedBook(id, manageTokenHash);
    if (!book || book.status !== "deleting") return false;
    this.books.delete(id);
    return true;
  }
}

class MemoryObjects {
  values = new Map();

  async put(key, value, options) {
    this.values.set(key, { body: new Uint8Array(value), contentType: options.httpMetadata.contentType });
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async head(key) {
    return this.values.has(key) ? { httpEtag: '"memory"' } : null;
  }

  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.values.delete(key);
  }
}

test("publishes an uploaded book and makes revocation fail closed", async () => {
  const manageToken = "a".repeat(43);
  const shareToken = "b".repeat(43);
  const tokens = [manageToken, shareToken];
  const repository = new MemoryRepository();
  const objects = new MemoryObjects();
  const api = createBookShareApi({
    repository,
    objects,
    tokenFactory: () => tokens.shift(),
    clock: () => new Date("2026-08-28T00:00:00.000Z"),
  });

  const draftResponse = await api.handle(new Request("https://example.test/api/books", { method: "POST" }));
  assert.equal(draftResponse.status, 201);
  const draft = await draftResponse.json();
  assert.equal(draft.manageToken, manageToken);

  const assetId = "asset:12345678-1234-4234-8234-123456789abc";
  const uploadResponse = await api.handle(new Request(
    `https://example.test/api/books/${draft.bookId}/assets/${encodeURIComponent(assetId)}`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${manageToken}`, "content-type": "image/png" },
      body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    },
  ));
  assert.equal(uploadResponse.status, 200);

  const duplicateUploadResponse = await api.handle(new Request(
    `https://example.test/api/books/${draft.bookId}/assets/${encodeURIComponent(assetId)}`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${manageToken}`, "content-type": "image/png" },
      body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]),
    },
  ));
  assert.equal(duplicateUploadResponse.status, 409);
  assert.equal((await duplicateUploadResponse.json()).code, "asset_exists");
  assert.equal(objects.values.size, 1);

  const manifest = {
    id: "warm-photo-story",
    revision: 4,
    title: "A Warm Photo Story",
    coverAssetId: assetId,
    spreads: [{
      id: "spread-1",
      order: 0,
      title: "Home",
      body: "A remembered afternoon.",
      elements: [{
        id: "photo",
        label: "Family photo",
        kind: "lifted",
        assetId,
        page: "right",
        transform: { x: 0.5, y: 0.5, scaleX: 0.8, scaleY: 0.8, rotationDeg: 0 },
        depth: 0.1,
        locked: false,
        interaction: {
          hover: "lift-glow",
          focus: "spotlight",
          reveal: { kind: "caption", title: "A warm memory", summary: "", facts: [] },
        },
        provenance: "human",
      }],
    }],
  };
  const invalidManifest = structuredClone(manifest);
  delete invalidManifest.spreads[0].elements[0].transform;
  const invalidPublishResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest: invalidManifest }),
  }));
  assert.equal(invalidPublishResponse.status, 400);
  assert.equal((await invalidPublishResponse.json()).code, "invalid_manifest");

  const publishResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest }),
  }));
  assert.equal(publishResponse.status, 200);
  assert.equal((await publishResponse.json()).shareUrl, `https://example.test/share/${shareToken}`);

  const sharedResponse = await api.handle(new Request(`https://example.test/api/shared/${shareToken}`));
  assert.equal(sharedResponse.status, 200);
  const shared = await sharedResponse.json();
  assert.equal(shared.book.coverTextureUrl, `/api/shared/${shareToken}/assets/${encodeURIComponent(assetId)}`);
  assert.equal(shared.book.spreads[0].elements[0].assetId, `/api/shared/${shareToken}/assets/${encodeURIComponent(assetId)}`);

  const assetResponse = await api.handle(new Request(
    `https://example.test/api/shared/${shareToken}/assets/${encodeURIComponent(assetId)}`,
  ));
  assert.equal(assetResponse.status, 200);
  assert.equal(assetResponse.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await assetResponse.arrayBuffer()), new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));

  const revokeResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}` },
  }));
  assert.equal(revokeResponse.status, 200);
  assert.equal(await api.isPublishedShare(shareToken), false);

  const revokedRead = await api.handle(new Request(`https://example.test/api/shared/${shareToken}`));
  assert.equal(revokedRead.status, 404);
  assert.equal((await revokedRead.json()).code, "not_found");

  const revokedAsset = await api.handle(new Request(
    `https://example.test/api/shared/${shareToken}/assets/${encodeURIComponent(assetId)}`,
  ));
  assert.equal(revokedAsset.status, 404);

  const deleteResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${manageToken}` },
  }));
  assert.equal(deleteResponse.status, 204);
  assert.equal(repository.books.has(draft.bookId), false);
  assert.equal(objects.values.size, 0);
});
