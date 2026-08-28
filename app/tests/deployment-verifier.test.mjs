import assert from "node:assert/strict";
import test from "node:test";
import { verifyDeployment } from "../scripts/verify-deployment.mjs";

const toolNames = [
  "get_project_context",
  "manage_book",
  "compose_spread",
  "apply_scene_patch",
  "set_presentation",
  "undo_project_change",
];

function response(body, init = {}) {
  return new Response(body, init);
}

test("verifies the public HTTP contract and reports the remaining host gate", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/") {
      return response('<title>Apertale</title><script type="module" src="/assets/index.js"></script>', {
        headers: {
          "content-type": "text/html",
          "origin-agent-cluster": "?1",
          "permissions-policy": "tools=(self)",
        },
      });
    }
    if (url.pathname === "/apertale-manifest.json") {
      return response(JSON.stringify({
        name: "Apertale",
        version: "1.1.0",
        webMcp: { registration: "document.modelContext.registerTool", tools: toolNames },
      }));
    }
    if (url.pathname === "/assets/index.js") return response('const lazyChunks = ["assets/App.js"];');
    if (url.pathname === "/assets/App.js") return response(toolNames.join("\n"));
    return response("missing", { status: 404 });
  };

  const result = await verifyDeployment("https://apertale.example/", fetchImpl);
  assert.equal(result.ok, true);
  assert.equal(result.level, "deployed-http-contract");
  assert.equal(result.hostLoop, "required");
  assert.deepEqual(result.tools, toolNames);
});

test("rejects a deployment without the WebMCP document policy", async () => {
  const fetchImpl = async () => response("<title>Apertale</title>", {
    headers: { "content-type": "text/html" },
  });
  await assert.rejects(
    verifyDeployment("https://apertale.example/", fetchImpl),
    /origin-agent-cluster must be "\?1"/,
  );
});
