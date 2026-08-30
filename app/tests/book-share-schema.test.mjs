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
