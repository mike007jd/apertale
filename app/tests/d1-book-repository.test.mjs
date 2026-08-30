import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createBookShareApi } from "../worker/bookShareApi.js";
import { D1BookRepository } from "../worker/d1BookRepository.js";

class NodeD1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new NodeD1Statement(this.database, this.sql, values);
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) ?? null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }
}

class NodeD1Database {
  database = new DatabaseSync(":memory:");

  prepare(sql) {
    return new NodeD1Statement(this.database, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }

  close() {
    this.database.close();
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

class BlockingPutObjects {
  constructor(expectedPuts = 1) {
    this.expectedPuts = expectedPuts;
    this.values = new Map();
    this.putCount = 0;
    this.putStarted = deferred();
    this.putReleased = deferred();
  }

  async put(key, value, options) {
    this.values.set(key, { body: new Uint8Array(value), contentType: options.httpMetadata.contentType });
    this.putCount += 1;
    if (this.putCount >= this.expectedPuts) this.putStarted.resolve();
    await this.putReleased.promise;
  }

  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.values.delete(key);
  }
}

function testAssetId(serial) {
  return `asset:${serial.toString(16).padStart(8, "0")}-1234-4234-8234-123456789abc`;
}

test("D1 draft creation is idempotent only for the same creator capability", async (context) => {
  const database = new NodeD1Database();
  context.after(() => database.close());
  const repository = new D1BookRepository(database);
  const input = {
    id: "12345678-1234-4234-8234-123456789abc",
    manageTokenHash: "manage-hash-a",
    now: "2026-08-30T00:00:00.000Z",
  };

  assert.equal(await repository.createBook(input), "created");
  assert.equal(await repository.createBook(input), "existing");
  assert.equal(await repository.createBook({ ...input, manageTokenHash: "manage-hash-b" }), "conflict");
  assert.equal(await repository.countBooks(), 1);
  assert.equal((await repository.findBook(input.id)).manage_token_hash, input.manageTokenHash);
});

test("D1 admits only one concurrent draft at each creation bound", async (context) => {
  const now = "2026-08-30T00:00:00.000Z";
  const windowStart = "2026-08-29T23:00:00.000Z";

  const siteDatabase = new NodeD1Database();
  context.after(() => siteDatabase.close());
  const siteRepository = new D1BookRepository(siteDatabase);
  const siteOutcomes = await Promise.all([
    siteRepository.createBook({
      id: "13345678-1234-4234-8234-123456789abc",
      manageTokenHash: "manage-a",
      now,
      maxSiteBooks: 1,
      maxBooksPerWindow: 10,
      windowStart,
    }),
    siteRepository.createBook({
      id: "14345678-1234-4234-8234-123456789abc",
      manageTokenHash: "manage-b",
      now,
      maxSiteBooks: 1,
      maxBooksPerWindow: 10,
      windowStart,
    }),
  ]);
  assert.deepEqual(siteOutcomes.sort(), ["created", "site_limit"]);
  assert.equal(await siteRepository.countBooks(), 1);

  const rateDatabase = new NodeD1Database();
  context.after(() => rateDatabase.close());
  const rateRepository = new D1BookRepository(rateDatabase);
  const rateOutcomes = await Promise.all([
    rateRepository.createBook({
      id: "15345678-1234-4234-8234-123456789abc",
      manageTokenHash: "manage-a",
      now,
      maxSiteBooks: 10,
      maxBooksPerWindow: 1,
      windowStart,
    }),
    rateRepository.createBook({
      id: "16345678-1234-4234-8234-123456789abc",
      manageTokenHash: "manage-b",
      now,
      maxSiteBooks: 10,
      maxBooksPerWindow: 1,
      windowStart,
    }),
  ]);
  assert.deepEqual(rateOutcomes.sort(), ["created", "rate_limit"]);
  assert.equal(await rateRepository.countBooks(), 1);
});

test("D1 creation-rate evidence survives permanent book deletion", async (context) => {
  const database = new NodeD1Database();
  context.after(() => database.close());
  const repository = new D1BookRepository(database);
  const now = "2026-08-30T00:00:00.000Z";
  const windowStart = "2026-08-29T23:00:00.000Z";
  const first = {
    id: "17345678-1234-4234-8234-123456789abc",
    manageTokenHash: "manage-a",
    now,
    maxSiteBooks: 10,
    maxBooksPerWindow: 1,
    windowStart,
  };

  assert.equal(await repository.createBook(first), "created");
  assert.equal(await repository.markDeleting({
    id: first.id,
    manageTokenHash: first.manageTokenHash,
    now,
  }), true);
  assert.equal(await repository.deleteBook({
    id: first.id,
    manageTokenHash: first.manageTokenHash,
  }), true);
  assert.equal(await repository.countBooks(), 0);
  assert.equal(await repository.countBooksCreatedSince(windowStart), 1);
  assert.equal(await repository.createBook({
    ...first,
    id: "18345678-1234-4234-8234-123456789abc",
    manageTokenHash: "manage-b",
  }), "rate_limit");
});

test("D1 deletion makes one creator generation terminal", async (context) => {
  const database = new NodeD1Database();
  context.after(() => database.close());
  const repository = new D1BookRepository(database);
  const api = createBookShareApi({ repository, objects: new BlockingPutObjects() });
  const bookId = "19345678-1234-4234-8234-123456789abc";
  const manageToken = "q".repeat(43);
  const authorization = `Bearer ${manageToken}`;

  const creating = await api.handle(new Request("https://example.test/api/books", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ bookId }),
  }));
  assert.equal(creating.status, 201);
  const created = await repository.findBook(bookId);
  assert.ok(created?.manage_token_hash);
  const deleting = await api.handle(new Request(`https://example.test/api/books/${bookId}`, {
    method: "DELETE",
    headers: { authorization },
  }));
  assert.equal(deleting.status, 204);
  assert.equal(await repository.findBook(bookId), null);
  const tombstone = await repository.findDeletedBook(bookId);
  assert.equal(tombstone?.manage_token_hash, created.manage_token_hash);
  assert.equal(await repository.createBook({
    id: bookId,
    manageTokenHash: created.manage_token_hash,
    now: "2026-08-30T00:00:00.000Z",
  }), "deleted");
  assert.equal(await repository.createBook({
    id: bookId,
    manageTokenHash: "another-capability",
    now: "2026-08-30T00:00:00.000Z",
  }), "conflict");

