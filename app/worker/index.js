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

function appShellRequest(request) {
  const indexUrl = new URL(request.url);
  indexUrl.pathname = APP_SHELL_PATH;
  indexUrl.search = "";
  return new Request(indexUrl, request);
}

export async function handleRequest(request, env, options = {}) {
  const url = new URL(request.url);
  const acceptsHtml = request.headers.get("accept")?.includes("text/html");
  const readsDocument = ["GET", "HEAD"].includes(request.method);

  if (url.pathname === "/" && acceptsHtml && readsDocument) {
    return withWebMcpDocumentPolicy(await env.ASSETS.fetch(appShellRequest(request)), { html: true });
  }

  const isStorageRoute = url.pathname === "/api/books"
    || url.pathname.startsWith("/api/books/")
    || url.pathname.startsWith("/api/shared/");

  if (isStorageRoute) {
    const storageApi = options.storageApi ?? apiFromEnvironment(env);
    if (!storageApi) return withWebMcpDocumentPolicy(unavailableStorageResponse());
    const response = await storageApi.handle(request);
    return withWebMcpDocumentPolicy(response ?? new Response("Not found", { status: 404 }));
  }

  const shareMatch = /^\/share\/([^/]+)\/?$/u.exec(url.pathname);
  if (shareMatch && readsDocument) {
    const storageApi = options.storageApi ?? apiFromEnvironment(env);
    if (!storageApi) return withWebMcpDocumentPolicy(unavailableStorageResponse());
    let published = false;
    try {
      published = await storageApi.isPublishedShare(shareMatch[1]);
    } catch {
      return withWebMcpDocumentPolicy(unavailableStorageResponse());
    }
    if (!published) {
      return withWebMcpDocumentPolicy(new Response(request.method === "HEAD" ? null : "Shared book not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" },
      }));
    }
    return withWebMcpDocumentPolicy(await env.ASSETS.fetch(appShellRequest(request)), { html: true });
  }

  const response = await env.ASSETS.fetch(request);

  if (response.status !== 404 || !acceptsHtml || !readsDocument) {
    return withWebMcpDocumentPolicy(response);
  }

  return withWebMcpDocumentPolicy(await env.ASSETS.fetch(appShellRequest(request)), { html: true });
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
