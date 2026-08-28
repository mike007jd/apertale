import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("packages every versioned D1 migration for Sites", async () => {
  const source = await readFile(new URL("../drizzle/0001_living_book_sharing.sql", import.meta.url), "utf8");
  const packaged = await readFile(
    new URL("../dist/.openai/drizzle/0001_living_book_sharing.sql", import.meta.url),
    "utf8",
  );

  assert.equal(packaged, source);
});
