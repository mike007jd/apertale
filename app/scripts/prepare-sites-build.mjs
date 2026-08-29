#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
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
copyFileSync(index, appShell);
unlinkSync(index);
copyFileSync(hosting, path.join(dist, ".openai", "hosting.json"));

console.log("Prepared Sites build: Worker-routed app shell, dist/server/*.js, and dist/.openai/hosting.json");
