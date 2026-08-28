import assert from "node:assert/strict";
import test from "node:test";
import { createBookShareApi } from "../worker/bookShareApi.js";
import qualityRubric from "../worker/qualityRubric.json" with { type: "json" };

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

  async countBooks() {
    return this.books.size;
  }

  async countBooksCreatedSince(isoTimestamp) {
    return [...this.books.values()].filter((book) => book.created_at >= isoTimestamp).length;
  }

  async publishBook({ id, manageTokenHash, shareTokenHash, title, revision, manifestJson, now }) {
    const book = await this.findManagedBook(id, manageTokenHash);
    if (!book) return false;
    if (["draft", "revoked"].includes(book.status)) {
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
    return book.status === "published"
      && book.revision === revision
      && book.shareTokenHash === shareTokenHash;
  }

  async findPublishedBook(shareTokenHash) {
    return [...this.books.values()].find((book) => book.shareTokenHash === shareTokenHash && book.status === "published") ?? null;
  }

  async findPublishedAsset(shareTokenHash, assetId) {
    const book = await this.findPublishedBook(shareTokenHash);
    const asset = book ? this.assets.get(`${book.id}:${assetId}`) ?? null : null;
    return asset ? { ...asset, manifest_json: book.manifest_json } : null;
  }

  async revokeBook({ id, manageTokenHash, now }) {
    const book = await this.findManagedBook(id, manageTokenHash);
    if (!book || book.status !== "published") return false;
    Object.assign(book, { shareTokenHash: null, status: "revoked", revoked_at: now });
    return true;
  }

  async markDeleting({ id, manageTokenHash }) {
    const book = await this.findManagedBook(id, manageTokenHash);
    if (!book || !["draft", "published", "revoked", "deleting"].includes(book.status)) return false;
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
    for (const key of [...this.assets.keys()]) {
      if (key.startsWith(`${id}:`)) this.assets.delete(key);
    }
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
  const repository = new MemoryRepository();
  const objects = new MemoryObjects();
  const api = createBookShareApi({
    repository,
    objects,
    tokenFactory: () => manageToken,
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

  const personalSourceId = "asset:22345678-1234-4234-8234-123456789abc";
  const personalSourceUpload = await api.handle(new Request(
    `https://example.test/api/books/${draft.bookId}/assets/${encodeURIComponent(personalSourceId)}`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${manageToken}`, "content-type": "image/png" },
      body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    },
  ));
  assert.equal(personalSourceUpload.status, 200);

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
  assert.equal(objects.values.size, 2);

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
      artwork: {
        cleanPlateAssetId: "/assets/generated/wonders-colosseum-clean-v2.png",
        sourceAssetId: "/assets/generated/wonders-colosseum.png",
        separation: "inpainted-clean-plate",
      },
      elements: [{
        id: "photo",
        label: "Family photo",
        kind: "lifted",
        assetId,
        page: "right",
        transform: { x: 0.5, y: 0.5, scaleX: 0.8, scaleY: 0.8, rotationDeg: 0 },
        depth: 0.1,
        locked: false,
        provenance: "human",
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
      }, {
        id: "memory-hotspot",
        label: "Memory hotspot",
        kind: "decoration",
        assetId: "procedural:hotspot:amber",
        page: "right",
        transform: { x: 0.7, y: 0.35, scaleX: 0.8, scaleY: 0.8, rotationDeg: 0 },
        depth: 0.08,
        locked: false,
        interaction: {
          hover: "lift-glow",
          focus: "spotlight",
          reveal: { kind: "caption", title: "A warm memory", summary: "", facts: [] },
        },
        provenance: "agent",
      }],
    }],
  };
  const invalidManifest = structuredClone(manifest);
  delete invalidManifest.spreads[0].elements[0].transform;
  const invalidPublishResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest: invalidManifest, shareToken }),
  }));
  assert.equal(invalidPublishResponse.status, 400);
  assert.equal((await invalidPublishResponse.json()).code, "invalid_manifest");

  const missingQualityResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest, shareToken }),
  }));
  assert.equal(missingQualityResponse.status, 409);
  assert.equal((await missingQualityResponse.json()).code, "quality_blocked");

  const structuralBlocker = structuredClone(manifest);
  delete structuralBlocker.spreads[0].artwork;
  const structuralBlockerResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest: structuralBlocker, shareToken, quality: qualityFor(structuralBlocker) }),
  }));
  assert.equal(structuralBlockerResponse.status, 409);
  assert.equal((await structuralBlockerResponse.json()).code, "quality_blocked");

  const missingBundledAsset = structuredClone(manifest);
  missingBundledAsset.spreads[0].elements[1].assetId = "/assets/generated/does-not-exist.png";
  const missingBundledResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest: missingBundledAsset, shareToken, quality: qualityFor(missingBundledAsset) }),
  }));
  assert.equal(missingBundledResponse.status, 400);
  assert.equal((await missingBundledResponse.json()).code, "invalid_manifest");

  const forgedEvidence = qualityFor(manifest);
  forgedEvidence.checks.find((check) => check.criterionId === "spread-composition").evidence[0].spreadId = "does-not-exist";
  const forgedEvidenceResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest, shareToken, quality: forgedEvidence }),
  }));
  assert.equal(forgedEvidenceResponse.status, 409);
  assert.equal((await forgedEvidenceResponse.json()).code, "quality_blocked");

  const wrongAssetPolicy = qualityFor(manifest);
  wrongAssetPolicy.creationBrief.bookType = "preserved-photo-album";
  wrongAssetPolicy.creationBrief.photoPolicy = {
    sourceUse: "preserve-original-layout",
    preserveIdentity: true,
    allowFaceChanges: false,
    allowCrop: false,
    allowColorCorrection: true,
  };
  const wrongAssetPolicyResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest, shareToken, quality: wrongAssetPolicy }),
  }));
  assert.equal(wrongAssetPolicyResponse.status, 409);
  assert.equal((await wrongAssetPolicyResponse.json()).code, "quality_blocked");

  const forgedPhotoIdentity = qualityFor(manifest);
  forgedPhotoIdentity.creationBrief.sourceAssets = [{ id: personalSourceId, name: "Portrait.png" }];
  forgedPhotoIdentity.creationBrief.photoPolicy = { sourceUse: "reference-and-compose" };
  const forgedPhotoManifest = structuredClone(manifest);
  forgedPhotoManifest.spreads[0].artwork.personalSourceAssetId = personalSourceId;
  const forgedPhotoIdentityResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest: forgedPhotoManifest, shareToken, quality: forgedPhotoIdentity }),
  }));
  assert.equal(forgedPhotoIdentityResponse.status, 409);
  assert.equal((await forgedPhotoIdentityResponse.json()).code, "quality_blocked");

  const forgedIncompleteBrief = qualityFor(manifest);
  delete forgedIncompleteBrief.creationBrief.premise;
  const forgedIncompleteBriefResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest, shareToken, quality: forgedIncompleteBrief }),
  }));
  assert.equal(forgedIncompleteBriefResponse.status, 409);
  assert.equal((await forgedIncompleteBriefResponse.json()).code, "quality_blocked");

  const publishResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest, shareToken, quality: qualityFor(manifest, { warning: true }) }),
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

  const retryRevokeResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}` },
  }));
  assert.equal(retryRevokeResponse.status, 200);
  assert.equal((await retryRevokeResponse.json()).status, "revoked");
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
function pngBytes() {
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
}

function qualityFor(manifest, { warning = false } = {}) {
  const checks = qualityRubric.criteria.map((criterion, index) => ({
    criterionId: criterion.id,
    outcome: warning && index === 0 ? "warn" : "pass",
    message: `${criterion.label} was checked against rendered evidence.`,
    evidence: [{
      scope: criterion.id === "cover-appeal" ? "cover" : "spread",
      ...(criterion.id === "cover-appeal" ? {} : { spreadId: manifest.spreads[0].id }),
      locator: criterion.id === "cover-appeal" ? "[data-book-id] img" : ".book-scene canvas",
      description: "Rendered publication evidence",
    }],
    ...(warning && index === 0 ? { suggestedPatch: "Keep this warning recorded for publication." } : {}),
  }));
  return {
    contractVersion: 1,
    rubricVersion: qualityRubric.version,
    documentId: manifest.id,
    reviewedRevision: manifest.revision,
    round: 1,
    maxRounds: qualityRubric.maxReviewRounds,
    creationBrief: {
      contractVersion: 2,
      bookType: "illustrated-storybook",
      premise: "A warm afternoon becomes a short illustrated story.",
      audience: "Families",
      spreadCount: manifest.spreads.length,
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

test("publishes a preserved-photo album only with its declared original source", async () => {
  const manageToken = "n".repeat(43);
  const shareToken = "o".repeat(43);
  const repository = new MemoryRepository();
  const objects = new MemoryObjects();
  const api = createBookShareApi({ repository, objects, tokenFactory: () => manageToken });
  const draft = await (await api.handle(new Request("https://example.test/api/books", { method: "POST" }))).json();
  const sourceId = "asset:12345678-1234-4234-8234-123456789abc";
  const upload = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/assets/${encodeURIComponent(sourceId)}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "image/png" },
    body: pngBytes(),
  }));
  assert.equal(upload.status, 200);
  const manifest = {
    id: "preserved-family-album",
    revision: 3,
    title: "Our Family Album",
    coverTextureUrl: "/assets/covers/your-story-made-alive-v2.png",
    spreads: [{
      id: "opening",
      order: 0,
      title: "The original afternoon",
      body: "The photograph remains intact.",
      artwork: { cleanPlateAssetId: sourceId, sourceAssetId: sourceId, personalSourceAssetId: sourceId, separation: "preserved-photo-layout" },
      elements: [{
        id: "caption-frame",
        label: "Caption frame",
        kind: "decoration",
        assetId: "/assets/generated/story-city-clouds-cutout-v3.png",
        page: "left",
        transform: { x: 0.3, y: 0.3, scaleX: 0.5, scaleY: 0.5, rotationDeg: 0 },
        depth: 0.05,
        locked: false,
        provenance: "agent",
      }, {
        id: "memory-light",
        label: "Memory light",
        kind: "lifted",
        assetId: "/assets/generated/story-window-glow-cutout-v3.png",
        page: "right",
        transform: { x: 0.75, y: 0.35, scaleX: 0.5, scaleY: 0.5, rotationDeg: 0 },
        depth: 0.1,
        locked: false,
        provenance: "agent",
        interaction: {
          hover: "warm-rim",
          focus: "spotlight",
          reveal: { kind: "caption", title: "Memory", summary: "A source-true moment.", facts: [] },
        },
      }],
    }],
  };
  const quality = qualityFor(manifest);
  quality.creationBrief = {
    contractVersion: 2,
    bookType: "preserved-photo-album",
    premise: "Keep the original family photograph in its original layout.",
    audience: "The family",
    spreadCount: 1,
    visualDirection: "Quiet archival album",
    sourceAssets: [{ id: sourceId, name: "Original.png" }],
    photoPolicy: {
      sourceUse: "preserve-original-layout",
      preserveIdentity: true,
      allowFaceChanges: false,
      allowCrop: false,
      allowColorCorrection: true,
    },
  };
  const response = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest, shareToken, quality }),
  }));
  assert.equal(response.status, 200);
});

