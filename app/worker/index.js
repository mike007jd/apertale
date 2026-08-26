function withWebMcpDocumentPolicy(response) {
  const headers = new Headers(response.headers);
  headers.set("Origin-Agent-Cluster", "?1");
  headers.set("Permissions-Policy", "tools=(self)");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");

    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) {
      return withWebMcpDocumentPolicy(response);
    }

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return withWebMcpDocumentPolicy(await env.ASSETS.fetch(new Request(indexUrl, request)));
  },
};