  const replayedCreate = await api.handle(new Request("https://example.test/api/books", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ bookId }),
  }));
  assert.equal(replayedCreate.status, 200);
  assert.deepEqual(await replayedCreate.json(), { ok: true, bookId, status: "deleted" });
});

test("D1 triggers preserve revoke and delete invariants for rolling old Workers", async (context) => {
  const database = new NodeD1Database();
  context.after(() => database.close());
  const repository = new D1BookRepository(database);
  const now = "2026-08-30T00:00:00.000Z";
  const revokedId = "20345678-1234-4234-8234-123456789abc";
  const revokedManageHash = "rolling-revoke-manage";
  assert.equal(await repository.createBook({ id: revokedId, manageTokenHash: revokedManageHash, now }), "created");
  await database.prepare(`UPDATE living_books
    SET status = 'published', share_token_hash = ?, updated_at = ?
    WHERE id = ?`).bind("rolling-share", now, revokedId).run();
  await database.prepare(`UPDATE living_books
    SET status = 'revoked', updated_at = ?
    WHERE id = ?`).bind(now, revokedId).run();
  assert.equal((await repository.findManagedBook(revokedId, revokedManageHash)).asset_cleanup_pending, 1);

  const deletedId = "21345678-1234-4234-8234-123456789abc";
  const deletedManageHash = "rolling-delete-manage";
  assert.equal(await repository.createBook({ id: deletedId, manageTokenHash: deletedManageHash, now }), "created");
  await database.prepare(`UPDATE living_books
    SET status = 'deleting', updated_at = ?
    WHERE id = ?`).bind(now, deletedId).run();
  await database.prepare("DELETE FROM living_books WHERE id = ?").bind(deletedId).run();
  const deleted = await repository.findDeletedBook(deletedId);
  assert.equal(deleted.manage_token_hash, deletedManageHash);
  assert.equal(deleted.deleted_at, now);
  const eventsBeforeDelayedCreate = await database.prepare(`SELECT COUNT(*) AS count
    FROM living_book_creation_events`).first();
  await assert.rejects(
    database.prepare(`INSERT INTO living_books (
      id, manage_token_hash, status, created_at, updated_at
    ) VALUES (?, ?, 'draft', ?, ?)
    ON CONFLICT(id) DO NOTHING`).bind(
      deletedId,
      deletedManageHash,
      now,
      now,
    ).run(),
    /deleted generation id is terminal/u,
  );
  assert.equal(await repository.findBook(deletedId), null);
  const eventsAfterDelayedCreate = await database.prepare(`SELECT COUNT(*) AS count
    FROM living_book_creation_events`).first();
  assert.equal(eventsAfterDelayedCreate.count, eventsBeforeDelayedCreate.count);
});