async function publishFixture(options = {}) {
  const manageToken = options.manageToken ?? "a".repeat(43);
  const shareToken = options.shareToken ?? "b".repeat(43);
  const repository = new MemoryRepository();
  const objects = new MemoryObjects();
  const api = createBookShareApi({
    repository,
    objects,
    tokenFactory: () => manageToken,
    clock: () => new Date("2026-08-28T00:00:00.000Z"),
    limits: options.limits,
  });
  const draftResponse = await api.handle(new Request("https://example.test/api/books", { method: "POST" }));
  const draft = await draftResponse.json();
  const assetId = "asset:12345678-1234-4234-8234-123456789abc";
  const uploadResponse = await api.handle(new Request(
    `https://example.test/api/books/${draft.bookId}/assets/${encodeURIComponent(assetId)}`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${draft.manageToken}`, "content-type": "image/png" },
      body: pngBytes(),
    },
  ));
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
      artwork: {
        cleanPlateAssetId: "/assets/generated/wonders-colosseum-clean-v2.png",
        sourceAssetId: "/assets/generated/wonders-colosseum.png",
        separation: "inpainted-clean-plate",
      },
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
  };
  const publishRequest = {
    method: "POST",
    headers: { authorization: `Bearer ${draft.manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest, shareToken, quality: qualityFor(manifest) }),
  };
  const publishResponse = await api.handle(new Request(
    `https://example.test/api/books/${draft.bookId}/publish`,
    publishRequest,
  ));
  return {
    api,
    repository,
    objects,
    draft,
    assetId,
    manageToken: draft.manageToken,
    shareToken,
    uploadResponse,
    publishResponse,
    publishRequest,
  };
}

