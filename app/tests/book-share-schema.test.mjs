import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { LIVING_BOOK_SCHEMA_STATEMENTS } from "../worker/bookShareSchema.js";

function normalizeSql(statement) {
  return statement.replace(/\s+/g, " ").trim();
}

test("the fresh-binding bootstrap matches immutable D1 migration 0001", async () => {
  const migration = await readFile(
    new URL("../drizzle/0001_living_book_sharing.sql", import.meta.url),
    "utf8",
  );
  const migrationStatements = migration
    .split(";")
    .map(normalizeSql)
    .filter(Boolean);

  assert.deepEqual(migrationStatements, [
    ...LIVING_BOOK_SCHEMA_STATEMENTS.map(normalizeSql),
    "PRAGMA optimize",
  ]);
});
