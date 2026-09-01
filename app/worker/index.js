import { createBookShareApi } from "./bookShareApi.js";
import { D1BookRepository } from "./d1BookRepository.js";

const APP_SHELL_PATH = "/app-shell";

function withWebMcpDocumentPolicy(response, { html = false } = {}) {
  const headers = new Headers(response.headers);
  headers.set("Origin-Agent-Cluster", "?1");
  headers.set("Permissions-Policy", "tools=(self)");
  if (html) headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function unavailableStorageResponse() {
  return new Response(JSON.stringify({
    ok: false,
    code: "storage_unavailable",
    message: "Book storage is not configured for this Site build.",
  }), {
    status: 503,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function apiFromEnvironment(env) {
  if (!env.DB || !env.FILES) return null;
  return createBookShareApi({ repository: new D1BookRepository(env.DB), objects: env.FILES });
}

async function appShell(env, request) {
  const indexUrl = new URL(request.url);
  indexUrl.pathname = APP_SHELL_PATH;
  indexUrl.search = "";
  return withWebMcpDocumentPolicy(await env.ASSETS.fetch(new Request(indexUrl, request)), { html: true });
}

async function routeRequest(request, env, options) {
  const url = new URL(request.url);
  const acceptsHtml = request.headers.get("accept")?.includes("text/html");
  const readsDocument = ["GET", "HEAD"].includes(request.method);

  if (url.pathname === "/" && acceptsHtml && readsDocument) return appShell(env, request);

  const isStorageRoute = url.pathname === "/api/books"
    || url.pathname.startsWith("/api/books/")
    || url.pathname.startsWith("/api/shared/");
  const shareMatch = /^\/share\/([^/]+)\/?$/u.exec(url.pathname);

  if (isStorageRoute || (shareMatch && readsDocument)) {
    const storageApi = options.storageApi ?? apiFromEnvironment(env);
    if (!storageApi) return unavailableStorageResponse();
    if (isStorageRoute) {
      return await storageApi.handle(request) ?? new Response("Not found", { status: 404 });
    }
    let published = false;
    try {
      published = await storageApi.isPublishedShare(shareMatch[1]);
    } catch {
      return unavailableStorageResponse();
    }
    if (!published) {
      return new Response(request.method === "HEAD" ? null : "Shared book not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" },
      });
    }
    return appShell(env, request);
  }

  const response = await env.ASSETS.fetch(request);
  if (response.status !== 404 || !acceptsHtml || !readsDocument) return response;
  return appShell(env, request);
}

export async function handleRequest(request, env, options = {}) {
  return withWebMcpDocumentPolicy(await routeRequest(request, env, options));
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
