#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const localManifest = JSON.parse(readFileSync(new URL("../site-manifest.json", import.meta.url), "utf8"));
export const SITE_TOOL_NAMES = Object.freeze(Object.values(localManifest.webMcp.tools));

function fail(message) {
  throw new Error(`Deployment verification failed: ${message}`);
}

function asBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("pass an absolute deployment URL.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    fail("the deployment must use HTTPS (HTTP is accepted only for localhost checks).");
  }
  url.hash = "";
  return url;
}

function assertHeader(response, name, expected) {
  const actual = response.headers.get(name);
  if (actual !== expected) fail(`${name} must be ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}.`);
}

function referencedChunks(source, moduleUrl) {
  const chunks = new Set();
  for (const match of source.matchAll(/["']([^"'\\\s]+\.js)["']/gu)) {
    let reference = match[1];
    if (reference.startsWith("assets/")) reference = `/${reference}`;
    if (!reference.startsWith("/") && !reference.startsWith("./") && !reference.startsWith("../")) continue;
    const url = new URL(reference, moduleUrl);
    if (url.origin === moduleUrl.origin && url.pathname.startsWith("/assets/")) chunks.add(url.href);
  }
  return chunks;
}

async function fetchBundleGraph(entryUrl, entrySource, fetchImpl) {
  const sources = [entrySource];
  const seen = new Set([entryUrl.href]);
  const pending = [...referencedChunks(entrySource, entryUrl)];

  while (pending.length > 0 && seen.size < 32) {
    const href = pending.shift();
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const chunkUrl = new URL(href);
    const response = await fetchImpl(chunkUrl, { redirect: "follow" });
    if (!response.ok) fail(`${chunkUrl.href} returned HTTP ${response.status}.`);
    const source = await response.text();
    sources.push(source);
    for (const reference of referencedChunks(source, chunkUrl)) {
      if (!seen.has(reference)) pending.push(reference);
    }
  }

  return sources.join("\n");
}

export async function verifyDeployment(value, fetchImpl = fetch) {
  const baseUrl = asBaseUrl(value);
  const response = await fetchImpl(baseUrl, {
    headers: { accept: "text/html" },
    redirect: "follow",
  });
  if (!response.ok) fail(`${baseUrl.href} returned HTTP ${response.status}.`);
  if (!response.headers.get("content-type")?.includes("text/html")) fail("the root response is not HTML.");
  assertHeader(response, "origin-agent-cluster", "?1");
  assertHeader(response, "permissions-policy", "tools=(self)");

  const html = await response.text();
  if (!/<title>\s*Apertale\s*<\/title>/i.test(html)) fail("the root HTML does not identify the Apertale build.");
  const modulePath = html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<script[^>]+src=["']([^"']+)["'][^>]+type=["']module["']/i)?.[1];
  if (!modulePath) fail("the root HTML has no module entry script.");

  const manifestUrl = new URL("apertale-manifest.json", baseUrl);
  const manifestResponse = await fetchImpl(manifestUrl, { redirect: "follow" });
  if (!manifestResponse.ok) fail(`${manifestUrl.href} returned HTTP ${manifestResponse.status}.`);
  const manifest = await manifestResponse.json();
  if (manifest?.name !== "Apertale") fail("the deployment manifest has the wrong product name.");
  if (manifest?.webMcp?.registration !== "document.modelContext.registerTool") fail("the deployment manifest has the wrong WebMCP registration API.");
  if (JSON.stringify(manifest?.webMcp?.tools) !== JSON.stringify(SITE_TOOL_NAMES)) fail("the deployment manifest does not match the expected tool catalog.");

  const entryUrl = new URL(modulePath, response.url || baseUrl);
  const entryResponse = await fetchImpl(entryUrl, { redirect: "follow" });
  if (!entryResponse.ok) fail(`${entryUrl.href} returned HTTP ${entryResponse.status}.`);
  const entry = await entryResponse.text();
  const bundleGraph = await fetchBundleGraph(entryUrl, entry, fetchImpl);
  const missingTools = SITE_TOOL_NAMES.filter((name) => !bundleGraph.includes(name));
  if (missingTools.length > 0) fail(`the shipped entry bundle is missing tool identifiers: ${missingTools.join(", ")}.`);

  return {
    ok: true,
    level: "deployed-http-contract",
    url: response.url || baseUrl.href,
    product: manifest.name,
    version: manifest.version,
    tools: SITE_TOOL_NAMES,
    headers: {
      originAgentCluster: response.headers.get("origin-agent-cluster"),
      permissionsPolicy: response.headers.get("permissions-policy"),
    },
    hostLoop: "required",
    hostLoopReason: "Only an eligible ChatGPT desktop built-in browser can inject document.modelContext and prove real Site Tools discovery and execution.",
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: npm run verify:deployment -- https://your-public-site.example/");
    process.exitCode = 2;
  } else {
    try {
      console.log(JSON.stringify(await verifyDeployment(target), null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
