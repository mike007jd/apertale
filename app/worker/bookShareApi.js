import qualityRubric from "./qualityRubric.json" with { type: "json" };
import bundledAssetCatalog from "./bundledAssetCatalog.json" with { type: "json" };
// Generated from src/bookElementGrammar.ts by scripts/sync-book-element-grammar.mjs.
// This boundary keeps its own validators and only shares the grammar's bounds,
// vocabularies, and patterns.
import grammar from "./bookElementGrammar.json" with { type: "json" };
// Generated from src/bookAssetContract.ts by the same script: the cross-resource
// asset-reference rules this boundary re-checks with its own traversal.
import assetReferenceRules from "./bookAssetReferenceRules.json" with { type: "json" };

const ASSET_ID_PATTERN = /^asset:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = new RegExp(grammar.tokenPatternSource);
const BOOK_ID_PATTERN = new RegExp(grammar.bookIdPatternSource, "i");
const ALLOWED_IMAGE_TYPES = new Set(grammar.imageTypes);
const MAX_ASSET_BYTES = 1_500_000;
const MAX_MANIFEST_BYTES = 1_000_000;
// Derived from the rubric so the client publication plan and this upload quota
// advertise the same bound for reader-visible cover, final-base, layer, and
// frame assets. Author-only source provenance is never uploaded.
const MAX_ASSETS = qualityRubric.maxBookUploadedAssets;
const MAX_SITE_BOOKS = 2_000;
const MAX_BOOKS_PER_WINDOW = 40;
const CREATION_WINDOW_MS = 60 * 60 * 1_000;
const ELEMENT_KINDS = new Set(grammar.elementKinds);
const PAGES = new Set(grammar.pages);
const PROVENANCE = new Set(grammar.provenance);
const MOTION_PRESETS = new Set(grammar.motion.presets);
const HOVER_RESPONSES = new Set(grammar.hoverResponses);
const FOCUS_RESPONSES = new Set(grammar.focusResponses);
const REVEAL_KINDS = new Set(grammar.reveal.kinds);
const PROCEDURAL_ASSET_PATTERN = new RegExp(grammar.proceduralAsset.idPatternSource, "u");
const BUNDLED_ASSET_PATTERN = /^\/assets\/[A-Za-z0-9][A-Za-z0-9._/-]{0,503}$/u;
const BUNDLED_ASSETS = new Set(bundledAssetCatalog.assets);

/** Raises the shared asset-reference rule as this boundary's rejection. */
function assetReferenceError(code, values) {
  const message = assetReferenceRules.messages[code].replace(/\{(\w+)\}/gu, (_, key) => String(values[key]));
  return new HttpError(400, "invalid_manifest", message);
}

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

async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function requireShareToken(payload, message) {
  const shareToken = payload?.shareToken;
  if (typeof shareToken !== "string" || !TOKEN_PATTERN.test(shareToken)) {
    throw new HttpError(400, "invalid_share_token", message);
  }
  return shareToken;
}

function isPublishedWith(book, shareTokenHash) {
  return book?.status === "published"
    && book.share_token_hash === shareTokenHash
    && Number.isSafeInteger(book.revision);
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
  if ((BUNDLED_ASSET_PATTERN.test(value) && BUNDLED_ASSETS.has(value)) || PROCEDURAL_ASSET_PATTERN.test(value)) return;
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
  assertNumber(motion.durationMs, grammar.motion.durationMs.min, grammar.motion.durationMs.max, message, true);
}

