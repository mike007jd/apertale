import { afterEach, describe, expect, it, vi } from "vitest";
import { registerSharedBookTools, SHARED_BOOK_TOOL_NAME, type SharedBookView } from "./sharedBookTools";
import type { DocumentState } from "./types";

const document: DocumentState = {
  id: "shared-1",
  revision: 3,
  title: "Atlas of Living Wonders",
  spreads: [
    {
      id: "s1",
      order: 0,
      title: "The Lighthouse",
      kicker: "Coast",
      body: "A lamp above the rocks.",
      elements: [
        {
          id: "boat",
          label: "Boat",
          kind: "lifted",
          assetId: "asset-boat",
          page: "right",
          transform: { x: 0.6, y: 0.5, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          depth: 1,
          locked: false,
          provenance: "agent",
          interaction: {
            hover: "lift-glow",
            focus: "spotlight",
            reveal: { kind: "fact-card", title: "The boat", summary: "Built in 1902.", facts: [{ label: "Length", value: "12 m" }] },
          },
        },
      ],
    },
    { id: "s2", order: 1, title: "The Storm", body: "Lightning over the bay.", elements: [] },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("shared reader WebMCP surface", () => {
  it("registers one read-only tool that reads the visible spread and, on request, the whole book", async () => {
    const tools: WebMCP.ModelContextTool[] = [];
    const modelContext = {
      registerTool: vi.fn(async (tool: WebMCP.ModelContextTool) => { tools.push(tool); }),
    };
    vi.stubGlobal("document", { modelContext });
    let view: SharedBookView | null = null;
    const cleanup = registerSharedBookTools(() => view);
    await vi.waitFor(() => expect(tools).toHaveLength(1));

    const tool = tools[0];
    expect(tool.name).toBe(SHARED_BOOK_TOOL_NAME);
    expect(tool.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true });
    expect(tool.description.length).toBeLessThanOrEqual(160);

    expect(JSON.parse(String(await tool.execute({}, { signal: new AbortController().signal })))).toMatchObject({ ok: false, code: "book_not_loaded" });

    view = { document, spreadIndex: 0, selectionId: "boat" };
    const current = JSON.parse(String(await tool.execute({}, { signal: new AbortController().signal })));
    expect(current).toMatchObject({
      ok: true,
      readOnly: true,
      book: { title: "Atlas of Living Wonders", spreadCount: 2 },
      outline: [{ index: 0, title: "The Lighthouse" }, { index: 1, title: "The Storm" }],
      currentSpread: { index: 0, kicker: "Coast", elements: [{ id: "boat", page: "right", reveal: { title: "The boat", facts: [{ label: "Length", value: "12 m" }] } }] },
      selectedElementId: "boat",
    });
    expect(current.spreads).toBeUndefined();

    view = { document, spreadIndex: 1, selectionId: null };
    const whole = JSON.parse(String(await tool.execute({ scope: "book" }, { signal: new AbortController().signal })));
    expect(whole.currentSpread.title).toBe("The Storm");
    expect(whole.spreads.map((spread: { title: string }) => spread.title)).toEqual(["The Lighthouse", "The Storm"]);

    cleanup();
  });

  it("stays silent when the host injects no modelContext", () => {
    vi.stubGlobal("document", {});
    expect(registerSharedBookTools(() => null)).toBeTypeOf("function");
  });
});
