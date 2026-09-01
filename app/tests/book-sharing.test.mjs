import assert from "node:assert/strict";
import test from "node:test";
import { createBookShareApi } from "../worker/bookShareApi.js";
import qualityRubric from "../worker/qualityRubric.json" with { type: "json" };

class MemoryRepository {
  books = new Map();
  assets = new Map();
  retiredShareTokenBookIds = new Map();
  deletedBookIds = new Map();
  creationEvents = [];

  async createBook({
    id,
    manageTokenHash,
    now,
    maxSiteBooks = Number.MAX_SAFE_INTEGER,
    maxBooksPerWindow = Number.MAX_SAFE_INTEGER,
    windowStart = "",
  }) {
    const deleted = this.deletedBookIds.get(id);
    if (deleted) return deleted.manageTokenHash === manageTokenHash ? "deleted" : "conflict";
    const existing = this.books.get(id);
    if (existing) return existing.manageTokenHash === manageTokenHash ? "existing" : "conflict";
    if (this.books.size >= maxSiteBooks) return "site_limit";
    const recentBooks = this.creationEvents.filter((createdAt) => createdAt >= windowStart).length;
    if (recentBooks >= maxBooksPerWindow) return "rate_limit";
    this.books.set(id, {
      id,
      manageTokenHash,
      status: "draft",
      share_token_hash: null,
      publish_attempt_token_hash: null,
      asset_cleanup_pending: 0,
      created_at: now,
    });
    this.creationEvents.push(now);
    return "created";
  }

  async findManagedBook(id, manageTokenHash) {
    const book = this.books.get(id);
    return book?.manageTokenHash === manageTokenHash ? book : null;
  }

  async findDeletedBook(id) {
    const deleted = this.deletedBookIds.get(id);
    return deleted ? { manage_token_hash: deleted.manageTokenHash, deleted_at: deleted.deletedAt } : null;
  }

  async insertAsset(asset) {
    const book = this.books.get(asset.bookId);
    if (
      !book
      || book.manageTokenHash !== asset.manageTokenHash
      || book.status !== "draft"
      || book.asset_cleanup_pending === 1
    ) return false;
    const bookAssetCount = [...this.assets.values()].filter((entry) => entry.bookId === asset.bookId).length;
    if (bookAssetCount >= (asset.maxAssets ?? Number.MAX_SAFE_INTEGER)) return false;
    if (this.assets.has(`${asset.bookId}:${asset.assetId}`)) return false;
    this.assets.set(`${asset.bookId}:${asset.assetId}`, {
      ...asset,
      object_key: asset.objectKey,
      content_type: asset.contentType,
      byte_size: asset.byteSize,
    });
    return true;
  }

  async listAssetIds(bookId) {
    return [...this.assets.values()].filter((asset) => asset.bookId === bookId).map((asset) => asset.assetId);
  }

  async claimPublishAttempt({ id, manageTokenHash, shareTokenHash }) {
    const book = await this.findManagedBook(id, manageTokenHash);
    if (!book || book.status !== "draft" || book.asset_cleanup_pending === 1) return false;
    if (this.retiredShareTokenBookIds.has(shareTokenHash)) return false;
    if (book.publish_attempt_token_hash === shareTokenHash) return true;
    if (
      book.publish_attempt_token_hash != null
      && !this.retiredShareTokenBookIds.has(book.publish_attempt_token_hash)
    ) return false;
    book.publish_attempt_token_hash = shareTokenHash;
    return true;
  }

  async isRetiredShareToken(shareTokenHash) {
    return this.retiredShareTokenBookIds.has(shareTokenHash);
  }

  async isRetiredShareTokenForBook(shareTokenHash, bookId) {
    return this.retiredShareTokenBookIds.get(shareTokenHash) === bookId;
  }

  async publishBook({ id, manageTokenHash, shareTokenHash, title, revision, manifestJson, now }) {
    const book = await this.findManagedBook(id, manageTokenHash);
    if (!book) return false;
    if (
      book.status === "draft"
      && book.asset_cleanup_pending !== 1
      && book.publish_attempt_token_hash === shareTokenHash
      && !this.retiredShareTokenBookIds.has(shareTokenHash)
    ) {
      Object.assign(book, {
        share_token_hash: shareTokenHash,
        publish_attempt_token_hash: null,
        status: "published",
        title,
        revision,
        manifest_json: manifestJson,
        published_at: now,
      });
      return revision;
    }
    return book.status === "published"
      && book.share_token_hash === shareTokenHash
      ? book.revision
      : false;
  }

  async findPublishedBook(shareTokenHash) {
    return [...this.books.values()].find((book) => book.share_token_hash === shareTokenHash && book.status === "published") ?? null;
  }

  async findPublishedAsset(shareTokenHash, assetId) {
    const book = await this.findPublishedBook(shareTokenHash);
    const asset = book ? this.assets.get(`${book.id}:${assetId}`) ?? null : null;
    return asset ? { ...asset, manifest_json: book.manifest_json } : null;
  }

  async revokeBook({ id, manageTokenHash, shareTokenHash, now }) {
    const book = await this.findManagedBook(id, manageTokenHash);
    if (
      !book
      || book.share_token_hash !== shareTokenHash
      || (
        book.status !== "published"
        && !(book.status === "revoked" && book.asset_cleanup_pending === 1)
      )
    ) return false;
    if (book.status === "published" && book.share_token_hash) {
      this.retiredShareTokenBookIds.set(book.share_token_hash, id);
    }
    Object.assign(book, { publish_attempt_token_hash: null, status: "revoked", asset_cleanup_pending: 1, revoked_at: now });
    return true;
  }

