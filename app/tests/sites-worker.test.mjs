import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import worker, { handleRequest } from "../worker/index.js";

test("serves existing static assets without a fallback", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/assets/app.js"), {
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("origin-agent-cluster"), "?1");
  assert.equal(response.headers.get("permissions-policy"), "tools=(self)");
  assert.deepEqual(calls, ["/assets/app.js"]);
});

test("falls back to the Worker-routed app shell for an unknown app route", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/flow/step-two?source=share", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(url.pathname + url.search);
          return new Response(url.pathname === "/app-shell" ? "app" : "missing", {
            status: url.pathname === "/app-shell" ? 200 : 404,
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("origin-agent-cluster"), "?1");
  assert.equal(response.headers.get("permissions-policy"), "tools=(self)");
  assert.deepEqual(calls, ["/flow/step-two?source=share", "/app-shell"]);
});

test("does not turn missing API or write requests into the app shell", async () => {
  for (const request of [
    new Request("https://example.test/api/missing", { headers: { accept: "application/json" } }),
    new Request("https://example.test/flow", { method: "POST", headers: { accept: "text/html" } }),
  ]) {
    let calls = 0;
    const response = await worker.fetch(request, {
      ASSETS: {
        fetch: async () => {
          calls += 1;
          return new Response("missing", { status: 404 });
        },
      },
    });

    assert.equal(response.status, 404);
    assert.equal(response.headers.get("origin-agent-cluster"), "?1");
    assert.equal(response.headers.get("permissions-policy"), "tools=(self)");
    assert.equal(calls, 1);
  }
});

test("does not serve the app shell for a revoked or unknown share token", async () => {
  let assetCalls = 0;
  const response = await handleRequest(
    new Request(`https://example.test/share/${"b".repeat(43)}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => { assetCalls += 1; return new Response("app"); } } },
    { storageApi: { isPublishedShare: async () => false } },
  );

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(assetCalls, 0);
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/app-shell", import.meta.url));
  await assert.rejects(access(new URL("../dist/client/index.html", import.meta.url)));
  await access(new URL("../dist/client/apertale-manifest.json", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/server/bookShareApi.js", import.meta.url));
  await access(new URL("../dist/server/d1BookRepository.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
});
