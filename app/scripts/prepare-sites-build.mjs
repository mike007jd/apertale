#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const index = path.join(dist, "client", "index.html");
const appShell = path.join(dist, "client", "app-shell");
const workerDirectory = path.join(root, "worker");
const worker = path.join(workerDirectory, "index.js");
const hosting = path.join(root, ".openai", "hosting.json");

for (const file of [index, worker, hosting]) {
  if (!existsSync(file)) throw new Error("Missing Sites build input: " + file);
}

mkdirSync(path.join(dist, "server"), { recursive: true });
mkdirSync(path.join(dist, ".openai"), { recursive: true });
for (const entry of readdirSync(workerDirectory, { withFileTypes: true })) {
  if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".json"))) {
    copyFileSync(path.join(workerDirectory, entry.name), path.join(dist, "server", entry.name));
  }
}

const jsonModules = ["bundledAssetCatalog", "qualityRubric"];
for (const moduleName of jsonModules) {
  const json = readFileSync(path.join(workerDirectory, `${moduleName}.json`), "utf8").trim();
  writeFileSync(path.join(dist, "server", `${moduleName}.js`), `export default ${json};\n`);
}

const builtBookShareApi = path.join(dist, "server", "bookShareApi.js");
const compatibleBookShareApi = jsonModules.reduce(
  (source, moduleName) => {
    const attributedImport = `./${moduleName}.json\" with { type: \"json\" }`;
    const compatibleImport = `./${moduleName}.js\"`;
    if (source.split(attributedImport).length !== 2) {
      throw new Error(`Expected exactly one JSON import in built Worker: ${moduleName}`);
    }
    const compatibleSource = source.replace(attributedImport, compatibleImport);
    if (compatibleSource.split(compatibleImport).length !== 2) {
      throw new Error(`Expected exactly one compatible import in built Worker: ${moduleName}`);
    }
    return compatibleSource;
  },
  readFileSync(builtBookShareApi, "utf8"),
);
writeFileSync(builtBookShareApi, compatibleBookShareApi);

copyFileSync(index, appShell);
unlinkSync(index);
copyFileSync(hosting, path.join(dist, ".openai", "hosting.json"));

console.log("Prepared Sites build: Worker-routed app shell, dist/server/*.js, and dist/.openai/hosting.json");