test("retries an interrupted delete without restoring public access", async () => {
  const { api, repository, objects, draft, manageToken, shareToken, assetId } = await publishFixture();
  let objectDeletes = 0;
  const innerDelete = objects.delete.bind(objects);
  objects.delete = async (keys) => {
    objectDeletes += 1;
    if (objectDeletes === 1) throw new Error("R2 unavailable");
    return innerDelete(keys);
  };

  const firstDelete = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${manageToken}` },
  }));
  assert.equal(firstDelete.status, 503);
  assert.equal((await firstDelete.json()).code, "storage_unavailable");
  assert.equal(repository.books.get(draft.bookId).status, "deleting");
  assert.equal(await api.isPublishedShare(shareToken), false);
  assert.equal((await api.handle(new Request(`https://example.test/api/shared/${shareToken}`))).status, 404);
  assert.equal((await api.handle(new Request(
    `https://example.test/api/shared/${shareToken}/assets/${encodeURIComponent(assetId)}`,
  ))).status, 404);
  assert.equal(objects.values.size, 1);
  assert.equal(repository.books.has(draft.bookId), true);

  const retryDelete = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${manageToken}` },
  }));
  assert.equal(retryDelete.status, 204);
  assert.equal(repository.books.has(draft.bookId), false);
  assert.equal(repository.assets.size, 0);
  assert.equal(objects.values.size, 0);
  assert.equal(await api.isPublishedShare(shareToken), false);
});

test("keeps assets from an older revision private after republish", async () => {
  const { api, draft, manageToken, shareToken, assetId, publishRequest } = await publishFixture({
    manageToken: "k".repeat(43),
    shareToken: "l".repeat(43),
  });
  const revokeResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}` },
  }));
  assert.equal(revokeResponse.status, 200);

  const nextManifest = structuredClone(JSON.parse(publishRequest.body).manifest);
  nextManifest.revision += 1;
  delete nextManifest.coverAssetId;
  nextManifest.coverTextureUrl = "/assets/covers/the-lantern-garden-v2.png";
  nextManifest.spreads[0].artwork = {
    cleanPlateAssetId: "/assets/generated/wonders-colosseum-clean-v2.png",
    sourceAssetId: "/assets/generated/wonders-colosseum.png",
    separation: "inpainted-clean-plate",
  };
  nextManifest.spreads[0].elements = [{
    ...nextManifest.spreads[0].elements[0],
    assetId: "/assets/generated/story-city-boy-cutout-v3.png",
  }, {
    ...nextManifest.spreads[0].elements[1],
    assetId: "/assets/generated/story-city-clouds-cutout-v3.png",
  }];
  const nextShareToken = "m".repeat(43);
  const republishResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest: nextManifest, shareToken: nextShareToken, quality: qualityFor(nextManifest) }),
  }));
  assert.equal(republishResponse.status, 200);
  assert.equal(await api.isPublishedShare(shareToken), false);
  assert.equal(await api.isPublishedShare(nextShareToken), true);

  const staleAssetResponse = await api.handle(new Request(
    `https://example.test/api/shared/${nextShareToken}/assets/${encodeURIComponent(assetId)}`,
  ));
  assert.equal(staleAssetResponse.status, 404);
  assert.equal((await staleAssetResponse.json()).code, "not_found");
});

