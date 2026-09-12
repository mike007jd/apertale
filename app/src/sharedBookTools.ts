import { recordDiagnostic } from "./diagnostics";
import { hasReveal, resolveInteraction } from "./interaction";
import type { DocumentState, Spread } from "./types";

/**
 * The anonymous share reader's WebMCP surface: one read-only tool that lets a
 * reader's own Agent read the published book they are looking at. It never
 * touches the document, so it stays separate from the eight authoring tools
 * and from the deployment manifest that names them.
 */
export const SHARED_BOOK_TOOL_NAME = "get_shared_book_context";

export type SharedBookView = {
  document: DocumentState;
  spreadIndex: number;
  selectionId: string | null;
};

function describeSpread(spread: Spread, index: number) {
  return {
    index,
    id: spread.id,
    title: spread.title,
    ...(spread.kicker ? { kicker: spread.kicker } : {}),
    body: spread.body,
    elements: spread.elements.map((element) => {
      const interaction = resolveInteraction(element);
      return {
        id: element.id,
        label: element.label,
        page: element.page,
        ...(hasReveal(interaction) ? { reveal: interaction.reveal } : {}),
      };
    }),
  };
}

export function sharedBookContext(view: SharedBookView, scope: "current" | "book") {
  const { document, spreadIndex, selectionId } = view;
  return {
    ok: true,
    surface: "shared-reader",
    readOnly: true,
    book: { title: document.title, spreadCount: document.spreads.length },
    outline: document.spreads.map((spread, index) => ({ index, title: spread.title })),
    currentSpread: describeSpread(document.spreads[spreadIndex], spreadIndex),
    selectedElementId: selectionId,
    ...(scope === "book" ? { spreads: document.spreads.map(describeSpread) } : {}),
  };
}

export function registerSharedBookTools(getView: () => SharedBookView | null) {
  if (!document.modelContext?.registerTool) {
    recordDiagnostic("webmcp:unavailable", { surface: "shared-reader" });
    return () => undefined;
  }
  const controller = new AbortController();
  void document.modelContext.registerTool({
    name: SHARED_BOOK_TOOL_NAME,
    title: "Read shared book",
    description: "Read the published book open in this share link: title, outline, the visible spread's text, and each element's knowledge reveal.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["current", "book"], description: "current (default) for the visible spread; book for every spread's text and reveals." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: (input) => {
      recordDiagnostic("webmcp:tool-start", { name: SHARED_BOOK_TOOL_NAME });
      const view = getView();
      if (!view) return JSON.stringify({ ok: false, code: "book_not_loaded", summary: "The shared book has not finished loading." });
      const scope = (input as { scope?: unknown }).scope === "book" ? "book" : "current";
      const result = JSON.stringify(sharedBookContext(view, scope));
      recordDiagnostic("webmcp:tool-success", { name: SHARED_BOOK_TOOL_NAME });
      return result;
    },
  }, { signal: controller.signal }).catch((error: unknown) => {
    recordDiagnostic("webmcp:registration-failed", { name: SHARED_BOOK_TOOL_NAME, error: error instanceof Error ? error.name : "UnknownError" });
  });
  return () => controller.abort();
}
