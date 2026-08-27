const MANAGEABLE_STATUSES = new Set(["draft", "revoked"]);
const ASSET_ID_PATTERN = /^asset:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const BOOK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f-]{27,35}$/i;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_ASSET_BYTES = 1_500_000;
const MAX_MANIFEST_BYTES = 1_000_000;
const MAX_ASSETS = 24;
const ELEMENT_KINDS = new Set(["embedded", "lifted", "decoration"]);
const PAGES = new Set(["left", "right"]);
const PROVENANCE = new Set(["sample", "human", "agent"]);
const MOTION_PRESETS = new Set(["gentle-float", "fly-across", "water-bob", "soft-pulse", "slow-orbit"]);
const HOVER_RESPONSES = new Set(["none", "lift-glow", "tilt-toward-pointer", "warm-rim"]);
const FOCUS_RESPONSES = new Set(["none", "spotlight", "rise-and-center", "orbit-inspect"]);
const REVEAL_KINDS = new Set(["none", "caption", "fact-card"]);
const PROCEDURAL_ASSET_PATTERN = /^procedural:hotspot:(amber|aqua|jade|rose)$/u;
const BUNDLED_ASSET_PATTERN = /^\/assets\/[A-Za-z0-9][A-Za-z0-9._/-]{0,503}$/u;

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(payload, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(payload), { ...init, headers });
}

function tokenFromBytes(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function defaultTokenFactory() {
  return tokenFromBytes(crypto.getRandomValues(new Uint8Array(32)));
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return tokenFromBytes(new Uint8Array(digest));
}

function bearerToken(request) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(request.headers.get("authorization") ?? "");
  if (!match) throw new HttpError(401, "unauthorized", "A valid creator capability token is required.");
  return match[1];
}

function decodePathComponent(value, notFoundMessage) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(404, "not_found", notFoundMessage);
  }
}

function matchesImageSignature(bytes, contentType) {
  const view = new Uint8Array(bytes);
  if (contentType === "image/png") {
    return view.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => view[index] === byte);
  }
  if (contentType === "image/jpeg") return view.length >= 3 && view[0] === 255 && view[1] === 216 && view[2] === 255;
  return view.length >= 12
    && String.fromCharCode(...view.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...view.slice(8, 12)) === "WEBP";
}

function assertAssetReference(value, references) {
  if (typeof value === "undefined") return;
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    throw new HttpError(400, "invalid_manifest", "The book contains an invalid asset reference.");
  }
  if (ASSET_ID_PATTERN.test(value)) {
    references.add(value);
    return;
  }
  if ((BUNDLED_ASSET_PATTERN.test(value) && !value.split("/").includes("..")) || PROCEDURAL_ASSET_PATTERN.test(value)) return;
  throw new HttpError(400, "invalid_manifest", "Shared books may reference only uploaded or bundled assets.");
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertOnly(value, allowed, message) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new HttpError(400, "invalid_manifest", message);
  }
}

function assertString(value, { min = 0, max, message }) {
  if (typeof value !== "string" || value.length > max || (min > 0 && value.trim().length < min)) {
    throw new HttpError(400, "invalid_manifest", message);
  }
}

function assertNumber(value, min, max, message, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new HttpError(400, "invalid_manifest", message);
  }
}

function validateMotion(motion, message) {
  if (typeof motion === "undefined") return;
  if (!isRecord(motion)) throw new HttpError(400, "invalid_manifest", message);
  assertOnly(motion, ["preset", "durationMs", "loop"], message);
  if (!MOTION_PRESETS.has(motion.preset) || typeof motion.loop !== "boolean") {
    throw new HttpError(400, "invalid_manifest", message);
  }
  assertNumber(motion.durationMs, 400, 20_000, message, true);
}