test("retries metadata cleanup after files were already removed", async () => {
  const { api, repository, objects, draft, manageToken, shareToken } = await publishFixture({
    manageToken: "d".repeat(43),
    shareToken: "e".repeat(43),
  });
  let deleteBookCalls = 0;
  const innerDeleteBook = repository.deleteBook.bind(repository);
  repository.deleteBook = async (...args) => {
    deleteBookCalls += 1;
    if (deleteBookCalls === 1) return false;
    return innerDeleteBook(...args);
  };

  const firstDelete = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${manageToken}` },
  }));
  assert.equal(firstDelete.status, 409);
  assert.equal((await firstDelete.json()).code, "delete_conflict");
  assert.equal(objects.values.size, 0);
  assert.equal(repository.books.get(draft.bookId).status, "deleting");
  assert.equal(await api.isPublishedShare(shareToken), false);

  const retryDelete = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${manageToken}` },
  }));
  assert.equal(retryDelete.status, 204);
  assert.equal(repository.books.has(draft.bookId), false);
  assert.equal(repository.assets.size, 0);
});

test("bounds anonymous book creation without storing network identity", async () => {
  const repository = new MemoryRepository();
  const objects = new MemoryObjects();
  const api = createBookShareApi({
    repository,
    objects,
    tokenFactory: () => "f".repeat(43),
    clock: () => new Date("2026-08-28T00:00:00.000Z"),
    limits: { maxSiteBooks: 2, maxBooksPerWindow: 2 },
  });

  assert.equal((await api.handle(new Request("https://example.test/api/books", { method: "POST" }))).status, 201);
  assert.equal((await api.handle(new Request("https://example.test/api/books", { method: "POST" }))).status, 201);
  const limited = await api.handle(new Request("https://example.test/api/books", { method: "POST" }));
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).code, "creation_limit");

  const rateApi = createBookShareApi({
    repository: new MemoryRepository(),
    objects: new MemoryObjects(),
    tokenFactory: () => "g".repeat(43),
    clock: () => new Date("2026-08-28T00:00:00.000Z"),
    limits: { maxSiteBooks: 50, maxBooksPerWindow: 1, creationWindowMs: 60 * 60 * 1000 },
  });
  assert.equal((await rateApi.handle(new Request("https://example.test/api/books", { method: "POST" }))).status, 201);
  const rateLimited = await rateApi.handle(new Request("https://example.test/api/books", { method: "POST" }));
  assert.equal(rateLimited.status, 429);
  assert.equal((await rateLimited.json()).code, "creation_rate");
});

