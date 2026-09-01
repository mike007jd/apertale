import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTHORING_GUIDE_DETAIL, PROJECT_CONTEXT_DETAILS, SITE_TOOL_NAMES, buildAuthoringGuide } from "./authoringContract";
import { BookEngine, bookEngine, humanEdit } from "./bookEngine";
import { completeImageHandoff, currentImageHandoff } from "./imageHandoff";
import { QUALITY_VISUAL_CRITERION_IDS } from "./qualityContract";
import { registerWebMcpTools } from "./webmcp";
import { getAssetMetadata, type StoredAssetMetadata } from "./assetStore";

const verifiedAssets = vi.hoisted(() => new Map<string, StoredAssetMetadata>());

function createTestLockManager() {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request<T>(name: string, _options: LockOptions, callback: () => T | PromiseLike<T>) {
      const previous = tails.get(name) ?? Promise.resolve();
      const result = previous.catch(() => undefined).then(callback);
      tails.set(name, result.catch(() => undefined));
      return result;
    },
  } as Pick<LockManager, "request"> as LockManager;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

vi.mock("./assetStore", () => ({
  getAssetMetadata: vi.fn(async (assetIds: string[]) => assetIds
    .map((id) => verifiedAssets.get(id))
    .filter((asset): asset is StoredAssetMetadata => Boolean(asset))),
  listAssetMetadata: vi.fn(async () => []),
}));

const readyStoryBrief = (spreadCount: number) => ({
  contractVersion: 2,
  bookType: "illustrated-storybook",
  premise: "Explain a natural pattern through a clear visual story.",
  audience: "Curious family readers",
  spreadCount,
  visualDirection: "Tactile watercolor collage",
  sourceAssets: [],
});

type DraftSpread = { title: string; body: string; kicker?: string };