function validateReveal(reveal, message) {
  if (!isRecord(reveal)) throw new HttpError(400, "invalid_manifest", message);
  assertOnly(reveal, ["kind", "title", "summary", "facts", "source"], message);
  if (!REVEAL_KINDS.has(reveal.kind)) throw new HttpError(400, "invalid_manifest", message);
  assertString(reveal.title, { min: reveal.kind === "none" ? 0 : 1, max: 100, message });
  assertString(reveal.summary, { max: 500, message });
  if (!Array.isArray(reveal.facts) || reveal.facts.length > 8) throw new HttpError(400, "invalid_manifest", message);
  reveal.facts.forEach((fact) => {
    if (!isRecord(fact)) throw new HttpError(400, "invalid_manifest", message);
    assertOnly(fact, ["label", "value"], message);
    assertString(fact.label, { min: 1, max: 64, message });
    assertString(fact.value, { min: 1, max: 160, message });
  });
  if (typeof reveal.source !== "undefined") assertString(reveal.source, { max: 200, message });
}

function validateInteraction(interaction, message) {
  if (typeof interaction === "undefined") return;
  if (!isRecord(interaction)) throw new HttpError(400, "invalid_manifest", message);
  assertOnly(interaction, ["hover", "focus", "reveal", "motion", "hint"], message);
  if (!HOVER_RESPONSES.has(interaction.hover) || !FOCUS_RESPONSES.has(interaction.focus)) {
    throw new HttpError(400, "invalid_manifest", message);
  }
  validateReveal(interaction.reveal, message);
  validateMotion(interaction.motion, message);
  if (typeof interaction.hint !== "undefined") assertString(interaction.hint, { max: 200, message });
}

function validateElement(element, spreadNumber, references, elementIds) {
  const message = `Spread ${spreadNumber} contains an invalid element.`;
  if (!isRecord(element)) throw new HttpError(400, "invalid_manifest", message);
  assertOnly(element, [
    "id", "label", "kind", "assetId", "frameAssetIds", "page", "transform", "depth", "locked", "motion", "interaction", "provenance",
  ], message);
  assertString(element.id, { min: 1, max: 128, message });
  if (elementIds.has(element.id)) throw new HttpError(400, "invalid_manifest", message);
  elementIds.add(element.id);
  assertString(element.label, { min: 1, max: 64, message });
  if (!ELEMENT_KINDS.has(element.kind) || !PAGES.has(element.page) || !PROVENANCE.has(element.provenance) || typeof element.locked !== "boolean") {
    throw new HttpError(400, "invalid_manifest", message);
  }
  if (typeof element.assetId !== "string") throw new HttpError(400, "invalid_manifest", message);
  assertAssetReference(element.assetId, references);
  if (!isRecord(element.transform)) throw new HttpError(400, "invalid_manifest", message);
  assertOnly(element.transform, ["x", "y", "scaleX", "scaleY", "rotationDeg"], message);
  assertNumber(element.transform.x, 0, 1, message);
  assertNumber(element.transform.y, 0, 1, message);
  assertNumber(element.transform.scaleX, 0.3, 1.8, message);
  assertNumber(element.transform.scaleY, 0.3, 1.8, message);
  assertNumber(element.transform.rotationDeg, -180, 180, message);
  assertNumber(element.depth, 0, 0.5, message);
  validateMotion(element.motion, message);
  validateInteraction(element.interaction, message);
  if (typeof element.frameAssetIds !== "undefined") {
    if (!Array.isArray(element.frameAssetIds) || element.frameAssetIds.length < 2 || element.frameAssetIds.length > 6) {
      throw new HttpError(400, "invalid_manifest", message);
    }
    element.frameAssetIds.forEach((assetId) => {
      if (typeof assetId !== "string") throw new HttpError(400, "invalid_manifest", message);
      assertAssetReference(assetId, references);
    });
  }
}