  async completeRevocation({ id, manageTokenHash, shareTokenHash }) {
    const book = await this.findManagedBook(id, manageTokenHash);
    if (!book || book.status !== "revoked" || book.share_token_hash !== shareTokenHash) return false;
    for (const key of [...this.assets.keys()]) {
      if (key.startsWith(`${id}:`)) this.assets.delete(key);
    }
    book.asset_cleanup_pending = 0;
    return true;
  }

  async markDeleting({ id, manageTokenHash }) {
    const book = await this.findManagedBook(id, manageTokenHash);
    if (!book || !["draft", "published", "revoked", "deleting"].includes(book.status)) return false;
    if (book.status === "published" && book.share_token_hash) {
      this.retiredShareTokenBookIds.set(book.share_token_hash, id);
    }
    book.status = "deleting";
    book.share_token_hash = null;
    book.publish_attempt_token_hash = null;
    return true;
  }

  async listAssets(bookId) {
    return [...this.assets.values()].filter((asset) => asset.bookId === bookId);
  }

  async listAssetsForRevocation({ id, manageTokenHash, shareTokenHash }) {
    const book = await this.findManagedBook(id, manageTokenHash);
    if (
      !book
      || book.status !== "revoked"
      || book.asset_cleanup_pending !== 1
      || book.share_token_hash !== shareTokenHash
    ) return [];
    return this.listAssets(id);
  }

  async listAssetsForDeletion({ id, manageTokenHash }) {
    const book = await this.findManagedBook(id, manageTokenHash);
    if (!book || book.status !== "deleting") return [];
    return this.listAssets(id);
  }