test("retries a publish whose response was lost after commit without replacing the share link", async () => {
  const { api, repository, objects, draft, manageToken, shareToken, publishRequest, publishResponse } = await publishFixture({
    manageToken: "h".repeat(43),
    shareToken: "i".repeat(43),
  });
  const first = await publishResponse.json();
  assert.equal(first.shareUrl, `https://example.test/share/${shareToken}`);
  assert.match(first.shareUrl, /^https:\/\/example\.test\/share\/[A-Za-z0-9_-]{43}$/);

  let objectPuts = 0;
  const innerPut = objects.put.bind(objects);
  objects.put = async (...args) => {
    objectPuts += 1;
    return innerPut(...args);
  };

  const retry = await api.handle(new Request(
    `https://example.test/api/books/${draft.bookId}/publish`,
    publishRequest,
  ));
  assert.equal(retry.status, 200);
  const retried = await retry.json();
  assert.equal(retried.shareUrl, first.shareUrl);
  assert.equal(objectPuts, 0);
  assert.equal(objects.values.size, 1);
  assert.equal(repository.assets.size, 1);
  assert.equal(await api.isPublishedShare(shareToken), true);

  const mismatch = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      manifest: { revision: 4 },
      shareToken: "j".repeat(43),
    }),
  }));
  assert.equal(mismatch.status, 409);
  assert.equal((await mismatch.json()).code, "invalid_state");
  assert.equal(await api.isPublishedShare(shareToken), true);
  assert.equal(await api.isPublishedShare("j".repeat(43)), false);
});