function validateManifest(manifest) {
  if (!isRecord(manifest)) {
    throw new HttpError(400, "invalid_manifest", "A book manifest is required.");
  }
  assertOnly(manifest, ["id", "revision", "title", "coverAssetId", "coverTextureUrl", "spreads"], "The book manifest contains unsupported fields.");
  assertString(manifest.id, { min: 1, max: 128, message: "The book id is invalid." });
  assertString(manifest.title, { min: 1, max: 160, message: "The book title is invalid." });
  if (!Number.isSafeInteger(manifest.revision) || manifest.revision < 1) {
    throw new HttpError(400, "invalid_manifest", "The book revision is invalid.");
  }
  if (!Array.isArray(manifest.spreads) || manifest.spreads.length < 1 || manifest.spreads.length > 12) {
    throw new HttpError(400, "invalid_manifest", "A shared book must contain 1 to 12 spreads.");
  }

  const references = new Set();
  const spreadIds = new Set();
  assertAssetReference(manifest.coverAssetId, references);
  assertAssetReference(manifest.coverTextureUrl, references);
  manifest.spreads.forEach((spread, order) => {
    const message = `Spread ${order + 1} is invalid.`;
    if (!isRecord(spread)) throw new HttpError(400, "invalid_manifest", message);
    assertOnly(spread, ["id", "order", "textureUrl", "artwork", "title", "body", "kicker", "elements"], message);
    assertString(spread.id, { min: 1, max: 128, message });
    if (spreadIds.has(spread.id) || spread.order !== order || !Array.isArray(spread.elements) || spread.elements.length > 24) {
      throw new HttpError(400, "invalid_manifest", message);
    }
    spreadIds.add(spread.id);
    assertString(spread.title, { min: 1, max: 160, message });
    assertString(spread.body, { max: 4_000, message });
    if (typeof spread.kicker !== "undefined") assertString(spread.kicker, { max: 200, message });
    assertAssetReference(spread.textureUrl, references);
    if (typeof spread.artwork !== "undefined") {
      if (!isRecord(spread.artwork)) throw new HttpError(400, "invalid_manifest", message);
      assertOnly(spread.artwork, ["cleanPlateAssetId", "sourceAssetId", "separation"], message);
      if (spread.artwork.separation !== "inpainted-clean-plate") {
        throw new HttpError(400, "invalid_manifest", `Spread ${order + 1} has an invalid artwork contract.`);
      }
      if (typeof spread.artwork.cleanPlateAssetId !== "string") throw new HttpError(400, "invalid_manifest", message);
      assertAssetReference(spread.artwork.cleanPlateAssetId, references);
      assertAssetReference(spread.artwork.sourceAssetId, references);
    }
    const elementIds = new Set();
    spread.elements.forEach((element) => validateElement(element, order + 1, references, elementIds));
  });
  return references;
}

function assetHref(shareToken, assetId) {
  return `/api/shared/${shareToken}/assets/${encodeURIComponent(assetId)}`;
}

function hydrateManifest(manifest, shareToken) {
  const hydrated = structuredClone(manifest);
  const hydrate = (value) => ASSET_ID_PATTERN.test(value ?? "") ? assetHref(shareToken, value) : value;
  if (hydrated.coverAssetId) {
    hydrated.coverTextureUrl = hydrate(hydrated.coverAssetId);
    delete hydrated.coverAssetId;
  }
  hydrated.coverTextureUrl = hydrate(hydrated.coverTextureUrl);
  hydrated.spreads.forEach((spread) => {
    spread.textureUrl = hydrate(spread.textureUrl);
    if (spread.artwork) {
      spread.artwork.cleanPlateAssetId = hydrate(spread.artwork.cleanPlateAssetId);
      spread.artwork.sourceAssetId = hydrate(spread.artwork.sourceAssetId);
    }
    spread.elements.forEach((element) => {
      element.assetId = hydrate(element.assetId);
      element.frameAssetIds = element.frameAssetIds?.map(hydrate);
    });
  });
  return hydrated;
}

async function readJsonBody(request) {
  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_MANIFEST_BYTES) throw new HttpError(413, "manifest_too_large", "The book manifest is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_MANIFEST_BYTES) {
    throw new HttpError(413, "manifest_too_large", "The book manifest is too large.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "The request body must be valid JSON.");
  }
}

