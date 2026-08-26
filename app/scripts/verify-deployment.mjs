#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const EXPECTED_TOOLS = [
  "get_project_context",
  "manage_book",
  "compose_spread",
  "apply_scene_patch",
  "set_presentation",
  "undo_project_change",
];

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
  if (JSON.stringify(manifest?.webMcp?.tools) !== JSON.stringify(EXPECTED_TOOLS)) fail("the deployment manifest does not declare exactly the six expected tools.");

  const entryUrl = new URL(modulePath, response.url || baseUrl);
  const entryResponse = await fetchImpl(entryUrl, { redirect: "follow" });
  if (!entryResponse.ok) fail(`${entryUrl.href} returned HTTP ${entryResponse.status}.`);
  const entry = await entryResponse.text();
  const missingTools = EXPECTED_TOOLS.filter((name) => !entry.includes(name));
  if (missingTools.length > 0) fail(`the shipped entry bundle is missing tool identifiers: ${missingTools.join(", ")}.`);

  return {
    ok: true,
    level: "deployed-http-contract",
    url: response.url || baseUrl.href,
    product: manifest.name,
    version: manifest.version,
    tools: EXPECTED_TOOLS,
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
