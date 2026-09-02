#!/usr/bin/env node
// Projects the book element grammar (src/bookElementGrammar.ts) into a JSON
// artifact the Worker can import, so the publish boundary keeps its own
// validators while sharing one set of bounds, vocabularies, and patterns.
import { readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The app source uses bundler-style extensionless specifiers; Node needs the ".ts".
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith(".") || path.extname(specifier)) return nextResolve(specifier, context);
    return nextResolve(`${specifier}.ts`, context);
  },
});

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(appRoot, "worker", "bookElementGrammar.json");
const { BOOK_ELEMENT_GRAMMAR } = await import(path.join(appRoot, "src", "bookElementGrammar.ts"));
const expected = `${JSON.stringify(BOOK_ELEMENT_GRAMMAR, null, 2)}\n`;

if (process.argv.includes("--write")) {
  writeFileSync(outputPath, expected);
  console.log(`Updated ${path.relative(appRoot, outputPath)}.`);
} else {
  let current = "";
  try {
    current = readFileSync(outputPath, "utf8");
  } catch {
    // The actionable error below also covers a missing artifact.
  }
  if (current !== expected) {
    throw new Error("worker/bookElementGrammar.json is stale. Run npm run grammar:sync and commit the result.");
  }
  console.log("Book element grammar matches src/bookElementGrammar.ts.");
}
