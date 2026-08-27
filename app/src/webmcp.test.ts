import { afterEach, describe, expect, it, vi } from "vitest";
import { bookEngine, humanEdit } from "./bookEngine";
import { registerWebMcpTools } from "./webmcp";

describe("WebMCP registration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("registers six compact project tools and runs the shared-state acceptance path", async () => {
    bookEngine.openBook("apertale-your-story");
    bookEngine.reset();
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
      "get_project_context",
      "manage_book",
      "compose_spread",
      "apply_scene_patch",
      "set_presentation",
      "undo_project_change",
    ]);
    for (const registeredTool of tools) {
      expect(registeredTool.name.length).toBeLessThanOrEqual(30);
      expect(registeredTool.description.length).toBeLessThanOrEqual(500);
      expect(registeredTool.annotations).toEqual({
        readOnlyHint: registeredTool.name === "get_project_context",
        untrustedContentHint: registeredTool.name !== "set_presentation",
      });
      const schemaNodes: unknown[] = [registeredTool.inputSchema];
      while (schemaNodes.length > 0) {
        const node = schemaNodes.pop();
        if (!node || typeof node !== "object") continue;
        const record = node as Record<string, unknown>;
        if (typeof record.description === "string") expect(record.description.length).toBeLessThanOrEqual(150);
        schemaNodes.push(...Object.values(record));
      }
    }
    expect(registrationSignals).toHaveLength(6);
    const tool = (name: string) => tools.find((candidate) => candidate.name === name)!;
    expect(JSON.stringify(tool("manage_book").inputSchema)).toContain("set-cover");

    bookEngine.setSelection("bird");
    const contextResult = await tool("get_project_context").execute({}, { signal: new AbortController().signal });
    const context = JSON.parse(String(contextResult));
    expect(context).toMatchObject({
      book: { id: "apertale-your-story", revision: 1 },
      currentSpread: {
        id: "city-for-small-things",
        elements: [
          expect.objectContaining({ id: "bird" }),
          expect.objectContaining({ id: "city-flower-towers" }),
          expect.objectContaining({ id: "city-cloud-family" }),
          expect.objectContaining({ id: "paper-tower" }),
        ],
      },
      selection: { id: "bird" },
      library: { books: expect.any(Array) },
    });
    expect(String(contextResult).length).toBeLessThanOrEqual(2200);

    const selectedRevealResult = await tool("get_project_context").execute({ detail: "selected-reveal" }, {
      signal: new AbortController().signal,
    });
    expect(JSON.parse(String(selectedRevealResult))).toMatchObject({
      selection: { interaction: { reveal: { kind: "caption", title: "A city begins at hand scale" } } },
    });

    const assetDetailResult = await tool("get_project_context").execute({ detail: "assets" }, {
      signal: new AbortController().signal,
    });
    expect(JSON.parse(String(assetDetailResult))).toMatchObject({ assets: [] });

    const canceled = new AbortController();
    canceled.abort();
    await expect(tool("apply_scene_patch").execute({
      requestId: "canceled-patch",
      expectedRevision: 1,
      spreadId: "city-for-small-things",
      operations: [{ op: "update", elementId: "bird", kind: "lifted" }],
    }, { signal: canceled.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(bookEngine.getSnapshot().document.revision).toBe(1);

    const liftedAndAnimated = JSON.parse(String(await tool("apply_scene_patch").execute({
      requestId: "lift-and-animate-bird",
      expectedRevision: 1,
      spreadId: "city-for-small-things",
      operations: [{
        op: "update",
        elementId: "bird",
        kind: "lifted",
        motion: { preset: "fly-across", durationMs: 5200, loop: true },
        reveal: {
          kind: "fact-card",
          title: "Flight over the paper city",
          summary: "The bird becomes a guide through the illustrated spread.",
          facts: [{ label: "Interaction", value: "Hover, select, move, and animate" }],
          source: "Agent-authored scene note",
        },
      }],
    }, { signal: new AbortController().signal })));
    expect(liftedAndAnimated).toMatchObject({ ok: true, revision: 2, changedIds: ["bird"], undoToken: expect.any(String) });

    const moved = humanEdit("bird", { x: 0.74 });
    expect(moved.ok).toBe(true);
    const undone = JSON.parse(String(await tool("undo_project_change").execute({
      requestId: "undo-agent-patch",
      expectedRevision: 3,
      undoToken: liftedAndAnimated.undoToken,
    }, { signal: new AbortController().signal })));
    expect(undone).toMatchObject({ ok: true, revision: 4, changedIds: ["bird"] });
    const bird = bookEngine.getSnapshot().document.spreads[0].elements[0];
    expect(bird.kind).toBe("embedded");
    expect(bird.motion).toBeUndefined();
    expect(bird.interaction?.reveal.kind).toBe("caption");
    expect(bird.transform.x).toBe(0.74);

    const beforePresentationRevision = bookEngine.getSnapshot().document.revision;
    const presentation = await tool("set_presentation").execute({ requestId: "night-preview", theme: "midnight-desk", preview: true }, {
      signal: new AbortController().signal,
    });
    const duplicatePresentation = await tool("set_presentation").execute({ requestId: "night-preview", theme: "paper-atelier" }, {
      signal: new AbortController().signal,
    });
    expect(duplicatePresentation).toBe(presentation);
    expect(bookEngine.getSnapshot().session).toMatchObject({ sceneThemeId: "midnight-desk", preview: true });
    expect(bookEngine.getSnapshot().document.revision).toBe(beforePresentationRevision);
    await expect(tool("set_presentation").execute({
      requestId: "invalid-presentation",
      theme: "paper-atelier",
      preview: "yes",
    }, { signal: new AbortController().signal })).rejects.toThrow("preview must be boolean");
    expect(bookEngine.getSnapshot().session.sceneThemeId).toBe("midnight-desk");
    bookEngine.setPreview(false);

    const opened = JSON.parse(String(await tool("manage_book").execute({ requestId: "open-atlas", action: "open", bookId: "apertale-atlas-of-wonders" }, {
      signal: new AbortController().signal,
    })));
    expect(opened).toMatchObject({ ok: true, bookId: "apertale-atlas-of-wonders" });
    expect(bookEngine.getSnapshot().lastAction).toMatchObject({ source: "agent", summary: "ChatGPT opened Atlas of Living Wonders" });
    const duplicateOpen = await tool("manage_book").execute({ requestId: "open-atlas", action: "open", bookId: "apertale-lantern-garden" }, {
      signal: new AbortController().signal,
    });
    expect(JSON.parse(String(duplicateOpen))).toEqual(opened);

    const atlasRevision = bookEngine.getSnapshot().document.revision;
    const created = JSON.parse(String(await tool("manage_book").execute({
      requestId: "create-tides",
      expectedRevision: atlasRevision,
      action: "create",
      title: "How Tides Move",
      spreads: [{ title: "The Moon Pulls", body: "Gravity reaches across the water." }],
    }, { signal: new AbortController().signal })));
    expect(created).toMatchObject({ ok: true, changedIds: ["1-the-moon-pulls"] });

    const composed = JSON.parse(String(await tool("compose_spread").execute({
      requestId: "compose-tides",
      expectedRevision: created.revision,
      spreadId: "1-the-moon-pulls",
      body: "The Moon pulls the ocean into two broad bulges.",
    }, { signal: new AbortController().signal })));
    expect(composed).toMatchObject({ ok: true, changedIds: ["1-the-moon-pulls"] });

    const addedLayer = JSON.parse(String(await tool("apply_scene_patch").execute({
      requestId: "add-floating-bird",
      expectedRevision: composed.revision,
      spreadId: "1-the-moon-pulls",
      operations: [{
        op: "add",
        id: "floating-bird",
        label: "Floating bird",
        assetId: "/assets/generated/story-city-boy-cutout-v3.png",
        page: "right",
        kind: "lifted",
        locked: true,
        motion: { preset: "slow-orbit", durationMs: 8000, loop: true },
        hover: "warm-rim",
        focus: "orbit-inspect",
        reveal: {
          kind: "fact-card",
          title: "An illustrated guide",
          summary: "The paper bird gives the spread a moving visual anchor.",
          facts: [{ label: "Medium", value: "Layered paper illustration" }],
        },
      }],
    }, { signal: new AbortController().signal })));
    expect(addedLayer).toMatchObject({ ok: true, changedIds: ["floating-bird"] });
    expect(bookEngine.getSnapshot().document.spreads[0].elements[0]).toMatchObject({
      id: "floating-bird",
      locked: true,
      motion: { preset: "slow-orbit", durationMs: 8000, loop: true },
      interaction: {
        hover: "warm-rim",
        focus: "orbit-inspect",
        reveal: { kind: "fact-card", title: "An illustrated guide" },
      },
    });

    const rejectedUrl = JSON.parse(String(await tool("apply_scene_patch").execute({
      requestId: "reject-url",
      expectedRevision: addedLayer.revision,
      spreadId: "1-the-moon-pulls",
      operations: [{ op: "add", id: "remote", label: "Remote", assetId: "https://example.com/image.png", page: "right" }],
    }, { signal: new AbortController().signal })));
    expect(rejectedUrl).toMatchObject({ ok: false, code: "invalid" });

    const layeredBackground = JSON.parse(String(await tool("apply_scene_patch").execute({
      requestId: "set-layered-background",
      expectedRevision: addedLayer.revision,
      spreadId: "1-the-moon-pulls",
      operations: [{
        op: "set-background",
        sourceAssetId: "/assets/generated/wonders-colosseum.png",
        cleanPlateAssetId: "/assets/generated/wonders-colosseum-clean-v2.png",
      }, {
        op: "add",
        id: "second-layer",
        label: "Second foreground layer",
        assetId: "/assets/generated/wonders-colosseum-cypress-cutout-v2.png",
        page: "left",
      }],
    }, { signal: new AbortController().signal })));
    expect(layeredBackground).toMatchObject({ ok: true, changedIds: ["1-the-moon-pulls:background", "second-layer"] });
    expect(bookEngine.getSnapshot().document.spreads[0].artwork).toMatchObject({
      separation: "inpainted-clean-plate",
      cleanPlateAssetId: "/assets/generated/wonders-colosseum-clean-v2.png",
    });

    cleanup();
    expect(registrationSignals.every((signal) => signal.aborted)).toBe(true);
  });

  it("fails closed and unregisters the whole tool set when one registration is rejected", async () => {
    const registrationSignals: AbortSignal[] = [];
    const modelContext = {
      registerTool: vi.fn((tool: WebMCP.ModelContextTool, options?: WebMCP.ModelContextRegisterToolOptions) => {
        if (options?.signal) registrationSignals.push(options.signal);
        if (tool.name === "compose_spread") return Promise.reject(new DOMException("Invalid schema", "InvalidStateError"));
        return Promise.resolve();
      }),
    };
    vi.stubGlobal("document", { modelContext });
    const statuses: boolean[] = [];

    const cleanup = registerWebMcpTools((available) => statuses.push(available));
    await vi.waitFor(() => expect(statuses).toEqual([false]));

    expect(modelContext.registerTool).toHaveBeenCalledTimes(6);
    expect(registrationSignals).toHaveLength(6);
    expect(registrationSignals.every((signal) => signal.aborted)).toBe(true);
    cleanup();
    expect(statuses).toEqual([false]);
  });
});