test("D1 publish replay returns the committed revision without replacing its manifest", async (context) => {
  const database = new NodeD1Database();
  context.after(() => database.close());
  const repository = new D1BookRepository(database);
  const id = "22345678-1234-4234-8234-123456789abc";
  const manageTokenHash = "manage-hash";
  const shareTokenHash = "share-hash";
  const now = "2026-08-30T00:00:00.000Z";
  await repository.createBook({ id, manageTokenHash, now });
  assert.equal(await repository.claimPublishAttempt({ id, manageTokenHash, shareTokenHash, now }), true);

  assert.equal(await repository.publishBook({
    id,
    manageTokenHash,
    shareTokenHash,
    title: "Committed title",
    revision: 4,
    manifestJson: JSON.stringify({ revision: 4, title: "Committed title" }),
    now,
  }), 4);
  assert.equal(await repository.publishBook({
    id,
    manageTokenHash,
    shareTokenHash,
    title: "Uncommitted edit",
    revision: 5,
    manifestJson: JSON.stringify({ revision: 5, title: "Uncommitted edit" }),
    now: "2026-08-30T00:01:00.000Z",
  }), 4);
  assert.equal(await repository.publishBook({
    id,
    manageTokenHash,
    shareTokenHash: "different-share-hash",
    title: "Wrong capability",
    revision: 5,
    manifestJson: "{}",
    now,
  }), false);

  const published = await repository.findPublishedBook(shareTokenHash);
  assert.equal(published.revision, 4);
  assert.equal(published.title, "Committed title");
  assert.deepEqual(JSON.parse(published.manifest_json), { revision: 4, title: "Committed title" });
});

