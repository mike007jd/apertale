#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(appRoot, "public");
const assetRoot = path.join(publicRoot, "assets");
const outputPath = path.join(appRoot, "worker", "bundledAssetCatalog.json");

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(absolute) : [absolute];
  });
}

const catalog = {
  version: 1,
  assets: filesUnder(assetRoot)
    .map((absolute) => `/${path.relative(publicRoot, absolute).split(path.sep).join("/")}`)
    .sort(),
};
const expected = `${JSON.stringify(catalog, null, 2)}\n`;

if (process.argv.includes("--write")) {
  writeFileSync(outputPath, expected);
  console.log(`Updated ${path.relative(appRoot, outputPath)} (${catalog.assets.length} assets).`);
} else {
  let current = "";
  try {
    current = readFileSync(outputPath, "utf8");
  } catch {
    // The actionable error below also covers a missing catalog.
  }
  if (current !== expected) {
    throw new Error("Bundled asset catalog is stale. Run npm run catalog:assets and commit the result.");
  }
  console.log(`Bundled asset catalog matches public/assets (${catalog.assets.length} assets).`);
}
