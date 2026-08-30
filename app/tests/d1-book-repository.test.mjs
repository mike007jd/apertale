import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
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

  assert.equal(await repository.revokeBook({ id, manageTokenHash, now }), true);
  const revoked = await repository.findManagedBook(id, manageTokenHash);
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.share_token_hash, firstShareHash);
  assert.equal(revoked.publish_attempt_token_hash, null);
  assert.equal(await repository.isRetiredShareToken(firstShareHash), true);
  assert.equal(await repository.claimPublishAttempt({ id, manageTokenHash, shareTokenHash: firstShareHash, now }), false);
  assert.equal(await repository.claimPublishAttempt({ id, manageTokenHash, shareTokenHash: nextShareHash, now }), true);
  assert.equal(await repository.publishBook({
    id,
    manageTokenHash,
    shareTokenHash: nextShareHash,
    title: "Second",
    revision: 2,
    manifestJson: JSON.stringify({ revision: 2 }),
    now,
  }), 2);
  assert.equal(await repository.revokeBook({ id, manageTokenHash, now }), true);
  assert.equal(await repository.isRetiredShareToken(nextShareHash), true);
  assert.equal(await repository.claimPublishAttempt({ id, manageTokenHash, shareTokenHash: firstShareHash, now }), false);
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