function validateReveal(reveal, message) {
  if (!isRecord(reveal)) throw new HttpError(400, "invalid_manifest", message);
  assertOnly(reveal, ["kind", "title", "summary", "facts", "source"], message);
  if (!REVEAL_KINDS.has(reveal.kind)) throw new HttpError(400, "invalid_manifest", message);
  assertString(reveal.title, { min: reveal.kind === "none" ? 0 : 1, max: grammar.reveal.title.max, message });
  assertString(reveal.summary, { max: grammar.reveal.summary.max, message });
  if (!Array.isArray(reveal.facts) || reveal.facts.length > grammar.reveal.facts.max) throw new HttpError(400, "invalid_manifest", message);
  reveal.facts.forEach((fact) => {
    if (!isRecord(fact)) throw new HttpError(400, "invalid_manifest", message);
    assertOnly(fact, ["label", "value"], message);
    assertString(fact.label, { min: 1, max: grammar.reveal.factLabel.max, message });
    assertString(fact.value, { min: 1, max: grammar.reveal.factValue.max, message });
  });
  if (typeof reveal.source !== "undefined") assertString(reveal.source, { max: grammar.reveal.source.max, message });
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
  assertString(element.label, { min: 1, max: grammar.label.max, message });
  if (!ELEMENT_KINDS.has(element.kind) || !PAGES.has(element.page) || !PROVENANCE.has(element.provenance) || typeof element.locked !== "boolean") {
    throw new HttpError(400, "invalid_manifest", message);
  }
  if (typeof element.assetId !== "string") throw new HttpError(400, "invalid_manifest", message);
  assertAssetReference(element.assetId, references);
  if (!isRecord(element.transform)) throw new HttpError(400, "invalid_manifest", message);
  assertOnly(element.transform, ["x", "y", "scaleX", "scaleY", "rotationDeg"], message);
  for (const field of ["x", "y", "scaleX", "scaleY", "rotationDeg"]) {
    assertNumber(element.transform[field], grammar.transform[field].min, grammar.transform[field].max, message);
  }
  assertNumber(element.depth, grammar.depth.min, grammar.depth.max, message);
  validateMotion(element.motion, message);
  validateInteraction(element.interaction, message);
  if (typeof element.frameAssetIds !== "undefined") {
    if (!Array.isArray(element.frameAssetIds) || element.frameAssetIds.length < grammar.frameAssetIds.min || element.frameAssetIds.length > grammar.frameAssetIds.max) {
      throw new HttpError(400, "invalid_manifest", message);
    }
    if (PROCEDURAL_ASSET_PATTERN.test(element.assetId)) {
      throw new HttpError(400, "invalid_manifest", `Spread ${spreadNumber} procedural markers cannot carry image sequences.`);
    }
    element.frameAssetIds.forEach((assetId) => {
      if (typeof assetId !== "string") throw new HttpError(400, "invalid_manifest", message);
      if (PROCEDURAL_ASSET_PATTERN.test(assetId)) {
        throw new HttpError(400, "invalid_manifest", `Spread ${spreadNumber} image sequences cannot contain procedural markers.`);
      }
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
  if (!Array.isArray(manifest.spreads) || manifest.spreads.length < grammar.spreads.min || manifest.spreads.length > grammar.spreads.max) {
    throw new HttpError(400, "invalid_manifest", `A shared book must contain ${grammar.spreads.min} to ${grammar.spreads.max} spreads.`);
  }

  const references = new Set();
  const spreadIds = new Set();
  const elementIds = new Set();
  assertAssetReference(manifest.coverAssetId, references);
  assertAssetReference(manifest.coverTextureUrl, references);
  manifest.spreads.forEach((spread, order) => {
    const message = `Spread ${order + 1} is invalid.`;
    if (!isRecord(spread)) throw new HttpError(400, "invalid_manifest", message);
    assertOnly(spread, ["id", "order", "textureUrl", "artwork", "title", "body", "kicker", "elements"], message);
    assertString(spread.id, { min: 1, max: 128, message });
    if (spreadIds.has(spread.id) || spread.order !== order || !Array.isArray(spread.elements) || spread.elements.length > grammar.elementsPerSpread.max) {
      throw new HttpError(400, "invalid_manifest", message);
    }
    spreadIds.add(spread.id);
    assertString(spread.title, { min: 1, max: 160, message });
    assertString(spread.body, { max: 4_000, message });
    if (typeof spread.kicker !== "undefined") assertString(spread.kicker, { max: 200, message });
    assertAssetReference(spread.textureUrl, references);
    if (typeof spread.artwork !== "undefined") {
      if (!isRecord(spread.artwork)) throw new HttpError(400, "invalid_manifest", message);
      assertOnly(spread.artwork, ["cleanPlateAssetId", "sourceAssetId", "personalSourceAssetId", "separation"], message);
      if (!assetReferenceRules.separations.includes(spread.artwork.separation)) {
        throw new HttpError(400, "invalid_manifest", `Spread ${order + 1} has an invalid artwork contract.`);
      }
      if (typeof spread.artwork.cleanPlateAssetId !== "string") throw new HttpError(400, "invalid_manifest", message);
      assertAssetReference(spread.artwork.cleanPlateAssetId, references);
      assertAssetReference(spread.artwork.sourceAssetId, references);
      assertAssetReference(spread.artwork.personalSourceAssetId, references);
    }
    spread.elements.forEach((element) => validateElement(element, order + 1, references, elementIds));
  });
  validateBookAssetReferences(manifest);
  return references;
}

/** Mirrors the client's pure cross-resource contract at the publish boundary. */
function validateBookAssetReferences(manifest) {
  const coverAssetId = manifest.coverAssetId ?? manifest.coverTextureUrl;
  const backgroundOwner = new Map();
  const backgroundIds = new Set();

  manifest.spreads.forEach((spread, spreadIndex) => {
    if (!spread.artwork) return;
    const spreadNumber = spreadIndex + 1;
    const { sourceAssetId, cleanPlateAssetId, separation } = spread.artwork;
    if (sourceAssetId && sourceAssetId === cleanPlateAssetId && separation !== assetReferenceRules.sourceReuseSeparation) {
      throw assetReferenceError("generated-source-clean-reuse", { spread: spreadNumber });
    }
    [sourceAssetId, cleanPlateAssetId].filter(Boolean).forEach((asset) => {
      if (asset === coverAssetId) throw assetReferenceError("cover-interior-reuse", { spread: spreadNumber, asset });
      const owner = backgroundOwner.get(asset);
      if (typeof owner === "number" && owner !== spreadIndex) {
        throw assetReferenceError("background-cross-spread-reuse", { spread: spreadNumber, asset, owner: owner + 1 });
      }
      backgroundOwner.set(asset, spreadIndex);
      backgroundIds.add(asset);
    });
  });

  manifest.spreads.forEach((spread, spreadIndex) => {
    const spreadNumber = spreadIndex + 1;
    const foregroundOwner = new Map();
    spread.elements.filter((element) => !PROCEDURAL_ASSET_PATTERN.test(element.assetId)).forEach((element, layerIndex) => {
      const layer = layerIndex + 1;
      if (element.frameAssetIds?.length && element.frameAssetIds[0] !== element.assetId) {
        throw assetReferenceError("resting-frame-mismatch", { spread: spreadNumber, layer, asset: element.assetId });
      }
      new Set(element.frameAssetIds?.length ? element.frameAssetIds : [element.assetId]).forEach((asset) => {
        const owner = foregroundOwner.get(asset);
        if (typeof owner === "number" && owner !== layerIndex) {
          throw assetReferenceError("foreground-cross-layer-reuse", { spread: spreadNumber, layer, asset, owner: owner + 1 });
        }
        foregroundOwner.set(asset, layerIndex);
        if (asset === coverAssetId) throw assetReferenceError("cover-foreground-reuse", { spread: spreadNumber, layer, asset });
        if (backgroundIds.has(asset)) throw assetReferenceError("background-foreground-reuse", { spread: spreadNumber, layer, asset });
      });
    });
  });
}

function assetHref(shareToken, assetId) {
  return `/api/shared/${shareToken}/assets/${encodeURIComponent(assetId)}`;
}

function publicManifest(manifest) {
  const published = structuredClone(manifest);
  if (published.coverAssetId) delete published.coverTextureUrl;
  published.spreads?.forEach((spread) => {
    spread.elements?.forEach((element) => {
      if (
        PROCEDURAL_ASSET_PATTERN.test(element.assetId)
        || element.frameAssetIds?.some((assetId) => PROCEDURAL_ASSET_PATTERN.test(assetId))
      ) delete element.frameAssetIds;
    });
    if (!spread.artwork) return;
    const usesGroundedComposite = spread.textureUrl
      && spread.textureUrl === spread.artwork.sourceAssetId
      && spread.elements?.every((element) => PROCEDURAL_ASSET_PATTERN.test(element.assetId));
    const renderedBase = usesGroundedComposite
      ? spread.textureUrl
      : spread.artwork.cleanPlateAssetId ?? spread.textureUrl;
    if (renderedBase) spread.artwork.cleanPlateAssetId = renderedBase;
    delete spread.textureUrl;
    delete spread.artwork.sourceAssetId;
    delete spread.artwork.personalSourceAssetId;
  });
  return published;
}

function hydrateManifest(manifest, shareToken) {
  // Sanitizing here also protects links published before private authoring
  // provenance was split from the reader manifest.
  const hydrated = publicManifest(manifest);
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
  // Read the body once: the byte length gates the size check and the same
  // buffer is decoded for parsing.
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_MANIFEST_BYTES) {
    throw new HttpError(413, "manifest_too_large", "The book manifest is too large.");
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "invalid_json", "The request body must be valid JSON.");
  }
}

export function createBookShareApi({
  repository,
  objects,
  clock = () => new Date(),
  limits = {},
}) {
  const now = () => clock().toISOString();
  const maxSiteBooks = limits.maxSiteBooks ?? MAX_SITE_BOOKS;
  const maxBooksPerWindow = limits.maxBooksPerWindow ?? MAX_BOOKS_PER_WINDOW;
  const creationWindowMs = limits.creationWindowMs ?? CREATION_WINDOW_MS;

  async function managedBook(request, bookId) {
    const token = bearerToken(request);
    const manageTokenHash = await hashToken(token);
    const book = await repository.findManagedBook(bookId, manageTokenHash);
    if (!book) throw new HttpError(404, "not_found", "The book was not found.");
    return { book, manageTokenHash };
  }

  async function createDraft(request) {
    const payload = await readJsonBody(request);
    const id = payload?.bookId;
    if (typeof id !== "string" || !BOOK_ID_PATTERN.test(id)) {
      throw new HttpError(400, "invalid_book_id", "A valid client-generated book id is required.");
    }
    const manageTokenHash = await hashToken(bearerToken(request));
    const windowStart = new Date(clock().getTime() - creationWindowMs).toISOString();
    const outcome = await repository.createBook({
      id,
      manageTokenHash,
      now: now(),
      maxSiteBooks,
      maxBooksPerWindow,
      windowStart,
    });
    if (outcome === "deleted") {
      return json({ ok: true, bookId: id, status: "deleted" });
    }
    if (outcome === "conflict") {
      throw new HttpError(409, "book_exists", "That book id already belongs to another creator capability.");
    }
    if (outcome === "site_limit") {
      throw new HttpError(429, "creation_limit", "This Site has reached its book storage bound.");
    }
    if (outcome === "rate_limit") {
      throw new HttpError(429, "creation_rate", "Too many books are being created right now. Try again later.");
    }
    const existing = outcome === "existing"
      ? await repository.findManagedBook(id, manageTokenHash)
      : null;
    return json({
      ok: true,
      bookId: id,
      status: existing?.status ?? "draft",
    }, { status: outcome === "created" ? 201 : 200 });
  }

  async function uploadAsset(request, bookId, rawAssetId) {
    const assetId = decodePathComponent(rawAssetId, "The asset was not found.");
    if (!ASSET_ID_PATTERN.test(assetId)) throw new HttpError(400, "invalid_asset_id", "The asset id is invalid.");
    const { book, manageTokenHash } = await managedBook(request, bookId);
    if (book.status !== "draft") {
      throw new HttpError(409, "invalid_state", "Only a fresh draft accepts new assets; create a new draft to republish.");
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
      const inserted = await repository.insertAsset({
        bookId,
        manageTokenHash,
        assetId,
        objectKey,
        contentType,
        byteSize: bytes.byteLength,
        now: now(),
        maxAssets: MAX_ASSETS,
      });
      if (!inserted) {
        const current = await repository.findManagedBook(bookId, manageTokenHash);
        if (current?.status === "draft") {
          const assets = await repository.listAssetIds(bookId);
          if (assets.includes(assetId)) {
            throw new HttpError(409, "asset_exists", "Asset ids are immutable; upload changed content with a new asset id.");
          }
          if (assets.length >= MAX_ASSETS) {
            throw new HttpError(409, "asset_limit", `A book may contain at most ${MAX_ASSETS} uploaded assets.`);
          }
        }
        throw new HttpError(409, "invalid_state", "Only a fresh draft accepts new assets; create a new draft to republish.");
      }
    } catch (error) {
      await objects.delete(objectKey);
      throw error;
    }
    return json({ ok: true, bookId, assetId, byteSize: bytes.byteLength });
  }

  function publishedJson(request, bookId, shareToken, revision) {
    return json({
      ok: true,
      bookId,
      status: "published",
      shareUrl: new URL(`/share/${shareToken}`, request.url).href,
      publishedRevision: revision,
    });
  }

  async function publishContext(request, bookId) {
    const { book, manageTokenHash } = await managedBook(request, bookId);
    const payload = await readJsonBody(request);
    const shareToken = requireShareToken(payload, "A valid share token is required.");
    return { book, manageTokenHash, payload, shareToken, shareTokenHash: await hashToken(shareToken) };
  }

  async function publish(request, bookId) {
    const { book, manageTokenHash, payload, shareToken, shareTokenHash } = await publishContext(request, bookId);
    if (book.status === "published") {
      if (book.share_token_hash !== shareTokenHash || !Number.isSafeInteger(book.revision)) {
        throw new HttpError(409, "invalid_state", "Only a fresh draft generation can be published.");
      }
      return publishedJson(request, bookId, shareToken, book.revision);
    }

    if (book.status === "revoked" && await repository.isRetiredShareToken(shareTokenHash)) {
      throw new HttpError(409, "revoked_share", "A revoked share capability cannot be published again.");
    }
    if (book.status !== "draft") {
      throw new HttpError(409, "invalid_state", "Only a fresh draft can be published.");
    }
    if (Number(book.asset_cleanup_pending) === 1) {
      throw new HttpError(409, "invalid_state", "Finish revoking the previous publication before publishing again.");
    }
    if (await repository.isRetiredShareToken(shareTokenHash)) {
      throw new HttpError(409, "revoked_share", "A revoked share capability cannot be published again.");
    }
    const claimed = await repository.claimPublishAttempt({
      id: bookId,
      manageTokenHash,
      shareTokenHash,
      now: now(),
    });
    if (!claimed) {
      const current = await repository.findManagedBook(bookId, manageTokenHash);
      if (isPublishedWith(current, shareTokenHash)) {
        return publishedJson(request, bookId, shareToken, current.revision);
      }
      throw new HttpError(409, "publish_conflict", "Another publication attempt already owns this book state.");
    }
    const manifest = payload?.manifest;
    validateManifest(manifest);
    // One shared creation-asset policy traversal: the deterministic publish
    // checks and the stored attestation validate the same (manifest, brief)
    // pair, so a second identical pass would only duplicate work.
    const publishedManifest = publicManifest(manifest);
    const references = validateManifest(publishedManifest);
    const uploaded = new Set(await repository.listAssetIds(bookId));
    const missing = [...references].filter((assetId) => !uploaded.has(assetId));
    if (missing.length > 0) {
      throw new HttpError(409, "missing_assets", `Upload every referenced local asset before publishing (${missing.length} missing).`);
    }
    const published = await repository.publishBook({
      id: bookId,
      manageTokenHash,
      shareTokenHash,
      title: manifest.title.trim(),
      revision: manifest.revision,
      manifestJson: JSON.stringify(publishedManifest),
      now: now(),
    });
    if (!published) throw new HttpError(409, "publish_conflict", "The book changed before it could be published.");
    return publishedJson(request, bookId, shareToken, published);
  }

  async function reconcilePublish(request, bookId) {
    const { book, manageTokenHash, shareToken, shareTokenHash } = await publishContext(request, bookId);
    if (book.status === "published") {
      if (book.share_token_hash !== shareTokenHash || !Number.isSafeInteger(book.revision)) {
        throw new HttpError(409, "invalid_state", "The committed publication belongs to another share capability.");
      }
      return publishedJson(request, bookId, shareToken, book.revision);
    }
    if (book.status === "revoked") {
      return json({ ok: true, bookId, status: "revoked" });
    }
    if (book.status !== "draft") {
      throw new HttpError(409, "invalid_state", "This publication cannot be resumed from its current state.");
    }
    if (Number(book.asset_cleanup_pending) === 1) {
      return json({ ok: true, bookId, status: "revoked" });
    }
    if (await repository.isRetiredShareToken(shareTokenHash)) {
      return json({ ok: true, bookId, status: "revoked" });
    }
    if (await repository.claimPublishAttempt({
      id: bookId,
      manageTokenHash,
      shareTokenHash,
      now: now(),
    })) {
      return json({ ok: true, bookId, status: "publishing" });
    }
    const current = await repository.findManagedBook(bookId, manageTokenHash);
    if (isPublishedWith(current, shareTokenHash)) {
      return publishedJson(request, bookId, shareToken, current.revision);
    }
    if (await repository.isRetiredShareToken(shareTokenHash)) {
      return json({ ok: true, bookId, status: "revoked" });
    }
    throw new HttpError(409, "publish_conflict", "Another publication attempt already owns this book state.");
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
    if (!asset?.manifest_json) throw new HttpError(404, "not_found", "The shared asset was not found.");
    try {
      const currentReferences = validateManifest(publicManifest(JSON.parse(asset.manifest_json)));
      if (!currentReferences.has(assetId)) throw new Error("unreferenced asset");
    } catch {
      // Assets left behind by an older revision remain private after republish.
      // Stored-manifest corruption also fails closed instead of broadening read
      // access to every object ever uploaded for the book.
      throw new HttpError(404, "not_found", "The shared asset was not found.");
    }
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
    const payload = await readJsonBody(request);
    const shareToken = requireShareToken(payload, "The published share token is required for revocation.");
    const shareTokenHash = await hashToken(shareToken);
    // Revocation retains the last public token hash as a tombstone and clears
    // any in-flight publish claim. A retry is therefore idempotent without
    // allowing the revoked URL to become public again.
    if (book.status !== "published" && book.status !== "revoked") {
      throw new HttpError(409, "invalid_state", "Only a published or revoked book can be revoked.");
    }
    if (book.share_token_hash !== shareTokenHash) {
      if (await repository.isRetiredShareTokenForBook(shareTokenHash, bookId)) {
        return json({ ok: true, bookId, status: "revoked" });
      }
      throw new HttpError(409, "revoke_conflict", "The publication targeted for revocation is no longer current.");
    }
    if (book.status === "revoked" && Number(book.asset_cleanup_pending) === 0) {
      return json({ ok: true, bookId, status: "revoked" });
    }
    const revoked = await repository.revokeBook({
      id: bookId,
      manageTokenHash,
      shareTokenHash,
      now: now(),
    });
    if (!revoked) {
      const current = await repository.findManagedBook(bookId, manageTokenHash);
      if (
        (current?.status === "revoked"
          && Number(current.asset_cleanup_pending) === 0
          && current.share_token_hash === shareTokenHash)
        || (
          current?.share_token_hash !== shareTokenHash
          && await repository.isRetiredShareTokenForBook(shareTokenHash, bookId)
        )
      ) return json({ ok: true, bookId, status: "revoked" });
      throw new HttpError(409, "revoke_conflict", "The book changed before it could be revoked.");
    }
    const objectKeys = await repository.listAssetsForRevocation({ id: bookId, manageTokenHash, shareTokenHash });
    if (objectKeys.length > 0) await objects.delete(objectKeys);
    if (!await repository.completeRevocation({
      id: bookId,
      manageTokenHash,
      shareTokenHash,
      now: now(),
    })) {
      throw new HttpError(409, "revoke_conflict", "The share link was revoked, but its asset cleanup must be retried.");
    }
    return json({ ok: true, bookId, status: "revoked" });
  }

  async function remove(request, bookId) {
    const manageTokenHash = await hashToken(bearerToken(request));
    const book = await repository.findManagedBook(bookId, manageTokenHash);
    if (!book) {
      const deleted = await repository.findDeletedBook(bookId);
      if (deleted?.manage_token_hash === manageTokenHash) {
        return new Response(null, { status: 204, headers: { "cache-control": "private, no-store" } });
      }
      throw new HttpError(409, "delete_conflict", "The draft is not visible yet; confirm its creation before retrying deletion.");
    }
    if (!await repository.markDeleting({ id: bookId, manageTokenHash, now: now() })) {
      throw new HttpError(409, "delete_conflict", "The book changed before deletion began.");
    }
    const objectKeys = await repository.listAssetsForDeletion({ id: bookId, manageTokenHash });
    if (objectKeys.length > 0) await objects.delete(objectKeys);
    if (!await repository.deleteBook({ id: bookId, manageTokenHash })) {
      throw new HttpError(409, "delete_conflict", "The book files were removed, but its metadata cleanup must be retried.");
    }
    return new Response(null, { status: 204, headers: { "cache-control": "private, no-store" } });
  }

  async function route(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/books") return createDraft(request);

    let match = /^\/api\/books\/([^/]+)\/assets\/([^/]+)$/u.exec(url.pathname);
    if (match && request.method === "PUT" && BOOK_ID_PATTERN.test(match[1])) return uploadAsset(request, match[1], match[2]);

    match = /^\/api\/books\/([^/]+)\/publish\/reconcile$/u.exec(url.pathname);
    if (match && request.method === "POST" && BOOK_ID_PATTERN.test(match[1])) return reconcilePublish(request, match[1]);

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