  async deleteBook({ id, manageTokenHash }) {
    const book = await this.findManagedBook(id, manageTokenHash);
    if (!book || book.status !== "deleting") return false;
    for (const key of [...this.assets.keys()]) {
      if (key.startsWith(`${id}:`)) this.assets.delete(key);
    }
    this.deletedBookIds.set(id, { manageTokenHash, deletedAt: book.updated_at ?? book.created_at });
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

function draftCreationRequest(manageToken, bookId = crypto.randomUUID()) {
  return new Request("https://example.test/api/books", {
    method: "POST",
    headers: {
      authorization: `Bearer ${manageToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ bookId }),
  });
}

test("publishes an uploaded book and makes revocation fail closed", async () => {
  const manageToken = "a".repeat(43);
  const shareToken = "b".repeat(43);
  const repository = new MemoryRepository();
  const objects = new MemoryObjects();
  const api = createBookShareApi({
    repository,
    objects,
    clock: () => new Date("2026-08-28T00:00:00.000Z"),
  });

  const draftResponse = await api.handle(draftCreationRequest(manageToken));
  assert.equal(draftResponse.status, 201);
  const draft = await draftResponse.json();
  assert.equal("manageToken" in draft, false);

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

  const coverAssetId = "asset:32345678-1234-4234-8234-123456789abc";
  const coverUpload = await api.handle(new Request(
    `https://example.test/api/books/${draft.bookId}/assets/${encodeURIComponent(coverAssetId)}`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${manageToken}`, "content-type": "image/png" },
      body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    },
  ));
  assert.equal(coverUpload.status, 200);

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
  assert.equal(objects.values.size, 3);

  const manifest = {
    id: "warm-photo-story",
    revision: 4,
    title: "A Warm Photo Story",
    coverAssetId,
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
      }, {
        id: "memory-hotspot-second",
        label: "Second memory hotspot",
        kind: "decoration",
        assetId: "procedural:hotspot:amber",
        page: "left",
        transform: { x: 0.3, y: 0.35, scaleX: 0.8, scaleY: 0.8, rotationDeg: 0 },
        depth: 0.08,
        locked: false,
        provenance: "agent",
      }],
    }],
  };
  manifest.spreads.push({
    ...structuredClone(manifest.spreads[0]),
    id: "spread-2",
    order: 1,
    title: "The road home",
    body: "The warm afternoon continues.",
    artwork: {
      cleanPlateAssetId: "/assets/generated/wonders-chichen-itza-clean-v2.png",
      sourceAssetId: "/assets/generated/wonders-chichen-itza.png",
      separation: "inpainted-clean-plate",
    },
    elements: manifest.spreads[0].elements.map((element) => ({
      ...structuredClone(element),
      id: `second-${element.id}`,
    })),
  });
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

  const personalPhotoManifest = structuredClone(manifest);
  personalPhotoManifest.spreads.forEach((spread) => { spread.artwork.personalSourceAssetId = personalSourceId; });
  const bookOnlyPhotoQuality = qualityFor(personalPhotoManifest);
  bookOnlyPhotoQuality.creationBrief.sourceAssets = [{ id: personalSourceId, name: "Portrait.png" }];
  bookOnlyPhotoQuality.creationBrief.photoPolicy = {
    sourceUse: "reference-and-compose",
    preserveIdentity: true,
    allowFaceChanges: false,
  };
  const bookOnlyPhotoCheck = bookOnlyPhotoQuality.checks.find((check) => check.criterionId === "photo-fidelity-integration");
  bookOnlyPhotoCheck.outcome = "note";
  bookOnlyPhotoCheck.message = "Personal photo fidelity was not inspected.";
  bookOnlyPhotoCheck.evidence = [{
    scope: "book",
    locator: "creationBrief.sourceAssets",
    description: "The ready brief has personal source assets.",
  }];
  bookOnlyPhotoQuality.noteCount = 1;
  const bookOnlyPhotoResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest: personalPhotoManifest, shareToken, quality: bookOnlyPhotoQuality }),
  }));
  assert.equal(bookOnlyPhotoResponse.status, 409);
  const bookOnlyPhotoError = await bookOnlyPhotoResponse.json();
  assert.equal(bookOnlyPhotoError.code, "quality_blocked");
  assert.match(bookOnlyPhotoError.message, /photo-fidelity-integration critique must cover every spread/i);

  const forgedIncompleteBrief = qualityFor(manifest);
  delete forgedIncompleteBrief.creationBrief.premise;
  const forgedIncompleteBriefResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest, shareToken, quality: forgedIncompleteBrief }),
  }));
  assert.equal(forgedIncompleteBriefResponse.status, 409);
  assert.equal((await forgedIncompleteBriefResponse.json()).code, "quality_blocked");

  const motionOnly = structuredClone(manifest);
  motionOnly.spreads[0].elements.forEach((element) => { delete element.interaction; });
  motionOnly.spreads[0].elements[0].motion = { preset: "gentle-float", durationMs: 4200, loop: true };
  const motionOnlyResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest: motionOnly, shareToken, quality: qualityFor(motionOnly) }),
  }));
  assert.equal(motionOnlyResponse.status, 409);
  assert.equal((await motionOnlyResponse.json()).code, "quality_blocked");

  const reusedCover = structuredClone(manifest);
  reusedCover.coverAssetId = assetId;
  const reusedCoverResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest: reusedCover, shareToken, quality: qualityFor(reusedCover) }),
  }));
  assert.equal(reusedCoverResponse.status, 400);
  assert.equal((await reusedCoverResponse.json()).code, "invalid_manifest");

  const mismatchedFrames = structuredClone(manifest);
  mismatchedFrames.spreads[0].elements[0].frameAssetIds = [
    "/assets/generated/story-city-clouds-cutout-v3.png",
    assetId,
  ];
  const mismatchedFramesResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest: mismatchedFrames, shareToken, quality: qualityFor(mismatchedFrames) }),
  }));
  assert.equal(mismatchedFramesResponse.status, 400);
  assert.equal((await mismatchedFramesResponse.json()).code, "invalid_manifest");

  const proceduralFrames = structuredClone(manifest);
  proceduralFrames.spreads[0].elements[2].frameAssetIds = [
    proceduralFrames.spreads[0].elements[2].assetId,
    assetId,
  ];
  const proceduralFramesResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest: proceduralFrames, shareToken, quality: qualityFor(proceduralFrames) }),
  }));
  assert.equal(proceduralFramesResponse.status, 400);
  assert.equal((await proceduralFramesResponse.json()).code, "invalid_manifest");

  const proceduralSequenceFrame = structuredClone(manifest);
  proceduralSequenceFrame.spreads[0].elements[0].frameAssetIds = [
    assetId,
    proceduralSequenceFrame.spreads[0].elements[2].assetId,
  ];
  const proceduralSequenceFrameResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest: proceduralSequenceFrame, shareToken, quality: qualityFor(proceduralSequenceFrame) }),
  }));
  assert.equal(proceduralSequenceFrameResponse.status, 400);
  assert.equal((await proceduralSequenceFrameResponse.json()).code, "invalid_manifest");

  const duplicateForeground = structuredClone(manifest);
  duplicateForeground.spreads[0].elements[1].assetId = assetId;
  const duplicateForegroundResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest: duplicateForeground, shareToken, quality: qualityFor(duplicateForeground) }),
  }));
  assert.equal(duplicateForegroundResponse.status, 400);
  assert.equal((await duplicateForegroundResponse.json()).code, "invalid_manifest");

  const reusedBackground = structuredClone(manifest);
  reusedBackground.spreads.push({
    ...structuredClone(reusedBackground.spreads[0]),
    id: "spread-2",
    order: 1,
    elements: structuredClone(reusedBackground.spreads[0].elements).map((element) => ({ ...element, id: `second-${element.id}` })),
  });
  const reusedBackgroundResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest: reusedBackground, shareToken, quality: qualityFor(reusedBackground) }),
  }));
  assert.equal(reusedBackgroundResponse.status, 400);
  assert.equal((await reusedBackgroundResponse.json()).code, "invalid_manifest");

  const sourceCoverManifest = structuredClone(forgedPhotoManifest);
  delete sourceCoverManifest.coverAssetId;
  sourceCoverManifest.coverTextureUrl = personalSourceId;
  const sourceCoverQuality = qualityFor(sourceCoverManifest);
  sourceCoverQuality.creationBrief = {
    ...sourceCoverQuality.creationBrief,
    sourceAssets: [{ id: personalSourceId, name: "Portrait.png" }],
    photoPolicy: { sourceUse: "reference-and-compose", preserveIdentity: true, allowFaceChanges: false },
  };
  const sourceCoverResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest: sourceCoverManifest, shareToken, quality: sourceCoverQuality }),
  }));
  assert.equal(sourceCoverResponse.status, 409);
  assert.equal((await sourceCoverResponse.json()).code, "quality_blocked");

  const publishResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest, shareToken, quality: qualityFor(manifest, { warning: true }) }),
  }));
  assert.equal(publishResponse.status, 200);
  assert.equal((await publishResponse.json()).shareUrl, `https://example.test/share/${shareToken}`);

  const publishedCreateReplay = await api.handle(draftCreationRequest(manageToken, draft.bookId));
  assert.equal(publishedCreateReplay.status, 200);
  assert.equal((await publishedCreateReplay.json()).status, "published");

  const sharedResponse = await api.handle(new Request(`https://example.test/api/shared/${shareToken}`));
  assert.equal(sharedResponse.status, 200);
  const shared = await sharedResponse.json();
  assert.equal(shared.book.coverTextureUrl, `/api/shared/${shareToken}/assets/${encodeURIComponent(coverAssetId)}`);
  assert.equal(shared.book.spreads[0].elements[0].assetId, `/api/shared/${shareToken}/assets/${encodeURIComponent(assetId)}`);

  const assetResponse = await api.handle(new Request(
    `https://example.test/api/shared/${shareToken}/assets/${encodeURIComponent(assetId)}`,
  ));
  assert.equal(assetResponse.status, 200);
  assert.equal(assetResponse.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await assetResponse.arrayBuffer()), new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));

  const revokeResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ shareToken }),
  }));
  assert.equal(revokeResponse.status, 200);
  assert.equal(await api.isPublishedShare(shareToken), false);
  assert.equal(repository.assets.size, 0);
  assert.equal(objects.values.size, 0);
  assert.equal(repository.books.get(draft.bookId).asset_cleanup_pending, 0);

  const retryRevokeResponse = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ shareToken }),
  }));
  assert.equal(retryRevokeResponse.status, 200);
  assert.equal((await retryRevokeResponse.json()).status, "revoked");
  assert.equal(await api.isPublishedShare(shareToken), false);
  assert.equal(repository.assets.size, 0);
  assert.equal(objects.values.size, 0);

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

