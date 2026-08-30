import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { LIVING_BOOK_SCHEMA_STATEMENTS } from "../worker/bookShareSchema.js";

function schemaShape(database) {
  const tables = database.prepare(`SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name`).all();
  return {
    tables: Object.fromEntries(tables.map(({ name }) => [
      name,
      database.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all()
        .map(({ name: column, type, notnull, dflt_value: defaultValue, pk }) => ({
          column,
          type,
          notnull,
          defaultValue,
          pk,
        }))
        .sort((left, right) => left.column.localeCompare(right.column)),
    ])),
    triggers: database.prepare(`SELECT name, sql FROM sqlite_master
      WHERE type = 'trigger' ORDER BY name`).all()
      .map(({ name, sql }) => ({ name, sql: sql.replace(/\s+/gu, " ").trim() })),
    indexes: database.prepare(`SELECT name, tbl_name, sql FROM sqlite_master
      WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
      ORDER BY name`).all()
      .map(({ name, tbl_name: table, sql }) => ({
        name,
        table,
        sql: sql?.replace(/\s+/gu, " ").trim() ?? null,
      })),
  };
}

test("the fresh-binding bootstrap matches the complete numbered D1 migration history", async (context) => {
  const bootstrap = new DatabaseSync(":memory:");
  const migrated = new DatabaseSync(":memory:");
  context.after(() => {
    bootstrap.close();
    migrated.close();
  });

  for (const statement of LIVING_BOOK_SCHEMA_STATEMENTS) bootstrap.exec(statement);
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  const migrations = (await readdir(migrationDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  assert.deepEqual(migrations.map((name) => name.slice(0, 4)), migrations.map((_, index) => String(index + 1).padStart(4, "0")));
  for (const migration of migrations) {
    migrated.exec(await readFile(new URL(migration, migrationDirectory), "utf8"));
  }

  assert.deepEqual(schemaShape(bootstrap), schemaShape(migrated));
});

test("migration 0002 backfills any recoverable revoked-token tombstones", async (context) => {
  const database = new DatabaseSync(":memory:");
  context.after(() => database.close());
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  database.exec(await readFile(new URL("0001_living_book_sharing.sql", migrationDirectory), "utf8"));
  database.prepare(`INSERT INTO living_books (
    id, manage_token_hash, share_token_hash, status, created_at, updated_at, revoked_at
  ) VALUES (?, ?, ?, 'revoked', ?, ?, ?)`).run(
    "12345678-1234-4234-8234-123456789abc",
    "manage-hash",
    "retired-share-hash",
    "2026-08-30T00:00:00.000Z",
    "2026-08-30T00:01:00.000Z",
    "2026-08-30T00:01:00.000Z",
  );

  database.exec(await readFile(new URL("0002_publish_attempt_token.sql", migrationDirectory), "utf8"));
  const retired = database.prepare(`SELECT share_token_hash, book_id
    FROM living_book_retired_share_tokens`).get();
  assert.equal(retired.share_token_hash, "retired-share-hash");
  assert.equal(retired.book_id, "12345678-1234-4234-8234-123456789abc");
});

test("migration 0003 backfills creation-rate evidence without duplicating bootstrap events", async (context) => {
  const database = new DatabaseSync(":memory:");
  context.after(() => database.close());
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  database.exec(await readFile(new URL("0001_living_book_sharing.sql", migrationDirectory), "utf8"));
  database.exec(await readFile(new URL("0002_publish_attempt_token.sql", migrationDirectory), "utf8"));
  database.prepare(`INSERT INTO living_books (
    id, manage_token_hash, status, created_at, updated_at
  ) VALUES (?, ?, 'draft', ?, ?)`).run(
    "22345678-1234-4234-8234-123456789abc",
    "manage-hash",
    "2026-08-30T00:00:00.000Z",
    "2026-08-30T00:00:00.000Z",
  );

  const migration = await readFile(new URL("0003_creation_events.sql", migrationDirectory), "utf8");
  database.exec(migration);
  database.exec(migration);
  const events = database.prepare(`SELECT book_id, created_at
    FROM living_book_creation_events`).all();
  assert.equal(events.length, 1);
  assert.equal(events[0].book_id, "22345678-1234-4234-8234-123456789abc");
  assert.equal(events[0].created_at, "2026-08-30T00:00:00.000Z");
});

test("migration 0004 marks only revoked generations that still own remote assets", async (context) => {
  const database = new DatabaseSync(":memory:");
  context.after(() => database.close());
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  for (const migration of [
    "0001_living_book_sharing.sql",
    "0002_publish_attempt_token.sql",
    "0003_creation_events.sql",
  ]) database.exec(await readFile(new URL(migration, migrationDirectory), "utf8"));

  const now = "2026-08-30T00:00:00.000Z";
  const withAsset = "32345678-1234-4234-8234-123456789abc";
  const withoutAsset = "42345678-1234-4234-8234-123456789abc";
  const insertBook = database.prepare(`INSERT INTO living_books (
    id, manage_token_hash, status, created_at, updated_at, revoked_at
  ) VALUES (?, 'manage-hash', 'revoked', ?, ?, ?)`);
  insertBook.run(withAsset, now, now, now);
  insertBook.run(withoutAsset, now, now, now);
  database.prepare(`INSERT INTO living_book_assets (
    book_id, asset_id, object_key, content_type, byte_size, created_at
  ) VALUES (?, ?, 'books/old-object', 'image/png', 8, ?)`).run(
    withAsset,
    "asset:12345678-1234-4234-8234-123456789abc",
    now,
  );

  database.exec(await readFile(new URL("0004_revoked_asset_cleanup.sql", migrationDirectory), "utf8"));

  const rows = database.prepare(`SELECT id, asset_cleanup_pending
    FROM living_books ORDER BY id`).all().map((row) => ({ ...row }));
  assert.deepEqual(rows, [
    { id: withAsset, asset_cleanup_pending: 1 },
    { id: withoutAsset, asset_cleanup_pending: 0 },
  ]);
});