export function createBookShareApi({ repository, objects, tokenFactory = defaultTokenFactory, clock = () => new Date() }) {
  const now = () => clock().toISOString();

  async function managedBook(request, bookId) {
    const token = bearerToken(request);
    const manageTokenHash = await hashToken(token);
    const book = await repository.findManagedBook(bookId, manageTokenHash);
    if (!book) throw new HttpError(404, "not_found", "The book was not found.");
    return { book, manageTokenHash };
  }

  async function createDraft() {
    const id = crypto.randomUUID();
    const manageToken = tokenFactory();
    if (!TOKEN_PATTERN.test(manageToken)) throw new Error("Token factory returned an invalid capability token.");
    await repository.createBook({ id, manageTokenHash: await hashToken(manageToken), now: now() });
    return json({ ok: true, bookId: id, manageToken, status: "draft" }, { status: 201 });
  }

  async function uploadAsset(request, bookId, rawAssetId) {
    const assetId = decodePathComponent(rawAssetId, "The asset was not found.");
    if (!ASSET_ID_PATTERN.test(assetId)) throw new HttpError(400, "invalid_asset_id", "The asset id is invalid.");
    const { book } = await managedBook(request, bookId);
    if (!MANAGEABLE_STATUSES.has(book.status)) {
      throw new HttpError(409, "invalid_state", "Only a draft or revoked book accepts new assets.");
    }
    const currentAssets = await repository.listAssetIds(bookId);
    if (currentAssets.includes(assetId)) {
      throw new HttpError(409, "asset_exists", "Asset ids are immutable; upload changed content with a new asset id.");
    }
    if (currentAssets.length >= MAX_ASSETS) {
      throw new HttpError(409, "asset_limit", `A book may contain at most ${MAX_ASSETS} uploaded assets.`);
    }
    const contentType = (request.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      throw new HttpError(415, "unsupported_asset", "Only PNG, JPEG, and WebP assets are accepted.");
    }
    const declaredSize = Number(request.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_ASSET_BYTES) {
      throw new HttpError(413, "asset_too_large", "Each stored asset must be 1.5 MB or smaller.");
    }
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_ASSET_BYTES) {
      throw new HttpError(413, "asset_too_large", "Each stored asset must be 1.5 MB or smaller.");
    }
    if (!matchesImageSignature(bytes, contentType)) {
      throw new HttpError(415, "unsupported_asset", "The file bytes do not match the declared image type.");
    }
    // A unique object key keeps a racing duplicate upload from overwriting or
    // deleting the immutable object already indexed by D1.
    const objectKey = `books/${bookId}/${assetId.slice("asset:".length)}/${crypto.randomUUID()}`;
    await objects.put(objectKey, bytes, { httpMetadata: { contentType } });
    try {
      await repository.insertAsset({ bookId, assetId, objectKey, contentType, byteSize: bytes.byteLength, now: now() });
    } catch (error) {
      await objects.delete(objectKey);
      throw error;
    }
    return json({ ok: true, bookId, assetId, byteSize: bytes.byteLength });
  }

  async function publish(request, bookId) {
    const { book, manageTokenHash } = await managedBook(request, bookId);
    if (!MANAGEABLE_STATUSES.has(book.status)) {
      throw new HttpError(409, "invalid_state", "Only a draft or revoked book can be published.");
    }
    const payload = await readJsonBody(request);
    const manifest = payload?.manifest;
    const references = validateManifest(manifest);
    const uploaded = new Set(await repository.listAssetIds(bookId));
    const missing = [...references].filter((assetId) => !uploaded.has(assetId));
    if (missing.length > 0) {
      throw new HttpError(409, "missing_assets", `Upload every referenced local asset before publishing (${missing.length} missing).`);
    }
    const shareToken = tokenFactory();
    if (!TOKEN_PATTERN.test(shareToken)) throw new Error("Token factory returned an invalid share token.");
    const published = await repository.publishBook({
      id: bookId,
      manageTokenHash,
      shareTokenHash: await hashToken(shareToken),
      title: manifest.title.trim(),
      revision: manifest.revision,
      manifestJson: JSON.stringify(manifest),
      now: now(),
    });
    if (!published) throw new HttpError(409, "publish_conflict", "The book changed before it could be published.");
    return json({
      ok: true,
      bookId,
      status: "published",
      shareUrl: new URL(`/share/${shareToken}`, request.url).href,
    });
  }

  async function readShared(shareToken) {
    if (!TOKEN_PATTERN.test(shareToken)) throw new HttpError(404, "not_found", "The shared book was not found.");
    const book = await repository.findPublishedBook(await hashToken(shareToken));
    if (!book?.manifest_json) throw new HttpError(404, "not_found", "The shared book was not found.");
    const manifest = hydrateManifest(JSON.parse(book.manifest_json), shareToken);
    return json({
      ok: true,
      book: manifest,
      publication: { title: book.title, revision: book.revision, publishedAt: book.published_at },
    });
  }

  async function readSharedAsset(request, shareToken, rawAssetId) {
    if (!TOKEN_PATTERN.test(shareToken)) throw new HttpError(404, "not_found", "The shared asset was not found.");
    const assetId = decodePathComponent(rawAssetId, "The shared asset was not found.");
    if (!ASSET_ID_PATTERN.test(assetId)) throw new HttpError(404, "not_found", "The shared asset was not found.");
    const asset = await repository.findPublishedAsset(await hashToken(shareToken), assetId);
    if (!asset) throw new HttpError(404, "not_found", "The shared asset was not found.");
    const object = request.method === "HEAD" ? await objects.head(asset.object_key) : await objects.get(asset.object_key);
    if (!object) throw new HttpError(404, "not_found", "The shared asset was not found.");
    const headers = new Headers({
      "content-type": asset.content_type,
      "content-length": String(asset.byte_size),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
    if (object.httpEtag) headers.set("etag", object.httpEtag);
    return new Response(request.method === "HEAD" ? null : object.body, { headers });
  }

  async function revoke(request, bookId) {
    const { book, manageTokenHash } = await managedBook(request, bookId);
    if (book.status !== "published") throw new HttpError(409, "invalid_state", "Only a published book can be revoked.");
    const revoked = await repository.revokeBook({ id: bookId, manageTokenHash, now: now() });
    if (!revoked) throw new HttpError(409, "revoke_conflict", "The book changed before it could be revoked.");
    return json({ ok: true, bookId, status: "revoked" });
  }

  async function remove(request, bookId) {
    const { manageTokenHash } = await managedBook(request, bookId);
    if (!await repository.markDeleting({ id: bookId, manageTokenHash, now: now() })) {
      throw new HttpError(409, "delete_conflict", "The book changed before deletion began.");
    }
    const assets = await repository.listAssets(bookId);
    if (assets.length > 0) await objects.delete(assets.map((asset) => asset.object_key));
    if (!await repository.deleteBook({ id: bookId, manageTokenHash })) {
      throw new HttpError(409, "delete_conflict", "The book files were removed, but its metadata cleanup must be retried.");
    }
    return new Response(null, { status: 204, headers: { "cache-control": "private, no-store" } });
  }

  async function route(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/books") return createDraft();

    let match = /^\/api\/books\/([^/]+)\/assets\/([^/]+)$/u.exec(url.pathname);
    if (match && request.method === "PUT" && BOOK_ID_PATTERN.test(match[1])) return uploadAsset(request, match[1], match[2]);

    match = /^\/api\/books\/([^/]+)\/(publish|revoke)$/u.exec(url.pathname);
    if (match && request.method === "POST" && BOOK_ID_PATTERN.test(match[1])) {
      return match[2] === "publish" ? publish(request, match[1]) : revoke(request, match[1]);
    }

    match = /^\/api\/books\/([^/]+)$/u.exec(url.pathname);
    if (match && request.method === "DELETE" && BOOK_ID_PATTERN.test(match[1])) return remove(request, match[1]);

    match = /^\/api\/shared\/([^/]+)\/assets\/([^/]+)$/u.exec(url.pathname);
    if (match && ["GET", "HEAD"].includes(request.method)) return readSharedAsset(request, match[1], match[2]);

    match = /^\/api\/shared\/([^/]+)$/u.exec(url.pathname);
    if (match && request.method === "GET") return readShared(match[1]);
    return null;
  }

  return {
    async handle(request) {
      try {
        return await route(request);
      } catch (error) {
        if (error instanceof HttpError) return json({ ok: false, code: error.code, message: error.message }, { status: error.status });
        return json({ ok: false, code: "storage_unavailable", message: "Book storage is temporarily unavailable." }, { status: 503 });
      }
    },
    async isPublishedShare(shareToken) {
      if (!TOKEN_PATTERN.test(shareToken)) return false;
      return Boolean(await repository.findPublishedBook(await hashToken(shareToken)));
    },
  };
}
