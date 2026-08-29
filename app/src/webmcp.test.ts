import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTHORING_GUIDE_DETAIL, PROJECT_CONTEXT_DETAILS, SITE_TOOL_NAMES, buildAuthoringGuide } from "./authoringContract";
import { bookEngine, humanEdit } from "./bookEngine";
import { QUALITY_VISUAL_CRITERION_IDS } from "./qualityContract";
import { registerWebMcpTools } from "./webmcp";

const readyStoryBrief = (spreadCount: number) => ({
  contractVersion: 2,
  bookType: "illustrated-storybook",
  premise: "Explain a natural pattern through a clear visual story.",
  audience: "Curious family readers",
  spreadCount,
  visualDirection: "Tactile watercolor collage",
  sourceAssets: [],
});

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

    expect(tools.map((tool) => tool.name)).toEqual([...SITE_TOOL_NAMES]);
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
    const manageBookSchema = tool("manage_book").inputSchema as { required?: string[] };
    const projectContextSchema = tool("get_project_context").inputSchema as {
      properties?: { detail?: { enum?: string[] } };
    };
    expect(projectContextSchema.properties?.detail?.enum).toEqual([...PROJECT_CONTEXT_DETAILS]);
    expect(JSON.stringify(manageBookSchema)).toContain("set-cover");
    expect(manageBookSchema.required).toContain("expectedRevision");
    expect(tool("get_project_context").description).toContain("authoring-guide");
    expect(tool("get_project_context").description).toContain("creation-readiness");
    expect(tool("get_project_context").description).toContain("ask every returned blocking question");
    expect(tool("manage_book").description).toContain("exact brief");
    expect(tool("manage_book").description).toContain("do not mutate");
    expect(tool("manage_book").description).toContain("preserved-photo-album");
    expect(tool("manage_book").description).toContain("record critique");
    expect(tool("manage_book").description).toContain("adopt-creation-brief");
    expect(tool("get_project_context").description).toContain("quality-review");
    expect(tool("apply_scene_patch").description).toContain("original composite reference");
    expect(tool("apply_scene_patch").description).toContain("personalSourceAssetId");

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

    const contextWithoutHostOptions = await (tool("get_project_context").execute as unknown as (
      input: Record<string, unknown>,
    ) => Promise<unknown>)({});
    expect(JSON.parse(String(contextWithoutHostOptions))).toMatchObject({
      book: { id: "apertale-your-story", revision: 1 },
    });

    const unownedQuality = JSON.parse(String(await tool("get_project_context").execute({ detail: "quality-review" }, {
      signal: new AbortController().signal,
    })));
    expect(unownedQuality.qualityReview).toMatchObject({
      creationBrief: null,
      instructions: expect.stringContaining("adopt-creation-brief"),
    });

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

    await expect(tool("manage_book").execute({
      requestId: "create-before-guide",
      expectedRevision: 1,
      action: "create",
      title: "Too Soon",
      spreads: [{ title: "Unplanned", body: "This mutation must not run." }],
    }, { signal: new AbortController().signal })).rejects.toThrow(
      "read get_project_context with detail authoring-guide before creating a book",
    );
    expect(bookEngine.getSnapshot().document.revision).toBe(1);

    const authoringGuideResult = await tool("get_project_context").execute({ detail: AUTHORING_GUIDE_DETAIL }, {
      signal: new AbortController().signal,
    });
    expect(JSON.parse(String(authoringGuideResult))).toMatchObject({
      authoringGuide: { id: "apertale-authoring-guide", contract: "two-phase" },
    });

    const readinessResult = JSON.parse(String(await tool("get_project_context").execute({
      detail: "creation-readiness",
      creationBrief: {
        contractVersion: 2,
        bookType: "photo-led-keepsake",
        premise: "A family keepsake.",
        spreadCount: 4,
        visualDirection: "Warm collage",
        sourceAssets: [],
      },
    }, { signal: new AbortController().signal })));
    expect(readinessResult.creationReadiness).toMatchObject({
      ready: false,
      blockingMissingFields: expect.arrayContaining([
        expect.objectContaining({ field: "audience" }),
        expect.objectContaining({ field: "sourceAssets" }),
        expect.objectContaining({ field: "photoPolicy.sourceUse" }),
      ]),
      questions: expect.arrayContaining(["Who is this book for?", "Please add the photos you want this book to use."]),
    });

    const rejectedCreate = JSON.parse(String(await tool("manage_book").execute({
      requestId: "create-incomplete-brief",
      expectedRevision: 1,
      action: "create",
      title: "Incomplete Keepsake",
      spreads: [{ title: "Opening", body: "This must not be created." }],
      creationBrief: {
        contractVersion: 2,
        bookType: "photo-led-keepsake",
        premise: "A family keepsake.",
        spreadCount: 1,
        visualDirection: "Warm collage",
        sourceAssets: [],
      },
    }, { signal: new AbortController().signal })));
    expect(rejectedCreate).toMatchObject({ ok: false, code: "creation_not_ready", readiness: { ready: false } });
    expect(bookEngine.getSnapshot().document.revision).toBe(1);

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
    const presentation = await tool("set_presentation").execute({ requestId: "night-preview", theme: "midnight-desk", preview: true, spreadId: "city-for-small-things" }, {
      signal: new AbortController().signal,
    });
    const duplicatePresentation = await tool("set_presentation").execute({ requestId: "night-preview", theme: "paper-atelier" }, {
      signal: new AbortController().signal,
    });
    expect(duplicatePresentation).toBe(presentation);
    expect(JSON.parse(String(presentation))).toMatchObject({ spreadId: "city-for-small-things" });
    expect(bookEngine.getSnapshot().session).toMatchObject({ sceneThemeId: "midnight-desk", preview: true });
    expect(bookEngine.getSnapshot().document.revision).toBe(beforePresentationRevision);
    await expect(tool("set_presentation").execute({
      requestId: "invalid-presentation",
      theme: "paper-atelier",
      preview: "yes",
    }, { signal: new AbortController().signal })).rejects.toThrow("preview must be boolean");
    expect(bookEngine.getSnapshot().session.sceneThemeId).toBe("midnight-desk");
    bookEngine.setPreview(false);

    const openExpectedRevision = bookEngine.getSnapshot().document.revision;
    await expect(tool("manage_book").execute({
      requestId: "open-missing-revision",
      action: "open",
      bookId: "apertale-atlas-of-wonders",
    }, { signal: new AbortController().signal })).rejects.toThrow("expectedRevision");
    expect(JSON.parse(String(await tool("manage_book").execute({
      requestId: "open-stale-revision",
      expectedRevision: openExpectedRevision + 1,
      action: "open",
      bookId: "apertale-atlas-of-wonders",
    }, { signal: new AbortController().signal })))).toMatchObject({
      ok: false,
      code: "revision_conflict",
      currentRevision: openExpectedRevision,
    });
    const opened = JSON.parse(String(await tool("manage_book").execute({ requestId: "open-atlas", expectedRevision: openExpectedRevision, action: "open", bookId: "apertale-atlas-of-wonders" }, {
      signal: new AbortController().signal,
    })));
    expect(opened).toMatchObject({ ok: true, bookId: "apertale-atlas-of-wonders" });
    expect(bookEngine.getSnapshot().lastAction).toMatchObject({ source: "agent", summary: "Codex opened Atlas of Living Wonders" });
    const duplicateOpen = await tool("manage_book").execute({ requestId: "open-atlas", expectedRevision: openExpectedRevision, action: "open", bookId: "apertale-lantern-garden" }, {
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
      creationBrief: readyStoryBrief(1),
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
        cleanPlateAssetId: "/assets/generated/story-city-clean-v2.png",
        sourceAssetId: "/assets/generated/city-spread.png",
        separation: "inpainted-clean-plate",
      }, {
        op: "add",
        id: "second-layer",
        label: "Second foreground layer",
        assetId: "/assets/generated/story-city-boy-cutout-v3.png",
        page: "left",
      }],
    }, { signal: new AbortController().signal })));
    expect(layeredBackground).toMatchObject({ ok: true, changedIds: ["1-the-moon-pulls:background", "second-layer"] });
    expect(bookEngine.getSnapshot().document.spreads[0].artwork).toMatchObject({
      separation: "inpainted-clean-plate",
      cleanPlateAssetId: "/assets/generated/story-city-clean-v2.png",
      sourceAssetId: "/assets/generated/city-spread.png",
    });

    const qualityContext = JSON.parse(String(await tool("get_project_context").execute({ detail: "quality-review" }, {
      signal: new AbortController().signal,
    })));
    expect(qualityContext.qualityReview).toMatchObject({
      rubric: { version: 1, maxReviewRounds: 2 },
      review: { status: "needs-review", nextRound: 1 },
      renderManifest: { documentId: expect.any(String), spreads: [{ id: "1-the-moon-pulls" }] },
      renderEvidence: [],
    });
    expect(qualityContext.qualityReview.deterministicChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ criterionId: "render-evidence-completeness", outcome: "blocker" }),
    ]));

    const staleQualityStart = JSON.parse(String(await tool("manage_book").execute({
      requestId: "begin-quality-round-stale",
      expectedRevision: layeredBackground.revision + 1,
      action: "begin-critique",
    }, { signal: new AbortController().signal })));
    expect(staleQualityStart).toMatchObject({
      ok: false,
      code: "revision_conflict",
      currentRevision: layeredBackground.revision,
    });

    const qualityStart = JSON.parse(String(await tool("manage_book").execute({
      requestId: "begin-quality-round-one",
      expectedRevision: layeredBackground.revision,
      action: "begin-critique",
    }, { signal: new AbortController().signal })));
    expect(qualityStart).toMatchObject({ ok: true, nextRound: 1, remainingRounds: 2 });

    const critique = JSON.parse(String(await tool("manage_book").execute({
      requestId: "record-quality-round-one",
      expectedRevision: layeredBackground.revision,
      action: "record-critique",
      qualityReview: {
        contractVersion: 1,
        reviewedRevision: layeredBackground.revision,
        expectedRound: 1,
        sampleReady: false,
        summary: "The first rendered review found missing publication evidence.",
        checks: QUALITY_VISUAL_CRITERION_IDS.map((criterionId) => ({
          criterionId,
          outcome: "pass",
          message: `${criterionId} was inspected.`,
          evidence: criterionId === "cover-appeal"
            ? [{ scope: "cover", locator: "[data-book-id] img", description: "Rendered cover" }]
            : [{ scope: "spread", spreadId: "1-the-moon-pulls", locator: ".book-scene canvas", description: "Rendered spread" }],
        })),
      },
    }, { signal: new AbortController().signal })));
    expect(critique).toMatchObject({
      ok: true,
      qualityReport: { round: 1, status: "blocked", publishAllowed: false },
      qualityGate: { status: "blocked", remainingRounds: 1 },
    });

    cleanup();
    expect(registrationSignals.every((signal) => signal.aborted)).toBe(true);
  });

  it("returns the authoring-guide quality contract, rejects invalid detail, and keeps compact context unchanged", async () => {
    bookEngine.openBook("apertale-your-story");
    bookEngine.reset();
    const tools: WebMCP.ModelContextTool[] = [];
    const modelContext = {
      registerTool: vi.fn(async (tool: WebMCP.ModelContextTool) => {
        tools.push(tool);
      }),
    };
    vi.stubGlobal("document", { modelContext });
    const statuses: boolean[] = [];
    const cleanup = registerWebMcpTools((available) => statuses.push(available));
    await vi.waitFor(() => expect(statuses).toEqual([true]));
    expect(tools).toHaveLength(6);

    const getProjectContext = tools.find((candidate) => candidate.name === "get_project_context")!;
    const signal = { signal: new AbortController().signal };

    const compactResult = JSON.parse(String(await getProjectContext.execute({}, signal)));
    expect(compactResult.authoringGuide).toBeUndefined();
    expect(compactResult.book).toMatchObject({ id: "apertale-your-story", revision: 1 });

    const guideResult = JSON.parse(String(await getProjectContext.execute({ detail: AUTHORING_GUIDE_DETAIL }, signal)));
    const expectedGuide = buildAuthoringGuide();
    expect(guideResult.book).toMatchObject({ id: "apertale-your-story", revision: 1 });
    expect(guideResult.authoringGuide).toEqual(expectedGuide);
    expect(guideResult.authoringGuide.contract).toBe("two-phase");
    expect(guideResult.authoringGuide.tools).toEqual([...SITE_TOOL_NAMES]);
    expect(guideResult.authoringGuide.hardGates.map((gate: { id: string }) => gate.id)).toEqual(
      expectedGuide.hardGates.map((gate) => gate.id),
    );
    expect(guideResult.authoringGuide.hardGates.find((gate: { id: string }) => gate.id === "photo-truth").rule).toMatch(
      /raw uploaded photo/,
    );
    expect(guideResult.authoringGuide.hardGates.find((gate: { id: string }) => gate.id === "imagegen-before-create").rule)
      .toMatch(/before manage_book create/);
    expect(guideResult.authoringGuide.hardGates.find((gate: { id: string }) => gate.id === "handoff-before-refer").rule)
      .toMatch(/Hand off each generated asset/);
    expect(guideResult.authoringGuide.phases[0].mutationAllowed).toBe(false);
    expect(guideResult.authoringGuide.phases[1].sequence).toEqual(["handoff", "create", "set-cover", "patch", "verify"]);

    await expect(getProjectContext.execute({ detail: "skill" }, signal)).rejects.toThrow("detail is not supported.");
    await expect(getProjectContext.execute({ detail: "quality" }, signal)).rejects.toThrow("detail is not supported.");
    await expect(getProjectContext.execute({ detail: "authoring" }, signal)).rejects.toThrow("detail is not supported.");

    cleanup();
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