test("bounds missing deletion requests and keeps a deleted creator generation terminal", async () => {
  const manageToken = "t".repeat(43);
  const bookId = "12345678-1234-4234-8234-123456789099";
  const repository = new MemoryRepository();
  const api = createBookShareApi({ repository, objects: new MemoryObjects() });

  const missingDelete = await api.handle(new Request(`https://example.test/api/books/${bookId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${manageToken}` },
  }));
  assert.equal(missingDelete.status, 409);
  assert.equal((await missingDelete.json()).code, "delete_conflict");
  assert.equal(repository.deletedBookIds.size, 0);

  assert.equal((await api.handle(draftCreationRequest(manageToken, bookId))).status, 201);
  assert.equal((await api.handle(new Request(`https://example.test/api/books/${bookId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${manageToken}` },
  }))).status, 204);
  const replayedCreate = await api.handle(draftCreationRequest(manageToken, bookId));
  assert.equal(replayedCreate.status, 200);
  assert.deepEqual(await replayedCreate.json(), { ok: true, bookId, status: "deleted" });
  assert.equal((await api.handle(new Request(`https://example.test/api/books/${bookId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${manageToken}` },
  }))).status, 204);
  assert.equal((await api.handle(draftCreationRequest("u".repeat(43), bookId))).status, 409);
  assert.equal(repository.deletedBookIds.size, 1);
});

function pngBytes() {
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
}

function qualityFor(manifest, { warning = false } = {}) {
  const hasPersonalPhoto = manifest.spreads.some((spread) => Boolean(spread.artwork?.personalSourceAssetId));
  const checks = qualityRubric.criteria.map((criterion, index) => {
    const photoFidelityNotApplicable = criterion.id === "photo-fidelity-integration" && !hasPersonalPhoto;
    return {
      criterionId: criterion.id,
      outcome: warning && index === 0 ? "warn" : photoFidelityNotApplicable ? "note" : "pass",
      message: photoFidelityNotApplicable
        ? "No personal source photos are present, so photo fidelity is not applicable."
        : `${criterion.label} was checked against rendered evidence.`,
      evidence: criterion.id === "cover-appeal"
        ? [{ scope: "cover", locator: "[data-book-id] img", description: "Rendered publication evidence" }]
        : photoFidelityNotApplicable
          ? [{ scope: "book", locator: "creationBrief.sourceAssets", description: "The ready brief contains no personal source assets." }]
          : manifest.spreads.map((spread) => ({
            scope: "spread",
            spreadId: spread.id,
            locator: ".book-scene canvas",
            description: "Rendered publication evidence",
          })),
      ...(warning && index === 0 ? { suggestedPatch: "Keep this warning recorded for publication." } : {}),
    };
  });
  return {
    contractVersion: 2,
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
    noteCount: hasPersonalPhoto ? 0 : 1,
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
  const api = createBookShareApi({ repository, objects });
  const draft = await (await api.handle(draftCreationRequest(manageToken))).json();
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
  const shared = await (await api.handle(new Request(`https://example.test/api/shared/${shareToken}`))).json();
  assert.equal(shared.book.spreads[0].artwork.sourceAssetId, undefined);
  assert.equal(shared.book.spreads[0].artwork.personalSourceAssetId, undefined);
  assert.equal(
    shared.book.spreads[0].artwork.cleanPlateAssetId,
    `/api/shared/${shareToken}/assets/${encodeURIComponent(sourceId)}`,
  );
  assert.equal((await api.handle(new Request(
    `https://example.test/api/shared/${shareToken}/assets/${encodeURIComponent(sourceId)}`,
  ))).status, 200);
});

