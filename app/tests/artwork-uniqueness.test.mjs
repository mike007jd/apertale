import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const assetRoots = ["public/assets/covers", "public/assets/generated"];

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }))).flat();
}

test("ships no pixel-identical cover or illustration assets", async () => {
  const files = (await Promise.all(assetRoots.map(listFiles))).flat()
    .filter((path) => /\.(png|jpe?g|webp)$/i.test(path));
  const hashes = await Promise.all(files.map(async (path) => createHash("sha256")
    .update(await readFile(path))
    .digest("hex")));
  const duplicateGroups = hashes.flatMap((hash, index) => {
    const matching = files.filter((_, candidate) => hashes[candidate] === hash);
    return matching.length > 1 && matching[0] === files[index] ? [matching] : [];
  });

  assert.deepEqual(duplicateGroups, [], `pixel-identical artwork: ${JSON.stringify(duplicateGroups)}`);
});