test("D1 serializes publish attempts and tombstones the revoked share token", async (context) => {
  const database = new NodeD1Database();
  context.after(() => database.close());
  const repository = new D1BookRepository(database);
  const id = "32345678-1234-4234-8234-123456789abc";
  const manageTokenHash = "manage-hash";
  const firstShareHash = "share-hash-a";
  const nextShareHash = "share-hash-b";
  const now = "2026-08-30T00:00:00.000Z";
  await repository.createBook({ id, manageTokenHash, now });

  assert.equal(await repository.claimPublishAttempt({ id, manageTokenHash, shareTokenHash: firstShareHash, now }), true);
  assert.equal(await repository.claimPublishAttempt({ id, manageTokenHash, shareTokenHash: firstShareHash, now }), true);
  assert.equal(await repository.claimPublishAttempt({ id, manageTokenHash, shareTokenHash: nextShareHash, now }), false);
  assert.equal(await repository.publishBook({
    id,
    manageTokenHash,
    shareTokenHash: firstShareHash,
    title: "First",
    revision: 1,
    manifestJson: JSON.stringify({ revision: 1 }),
    now,
  }), 1);

  assert.equal(await repository.revokeBook({ id, manageTokenHash, shareTokenHash: firstShareHash, now }), true);
  const revoked = await repository.findManagedBook(id, manageTokenHash);
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.share_token_hash, firstShareHash);
  assert.equal(revoked.publish_attempt_token_hash, null);
  assert.equal(revoked.asset_cleanup_pending, 1);
  assert.equal(await repository.isRetiredShareToken(firstShareHash), true);
  assert.equal(await repository.isRetiredShareTokenForBook(firstShareHash, id), true);
  assert.equal(await repository.isRetiredShareTokenForBook(firstShareHash, "92345678-1234-4234-8234-123456789abc"), false);
  assert.equal(await repository.claimPublishAttempt({ id, manageTokenHash, shareTokenHash: firstShareHash, now }), false);
  assert.equal(await repository.claimPublishAttempt({ id, manageTokenHash, shareTokenHash: nextShareHash, now }), false);
  assert.equal(await repository.completeRevocation({ id, manageTokenHash, shareTokenHash: firstShareHash, now }), true);
  assert.equal((await repository.findManagedBook(id, manageTokenHash)).asset_cleanup_pending, 0);
  assert.equal(await repository.insertAsset({
    bookId: id,
    manageTokenHash,
    assetId: testAssetId(999),
    objectKey: "revoked/late-upload",
    contentType: "image/png",
    byteSize: 8,
    now,
  }), false);
  assert.equal(await repository.claimPublishAttempt({ id, manageTokenHash, shareTokenHash: nextShareHash, now }), false);
  const nextId = "35345678-1234-4234-8234-123456789abc";
  assert.equal(await repository.createBook({ id: nextId, manageTokenHash, now }), "created");
  assert.equal(await repository.claimPublishAttempt({ id: nextId, manageTokenHash, shareTokenHash: nextShareHash, now }), true);
  assert.equal(await repository.publishBook({
    id: nextId,
    manageTokenHash,
    shareTokenHash: nextShareHash,
    title: "Second",
    revision: 2,
    manifestJson: JSON.stringify({ revision: 2 }),
    now,
  }), 2);
  assert.equal(await repository.revokeBook({ id: nextId, manageTokenHash, shareTokenHash: nextShareHash, now }), true);
  assert.equal(await repository.isRetiredShareToken(nextShareHash), true);
  assert.equal(await repository.claimPublishAttempt({ id, manageTokenHash, shareTokenHash: firstShareHash, now }), false);
});

test("D1 revocation cleanup releases the full asset quota to a fresh draft", async (context) => {
  const database = new NodeD1Database();
  context.after(() => database.close());
  const repository = new D1BookRepository(database);
  let id = "33345678-1234-4234-8234-123456789abc";
  const manageTokenHash = "manage-hash";
  const shareTokenHash = "share-hash";
  const now = "2026-08-30T00:00:00.000Z";
  await repository.createBook({ id, manageTokenHash, now });

  const insertRange = async (first, last) => {
    for (let serial = first; serial <= last; serial += 1) {
      assert.equal(await repository.insertAsset({
        bookId: id,
        manageTokenHash,
        assetId: testAssetId(serial),
        objectKey: `quota/${serial}`,
        contentType: "image/png",
        byteSize: 8,
        now,
        maxAssets: 50,
      }), true);
    }
  };

  await insertRange(1, 50);
  assert.equal((await repository.listAssetIds(id)).length, 50);
  assert.equal(await repository.claimPublishAttempt({ id, manageTokenHash, shareTokenHash, now }), true);
  assert.equal(await repository.publishBook({
    id,
    manageTokenHash,
    shareTokenHash,
    title: "First revision",
    revision: 1,
    manifestJson: "{}",
    now,
  }), 1);
  assert.equal(await repository.revokeBook({ id, manageTokenHash, shareTokenHash, now }), true);
  assert.equal(await repository.completeRevocation({ id, manageTokenHash, shareTokenHash, now }), true);
  assert.deepEqual(await repository.listAssetIds(id), []);
  assert.equal(await repository.markDeleting({ id, manageTokenHash, now }), true);
  assert.equal(await repository.deleteBook({ id, manageTokenHash }), true);
  id = "34345678-1234-4234-8234-123456789abc";
  assert.equal(await repository.createBook({ id, manageTokenHash, now }), "created");

  await insertRange(51, 100);
  assert.equal((await repository.listAssetIds(id)).length, 50);
});

