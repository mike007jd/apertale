#!/usr/bin/env node
// Projects the publishing grammar sources (src/bookElementGrammar.ts and the
// asset-reference rule set in src/bookAssetContract.ts) into JSON artifacts the
// Worker can import, so the publish boundary keeps its own validators while
// sharing one set of bounds, vocabularies, patterns, and rule messages.
import { readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    // The app source uses bundler-style extensionless specifiers and attribute-free
    // JSON imports; Node needs the ".ts" and an explicit `type: "json"`.
    const resolved = specifier.startsWith(".") && !path.extname(specifier)
      ? nextResolve(`${specifier}.ts`, context)
      : nextResolve(specifier, context);
    return resolved.url.endsWith(".json") ? { ...resolved, importAttributes: { type: "json" } } : resolved;
  },
});

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = [
  { module: "bookElementGrammar", export: "BOOK_ELEMENT_GRAMMAR", output: "bookElementGrammar.json" },
  { module: "bookAssetContract", export: "BOOK_ASSET_REFERENCE_RULES", output: "bookAssetReferenceRules.json" },
];
const write = process.argv.includes("--write");

for (const artifact of artifacts) {
  const outputPath = path.join(appRoot, "worker", artifact.output);
  const source = path.join(appRoot, "src", `${artifact.module}.ts`);
  const expected = `${JSON.stringify((await import(source))[artifact.export], null, 2)}\n`;

  if (write) {
    writeFileSync(outputPath, expected);
    console.log(`Updated ${path.relative(appRoot, outputPath)}.`);
    continue;
  }
  let current = "";
  try {
    current = readFileSync(outputPath, "utf8");
  } catch {
    // The actionable error below also covers a missing artifact.
  }
  if (current !== expected) {
    throw new Error(`worker/${artifact.output} is stale. Run npm run grammar:sync and commit the result.`);
  }
  console.log(`worker/${artifact.output} matches src/${artifact.module}.ts.`);
}