test("keeps transformed-book source-photo provenance private after sharing", async () => {
  const manageToken = "p".repeat(43);
  const shareToken = "q".repeat(43);
  const repository = new MemoryRepository();
  const api = createBookShareApi({ repository, objects: new MemoryObjects() });
  const draft = await (await api.handle(draftCreationRequest(manageToken))).json();
  const personalSourceId = "asset:92345678-1234-4234-8234-123456789abc";
  const coverAssetId = "asset:82345678-1234-4234-8234-123456789abc";
  const staleCoverAssetId = "asset:72345678-1234-4234-8234-123456789abc";
  const staleTextureAssetId = "asset:62345678-1234-4234-8234-123456789abc";
  for (const assetId of [personalSourceId, coverAssetId, staleCoverAssetId, staleTextureAssetId]) {
    assert.equal((await api.handle(new Request(
      `https://example.test/api/books/${draft.bookId}/assets/${encodeURIComponent(assetId)}`,
      {
        method: "PUT",
        headers: { authorization: `Bearer ${manageToken}`, "content-type": "image/png" },
        body: pngBytes(),
      },
    ))).status, 200);
  }
  const manifest = {
    id: "private-family-source",
    revision: 2,
    title: "A Painted Family Memory",
    coverAssetId,
    coverTextureUrl: staleCoverAssetId,
    spreads: [{
      id: "opening",
      order: 0,
      title: "A transformed memory",
      body: "The private photo informed this generated scene.",
      textureUrl: staleTextureAssetId,
      artwork: {
        cleanPlateAssetId: "/assets/generated/wonders-colosseum-clean-v2.png",
        sourceAssetId: "/assets/generated/wonders-colosseum.png",
        personalSourceAssetId: personalSourceId,
        separation: "inpainted-clean-plate",
      },
      elements: [{
        id: "subject",
        label: "Painted subject",
        kind: "lifted",
        assetId: "/assets/generated/story-city-boy-cutout-v3.png",
        page: "right",
        transform: { x: 0.65, y: 0.55, scaleX: 0.7, scaleY: 0.7, rotationDeg: 0 },
        depth: 0.1,
        locked: false,
        provenance: "agent",
        interaction: {
          hover: "lift-glow",
          focus: "spotlight",
          reveal: { kind: "caption", title: "Memory", summary: "A painted keepsake.", facts: [] },
        },
      }, {
        id: "clouds",
        label: "Painted clouds",
        kind: "decoration",
        assetId: "/assets/generated/story-city-clouds-cutout-v3.png",
        page: "left",
        transform: { x: 0.35, y: 0.35, scaleX: 0.65, scaleY: 0.65, rotationDeg: 0 },
        depth: 0.05,
        locked: false,
        provenance: "agent",
      }],
    }],
  };
  const quality = qualityFor(manifest);
  quality.creationBrief = {
    contractVersion: 2,
    bookType: "photo-led-keepsake",
    premise: "Transform a family photo into a painted keepsake.",
    audience: "The family",
    spreadCount: 1,
    visualDirection: "Warm painted paper collage",
    sourceAssets: [{ id: personalSourceId, name: "Family.png" }],
    photoPolicy: { sourceUse: "reference-and-compose", preserveIdentity: true, allowFaceChanges: false },
  };
  const published = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest, shareToken, quality }),
  }));
  assert.equal(published.status, 200);

  const shared = await (await api.handle(new Request(`https://example.test/api/shared/${shareToken}`))).json();
  assert.equal(shared.book.coverTextureUrl, `/api/shared/${shareToken}/assets/${encodeURIComponent(coverAssetId)}`);
  assert.equal(shared.book.spreads[0].textureUrl, undefined);
  assert.equal(shared.book.spreads[0].artwork.sourceAssetId, undefined);
  assert.equal(shared.book.spreads[0].artwork.personalSourceAssetId, undefined);
  for (const privateAssetId of [personalSourceId, staleCoverAssetId, staleTextureAssetId]) {
    const privateAsset = await api.handle(new Request(
      `https://example.test/api/shared/${shareToken}/assets/${encodeURIComponent(privateAssetId)}`,
    ));
    assert.equal(privateAsset.status, 404);
  }
});