test("D1 schema keeps revoked generations terminal during a rolling Worker deployment", async (context) => {
  const database = new NodeD1Database();
  context.after(() => database.close());
  const repository = new D1BookRepository(database);
  const id = "35345678-1234-4234-8234-123456789abc";
  const manageTokenHash = "manage-hash";
  const shareTokenHash = "share-hash";
  const now = "2026-08-30T00:00:00.000Z";

  assert.equal(await repository.createBook({ id, manageTokenHash, now }), "created");
  assert.equal(await repository.claimPublishAttempt({ id, manageTokenHash, shareTokenHash, now }), true);
  assert.equal(await repository.publishBook({
    id,
    manageTokenHash,
    shareTokenHash,
    title: "Terminal generation",
    revision: 1,
    manifestJson: "{}",
    now,
  }), 1);
  assert.equal(await repository.revokeBook({ id, manageTokenHash, shareTokenHash, now }), true);

  // These statements model the previous Worker bundle after the new schema is
  // already live. Database triggers must fail closed until old isolates drain.
  await assert.rejects(
    database.prepare(`UPDATE living_books
      SET publish_attempt_token_hash = ?
      WHERE id = ?`).bind("old-worker-claim", id).run(),
    /revoked generation is terminal/u,
  );
  await assert.rejects(
    database.prepare(`UPDATE living_books
      SET status = 'published'
      WHERE id = ?`).bind(id).run(),
    /revoked generation is terminal/u,
  );
  await assert.rejects(
    database.prepare(`INSERT INTO living_book_assets (
      book_id, asset_id, object_key, content_type, byte_size, created_at
    ) VALUES (?, ?, ?, 'image/png', 8, ?)`).bind(
      id,
      testAssetId(101),
      "old-worker/late-upload",
      now,
    ).run(),
    /only a draft generation accepts assets/u,
  );
});

test("D1 delete cancels an in-flight publish claim before its commit", async (context) => {
  const database = new NodeD1Database();
  context.after(() => database.close());
  const repository = new D1BookRepository(database);
  const id = "42345678-1234-4234-8234-123456789abc";
  const manageTokenHash = "manage-hash";
  const shareTokenHash = "share-hash";
  const now = "2026-08-30T00:00:00.000Z";
  await repository.createBook({ id, manageTokenHash, now });
  assert.equal(await repository.claimPublishAttempt({ id, manageTokenHash, shareTokenHash, now }), true);
  assert.equal(await repository.markDeleting({ id, manageTokenHash, now }), true);
  assert.equal(await repository.publishBook({
    id,
    manageTokenHash,
    shareTokenHash,
    title: "Must not publish",
    revision: 1,
    manifestJson: "{}",
    now,
  }), false);
});