const localAssetId = (ordinal: number) => `asset:20000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;

const verifyAsset = (id: string, role: "background" | "cover" | "cutout" | "source-photo") => {
  const cutout = role === "cutout";
  const width = role === "cover" ? 768 : role === "background" ? 1536 : role === "source-photo" ? 768 : 600;
  const height = role === "cover" ? 1152 : role === "background" ? 947 : role === "source-photo" ? 1024 : 800;
  verifiedAssets.set(id, {
    id,
    name: `${role}.png`,
    type: cutout ? "image/png" : "image/jpeg",
    size: 1,
    width,
    height,
    sourceWidth: width,
    sourceHeight: height,
    analysis: {
      version: 1,
      hasTransparency: cutout,
      hasMeaningfulAlpha: cutout,
      transparentPixelRatio: cutout ? 0.55 : 0,
      transparentBorderRatio: cutout ? 1 : 0,
      visiblePixelRatio: cutout ? 0.45 : 1,
    },
    assetUse: role === "source-photo" ? "source-photo" : "book-art",
    createdAt: "2026-08-30T00:00:00.000Z",
  });
  return id;
};

const preparedBookInput = (drafts: DraftSpread[]) => {
  let nextAsset = 1;
  const takeAsset = (role: "background" | "cover" | "cutout") => verifyAsset(localAssetId(nextAsset++), role);
  const coverAssetId = takeAsset("cover");
  const spreads = drafts.map((draft, index) => ({
    ...draft,
    background: {
      sourceAssetId: takeAsset("background"),
      cleanPlateAssetId: takeAsset("background"),
      separation: "inpainted-clean-plate" as const,
    },
    layers: [{
      id: `layer-${index + 1}-left`,
      label: `Story layer ${index + 1} left`,
      assetId: takeAsset("cutout"),
      page: "left" as const,
      hover: "lift-glow" as const,
    }, {
      id: `layer-${index + 1}-right`,
      label: `Story layer ${index + 1} right`,
      assetId: takeAsset("cutout"),
      page: "right" as const,
      focus: "spotlight" as const,
    }],
  }));
  const assetIds = [
    coverAssetId,
    ...spreads.flatMap((spread) => [
      spread.background.sourceAssetId,
      spread.background.cleanPlateAssetId,
      ...spread.layers.map((layer) => layer.assetId),
    ]),
  ];
  expect(assetIds.every((assetId) => verifiedAssets.has(assetId))).toBe(true);
  return { coverAssetId, spreads };
};

describe("WebMCP registration", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    });
    vi.stubGlobal("navigator", { locks: createTestLockManager() });
  });

  afterEach(() => {
    verifiedAssets.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reports agent use separately from tool availability", async () => {
    const tools: WebMCP.ModelContextTool[] = [];
    vi.stubGlobal("document", {
      modelContext: {
        registerTool: vi.fn(async (tool: WebMCP.ModelContextTool) => { tools.push(tool); }),
      },
    });
    const status = vi.fn();
    const onToolStart = vi.fn();
    const cleanup = registerWebMcpTools(status, () => undefined, onToolStart);

    await vi.waitFor(() => expect(status).toHaveBeenCalledWith(true));
    expect(onToolStart).not.toHaveBeenCalled();
    await tools[0]!.execute({}, { signal: new AbortController().signal });
    expect(onToolStart).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("registers the compact project tools and runs the shared-state acceptance path", async () => {
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
    const presented = vi.fn();
    const cleanup = registerWebMcpTools((available) => statuses.push(available), presented);
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
    expect(registrationSignals).toHaveLength(SITE_TOOL_NAMES.length);
    const tool = (name: string) => tools.find((candidate) => candidate.name === name)!;
    type TestSchema = {
      required?: string[];
      const?: string;
      properties?: Record<string, TestSchema>;
      items?: TestSchema;
      oneOf?: TestSchema[];
      pattern?: string;
      description?: string;
    };
    const manageBookSchema = tool("manage_book").inputSchema as TestSchema;
    const handoffSchema = tool("request_image_handoff").inputSchema as { required?: string[] };
    const projectContextSchema = tool("get_project_context").inputSchema as {
      properties?: { detail?: { enum?: string[] } };
    };
    expect(projectContextSchema.properties?.detail?.enum).toEqual([...PROJECT_CONTEXT_DETAILS]);
    expect(JSON.stringify(manageBookSchema)).toContain("set-cover");
    expect(JSON.stringify(manageBookSchema)).toContain("coverAssetId");
    expect(JSON.stringify(manageBookSchema)).toContain("background");
    expect(JSON.stringify(manageBookSchema)).toContain("layers");
    for (const mutationTool of ["manage_book", "compose_spread", "apply_scene_patch", "set_presentation", "undo_project_change"]) {
      const mutationSchema = tool(mutationTool).inputSchema as TestSchema;
      const required = mutationSchema.required;
      expect(required, mutationTool).toEqual(expect.arrayContaining(["expectedDocumentId", "expectedRevision"]));
      expect(mutationSchema.properties?.requestId?.description, mutationTool).toMatch(/exact unchanged request.*ok:false correction.*fresh id/i);
    }
    expect(Object.fromEntries((manageBookSchema.oneOf ?? []).map((branch) => [
      branch.properties?.action?.const,
      branch.required ?? [],
    ]))).toEqual({
      open: ["bookId"],
      create: ["title", "coverAssetId", "spreads", "creationBrief"],
      "adopt-creation-brief": ["creationBrief"],
      "set-cover": ["coverAssetId"],
      "begin-critique": [],
      "record-critique": ["qualityReview"],
    });
    const spreadSchema = manageBookSchema.properties?.spreads?.items;
    expect(spreadSchema?.required).toEqual(["title", "body", "background", "layers"]);
    expect(spreadSchema?.properties?.background?.required).toEqual([
      "cleanPlateAssetId",
      "sourceAssetId",
      "separation",
    ]);
    expect(spreadSchema?.properties?.layers?.items?.required).toEqual(["id", "label", "assetId", "page"]);
    expect(spreadSchema?.properties?.layers?.items?.properties?.id?.pattern).toBe("^[a-z0-9][a-z0-9-]{0,63}$");
    expect(handoffSchema.required).toEqual(["requestId", "assetUse", "reason"]);
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
          expect.objectContaining({
            id: "bird",
            assetId: "/assets/generated/story-city-boy-cutout-v3.png",
            frameAssetIds: null,
          }),
          expect.objectContaining({ id: "city-flower-towers" }),
          expect.objectContaining({ id: "city-cloud-family" }),
          expect.objectContaining({ id: "paper-tower" }),
        ],
      },
      selection: {
        id: "bird",
        assetId: "/assets/generated/story-city-boy-cutout-v3.png",
        frameAssetIds: null,
      },
      library: { books: expect.any(Array) },
    });
    expect(String(contextResult).length).toBeLessThanOrEqual(2600);

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

    const beforeGuideManifest = preparedBookInput([{ title: "Unplanned", body: "This mutation must not run." }]);
    await expect(tool("manage_book").execute({
      requestId: "create-before-guide",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: 1,
      action: "create",
      title: "Too Soon",
      ...beforeGuideManifest,
      creationBrief: readyStoryBrief(1),
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

    const invalidLayerIdManifest = preparedBookInput([{ title: "Invalid Layer Id", body: "The parser must reject this before mutation." }]);
    invalidLayerIdManifest.spreads[0].layers[0].id = "Bubu Bear";
    await expect(tool("manage_book").execute({
      requestId: "reject-invalid-layer-id",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: 1,
      action: "create",
      title: "Invalid Layer Id",
      ...invalidLayerIdManifest,
      creationBrief: readyStoryBrief(1),
    }, { signal: new AbortController().signal })).rejects.toThrow(/id must start with a lowercase letter or digit/i);
    expect(bookEngine.getSnapshot().document.revision).toBe(1);

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

    const incompleteBriefManifest = preparedBookInput([{ title: "Opening", body: "This must not be created." }]);
    const rejectedCreate = JSON.parse(String(await tool("manage_book").execute({
      requestId: "create-incomplete-brief",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: 1,
      action: "create",
      title: "Incomplete Keepsake",
      ...incompleteBriefManifest,
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

    const beforeRejectedShell = bookEngine.getSnapshot();
    const libraryBeforeRejectedShell = bookEngine.getLibrary();
    await expect(tool("manage_book").execute({
      requestId: "reject-text-only-shell",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: beforeRejectedShell.document.revision,
      action: "create",
      title: "Text Is Not A Finished Book",
      spreads: [{ title: "Opening", body: "A valid story draft still needs its complete prepared art set." }],
      creationBrief: readyStoryBrief(1),
    }, { signal: new AbortController().signal })).rejects.toThrow("coverAssetId");
    expect(bookEngine.getSnapshot().document).toEqual(beforeRejectedShell.document);
    expect(bookEngine.getLibrary()).toEqual(libraryBeforeRejectedShell);
    expect(presented).not.toHaveBeenCalled();

    const preparedWithoutInteraction = preparedBookInput([{
      title: "Still Incomplete",
      body: "All artwork exists, but the spread has no authored interaction.",
    }]);
    const spreadsWithoutInteraction = preparedWithoutInteraction.spreads.map((spread) => ({
      ...spread,
      layers: spread.layers.map(({ id, label, assetId, page }) => ({ id, label, assetId, page })),
    }));
    const rejectedArtifact = JSON.parse(String(await tool("manage_book").execute({
      requestId: "reject-complete-shape-without-interaction",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: beforeRejectedShell.document.revision,
      action: "create",
      title: "Structurally Valid But Incomplete",
      coverAssetId: preparedWithoutInteraction.coverAssetId,
      spreads: spreadsWithoutInteraction,
      creationBrief: readyStoryBrief(1),
    }, { signal: new AbortController().signal })));
    expect(rejectedArtifact).toMatchObject({
      ok: false,
      code: "creation_artifact_incomplete",
      issues: expect.arrayContaining([expect.stringMatching(/explicit story-relevant interaction/i)]),
    });
    expect(bookEngine.getSnapshot().document).toEqual(beforeRejectedShell.document);
    expect(bookEngine.getLibrary()).toEqual(libraryBeforeRejectedShell);
    expect(presented).not.toHaveBeenCalled();

    const canceled = new AbortController();
    canceled.abort();
    await expect(tool("apply_scene_patch").execute({
      requestId: "canceled-patch",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: 1,
      spreadId: "city-for-small-things",
      operations: [{ op: "update", elementId: "bird", kind: "lifted" }],
    }, { signal: canceled.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(bookEngine.getSnapshot().document.revision).toBe(1);

    const wrongBundledRole = JSON.parse(String(await tool("apply_scene_patch").execute({
      requestId: "reject-bundled-background-as-layer",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: 1,
      spreadId: "city-for-small-things",
      operations: [{
        op: "add",
        id: "opaque-background-copy",
        label: "Opaque background copy",
        assetId: "/assets/generated/story-city-clean-v2.png",
        page: "right",
      }],
    }, { signal: new AbortController().signal })));
    expect(wrongBundledRole).toMatchObject({ ok: false, code: "invalid", summary: expect.stringMatching(/foreground role/i) });
    expect(bookEngine.getSnapshot().document.revision).toBe(1);

    await expect(tool("apply_scene_patch").execute({
      requestId: "reject-mismatched-resting-frame",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: 1,
      spreadId: "city-for-small-things",
      operations: [{
        op: "add",
        id: "mismatched-resting-frame",
        label: "Mismatched resting frame",
        assetId: "/assets/generated/story-city-boy-cutout-v3.png",
        frameAssetIds: [
          "/assets/generated/story-window-glow-cutout-v3.png",
          "/assets/generated/story-city-boy-cutout-v3.png",
        ],
        page: "right",
      }],
    }, { signal: new AbortController().signal })).rejects.toThrow(/frameAssetIds\[0\] must equal assetId/i);

    const sourceCanvasAssetId = verifyAsset(localAssetId(800), "background");
    const cleanCanvasAssetId = verifyAsset(localAssetId(801), "background");
    verifiedAssets.get(cleanCanvasAssetId)!.sourceWidth = 2048;
    verifiedAssets.get(cleanCanvasAssetId)!.sourceHeight = 1024;
    await expect(tool("apply_scene_patch").execute({
      requestId: "reject-mismatched-source-canvases",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: 1,
      spreadId: "city-for-small-things",
      operations: [{
        op: "set-background",
        sourceAssetId: sourceCanvasAssetId,
        cleanPlateAssetId: cleanCanvasAssetId,
        separation: "inpainted-clean-plate",
      }],
    }, { signal: new AbortController().signal })).rejects.toThrow(/same original canvas size/i);
    expect(bookEngine.getSnapshot().document.revision).toBe(1);

    const liftedAndAnimated = JSON.parse(String(await tool("apply_scene_patch").execute({
      requestId: "lift-and-animate-bird",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: 1,
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

    const moved = await humanEdit("bird", { x: 0.74 });
    expect(moved.ok).toBe(true);
    const undone = JSON.parse(String(await tool("undo_project_change").execute({
      requestId: "undo-agent-patch",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: 3,
      undoToken: liftedAndAnimated.undoToken,
    }, { signal: new AbortController().signal })));
    expect(undone).toMatchObject({ ok: true, revision: 4, changedIds: ["bird"] });
    const bird = bookEngine.getSnapshot().document.spreads[0].elements[0];
    expect(bird.kind).toBe("embedded");
    expect(bird.motion).toBeUndefined();
    expect(bird.interaction?.reveal.kind).toBe("caption");
    expect(bird.transform.x).toBe(0.74);

    const beforePresentationRevision = bookEngine.getSnapshot().document.revision;
    const presentationDocumentId = bookEngine.getSnapshot().document.id;
    const presentation = await tool("set_presentation").execute({ requestId: "night-preview", expectedDocumentId: presentationDocumentId, expectedRevision: beforePresentationRevision, theme: "midnight-desk", preview: true, spreadId: "city-for-small-things" }, {
      signal: new AbortController().signal,
    });
    const duplicatePresentation = await tool("set_presentation").execute({ requestId: "night-preview", expectedDocumentId: presentationDocumentId, expectedRevision: beforePresentationRevision, theme: "paper-atelier" }, {
      signal: new AbortController().signal,
    });
    expect(duplicatePresentation).toBe(presentation);
    expect(JSON.parse(String(presentation))).toMatchObject({ spreadId: "city-for-small-things", surface: "reader" });
    expect(presented).toHaveBeenLastCalledWith(expect.objectContaining({
      requestId: "night-preview",
      surface: "reader",
      spreadId: "city-for-small-things",
      theme: "midnight-desk",
      preview: true,
    }), expect.any(AbortSignal));
    expect(bookEngine.getSnapshot().session).toMatchObject({ sceneThemeId: "midnight-desk", preview: true });
    expect(bookEngine.getSnapshot().document.revision).toBe(beforePresentationRevision);
    const shelfPresentation = JSON.parse(String(await tool("set_presentation").execute({
      requestId: "show-cover",
      expectedDocumentId: presentationDocumentId,
      expectedRevision: beforePresentationRevision,
      surface: "shelf",
      theme: "midnight-desk",
      preview: false,
    }, { signal: new AbortController().signal })));
    expect(shelfPresentation).toMatchObject({ surface: "shelf", preview: false });
    expect(presented).toHaveBeenLastCalledWith(expect.objectContaining({
      requestId: "show-cover",
      surface: "shelf",
    }), expect.any(AbortSignal));
    await expect(tool("set_presentation").execute({
      requestId: "invalid-shelf-spread",
      expectedDocumentId: presentationDocumentId,
      expectedRevision: beforePresentationRevision,
      surface: "shelf",
      spreadId: "city-for-small-things",
    }, { signal: new AbortController().signal })).rejects.toThrow("cannot be combined");
    await expect(tool("set_presentation").execute({
      requestId: "invalid-presentation",
      expectedDocumentId: presentationDocumentId,
      expectedRevision: beforePresentationRevision,
      theme: "paper-atelier",
      preview: "yes",
    }, { signal: new AbortController().signal })).rejects.toThrow("preview must be boolean");
    expect(bookEngine.getSnapshot().session.sceneThemeId).toBe("midnight-desk");
    bookEngine.setPreview(false);

    const openExpectedRevision = bookEngine.getSnapshot().document.revision;
    await expect(tool("manage_book").execute({
      requestId: "open-missing-revision",
      expectedDocumentId: presentationDocumentId,
      action: "open",
      bookId: "apertale-atlas-of-wonders",
    }, { signal: new AbortController().signal })).rejects.toThrow("expectedRevision");
    expect(JSON.parse(String(await tool("manage_book").execute({
      requestId: "open-stale-revision",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: openExpectedRevision + 1,
      action: "open",
      bookId: "apertale-atlas-of-wonders",
    }, { signal: new AbortController().signal })))).toMatchObject({
      ok: false,
      code: "revision_conflict",
      currentRevision: openExpectedRevision,
    });
    const opened = JSON.parse(String(await tool("manage_book").execute({ requestId: "open-atlas", expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: openExpectedRevision, action: "open", bookId: "apertale-atlas-of-wonders" }, {
      signal: new AbortController().signal,
    })));
    expect(opened).toMatchObject({ ok: true, bookId: "apertale-atlas-of-wonders" });
    expect(presented).toHaveBeenLastCalledWith(expect.objectContaining({
      requestId: "open-atlas",
      surface: "reader",
      documentId: "apertale-atlas-of-wonders",
    }), expect.any(AbortSignal));
    expect(bookEngine.getSnapshot().lastAction).toMatchObject({ source: "agent", summary: "Codex opened Atlas of Living Wonders" });
    const duplicateOpen = await tool("manage_book").execute({ requestId: "open-atlas", expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: openExpectedRevision, action: "open", bookId: "apertale-lantern-garden" }, {
      signal: new AbortController().signal,
    });
    expect(JSON.parse(String(duplicateOpen))).toEqual(opened);

    const atlasRevision = bookEngine.getSnapshot().document.revision;
    const created = JSON.parse(String(await tool("manage_book").execute({
      requestId: "create-tides",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: atlasRevision,
      action: "create",
      title: "How Tides Move",
      ...preparedBookInput([{ title: "The Moon Pulls", body: "Gravity reaches across the water." }]),
      creationBrief: readyStoryBrief(1),
    }, { signal: new AbortController().signal })));
    expect(created).toMatchObject({ ok: true, changedIds: ["1-the-moon-pulls"] });
    expect(presented).toHaveBeenLastCalledWith(expect.objectContaining({
      requestId: "create-tides",
      surface: "reader",
      documentId: expect.stringMatching(/^book-how-tides-move-/),
      spreadId: "1-the-moon-pulls",
    }), expect.any(AbortSignal));

    const composed = JSON.parse(String(await tool("compose_spread").execute({
      requestId: "compose-tides",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: created.revision,
      spreadId: "1-the-moon-pulls",
      body: "The Moon pulls the ocean into two broad bulges.",
    }, { signal: new AbortController().signal })));
    expect(composed).toMatchObject({ ok: true, changedIds: ["1-the-moon-pulls"] });

    const addedLayer = JSON.parse(String(await tool("apply_scene_patch").execute({
      requestId: "add-floating-bird",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: composed.revision,
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
    expect(bookEngine.getSnapshot().document.spreads[0].elements.find((element) => element.id === "floating-bird")).toMatchObject({
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
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: addedLayer.revision,
      spreadId: "1-the-moon-pulls",
      operations: [{ op: "add", id: "remote", label: "Remote", assetId: "https://example.com/image.png", page: "right" }],
    }, { signal: new AbortController().signal })));
    expect(rejectedUrl).toMatchObject({ ok: false, code: "invalid" });

    const layeredBackground = JSON.parse(String(await tool("apply_scene_patch").execute({
      requestId: "set-layered-background",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: addedLayer.revision,
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
        assetId: "/assets/generated/story-window-glow-cutout-v3.png",
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
      rubric: { version: 2, maxReviewRounds: 2 },
      review: { status: "needs-review", nextRound: 1 },
      renderManifest: { documentId: expect.any(String), spreads: [{ id: "1-the-moon-pulls" }] },
      renderEvidence: [],
    });
    expect(qualityContext.qualityReview.deterministicChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ criterionId: "render-evidence-completeness", outcome: "blocker" }),
    ]));
    expect(qualityContext.qualityReview.instructions).toContain('set_presentation(surface: "shelf")');
    expect(qualityContext.qualityReview.instructions).toContain('set_presentation(surface: "reader", spreadId)');
    expect(qualityContext.qualityReview.instructions).toMatch(/normal navigation and screenshots.*do not record revision-bound evidence/i);
    expect(qualityContext.qualityReview.instructions).toContain('photo-fidelity-integration with outcome: "note"');
    expect(qualityContext.qualityReview.instructions).toContain('scope: "book" and locator: "creationBrief.sourceAssets"');
    expect(qualityContext.qualityReview.instructions).toMatch(/personalSourceAssetId.*per-spread evidence/i);

    const adoptedCoverId = bookEngine.getSnapshot().document.coverAssetId!;
    const adoptedCoverMetadata = verifiedAssets.get(adoptedCoverId)!;
    verifiedAssets.set(adoptedCoverId, { ...adoptedCoverMetadata, assetUse: "source-photo" });
    const wrongRoleQualityStart = JSON.parse(String(await tool("manage_book").execute({
      requestId: "begin-quality-wrong-role",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: layeredBackground.revision,
      action: "begin-critique",
    }, { signal: new AbortController().signal })));
    expect(wrongRoleQualityStart).toMatchObject({
      ok: false,
      code: "creation_artifact_incomplete",
      issues: expect.arrayContaining([expect.stringMatching(/source-photo.*book-art role/i)]),
    });
    verifiedAssets.set(adoptedCoverId, adoptedCoverMetadata);

    const staleQualityStart = JSON.parse(String(await tool("manage_book").execute({
      requestId: "begin-quality-round-stale",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: layeredBackground.revision + 1,
      action: "begin-critique",
    }, { signal: new AbortController().signal })));
    expect(staleQualityStart).toMatchObject({
      ok: false,
      code: "revision_conflict",
      currentRevision: layeredBackground.revision,
    });

    const qualityStart = JSON.parse(String(await tool("manage_book").execute({
      requestId: "begin-quality-round-one",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: layeredBackground.revision,
      action: "begin-critique",
    }, { signal: new AbortController().signal })));
    expect(qualityStart).toMatchObject({ ok: true, nextRound: 1, remainingRounds: 2 });

    const critique = JSON.parse(String(await tool("manage_book").execute({
      requestId: "record-quality-round-one",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: layeredBackground.revision,
      action: "record-critique",
      qualityReview: {
        contractVersion: 2,
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
      ok: false,
      code: "render_evidence_required",
      qualityGate: { status: "checking", remainingRounds: 2 },
    });

    expect(JSON.parse(String(await tool("set_presentation").execute({
      requestId: "render-quality-cover",
      expectedDocumentId: bookEngine.getSnapshot().document.id,
      expectedRevision: bookEngine.getSnapshot().document.revision,
      surface: "shelf",
    }, { signal: new AbortController().signal })))).toMatchObject({ surface: "shelf" });
    expect(JSON.parse(String(await tool("set_presentation").execute({
      requestId: "render-quality-spread",
      expectedDocumentId: bookEngine.getSnapshot().document.id,
      expectedRevision: bookEngine.getSnapshot().document.revision,
      surface: "reader",
      spreadId: "1-the-moon-pulls",
    }, { signal: new AbortController().signal })))).toMatchObject({ surface: "reader", spreadId: "1-the-moon-pulls" });
    const renderedDocument = bookEngine.getSnapshot().document;
    // App records these only after the shelf image and reader canvas emit their
    // stable-frame callbacks; this registration test models those callbacks.
    expect(bookEngine.recordRenderEvidence({
      documentId: renderedDocument.id,
      revision: renderedDocument.revision,
      scope: "cover",
      theme: "midnight-desk",
      surface: "shelf",
      locator: `[data-book-id="${renderedDocument.id}"] .library-cover-frame img`,
    })).toBe(true);
    expect(bookEngine.recordRenderEvidence({
      documentId: renderedDocument.id,
      revision: renderedDocument.revision,
      scope: "spread",
      spreadId: "1-the-moon-pulls",
      theme: "midnight-desk",
      surface: "webgl",
      locator: ".book-scene canvas",
    })).toBe(true);

    const renderedCritique = JSON.parse(String(await tool("manage_book").execute({
      requestId: "record-quality-round-one-after-render",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: layeredBackground.revision,
      action: "record-critique",
      qualityReview: {
        contractVersion: 2,
        reviewedRevision: layeredBackground.revision,
        expectedRound: 1,
        sampleReady: false,
        summary: "The rendered review is now complete.",
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
    expect(renderedCritique).toMatchObject({
      ok: true,
      qualityReport: { round: 1, status: "blocked" },
      qualityGate: { status: "blocked", remainingRounds: 1 },
    });

    const sourcePhotoId = verifyAsset(localAssetId(950), "source-photo");
    const photoPrepared = preparedBookInput([{ title: "Family Light", body: "A source-true family memory." }]);
    const disguisedSourceCover = JSON.parse(String(await tool("manage_book").execute({
      requestId: "reject-disguised-source-photo-cover",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: layeredBackground.revision,
      action: "create",
      title: "Disguised Source Cover",
      ...photoPrepared,
      coverAssetId: sourcePhotoId,
      creationBrief: readyStoryBrief(1),
    }, { signal: new AbortController().signal })));
    expect(disguisedSourceCover).toMatchObject({
      ok: false,
      code: "creation_artifact_incomplete",
      issues: expect.arrayContaining([expect.stringMatching(/source-photo.*book-art role/i)]),
    });
    const photoCreated = JSON.parse(String(await tool("manage_book").execute({
      requestId: "create-photo-policy-book",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: layeredBackground.revision,
      action: "create",
      title: "Family Light",
      coverAssetId: photoPrepared.coverAssetId,
      spreads: photoPrepared.spreads.map((spread) => ({
        ...spread,
        background: { ...spread.background, personalSourceAssetId: sourcePhotoId },
      })),
      creationBrief: {
        contractVersion: 2,
        bookType: "photo-led-keepsake",
        premise: "Turn one family portrait into a warm illustrated keepsake.",
        audience: "The family",
        spreadCount: 1,
        visualDirection: "Warm tactile collage",
        sourceAssets: [{ id: sourcePhotoId, name: "Portrait.png" }],
        photoPolicy: { sourceUse: "reference-and-compose", preserveIdentity: true, allowFaceChanges: false },
      },
    }, { signal: new AbortController().signal })));
    expect(photoCreated).toMatchObject({ ok: true, revision: layeredBackground.revision + 1 });
    const sourceCover = JSON.parse(String(await tool("manage_book").execute({
      requestId: "reject-source-photo-as-cover",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: photoCreated.revision,
      action: "set-cover",
      coverAssetId: sourcePhotoId,
    }, { signal: new AbortController().signal })));
    expect(sourceCover).toMatchObject({
      ok: false,
      code: "invalid",
      summary: expect.stringMatching(/source-photo.*book-art role/i),
    });
    expect(bookEngine.getSnapshot().document.coverAssetId).toBe(photoPrepared.coverAssetId);

    cleanup();
    expect(registrationSignals.every((signal) => signal.aborted)).toBe(true);
  });

  it("reports the durable source revision when another tab advances it before open", async () => {
    bookEngine.openBook("apertale-your-story");
    bookEngine.reset();
    const expected = bookEngine.getSnapshot().document;
    const liveTab = new BookEngine();
    const editedElement = liveTab.getSnapshot().document.spreads[0].elements[0];
    await expect(liveTab.dispatchCoordinated({
      type: "edit",
      requestId: "advance-durable-source-before-tool-open",
      expectedDocumentId: expected.id,
      expectedRevision: expected.revision,
      elementId: editedElement.id,
      transform: { x: editedElement.transform.x === 0.76 ? 0.7 : 0.76 },
    }, "human")).resolves.toMatchObject({ ok: true });

    const tools: WebMCP.ModelContextTool[] = [];
    vi.stubGlobal("document", {
      modelContext: {
        registerTool: vi.fn(async (tool: WebMCP.ModelContextTool) => { tools.push(tool); }),
      },
    });
    const cleanup = registerWebMcpTools(() => undefined);
    await vi.waitFor(() => expect(tools).toHaveLength(SITE_TOOL_NAMES.length));
    const manageBook = tools.find((candidate) => candidate.name === "manage_book")!;
    const result = JSON.parse(String(await manageBook.execute({
      requestId: "open-after-durable-source-advance",
      expectedDocumentId: expected.id,
      expectedRevision: expected.revision,
      action: "open",
      bookId: "apertale-atlas-of-wonders",
    }, { signal: new AbortController().signal })));

    expect(result).toMatchObject({
      ok: false,
      code: "revision_conflict",
      currentRevision: expected.revision + 1,
    });
    expect(bookEngine.getSnapshot().document).toEqual(expected);
    cleanup();
  });

  it("retries a created book's presentation against the original document", async () => {
    bookEngine.openBook("apertale-your-story");
    bookEngine.reset();
    const tools: WebMCP.ModelContextTool[] = [];
    vi.stubGlobal("document", {
      modelContext: {
        registerTool: vi.fn(async (tool: WebMCP.ModelContextTool) => { tools.push(tool); }),
      },
    });
    const presented = vi.fn()
      .mockRejectedValueOnce(new Error("The reader surface timed out."))
      .mockResolvedValue(undefined);
    const cleanup = registerWebMcpTools(() => undefined, presented);
    await vi.waitFor(() => expect(tools).toHaveLength(SITE_TOOL_NAMES.length));
    const tool = (name: string) => tools.find((candidate) => candidate.name === name)!;
    const signal = { signal: new AbortController().signal };
    await tool("get_project_context").execute({ detail: AUTHORING_GUIDE_DETAIL }, signal);
    const input = {
      requestId: "create-retry-presentation",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: bookEngine.getSnapshot().document.revision,
      action: "create",
      title: "The Presentation Retry",
      ...preparedBookInput([{ title: "The Same Book", body: "A retry must return to this exact document." }]),
      creationBrief: readyStoryBrief(1),
    };

    const booksBefore = bookEngine.getLibrary().books.map((book) => book.id);
    const pending = JSON.parse(String(await tool("manage_book").execute(input, signal)));
    expect(pending).toMatchObject({
      ok: true,
      changedIds: ["1-the-same-book"],
      presentation: { status: "pending", summary: expect.stringMatching(/same requestId/i) },
    });
    const createdDocumentId = presented.mock.calls[0][0].documentId;
    expect(createdDocumentId).toMatch(/^book-the-presentation-retry-/);
    expect(bookEngine.getLibrary().books.filter((book) => book.id === createdDocumentId)).toHaveLength(1);
    expect(bookEngine.openBook("apertale-atlas-of-wonders", "human")).toBe(true);
    expect(bookEngine.getSnapshot().document.id).toBe("apertale-atlas-of-wonders");

    const retried = JSON.parse(String(await tool("manage_book").execute(input, signal)));
    expect(retried).toMatchObject({
      ok: true,
      documentId: createdDocumentId,
      changedIds: ["1-the-same-book"],
      undoToken: pending.undoToken,
    });
    expect(retried).not.toHaveProperty("presentation");
    expect(presented).toHaveBeenCalledTimes(2);
    expect(presented.mock.calls[1][0]).toMatchObject({
      requestId: input.requestId,
      surface: "reader",
      documentId: createdDocumentId,
      spreadId: "1-the-same-book",
      theme: "paper-atelier",
      preview: false,
    });
    expect(bookEngine.getSnapshot().document.id).toBe(createdDocumentId);
    expect(bookEngine.getLibrary().books.filter((book) => book.id === createdDocumentId)).toHaveLength(1);

    const undone = JSON.parse(String(await tool("undo_project_change").execute({
      requestId: "undo-create-after-presentation-retry",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: retried.revision,
      undoToken: retried.undoToken,
    }, signal)));
    expect(undone).toMatchObject({ ok: true, summary: expect.stringMatching(/removed the new book/i) });
    expect(bookEngine.getLibrary().books.map((book) => book.id)).toEqual(booksBefore);
    cleanup();
  });

  it("keeps an async cover mutation bound to the inspected document identity", async () => {
    bookEngine.openBook("apertale-your-story");
    bookEngine.reset();
    const baseline = bookEngine.getSnapshot().document;
    const coverAssetId = verifyAsset(localAssetId(999), "cover");
    const metadataStarted = deferred();
    const releaseMetadata = deferred();
    vi.mocked(getAssetMetadata).mockImplementationOnce(async (assetIds) => {
      metadataStarted.resolve();
      await releaseMetadata.promise;
      return assetIds
        .map((assetId) => verifiedAssets.get(assetId))
        .filter((asset): asset is StoredAssetMetadata => Boolean(asset));
    });
    const tools: WebMCP.ModelContextTool[] = [];
    vi.stubGlobal("document", {
      modelContext: {
        registerTool: vi.fn(async (tool: WebMCP.ModelContextTool) => { tools.push(tool); }),
      },
    });
    const cleanup = registerWebMcpTools(() => undefined);
    await vi.waitFor(() => expect(tools).toHaveLength(SITE_TOOL_NAMES.length));
    const manageBook = tools.find((candidate) => candidate.name === "manage_book")!;
    const pending = Promise.resolve(manageBook.execute({
      requestId: "cover-stays-on-inspected-book",
      expectedDocumentId: baseline.id,
      expectedRevision: baseline.revision,
      action: "set-cover",
      coverAssetId,
    }, { signal: new AbortController().signal }));

    await metadataStarted.promise;
    expect(bookEngine.openBook("apertale-atlas-of-wonders")).toBe(true);
    const otherBefore = bookEngine.getSnapshot().document;
    releaseMetadata.resolve();

    expect(JSON.parse(String(await pending))).toMatchObject({
      ok: false,
      code: "revision_conflict",
      currentRevision: otherBefore.revision,
    });
    expect(bookEngine.getSnapshot().document).toEqual(otherBefore);
    cleanup();
  });

  it("rejects a wrong-role layer on the second spread atomically, then creates the corrected whole book once", async () => {
    bookEngine.openBook("apertale-your-story");
    bookEngine.reset();
    const tools: WebMCP.ModelContextTool[] = [];
    vi.stubGlobal("document", {
      modelContext: {
        registerTool: vi.fn(async (tool: WebMCP.ModelContextTool) => { tools.push(tool); }),
      },
    });
    const presented = vi.fn();
    const cleanup = registerWebMcpTools(() => undefined, presented);
    await vi.waitFor(() => expect(tools).toHaveLength(SITE_TOOL_NAMES.length));
    const tool = (name: string) => tools.find((candidate) => candidate.name === name)!;
    const signal = { signal: new AbortController().signal };
    await tool("get_project_context").execute({ detail: AUTHORING_GUIDE_DETAIL }, signal);
    const manifest = preparedBookInput([
      { title: "First Light", body: "The first spread is complete." },
      { title: "Second Light", body: "The second spread must be equally complete." },
    ]);
    const invalidLayerId = manifest.spreads[1].layers[1].assetId;
    const validLayer = verifiedAssets.get(invalidLayerId)!;
    verifiedAssets.set(invalidLayerId, {
      ...validLayer,
      type: "image/jpeg",
      analysis: {
        ...validLayer.analysis!,
        hasTransparency: false,
        hasMeaningfulAlpha: false,
        transparentPixelRatio: 0,
        transparentBorderRatio: 0,
        visiblePixelRatio: 1,
      },
    });
    const documentBefore = structuredClone(bookEngine.getSnapshot().document);
    const booksBefore = bookEngine.getLibrary().books.map((book) => book.id);

    const rejected = JSON.parse(String(await tool("manage_book").execute({
      requestId: "reject-second-spread-role",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: documentBefore.revision,
      action: "create",
      title: "Two Complete Lights",
      ...manifest,
      creationBrief: readyStoryBrief(2),
    }, signal)));
    expect(rejected).toMatchObject({
      ok: false,
      code: "creation_artifact_incomplete",
      issues: expect.arrayContaining([expect.stringMatching(/native-alpha PNG or WebP/i)]),
    });
    expect(bookEngine.getSnapshot().document).toEqual(documentBefore);
    expect(bookEngine.getLibrary().books.map((book) => book.id)).toEqual(booksBefore);
    expect(presented).not.toHaveBeenCalled();

    verifiedAssets.set(invalidLayerId, validLayer);
    const created = JSON.parse(String(await tool("manage_book").execute({
      requestId: "create-two-complete-spreads",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: documentBefore.revision,
      action: "create",
      title: "Two Complete Lights",
      ...manifest,
      creationBrief: readyStoryBrief(2),
    }, signal)));
    expect(created).toMatchObject({
      ok: true,
      documentId: expect.stringMatching(/^book-two-complete-lights-/),
      changedIds: ["1-first-light", "2-second-light"],
    });
    expect(bookEngine.getLibrary().books.map((book) => book.id)).toEqual([...booksBefore, created.documentId]);
    expect(presented).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("returns a structured atomic failure when a prepared create asset disappeared from the browser registry", async () => {
    bookEngine.openBook("apertale-your-story");
    bookEngine.reset();
    const tools: WebMCP.ModelContextTool[] = [];
    vi.stubGlobal("document", {
      modelContext: {
        registerTool: vi.fn(async (tool: WebMCP.ModelContextTool) => { tools.push(tool); }),
      },
    });
    const presented = vi.fn();
    const cleanup = registerWebMcpTools(() => undefined, presented);
    await vi.waitFor(() => expect(tools).toHaveLength(SITE_TOOL_NAMES.length));
    const context = tools.find((candidate) => candidate.name === "get_project_context")!;
    const manageBook = tools.find((candidate) => candidate.name === "manage_book")!;
    const signal = { signal: new AbortController().signal };
    await context.execute({ detail: AUTHORING_GUIDE_DETAIL }, signal);
    const manifest = preparedBookInput([{ title: "Missing Star", body: "Every final must still exist at commit time." }]);
    verifiedAssets.delete(manifest.spreads[0].layers[1].assetId);
    const before = structuredClone(bookEngine.getSnapshot().document);
    const libraryBefore = bookEngine.getLibrary();

    const result = JSON.parse(String(await manageBook.execute({
      requestId: "reject-disappeared-create-asset",
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: before.revision,
      action: "create",
      title: "Missing Star",
      ...manifest,
      creationBrief: readyStoryBrief(1),
    }, signal)));

    expect(result).toMatchObject({
      ok: false,
      code: "creation_artifact_incomplete",
      issues: [expect.stringMatching(/missing 1 browser-local image/i)],
    });
    expect(bookEngine.getSnapshot().document).toEqual(before);
    expect(bookEngine.getLibrary()).toEqual(libraryBefore);
    expect(presented).not.toHaveBeenCalled();
    cleanup();
  });

  it.each([
    { bookType: "photo-led-keepsake" as const, separation: "inpainted-clean-plate" as const },
    { bookType: "preserved-photo-album" as const, separation: "preserved-photo-layout" as const },
  ])("creates a complete $bookType through the adapter with explicit personal-source provenance", async ({ bookType, separation }) => {
    bookEngine.openBook("apertale-your-story");
    bookEngine.reset();
    const tools: WebMCP.ModelContextTool[] = [];
    vi.stubGlobal("document", {
      modelContext: {
        registerTool: vi.fn(async (tool: WebMCP.ModelContextTool) => { tools.push(tool); }),
      },
    });
    const presented = vi.fn();
    const cleanup = registerWebMcpTools(() => undefined, presented);
    await vi.waitFor(() => expect(tools).toHaveLength(SITE_TOOL_NAMES.length));
    const manageBook = tools.find((candidate) => candidate.name === "manage_book")!;
    const context = tools.find((candidate) => candidate.name === "get_project_context")!;
    const signal = { signal: new AbortController().signal };
    await context.execute({ detail: AUTHORING_GUIDE_DETAIL }, signal);
    const manifest = preparedBookInput([{ title: "A True Memory", body: "The source remains explicit and traceable." }]);
    const personalSourceAssetId = verifyAsset(localAssetId(90), "source-photo");
    const preservedLayoutAssetId = manifest.spreads[0].background.sourceAssetId;
    Object.assign(
      manifest.spreads[0].background,
      separation === "preserved-photo-layout"
        ? {
            sourceAssetId: preservedLayoutAssetId,
            cleanPlateAssetId: preservedLayoutAssetId,
            personalSourceAssetId,
            separation,
          }
        : { personalSourceAssetId, separation },
    );
    const creationBrief = {
      contractVersion: 2,
      bookType,
      premise: "Keep one family memory source-true.",
      audience: "The family",
      spreadCount: 1,
      visualDirection: "Quiet tactile keepsake",
      sourceAssets: [{ id: personalSourceAssetId, name: "Family memory.png" }],
      photoPolicy: separation === "preserved-photo-layout"
        ? { sourceUse: "preserve-original-layout" as const, preserveIdentity: true, allowFaceChanges: false, allowCrop: false, allowColorCorrection: true }
        : { sourceUse: "reference-and-compose" as const, preserveIdentity: true, allowFaceChanges: false },
    };

    const created = JSON.parse(String(await manageBook.execute({
      requestId: `create-${bookType}`,
      expectedDocumentId: bookEngine.getSnapshot().document.id, expectedRevision: bookEngine.getSnapshot().document.revision,
      action: "create",
      title: `Complete ${bookType}`,
      ...manifest,
      creationBrief,
    }, signal)));
    expect(created).toMatchObject({ ok: true, changedIds: ["1-a-true-memory"] });
    expect(bookEngine.getSnapshot().document.spreads[0].artwork).toMatchObject({
      sourceAssetId: separation === "preserved-photo-layout"
        ? preservedLayoutAssetId
        : manifest.spreads[0].background.sourceAssetId,
      cleanPlateAssetId: separation === "preserved-photo-layout"
        ? preservedLayoutAssetId
        : manifest.spreads[0].background.cleanPlateAssetId,
      personalSourceAssetId,
      separation,
    });
    expect(bookEngine.getSnapshot().document.spreads[0].artwork?.sourceAssetId).not.toBe(personalSourceAssetId);
    expect(bookEngine.getSnapshot().document.spreads[0].artwork?.cleanPlateAssetId).not.toBe(personalSourceAssetId);
    expect(presented).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("waits for an exact reader frame when only the theme changes", async () => {
    bookEngine.openBook("apertale-your-story");
    bookEngine.reset();
    const tools: WebMCP.ModelContextTool[] = [];
    vi.stubGlobal("document", {
      modelContext: {
        registerTool: vi.fn(async (tool: WebMCP.ModelContextTool) => { tools.push(tool); }),
      },
    });
    let releaseFrame!: () => void;
    const frameReady = new Promise<void>((resolve) => { releaseFrame = resolve; });
    const presented = vi.fn(() => frameReady);
    const cleanup = registerWebMcpTools(() => undefined, presented);
    await vi.waitFor(() => expect(tools).toHaveLength(SITE_TOOL_NAMES.length));
    const setPresentation = tools.find((candidate) => candidate.name === "set_presentation")!;

    const execution = Promise.resolve(setPresentation.execute({
      requestId: "theme-only-frame",
      expectedDocumentId: bookEngine.getSnapshot().document.id,
      expectedRevision: bookEngine.getSnapshot().document.revision,
      theme: "midnight-desk",
    }, { signal: new AbortController().signal }));

    await vi.waitFor(() => expect(presented).toHaveBeenCalledTimes(1));
    let settled = false;
    void execution.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseFrame();
    const result = JSON.parse(String(await execution));

    expect(result).toMatchObject({ theme: "midnight-desk", surface: "reader" });
    expect(presented).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "theme-only-frame",
      surface: "reader",
      theme: "midnight-desk",
      preview: false,
    }), expect.any(AbortSignal));
    cleanup();
  });

  it("retries set_presentation against its exact book and session target", async () => {
    bookEngine.openBook("apertale-your-story");
    bookEngine.reset();
    const original = bookEngine.getSnapshot();
    const targetSpreadId = original.document.spreads.at(-1)!.id;
    const tools: WebMCP.ModelContextTool[] = [];
    vi.stubGlobal("document", {
      modelContext: {
        registerTool: vi.fn(async (tool: WebMCP.ModelContextTool) => { tools.push(tool); }),
      },
    });
    const presented = vi.fn()
      .mockRejectedValueOnce(new Error("The reader surface timed out."))
      .mockResolvedValue(undefined);
    const cleanup = registerWebMcpTools(() => undefined, presented);
    await vi.waitFor(() => expect(tools).toHaveLength(SITE_TOOL_NAMES.length));
    const setPresentation = tools.find((candidate) => candidate.name === "set_presentation")!;
    const signal = { signal: new AbortController().signal };
    const input = {
      requestId: "presentation-retry-exact-target",
      expectedDocumentId: bookEngine.getSnapshot().document.id,
      expectedRevision: bookEngine.getSnapshot().document.revision,
      theme: "midnight-desk",
      preview: true,
      spreadId: targetSpreadId,
      surface: "reader",
    };

    const pending = JSON.parse(String(await setPresentation.execute(input, signal)));
    expect(pending).toMatchObject({
      ok: true,
      presentation: { status: "pending", summary: expect.stringMatching(/same requestId/i) },
    });
    expect(bookEngine.openBook("apertale-atlas-of-wonders", "human")).toBe(true);
    bookEngine.setTheme("paper-atelier", "human");
    bookEngine.setPreview(false, "human");

    const retried = JSON.parse(String(await setPresentation.execute(input, signal)));
    expect(retried).toMatchObject({
      ok: true,
      theme: "midnight-desk",
      preview: true,
      spreadId: targetSpreadId,
      surface: "reader",
    });
    expect(presented).toHaveBeenCalledTimes(2);
    expect(presented.mock.calls[1][0]).toMatchObject({
      requestId: input.requestId,
      surface: "reader",
      documentId: original.document.id,
      revision: original.document.revision,
      spreadId: targetSpreadId,
      theme: "midnight-desk",
      preview: true,
    });
    const restored = bookEngine.getSnapshot();
    expect(restored.document.id).toBe(original.document.id);
    expect(restored.session.sceneThemeId).toBe("midnight-desk");
    expect(restored.session.preview).toBe(true);
    expect(restored.document.spreads[restored.session.currentSpreadIndex]?.id).toBe(targetSpreadId);
    cleanup();
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
    expect(tools).toHaveLength(SITE_TOOL_NAMES.length);

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
      .toMatch(/assetUse book-art/);
    expect(guideResult.authoringGuide.phases[0].mutationAllowed).toBe(false);
    expect(guideResult.authoringGuide.phases[1].sequence).toEqual(["handoff", "create", "verify"]);

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

    expect(modelContext.registerTool).toHaveBeenCalledTimes(SITE_TOOL_NAMES.length);
    expect(registrationSignals).toHaveLength(SITE_TOOL_NAMES.length);
    expect(registrationSignals.every((signal) => signal.aborted)).toBe(true);
    cleanup();
    expect(statuses).toEqual([false]);
  });

  it("keeps a superseded handoff isolated from the older execution signal", async () => {
    const tools: WebMCP.ModelContextTool[] = [];
    vi.stubGlobal("document", {
      modelContext: {
        registerTool: vi.fn(async (tool: WebMCP.ModelContextTool) => { tools.push(tool); }),
      },
    });
    const cleanup = registerWebMcpTools(() => undefined);
    await vi.waitFor(() => expect(tools).toHaveLength(SITE_TOOL_NAMES.length));
    const handoff = tools.find((tool) => tool.name === "request_image_handoff")!;
    const firstController = new AbortController();
    const secondController = new AbortController();

    await expect(handoff.execute({ requestId: "handoff-missing-use", reason: "Missing purpose." }, {
      signal: new AbortController().signal,
    })).rejects.toThrow("assetUse");

    const first = handoff.execute({ requestId: "handoff-a", assetUse: "source-photo", reason: "First request." }, { signal: firstController.signal });
    await vi.waitFor(() => expect(currentImageHandoff()?.requestId).toBe("handoff-a"));
    const second = handoff.execute({ requestId: "handoff-b", assetUse: "book-art", reason: "Second request." }, { signal: secondController.signal });
    expect(currentImageHandoff()?.requestId).toBe("handoff-b");

    // Abort A before its superseded execution has unwound and removed the old
    // listener. This is the exact window that used to let A cancel B.
    const firstCancellation = expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(completeImageHandoff("handoff-a", { assetIds: ["asset:from-a"], rejected: 0, failed: 0 })).toBeNull();
    firstController.abort();
    await Promise.resolve();
    expect(currentImageHandoff()?.requestId).toBe("handoff-b");
    await firstCancellation;
    expect(completeImageHandoff("handoff-b", { assetIds: ["asset:for-b"], rejected: 0, failed: 0 })).toMatchObject({ status: "provided" });
    await expect(second).resolves.toContain("asset:for-b");
    cleanup();
  });

  it("returns explicit counts when an image handoff is only partially accepted", async () => {
    const tools: WebMCP.ModelContextTool[] = [];
    vi.stubGlobal("document", {
      modelContext: {
        registerTool: vi.fn(async (tool: WebMCP.ModelContextTool) => { tools.push(tool); }),
      },
    });
    const cleanup = registerWebMcpTools(() => undefined);
    await vi.waitFor(() => expect(tools).toHaveLength(SITE_TOOL_NAMES.length));
    const handoff = tools.find((tool) => tool.name === "request_image_handoff")!;
    const pending = handoff.execute({
      requestId: "handoff-partial",
      assetUse: "book-art",
      reason: "Add a cover and two spreads.",
    }, { signal: new AbortController().signal });
    await vi.waitFor(() => expect(currentImageHandoff()?.requestId).toBe("handoff-partial"));

    expect(completeImageHandoff("handoff-partial", {
      assetIds: ["asset:cover"],
      rejected: 1,
      failed: 1,
    })).toMatchObject({ status: "partial" });
    const result = JSON.parse(String(await pending)) as Record<string, unknown>;
    expect(result).toMatchObject({
      status: "partial",
      assetIds: ["asset:cover"],
      counts: { accepted: 1, rejected: 1, failed: 1 },
      reason: expect.stringContaining("Only the returned asset ids are available"),
      note: expect.stringContaining("drawer remains open"),
    });
    cleanup();
  });

  it("settles an active handoff when its tool registration is removed", async () => {
    const tools: WebMCP.ModelContextTool[] = [];
    vi.stubGlobal("document", {
      modelContext: {
        registerTool: vi.fn(async (tool: WebMCP.ModelContextTool) => { tools.push(tool); }),
      },
    });
    const cleanup = registerWebMcpTools(() => undefined);
    await vi.waitFor(() => expect(tools).toHaveLength(SITE_TOOL_NAMES.length));
    const handoff = tools.find((tool) => tool.name === "request_image_handoff")!;
    const pending = handoff.execute({ requestId: "handoff-cleanup", assetUse: "source-photo", reason: "Wait for a photo." }, {
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => expect(currentImageHandoff()?.requestId).toBe("handoff-cleanup"));

    cleanup();
    await expect(pending).resolves.toContain("cancelled before the reader chose");
    expect(currentImageHandoff()).toBeNull();
  });
});