async function publishFixture(options = {}) {
  const manageToken = options.manageToken ?? "a".repeat(43);
  const shareToken = options.shareToken ?? "b".repeat(43);
  const repository = new MemoryRepository();
  const objects = new MemoryObjects();
  const api = createBookShareApi({
    repository,
    objects,
    clock: () => new Date("2026-08-28T00:00:00.000Z"),
    limits: options.limits,
  });
  const draftResponse = await api.handle(draftCreationRequest(manageToken));
  assert.equal(draftResponse.status, 201);
  const draft = await draftResponse.json();
  const assetId = "asset:12345678-1234-4234-8234-123456789abc";
  const uploadResponse = await api.handle(new Request(
    `https://example.test/api/books/${draft.bookId}/assets/${encodeURIComponent(assetId)}`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${manageToken}`, "content-type": "image/png" },
      body: pngBytes(),
    },
  ));
  assert.equal(uploadResponse.status, 200);
  const coverAssetId = "asset:32345678-1234-4234-8234-123456789abc";
  const coverUploadResponse = await api.handle(new Request(
    `https://example.test/api/books/${draft.bookId}/assets/${encodeURIComponent(coverAssetId)}`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${manageToken}`, "content-type": "image/png" },
      body: pngBytes(),
    },
  ));
  assert.equal(coverUploadResponse.status, 200);
  const manifest = {
    id: "warm-photo-story",
    revision: 4,
    title: "A Warm Photo Story",
    coverAssetId,
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
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest, shareToken, quality: qualityFor(manifest) }),
  };
  const publishResponse = await api.handle(new Request(
    `https://example.test/api/books/${draft.bookId}/publish`,
    publishRequest,
  ));
  assert.equal(publishResponse.status, 200);
  return {
    api,
    repository,
    objects,
    draft,
    assetId,
    coverAssetId,
    manageToken,
    shareToken,
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
  assert.equal(objects.values.size, 2);
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
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ shareToken }),
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
  const nextManageToken = "n".repeat(43);
  const nextDraftResponse = await api.handle(draftCreationRequest(nextManageToken));
  assert.equal(nextDraftResponse.status, 201);
  const nextDraft = await nextDraftResponse.json();
  const nextShareToken = "m".repeat(43);
  const republishResponse = await api.handle(new Request(`https://example.test/api/books/${nextDraft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${nextManageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest: nextManifest, shareToken: nextShareToken, quality: qualityFor(nextManifest) }),
  }));
  assert.equal(republishResponse.status, 200);
  assert.equal(await api.isPublishedShare(shareToken), false);
  assert.equal(await api.isPublishedShare(nextShareToken), true);

  const staleRevoke = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ shareToken }),
  }));
  assert.equal(staleRevoke.status, 200);
  assert.equal(await api.isPublishedShare(nextShareToken), true);

  const staleAssetResponse = await api.handle(new Request(
    `https://example.test/api/shared/${nextShareToken}/assets/${encodeURIComponent(assetId)}`,
  ));
  assert.equal(staleAssetResponse.status, 404);
  assert.equal((await staleAssetResponse.json()).code, "not_found");
});

test("keeps a retired token scoped to its own book during revoke retries", async () => {
  const {
    api,
    draft: firstDraft,
    manageToken: firstManageToken,
    shareToken: firstShareToken,
    assetId,
    coverAssetId,
    publishRequest,
  } = await publishFixture({ manageToken: "a".repeat(43), shareToken: "b".repeat(43) });
  assert.equal((await api.handle(new Request(`https://example.test/api/books/${firstDraft.bookId}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${firstManageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ shareToken: firstShareToken }),
  }))).status, 200);

  const secondManageToken = "c".repeat(43);
  const secondShareToken = "d".repeat(43);
  const secondDraftResponse = await api.handle(draftCreationRequest(secondManageToken));
  assert.equal(secondDraftResponse.status, 201);
  const secondDraft = await secondDraftResponse.json();
  for (const currentAssetId of [assetId, coverAssetId]) {
    const upload = await api.handle(new Request(
      `https://example.test/api/books/${secondDraft.bookId}/assets/${encodeURIComponent(currentAssetId)}`,
      {
        method: "PUT",
        headers: { authorization: `Bearer ${secondManageToken}`, "content-type": "image/png" },
        body: pngBytes(),
      },
    ));
    assert.equal(upload.status, 200);
  }
  const secondPublish = await api.handle(new Request(`https://example.test/api/books/${secondDraft.bookId}/publish`, {
    ...publishRequest,
    headers: { authorization: `Bearer ${secondManageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ ...JSON.parse(publishRequest.body), shareToken: secondShareToken }),
  }));
  assert.equal(secondPublish.status, 200);

  const mismatchedRevoke = await api.handle(new Request(`https://example.test/api/books/${secondDraft.bookId}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${secondManageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ shareToken: firstShareToken }),
  }));
  assert.equal(mismatchedRevoke.status, 409);
  assert.equal((await mismatchedRevoke.json()).code, "revoke_conflict");
  assert.equal(await api.isPublishedShare(secondShareToken), true);
});

test("rejects late asset uploads into a revoked generation", async () => {
  const { api, objects, draft, manageToken, shareToken } = await publishFixture();
  assert.equal((await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ shareToken }),
  }))).status, 200);

  const lateAssetId = "asset:92345678-1234-4234-8234-123456789abc";
  const lateUpload = await api.handle(new Request(
    `https://example.test/api/books/${draft.bookId}/assets/${encodeURIComponent(lateAssetId)}`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${manageToken}`, "content-type": "image/png" },
      body: pngBytes(),
    },
  ));
  assert.equal(lateUpload.status, 409);
  assert.equal((await lateUpload.json()).code, "invalid_state");
  assert.equal(objects.values.size, 0);
  assert.equal((await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ shareToken }),
  }))).status, 200);
});

test("discards an asset upload when its draft is revoked before metadata commit", async () => {
  const repository = new MemoryRepository();
  const objects = new MemoryObjects();
  const api = createBookShareApi({ repository, objects });
  const manageToken = "e".repeat(43);
  const draftResponse = await api.handle(draftCreationRequest(manageToken));
  const draft = await draftResponse.json();
  let announcePut;
  let releasePut;
  const putStarted = new Promise((resolve) => { announcePut = resolve; });
  const putReleased = new Promise((resolve) => { releasePut = resolve; });
  const put = objects.put.bind(objects);
  objects.put = async (...args) => {
    await put(...args);
    announcePut();
    await putReleased;
  };
  const assetId = "asset:a2345678-1234-4234-8234-123456789abc";
  const uploading = api.handle(new Request(
    `https://example.test/api/books/${draft.bookId}/assets/${encodeURIComponent(assetId)}`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${manageToken}`, "content-type": "image/png" },
      body: pngBytes(),
    },
  ));
  await putStarted;
  Object.assign(repository.books.get(draft.bookId), {
    status: "revoked",
    asset_cleanup_pending: 0,
  });
  releasePut();

  const response = await uploading;
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "invalid_state");
  assert.equal(repository.assets.size, 0);
  assert.equal(objects.values.size, 0);
});

