import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

test("packages every versioned D1 migration for Sites", async () => {
  const sourceDirectory = new URL("../drizzle/", import.meta.url);
  const packagedDirectory = new URL("../dist/.openai/drizzle/", import.meta.url);
  const migrationNames = (await readdir(sourceDirectory)).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual((await readdir(packagedDirectory)).filter((name) => name.endsWith(".sql")).sort(), migrationNames);

  for (const migrationName of migrationNames) {
    const [source, packaged] = await Promise.all([
      readFile(new URL(migrationName, sourceDirectory), "utf8"),
      readFile(new URL(migrationName, packagedDirectory), "utf8"),
    ]);
    assert.equal(packaged, source, migrationName);
  }
});
