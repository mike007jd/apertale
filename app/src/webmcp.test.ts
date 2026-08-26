import { afterEach, describe, expect, it, vi } from "vitest";
import { registerWebMcpTools } from "./webmcp";

describe("WebMCP registration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers the six Challenge tools with shared lifecycle and compact output", async () => {
    const tools: WebMCP.ModelContextTool[] = [];
    const registrationSignals: AbortSignal[] = [];
    const modelContext = {
      registerTool: vi.fn(async (tool: WebMCP.ModelContextTool, options?: WebMCP.ModelContextRegisterToolOptions) => {
        tools.push(tool);
        if (options?.signal) registrationSignals.push(options.signal);
      }),
    };
    vi.stubGlobal("document", { modelContext });
    const statuses: boolean[] = [];

    const cleanup = registerWebMcpTools((available) => statuses.push(available));
    await vi.waitFor(() => expect(statuses).toEqual([true]));

    expect(tools.map((tool) => tool.name)).toEqual([
      "get_book_context",
      "lift_element",
      "edit_element",
      "animate_element",
      "set_scene_theme",
      "undo_book_change",
    ]);
    expect(registrationSignals).toHaveLength(6);
    expect(tools[0].annotations).toMatchObject({ readOnlyHint: true });
    const result = await tools[0].execute({}, { signal: new AbortController().signal });
    expect(typeof result).toBe("string");
    expect(JSON.parse(String(result))).toMatchObject({
      book: { revision: expect.any(Number) },
      outline: expect.any(Array),
      currentSpread: { elements: [expect.objectContaining({ id: "bird" })] },
    });
    expect(String(result).length).toBeLessThanOrEqual(1500);

    await expect(tools[1].execute({ requestId: "hidden-element", expectedRevision: 1, elementId: "fox" }, {
      signal: new AbortController().signal,
    })).rejects.toThrow("current spread");

    const revisionBeforeInvalid = JSON.parse(String(result)).book.revision;
    await expect(tools[1].execute({ requestId: "invalid", expectedRevision: "1", elementId: "bird" }, {
      signal: new AbortController().signal,
    })).rejects.toThrow("expectedRevision");
    const afterInvalid = JSON.parse(String(await tools[0].execute({}, { signal: new AbortController().signal })));
    expect(afterInvalid.book.revision).toBe(revisionBeforeInvalid);

    const aborted = new AbortController();
    aborted.abort();
    await expect(tools[1].execute({ requestId: "canceled", expectedRevision: revisionBeforeInvalid, elementId: "bird" }, {
      signal: aborted.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    const afterCanceled = JSON.parse(String(await tools[0].execute({}, { signal: new AbortController().signal })));
    expect(afterCanceled.book.revision).toBe(revisionBeforeInvalid);

    const firstTheme = await tools[4].execute({ requestId: "theme-once", theme: "midnight-desk" }, {
      signal: new AbortController().signal,
    });
    const duplicateTheme = await tools[4].execute({ requestId: "theme-once", theme: "paper-atelier" }, {
      signal: new AbortController().signal,
    });
    expect(duplicateTheme).toBe(firstTheme);
    const afterTheme = JSON.parse(String(await tools[0].execute({}, { signal: new AbortController().signal })));
    expect(afterTheme.theme).toBe("midnight-desk");
    expect(afterTheme.book.revision).toBe(revisionBeforeInvalid);

    cleanup();
    expect(registrationSignals.every((signal) => signal.aborted)).toBe(true);
    vi.unstubAllGlobals();
  });
});