test("retries an interrupted revoke cleanup without restoring public access", async () => {
  const { api, repository, objects, draft, manageToken, shareToken } = await publishFixture({
    manageToken: "r".repeat(43),
    shareToken: "s".repeat(43),
  });
  let objectDeletes = 0;
  const innerDelete = objects.delete.bind(objects);
  objects.delete = async (keys) => {
    objectDeletes += 1;
    if (objectDeletes === 1) throw new Error("R2 unavailable");
    return innerDelete(keys);
  };

  const firstRevoke = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ shareToken }),
  }));
  assert.equal(firstRevoke.status, 503);
  assert.equal((await firstRevoke.json()).code, "storage_unavailable");
  assert.equal(repository.books.get(draft.bookId).status, "revoked");
  assert.equal(repository.books.get(draft.bookId).asset_cleanup_pending, 1);
  assert.equal(repository.assets.size, 2);
  assert.equal(objects.values.size, 2);
  assert.equal(await api.isPublishedShare(shareToken), false);

  const retryRevoke = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ shareToken }),
  }));
  assert.equal(retryRevoke.status, 200);
  assert.equal(repository.books.get(draft.bookId).asset_cleanup_pending, 0);
  assert.equal(repository.assets.size, 0);
  assert.equal(objects.values.size, 0);
  assert.equal(await api.isPublishedShare(shareToken), false);
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

test("uploads a full 12-spread image-led asset set before enforcing the shared bound", async () => {
  const manageToken = "q".repeat(43);
  const repository = new MemoryRepository();
  const objects = new MemoryObjects();
  const api = createBookShareApi({ repository, objects });
  const draft = await (await api.handle(draftCreationRequest(manageToken))).json();

  const upload = async (serial) => {
    const assetId = `asset:12345678-1234-4234-8234-${String(serial).padStart(12, "0")}`;
    return api.handle(new Request(
      `https://example.test/api/books/${draft.bookId}/assets/${encodeURIComponent(assetId)}`,
      {
        method: "PUT",
        headers: { authorization: `Bearer ${manageToken}`, "content-type": "image/png" },
        body: pngBytes(),
      },
    ));
  };
  // One dedicated cover plus, per spread, the original composite, the final
  // base, and two foreground layers at the 12-spread maximum.
  const bound = qualityRubric.maxBookUploadedAssets;
  assert.equal(bound, 50);
  for (let serial = 1; serial <= bound; serial += 1) {
    assert.equal((await upload(serial)).status, 200, `upload ${serial} should be accepted`);
  }

  const overQuota = await upload(bound + 1);
  assert.equal(overQuota.status, 409);
  const rejection = await overQuota.json();
  assert.equal(rejection.code, "asset_limit");
  assert.equal(rejection.message, `A book may contain at most ${bound} uploaded assets.`);
});

test("rejects an oversized publish manifest in one body pass", async () => {
  const manageToken = "s".repeat(43);
  const repository = new MemoryRepository();
  const objects = new MemoryObjects();
  const api = createBookShareApi({ repository, objects });
  const draft = await (await api.handle(draftCreationRequest(manageToken))).json();

  const oversized = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest: { id: "x".repeat(1_100_000) }, shareToken: "t".repeat(43) }),
  }));
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, "manifest_too_large");
});