test("D1 upload racing delete rolls back the uncommitted object", async (context) => {
  const database = new NodeD1Database();
  context.after(() => database.close());
  const repository = new D1BookRepository(database);
  const objects = new BlockingPutObjects();
  const api = createBookShareApi({
    repository,
    objects,
    clock: () => new Date("2026-08-30T00:00:00.000Z"),
  });
  const bookId = "92345678-1234-4234-8234-123456789abc";
  const assetId = "asset:a2345678-1234-4234-8234-123456789abc";
  const manageToken = "m".repeat(43);
  const replacementManageToken = "n".repeat(43);
  const authorization = `Bearer ${manageToken}`;

  const draft = await api.handle(new Request("https://example.test/api/books", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ bookId }),
  }));
  assert.equal(draft.status, 201);

  const upload = api.handle(new Request(
    `https://example.test/api/books/${bookId}/assets/${encodeURIComponent(assetId)}`,
    {
      method: "PUT",
      headers: { authorization, "content-type": "image/png" },
      body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    },
  ));
  await objects.putStarted.promise;

  const removal = await api.handle(new Request(`https://example.test/api/books/${bookId}`, {
    method: "DELETE",
    headers: { authorization },
  }));
  assert.equal(removal.status, 204);
  assert.equal(objects.values.size, 1);

  const replacement = await api.handle(new Request("https://example.test/api/books", {
    method: "POST",
    headers: {
      authorization: `Bearer ${replacementManageToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ bookId }),
  }));
  assert.equal(replacement.status, 409);
  assert.equal((await replacement.json()).code, "book_exists");

  objects.putReleased.resolve();
  const uploadResponse = await upload;
  assert.equal(uploadResponse.status, 409);
  assert.equal((await uploadResponse.json()).code, "invalid_state");
  assert.equal(objects.values.size, 0);
  const replacementBook = await repository.findBook(bookId);
  assert.equal(replacementBook, null);
  assert.ok(await repository.findDeletedBook(bookId));
  assert.deepEqual(await repository.listAssetIds(bookId), []);
});

test("D1 admits only one concurrent upload at the per-book asset bound", async (context) => {
  const database = new NodeD1Database();
  context.after(() => database.close());
  const repository = new D1BookRepository(database);
  const objects = new BlockingPutObjects(2);
  const api = createBookShareApi({
    repository,
    objects,
    clock: () => new Date("2026-08-30T00:00:00.000Z"),
  });
  const bookId = "93345678-1234-4234-8234-123456789abc";
  const manageToken = "q".repeat(43);
  const authorization = `Bearer ${manageToken}`;
  const draft = await api.handle(new Request("https://example.test/api/books", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ bookId }),
  }));
  assert.equal(draft.status, 201);
  const storedBook = await repository.findBook(bookId);

  for (let serial = 1; serial <= 49; serial += 1) {
    assert.equal(await repository.insertAsset({
      bookId,
      manageTokenHash: storedBook.manage_token_hash,
      assetId: testAssetId(serial),
      objectKey: `seed/${serial}`,
      contentType: "image/png",
      byteSize: 8,
      now: "2026-08-30T00:00:00.000Z",
      maxAssets: 50,
    }), true);
  }

  const upload = (serial) => api.handle(new Request(
    `https://example.test/api/books/${bookId}/assets/${encodeURIComponent(testAssetId(serial))}`,
    {
      method: "PUT",
      headers: { authorization, "content-type": "image/png" },
      body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    },
  ));
  const uploads = [upload(50), upload(51)];
  await objects.putStarted.promise;
  assert.equal(objects.values.size, 2);
  objects.putReleased.resolve();
  const responses = await Promise.all(uploads);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const rejected = responses.find((response) => response.status === 409);
  assert.equal((await rejected.json()).code, "asset_limit");
  assert.equal((await repository.listAssetIds(bookId)).length, 50);
  assert.equal(objects.values.size, 1);
});

test("D1 keeps one immutable object for concurrent uploads of the same asset id", async (context) => {
  const database = new NodeD1Database();
  context.after(() => database.close());
  const repository = new D1BookRepository(database);
  const objects = new BlockingPutObjects(2);
  const api = createBookShareApi({ repository, objects });
  const bookId = "94345678-1234-4234-8234-123456789abc";
  const manageToken = "r".repeat(43);
  const authorization = `Bearer ${manageToken}`;
  assert.equal((await api.handle(new Request("https://example.test/api/books", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ bookId }),
  }))).status, 201);

  const assetId = testAssetId(60);
  const upload = () => api.handle(new Request(
    `https://example.test/api/books/${bookId}/assets/${encodeURIComponent(assetId)}`,
    {
      method: "PUT",
      headers: { authorization, "content-type": "image/png" },
      body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    },
  ));
  const uploads = [upload(), upload()];
  await objects.putStarted.promise;
  objects.putReleased.resolve();
  const responses = await Promise.all(uploads);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const rejected = responses.find((response) => response.status === 409);
  assert.equal((await rejected.json()).code, "asset_exists");
  assert.deepEqual(await repository.listAssetIds(bookId), [assetId]);
  assert.equal(objects.values.size, 1);
});

test("D1 rejects a claimed token retired by another book before commit", async (context) => {
  const database = new NodeD1Database();
  context.after(() => database.close());
  const repository = new D1BookRepository(database);
  const firstId = "72345678-1234-4234-8234-123456789abc";
  const secondId = "82345678-1234-4234-8234-123456789abc";
  const firstManageHash = "manage-hash-a";
  const secondManageHash = "manage-hash-b";
  const shareTokenHash = "cross-book-share-hash";
  const now = "2026-08-30T00:00:00.000Z";

  await repository.createBook({ id: firstId, manageTokenHash: firstManageHash, now });
  assert.equal(await repository.claimPublishAttempt({
    id: firstId,
    manageTokenHash: firstManageHash,
    shareTokenHash,
    now,
  }), true);
  assert.equal(await repository.publishBook({
    id: firstId,
    manageTokenHash: firstManageHash,
    shareTokenHash,
    title: "First owner",
    revision: 1,
    manifestJson: "{}",
    now,
  }), 1);

  await repository.createBook({ id: secondId, manageTokenHash: secondManageHash, now });
  assert.equal(await repository.claimPublishAttempt({
    id: secondId,
    manageTokenHash: secondManageHash,
    shareTokenHash,
    now,
  }), true);

  // The claim was valid while the token was live, but retiring the first book
  // must invalidate that stale claim at the second book's commit boundary.
  assert.equal(await repository.markDeleting({ id: firstId, manageTokenHash: firstManageHash, now }), true);
  assert.equal(await repository.isRetiredShareToken(shareTokenHash), true);
  assert.equal(await repository.publishBook({
    id: secondId,
    manageTokenHash: secondManageHash,
    shareTokenHash,
    title: "Must not resurrect",
    revision: 1,
    manifestJson: "{}",
    now,
  }), false);
  assert.equal(await repository.findPublishedBook(shareTokenHash), null);

  const replacementShareHash = "fresh-share-hash";
  assert.equal(await repository.claimPublishAttempt({
    id: secondId,
    manageTokenHash: secondManageHash,
    shareTokenHash: replacementShareHash,
    now,
  }), true);
  assert.equal(await repository.publishBook({
    id: secondId,
    manageTokenHash: secondManageHash,
    shareTokenHash: replacementShareHash,
    title: "Recovered with a fresh token",
    revision: 2,
    manifestJson: "{}",
    now,
  }), 2);
});

test("D1 permanently retires a public token when its book is deleted", async (context) => {
  const database = new NodeD1Database();
  context.after(() => database.close());
  const repository = new D1BookRepository(database);
  const id = "52345678-1234-4234-8234-123456789abc";
  const manageTokenHash = "manage-hash";
  const shareTokenHash = "share-hash";
  const now = "2026-08-30T00:00:00.000Z";
  await repository.createBook({ id, manageTokenHash, now });
  await repository.claimPublishAttempt({ id, manageTokenHash, shareTokenHash, now });
  await repository.publishBook({
    id,
    manageTokenHash,
    shareTokenHash,
    title: "Published then deleted",
    revision: 1,
    manifestJson: "{}",
    now,
  });

  assert.equal(await repository.markDeleting({ id, manageTokenHash, now }), true);
  assert.equal(await repository.isRetiredShareToken(shareTokenHash), true);
  assert.equal(await repository.deleteBook({ id, manageTokenHash }), true);
  assert.equal(await repository.isRetiredShareToken(shareTokenHash), true);
  const replacementId = "62345678-1234-4234-8234-123456789abc";
  await repository.createBook({ id: replacementId, manageTokenHash, now });
  assert.equal(await repository.claimPublishAttempt({
    id: replacementId,
    manageTokenHash,
    shareTokenHash,
    now,
  }), false);
});