test("bounds anonymous book creation without storing network identity", async () => {
  const repository = new MemoryRepository();
  const objects = new MemoryObjects();
  const api = createBookShareApi({
    repository,
    objects,
    clock: () => new Date("2026-08-28T00:00:00.000Z"),
    limits: { maxSiteBooks: 2, maxBooksPerWindow: 2 },
  });

  const replayBookId = crypto.randomUUID();
  assert.equal((await api.handle(draftCreationRequest("f".repeat(43), replayBookId))).status, 201);
  assert.equal((await api.handle(draftCreationRequest("f".repeat(43)))).status, 201);
  assert.equal((await api.handle(draftCreationRequest("f".repeat(43), replayBookId))).status, 200);
  const capabilityMismatch = await api.handle(draftCreationRequest("z".repeat(43), replayBookId));
  assert.equal(capabilityMismatch.status, 409);
  assert.equal((await capabilityMismatch.json()).code, "book_exists");
  const limited = await api.handle(draftCreationRequest("f".repeat(43)));
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).code, "creation_limit");

  const rateApi = createBookShareApi({
    repository: new MemoryRepository(),
    objects: new MemoryObjects(),
    clock: () => new Date("2026-08-28T00:00:00.000Z"),
    limits: { maxSiteBooks: 50, maxBooksPerWindow: 1, creationWindowMs: 60 * 60 * 1000 },
  });
  const rateBookId = crypto.randomUUID();
  assert.equal((await rateApi.handle(draftCreationRequest("g".repeat(43), rateBookId))).status, 201);
  assert.equal((await rateApi.handle(new Request(`https://example.test/api/books/${rateBookId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${"g".repeat(43)}` },
  }))).status, 204);
  const rateLimited = await rateApi.handle(draftCreationRequest("g".repeat(43)));
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
    {
      ...publishRequest,
      body: JSON.stringify({ manifest: { revision: 5 }, shareToken }),
    },
  ));
  assert.equal(retry.status, 200);
  const retried = await retry.json();
  assert.equal(retried.shareUrl, first.shareUrl);
  assert.equal(retried.publishedRevision, 4);
  assert.equal(objectPuts, 0);
  assert.equal(objects.values.size, 2);
  assert.equal(repository.assets.size, 2);
  assert.equal(await api.isPublishedShare(shareToken), true);

  const reconciled = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish/reconcile`, {
    method: "POST",
    headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
    body: JSON.stringify({ shareToken }),
  }));
  assert.equal(reconciled.status, 200);
  assert.deepEqual(await reconciled.json(), {
    ok: true,
    bookId: draft.bookId,
    status: "published",
    shareUrl: first.shareUrl,
    publishedRevision: 4,
  });

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

test("reconcile claims one resumable token and never resurrects the revoked link", async () => {
  const { api, draft, manageToken, shareToken, publishRequest } = await publishFixture({
    manageToken: "u".repeat(43),
    shareToken: "v".repeat(43),
  });
  const headers = { authorization: `Bearer ${manageToken}`, "content-type": "application/json" };
  assert.equal((await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/revoke`, {
    method: "POST",
    headers,
    body: JSON.stringify({ shareToken }),
  }))).status, 200);

  const oldTokenRecovery = await api.handle(new Request(
    `https://example.test/api/books/${draft.bookId}/publish/reconcile`,
    { method: "POST", headers, body: JSON.stringify({ shareToken }) },
  ));
  assert.equal(oldTokenRecovery.status, 200);
  assert.equal((await oldTokenRecovery.json()).status, "revoked");

  const oldTokenPublish = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    ...publishRequest,
    body: JSON.stringify({ ...JSON.parse(publishRequest.body), shareToken }),
  }));
  assert.equal(oldTokenPublish.status, 409);
  assert.equal((await oldTokenPublish.json()).code, "revoked_share");

  const nextShareToken = "w".repeat(43);
  const competingShareToken = "x".repeat(43);
  const retiredGeneration = await api.handle(new Request(
    `https://example.test/api/books/${draft.bookId}/publish/reconcile`,
    { method: "POST", headers, body: JSON.stringify({ shareToken: nextShareToken }) },
  ));
  assert.equal(retiredGeneration.status, 200);
  assert.equal((await retiredGeneration.json()).status, "revoked");

  const nextManageToken = "y".repeat(43);
  const nextDraftResponse = await api.handle(draftCreationRequest(nextManageToken));
  assert.equal(nextDraftResponse.status, 201);
  const nextDraft = await nextDraftResponse.json();
  const nextHeaders = { authorization: `Bearer ${nextManageToken}`, "content-type": "application/json" };
  const claimed = await api.handle(new Request(
    `https://example.test/api/books/${nextDraft.bookId}/publish/reconcile`,
    { method: "POST", headers: nextHeaders, body: JSON.stringify({ shareToken: nextShareToken }) },
  ));
  assert.equal(claimed.status, 200);
  assert.equal((await claimed.json()).status, "publishing");

  const competing = await api.handle(new Request(
    `https://example.test/api/books/${nextDraft.bookId}/publish/reconcile`,
    { method: "POST", headers: nextHeaders, body: JSON.stringify({ shareToken: competingShareToken }) },
  ));
  assert.equal(competing.status, 409);
  assert.equal((await competing.json()).code, "publish_conflict");

  const nextManifest = structuredClone(JSON.parse(publishRequest.body).manifest);
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

  const resumed = await api.handle(new Request(`https://example.test/api/books/${nextDraft.bookId}/publish`, {
    ...publishRequest,
    headers: nextHeaders,
    body: JSON.stringify({ manifest: nextManifest, shareToken: nextShareToken, quality: qualityFor(nextManifest) }),
  }));
  assert.equal(resumed.status, 200);
  assert.equal((await resumed.json()).shareUrl, `https://example.test/share/${nextShareToken}`);
  assert.equal(await api.isPublishedShare(shareToken), false);
  assert.equal(await api.isPublishedShare(nextShareToken), true);

  assert.equal((await api.handle(new Request(`https://example.test/api/books/${nextDraft.bookId}/revoke`, {
    method: "POST",
    headers: nextHeaders,
    body: JSON.stringify({ shareToken: nextShareToken }),
  }))).status, 200);
  const oldestTokenRecovery = await api.handle(new Request(
    `https://example.test/api/books/${draft.bookId}/publish/reconcile`,
    { method: "POST", headers, body: JSON.stringify({ shareToken }) },
  ));
  assert.equal(oldestTokenRecovery.status, 200);
  assert.equal((await oldestTokenRecovery.json()).status, "revoked");
  const oldestTokenRepublish = await api.handle(new Request(`https://example.test/api/books/${draft.bookId}/publish`, {
    ...publishRequest,
    body: JSON.stringify({ ...JSON.parse(publishRequest.body), shareToken }),
  }));
  assert.equal(oldestTokenRepublish.status, 409);
  assert.equal((await oldestTokenRepublish.json()).code, "revoked_share");
});
