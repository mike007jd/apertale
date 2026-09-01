import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookEngine } from "./bookEngine";
import { bookLifecycleLockName, BOOK_LIBRARY_MUTATION_LOCK_NAME, BOOK_LIBRARY_STORAGE_KEY } from "./bookLifecycle";
import { hasReveal, resolveInteraction } from "./interaction";
import { evaluateDeterministicQuality, QUALITY_VISUAL_CRITERION_IDS, type QualityVisualReviewSubmission } from "./qualityContract";
import { sampleBooks } from "./sampleBook";
import { listStoredPublishedAssetIds } from "./projectArtifact";
import { THEME_IDS, isProceduralElement, type CreateBookCommand, type DocumentState } from "./types";

const cityEngine = () => {
  const engine = new BookEngine();
  engine.openBook("apertale-your-story");
  return engine;
};

const readyStoryBrief = (spreadCount: number) => ({
  contractVersion: 2,
  bookType: "illustrated-storybook" as const,
  premise: "A visual explanation of a natural rhythm.",
  audience: "Curious family readers",
  spreadCount,
  visualDirection: "Tactile watercolor collage",
  sourceAssets: [],
});

type DraftSpread = { id: string; title: string; body: string; kicker?: string };

const localAssetId = (ordinal: number) => `asset:10000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function createTestLockManager() {
  const tails = new Map<string, Promise<void>>();
  return {
    request<T>(name: string, options: LockOptions, callback: () => T | PromiseLike<T>) {
      const previous = tails.get(name) ?? Promise.resolve();
      const released = deferred<void>();
      tails.set(name, previous.catch(() => undefined).then(() => released.promise));
      let started = false;
      let settled = false;
      return new Promise<T>((resolve, reject) => {
        const rejectAbort = () => {
          if (started || settled) return;
          settled = true;
          reject(new DOMException("The lock request was aborted.", "AbortError"));
        };
        options.signal?.addEventListener("abort", rejectAbort, { once: true });
        void previous.catch(() => undefined).then(async () => {
          if (settled || options.signal?.aborted) {
            rejectAbort();
            released.resolve();
            return;
          }
          started = true;
          try {
            const value = await callback();
            settled = true;
            resolve(value);
          } catch (error) {
            settled = true;
            reject(error);
          } finally {
            options.signal?.removeEventListener("abort", rejectAbort);
            released.resolve();
          }
        });
      });
    },
  } as Pick<LockManager, "request"> as LockManager;
}

const preparedBook = (
  drafts: DraftSpread[],
  options: {
    separation?: "inpainted-clean-plate" | "preserved-photo-layout";
    personalSourceAssetId?: string;
  } = {},
) => {
  let nextAsset = 1;
  const assetIds: string[] = [];
  const takeAsset = () => {
    const id = localAssetId(nextAsset++);
    assetIds.push(id);
    return id;
  };
  const coverAssetId = takeAsset();
  const separation = options.separation ?? "inpainted-clean-plate";
  const spreads = drafts.map((draft, index) => {
    const sourceAssetId = separation === "preserved-photo-layout"
      ? options.personalSourceAssetId ?? takeAsset()
      : takeAsset();
    const cleanPlateAssetId = separation === "preserved-photo-layout" ? sourceAssetId : takeAsset();
    if (options.personalSourceAssetId) assetIds.push(options.personalSourceAssetId);
    return {
      ...draft,
      background: {
        sourceAssetId,
        cleanPlateAssetId,
        personalSourceAssetId: options.personalSourceAssetId,
        separation,
      },
      layers: [{
        id: `layer-${index + 1}-left`,
        label: `Story layer ${index + 1} left`,
        assetId: takeAsset(),
        page: "left" as const,
        hover: "lift-glow" as const,
      }, {
        id: `layer-${index + 1}-right`,
        label: `Story layer ${index + 1} right`,
        assetId: takeAsset(),
        page: "right" as const,
        focus: "spotlight" as const,
      }],
    };
  });
  return { coverAssetId, spreads, validatedLocalAssetIds: [...new Set(assetIds)] };
};

const blockingVisualReview = (revision: number, expectedRound: number): QualityVisualReviewSubmission => ({
  contractVersion: 2,
  reviewedRevision: revision,
  expectedRound,
  sampleReady: false,
  summary: "The rendered draft still has material quality blockers.",
  checks: QUALITY_VISUAL_CRITERION_IDS.map((criterionId) => ({
    criterionId,
    outcome: "blocker",
    message: `${criterionId} needs revision.`,
    evidence: criterionId === "cover-appeal"
      ? [{ scope: "cover", locator: "[data-book-id] img", description: "Rendered cover" }]
      : [{ scope: "spread", spreadId: "opening", locator: ".book-scene canvas", description: "Rendered opening spread" }],
    suggestedPatch: "Replace or revise the affected asset, then render again.",
  })),
});

const recordCompleteRenderEvidence = (engine: BookEngine) => {
  const document = engine.getSnapshot().document;
  return [
    engine.recordRenderEvidence({
      documentId: document.id,
      revision: document.revision,
      scope: "cover",
      theme: "paper-atelier",
      surface: "shelf",
      locator: "[data-book-id] img",
    }),
    ...document.spreads.map((spread) => engine.recordRenderEvidence({
      documentId: document.id,
      revision: document.revision,
      scope: "spread",
      spreadId: spread.id,
      theme: "paper-atelier",
      surface: "webgl",
      locator: ".book-scene canvas",
    })),
  ];
};

describe("BookEngine document contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
      clear: () => { storage.clear(); },
    });
    vi.stubGlobal("navigator", { locks: createTestLockManager() });
  });

  it("ships a guide plus four independent sample books instead of one combined demo book", () => {
    expect(sampleBooks).toHaveLength(5);
    expect(sampleBooks.map((book) => book.id)).toEqual([
      "apertale-field-guide",
      "apertale-atlas-of-wonders",
      "apertale-how-world-works",
      "apertale-your-story",
      "apertale-lantern-garden",
    ]);
    expect(sampleBooks.map((book) => book.spreads.length)).toEqual([4, 8, 6, 5, 5]);
    expect(new Set(sampleBooks.flatMap((book) => book.spreads.map((spread) => spread.id))).size).toBe(28);
    expect(sampleBooks[1].spreads.every((spread) => spread.textureUrl?.endsWith(".png"))).toBe(true);
    expect(sampleBooks[2].spreads.every((spread) => spread.textureUrl?.endsWith(".png"))).toBe(true);
    sampleBooks.forEach((book) => {
      const spreadTextures = book.spreads.map((spread) => spread.textureUrl);
      expect(new Set(spreadTextures).size, `${book.title} should not repeat full-spread artwork`).toBe(spreadTextures.length);
    });
    sampleBooks.flatMap((book) => book.spreads).forEach((layeredShowcase) => {
      expect(layeredShowcase.artwork, layeredShowcase.title).toMatchObject({ separation: "inpainted-clean-plate" });
      const rendersGroundedComposite = layeredShowcase.textureUrl === layeredShowcase.artwork?.sourceAssetId;
      if (rendersGroundedComposite) {
        expect(layeredShowcase.elements.length, `${layeredShowcase.title} should retain semantic interactions`).toBeGreaterThanOrEqual(3);
        expect(layeredShowcase.elements.every(isProceduralElement)).toBe(true);
      } else {
        expect(
          layeredShowcase.elements.filter((element) => !isProceduralElement(element)).length,
          `${layeredShowcase.title} should ship multiple real foreground layers`,
        ).toBeGreaterThanOrEqual(2);
      }
    });
    const atlas = sampleBooks.find((book) => book.id === "apertale-atlas-of-wonders")!;
    expect(atlas.spreads.every((spread) => spread.textureUrl === spread.artwork?.sourceAssetId)).toBe(true);
    expect(atlas.spreads.every((spread) => spread.artwork?.cleanPlateAssetId !== spread.artwork?.sourceAssetId)).toBe(true);
    expect(atlas.spreads.every((spread) => spread.elements.every(isProceduralElement))).toBe(true);
    const sleepingCity = sampleBooks.find((book) => book.id === "apertale-lantern-garden")!.spreads[3];
    expect(sleepingCity.textureUrl).toBe(sleepingCity.artwork?.sourceAssetId);
    expect(sleepingCity.elements.every(isProceduralElement)).toBe(true);
  });

  it("gives every spread authored hover, focus, and click reveal without forcing idle motion", () => {
    sampleBooks.forEach((book) => {
      book.spreads.forEach((spread) => {
        expect(spread.elements.length, `${book.title} / ${spread.title}`).toBeGreaterThan(0);
        spread.elements.forEach((element) => {
          const interaction = resolveInteraction(element);
          expect(interaction.hover, `${spread.title} / ${element.label} hover`).not.toBe("none");
          expect(interaction.focus, `${spread.title} / ${element.label} focus`).not.toBe("none");
          expect(hasReveal(interaction), `${spread.title} / ${element.label} reveal`).toBe(true);
        });
      });
    });
    expect(sampleBooks[3].spreads[0].elements.find((element) => element.id === "bird")?.motion).toBeUndefined();
    const riverBoat = sampleBooks[3].spreads[1].elements.find((element) => element.id === "river-paper-boat");
    expect(riverBoat?.motion?.preset).toBe("water-bob");
    expect(riverBoat?.transform.x).toBeLessThan(0.3);
    expect(sampleBooks[3].spreads[4].elements.find((element) => element.id === "warm-window-child")?.motion).toBeUndefined();
    const storyCutouts = sampleBooks[3].spreads
      .flatMap((spread) => spread.elements)
      .filter((element) => !isProceduralElement(element));
    expect(storyCutouts).toHaveLength(15);
    expect(storyCutouts.every((element) => element.assetId.endsWith("-cutout-v3.png"))).toBe(true);
    const anchoredIds = ["pyramid-main", "great-wall-tower", "petra-treasury-facade", "chichen-pyramid", "machu-citadel", "taj-monument", "corcovado-statue", "river-hill-home", "cloud-road-towers", "garden-arched-gate", "warm-window-child"];
    const elementsById = new Map(sampleBooks.flatMap((book) => book.spreads.flatMap((item) => item.elements)).map((element) => [element.id, element]));
    anchoredIds.forEach((id) => {
      const element = elementsById.get(id);
      expect(element?.motion, `${id} should stay anchored at rest`).toBeUndefined();
      expect(element?.interaction?.focus, `${id} should not rise or orbit on focus`).toBe("spotlight");
    });
  });

  it("migrates shipped sample semantics without overwriting a reader transform", () => {
    const documents = structuredClone(sampleBooks);
    const atlas = documents.find((book) => book.id === "apertale-atlas-of-wonders")!;
    atlas.revision = 2;
    const tajSpread = atlas.spreads.find((item) => item.id === "taj-mahal")!;
    tajSpread.textureUrl = tajSpread.artwork!.cleanPlateAssetId;
    const taj = tajSpread.elements.find((element) => element.id === "taj-monument")!;
    const dome = tajSpread.elements.find((element) => element.id === "taj-dome")!;
    taj.transform.x = 0.91;
    taj.transform.scaleX = 1.5;
    taj.transform.scaleY = 1.22;
    taj.assetId = "/assets/generated/wonders-taj-mahal-monument-cutout-v2.png";
    taj.kind = "lifted";
    taj.locked = false;
    taj.interaction!.focus = "orbit-inspect";
    dome.transform.scaleX = 1;
    dome.transform.scaleY = 1;
    dome.motion = { preset: "soft-pulse", durationMs: 4200, loop: true };
    localStorage.setItem("apertale.library.v4", JSON.stringify({ activeBookId: atlas.id, documents, sampleSourceVersion: 3 }));

    const migrated = new BookEngine().getSnapshot().document;
    const migratedTajSpread = migrated.spreads.find((item) => item.id === "taj-mahal")!;
    const migratedTaj = migratedTajSpread.elements.find((element) => element.id === "taj-monument")!;
    const migratedDome = migratedTajSpread.elements.find((element) => element.id === "taj-dome")!;
    expect(migratedTaj.transform.x).toBe(0.91);
    expect(migratedTaj.transform).toMatchObject({ scaleX: 0.72, scaleY: 0.72 });
    expect(migratedTaj).toMatchObject({ kind: "decoration", locked: true, depth: 0.12 });
    expect(isProceduralElement(migratedTaj)).toBe(true);
    expect(migratedTaj.interaction?.focus).toBe("spotlight");
    expect(migratedDome.transform).toMatchObject({ scaleX: 0.72, scaleY: 0.72 });
    expect(migratedDome.motion).toBeUndefined();
  });

  it("commits one revision and returns an undo token", () => {
    const engine = cityEngine();
    const result = engine.dispatch({ type: "lift", requestId: "lift-1", expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1, elementId: "bird" }, "agent");
    expect(result.ok).toBe(true);
    expect(result.ok && result.revision).toBe(2);
    expect(result.ok && result.undoToken).toBeTruthy();
    expect(engine.getContext().selection).toBeNull();
  });

  it("returns a compact, discoverable outline and current-spread element list", () => {
    const engine = cityEngine();
    engine.openBook("apertale-atlas-of-wonders");
    const context = engine.getContext();
    expect(context.outline).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "flavian-amphitheatre", elementCount: 3 }),
      expect.objectContaining({ id: "great-pyramid-of-giza", elementCount: 4 }),
      expect.objectContaining({ id: "christ-the-redeemer", elementCount: 4 }),
    ]));
    expect(context.outline).toHaveLength(8);
    expect(context.library.books).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "apertale-atlas-of-wonders", spreadCount: 8 }),
      expect.objectContaining({ id: "apertale-how-world-works", spreadCount: 6 }),
      expect.objectContaining({ id: "apertale-your-story", spreadCount: 5 }),
      expect.objectContaining({ id: "apertale-lantern-garden", spreadCount: 5 }),
    ]));
    expect(context.currentSpread.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "colosseum-arena", label: "Arena floor" }),
      expect.objectContaining({ id: "colosseum-procession", kind: "decoration", locked: true }),
      expect.objectContaining({ id: "colosseum-cypress", kind: "decoration", locked: true }),
    ]));
    expect(context.capabilities).toContain("set-book-cover");
    expect(context.capabilities).toContain("full-spread-illustration-stage");
    expect(context.capabilities).toContain("layered-image-interaction");
    expect(context.capabilities).toContain("browser-image-optimization");
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(2400);
  });

  /**
   * Preview is the reader's view of a finished book. Every authoring control
   * hides itself there, but the canvas keeps its pointer handlers, so a drag
   * used to write a real transform into a document the reader believed they
   * were only looking at. The refusal belongs in the model, not only in the
   * chrome that happens to be hidden at the time.
   */
  it("refuses a person's direct edits while Preview is on, and keeps working for Codex", () => {
    const engine = cityEngine();
    engine.setPreview(true);

    for (const command of [
      { type: "edit" as const, requestId: "p-edit", expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1, elementId: "bird", transform: { x: 0.9 } },
      { type: "lift" as const, requestId: "p-lift", expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1, elementId: "bird" },
      { type: "animate" as const, requestId: "p-animate", expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1, elementId: "bird", motion: null },
      { type: "interact" as const, requestId: "p-interact", expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1, elementId: "bird", interaction: { focus: "spotlight" as const } },
    ]) {
      expect(engine.dispatch(command, "human")).toMatchObject({
        ok: false,
        code: "invalid",
        summary: "Preview is read-only. Exit Preview to change this book.",
      });
    }
    expect(engine.getSnapshot().document.revision).toBe(1);

    // Watching Codex work is the point of previewing, so the agent is not
    // refused - and leaving Preview restores direct manipulation.
    expect(engine.dispatch({ type: "lift", requestId: "a-lift", expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1, elementId: "bird" }, "agent").ok).toBe(true);
    engine.setPreview(false);
    expect(engine.dispatch({ type: "lift", requestId: "h-lift", expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 2, elementId: "bird" }, "human").ok).toBe(true);
  });

  it("still lets a person undo while Preview is on", () => {
    const engine = cityEngine();
    const edited = engine.dispatch({ type: "edit", requestId: "pre-edit", expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1, elementId: "bird", transform: { x: 0.8 } }, "human");
    expect(edited.ok && edited.undoToken).toBeTruthy();
    engine.setPreview(true);
    const undone = engine.dispatch({
      type: "undo",
      requestId: "preview-undo",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 2,
      undoToken: edited.ok ? edited.undoToken! : "",
    }, "human");
    expect(undone.ok).toBe(true);
  });

  it("rejects stale revisions without mutating state", () => {
    const engine = cityEngine();
    const result = engine.dispatch({ type: "lift", requestId: "stale", expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 99, elementId: "bird" }, "agent");
    expect(result).toMatchObject({ ok: false, code: "revision_conflict", currentRevision: 1 });
    expect(engine.getSnapshot().document.revision).toBe(1);
  });

  it("rejects another document at the same revision without mutating state", () => {
    const engine = cityEngine();
    const before = engine.getSnapshot().document;
    const result = engine.dispatch({
      type: "lift",
      requestId: "wrong-document-same-revision",
      expectedDocumentId: "apertale-atlas-of-wonders",
      expectedRevision: before.revision,
      elementId: "bird",
    }, "agent");

    expect(result).toMatchObject({ ok: false, code: "revision_conflict", currentRevision: before.revision });
    expect(engine.getSnapshot().document).toEqual(before);
  });

  it("is idempotent by requestId", () => {
    const engine = cityEngine();
    const command = { type: "lift" as const, requestId: "same", expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1, elementId: "bird" };
    const first = engine.dispatch(command, "agent");
    const second = engine.dispatch(command, "agent");
    expect(second).toEqual(first);
    expect(engine.getSnapshot().document.revision).toBe(2);
  });

  it("keeps presentation theme outside document revision", () => {
    const engine = cityEngine();
    engine.setTheme("midnight-desk", "agent");
    expect(engine.getSnapshot().session.sceneThemeId).toBe("midnight-desk");
    expect(engine.getSnapshot().document.revision).toBe(1);
  });

  it("keeps Agent book and Preview actions visibly attributed until their own timeout", () => {
    const engine = cityEngine();
    engine.openBook("apertale-atlas-of-wonders", "agent");
    expect(engine.getSnapshot().lastAction).toMatchObject({ source: "agent", summary: "Codex opened Atlas of Living Wonders" });

    vi.advanceTimersByTime(1600);
    engine.setPreview(true, "agent");
    expect(engine.getSnapshot().lastAction).toMatchObject({ source: "agent", summary: "Codex entered Preview" });

    vi.advanceTimersByTime(1600);
    expect(engine.getSnapshot().lastAction).toMatchObject({ summary: "Codex entered Preview" });
    vi.advanceTimersByTime(1600);
    expect(engine.getSnapshot().lastAction).toBeNull();
  });

  it("undoes motion while preserving a later transform", () => {
    const engine = cityEngine();
    const animated = engine.dispatch({
      type: "animate",
      requestId: "animate-1",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      elementId: "bird",
      motion: { preset: "fly-across", durationMs: 5200, loop: true },
    }, "agent");
    expect(animated.ok).toBe(true);
    engine.dispatch({ type: "edit", requestId: "move-1", expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 2, elementId: "bird", transform: { x: 0.76 } }, "human");
    const undone = engine.dispatch({
      type: "undo",
      requestId: "undo-1",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 3,
      undoToken: animated.ok ? animated.undoToken : "",
    }, "agent");
    expect(undone.ok).toBe(true);
    const bird = engine.getSnapshot().document.spreads[0].elements[0];
    expect(bird.motion).toBeUndefined();
    expect(bird.transform.x).toBe(0.76);
    expect(engine.getSnapshot().document.revision).toBe(4);
  });

  it("undoes composed text while preserving a later element transform", () => {
    const engine = cityEngine();
    const originalBody = engine.getSnapshot().document.spreads[0].body;
    const composed = engine.dispatch({
      type: "compose-spread",
      requestId: "compose-city",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      spreadId: "city-for-small-things",
      body: "A clockwork city wakes beneath the paper clouds.",
    }, "agent");
    expect(composed.ok).toBe(true);

    engine.dispatch({
      type: "edit",
      requestId: "move-after-compose",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 2,
      elementId: "bird",
      transform: { x: 0.77 },
    }, "human");
    const undone = engine.dispatch({
      type: "undo",
      requestId: "undo-compose-after-move",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 3,
      undoToken: composed.ok ? composed.undoToken : "",
    }, "human");

    expect(undone.ok).toBe(true);
    expect(engine.getSnapshot().document.spreads[0].body).toBe(originalBody);
    expect(engine.getSnapshot().document.spreads[0].elements[0].transform.x).toBe(0.77);
  });

  it("stores an authored interaction response and undoes exactly that field", () => {
    const engine = cityEngine();
    const retuned = engine.dispatch({
      type: "interact",
      requestId: "interact-1",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      elementId: "bird",
      interaction: { focus: "rise-and-center" },
    }, "agent");
    expect(retuned.ok).toBe(true);
    const landmark = () => engine.getSnapshot().document.spreads[0].elements[0];
    expect(landmark().interaction?.focus).toBe("rise-and-center");
    expect(landmark().interaction?.hover).toBe("lift-glow");
    engine.dispatch({ type: "edit", requestId: "move-landmark", expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 2, elementId: "bird", transform: { x: 0.44 } }, "human");
    const undone = engine.dispatch({
      type: "undo",
      requestId: "undo-interact",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 3,
      undoToken: retuned.ok ? retuned.undoToken : "",
    }, "human");
    expect(undone.ok).toBe(true);
    expect(landmark().interaction?.focus).toBe("spotlight");
    expect(landmark().transform.x).toBe(0.44);
  });

  it("reports the resolved interaction of the selection to the Agent", () => {
    const engine = cityEngine();
    engine.setSelection("bird");
    expect(engine.getContext().selection).toMatchObject({
      id: "bird",
      interaction: { hover: "lift-glow", focus: "spotlight", reveal: "caption" },
    });
  });

  it("returns a usable token that can undo an undo", () => {
    const engine = cityEngine();
    const lifted = engine.dispatch({ type: "lift", requestId: "lift-redo", expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1, elementId: "bird" }, "human");
    expect(lifted.ok).toBe(true);
    const undone = engine.dispatch({
      type: "undo",
      requestId: "undo-redo",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 2,
      undoToken: lifted.ok ? lifted.undoToken : "",
    }, "human");
    expect(undone.ok).toBe(true);
    const redone = engine.dispatch({
      type: "undo",
      requestId: "redo",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 3,
      undoToken: undone.ok ? undone.undoToken : "",
    }, "human");
    expect(redone.ok).toBe(true);
    expect(engine.getSnapshot().document.spreads[0].elements[0].kind).toBe("lifted");
  });

  it("rejects an undo when a later command changed the same field", () => {
    const engine = cityEngine();
    const first = engine.dispatch({
      type: "edit",
      requestId: "first-transform",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      elementId: "bird",
      transform: { x: 0.7 },
    }, "human");
    expect(first.ok).toBe(true);
    engine.dispatch({
      type: "edit",
      requestId: "agent-transform",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 2,
      elementId: "bird",
      transform: { x: 0.82 },
    }, "agent");
    const result = engine.dispatch({
      type: "undo",
      requestId: "conflicting-undo",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 3,
      undoToken: first.ok ? first.undoToken : "",
    }, "human");
    expect(result).toMatchObject({ ok: false, code: "undo_conflict", currentRevision: 3 });
    expect(engine.getSnapshot().document.spreads[0].elements[0].transform.x).toBe(0.82);
  });

  it("allows an Agent undo token to be used by the human history", () => {
    const engine = cityEngine();
    const agentLift = engine.dispatch({ type: "lift", requestId: "agent-lift", expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1, elementId: "bird" }, "agent");
    expect(agentLift.ok).toBe(true);
    const humanUndo = engine.dispatch({
      type: "undo",
      requestId: "human-undo-agent",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 2,
      undoToken: agentLift.ok ? agentLift.undoToken : "",
    }, "human");
    expect(humanUndo.ok).toBe(true);
    expect(engine.getSnapshot().document.spreads[0].elements[0].kind).toBe("embedded");
  });

  it("never applies an undo token to a different active book", () => {
    const engine = cityEngine();
    const sharedCover = localAssetId(90);
    const firstCover = engine.dispatch({
      type: "set-book-cover",
      requestId: "cover-book-a",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      assetId: sharedCover,
      validatedLocalAssetIds: [sharedCover],
    }, "agent");
    expect(firstCover.ok).toBe(true);

    engine.openBook("apertale-atlas-of-wonders");
    const secondCover = engine.dispatch({
      type: "set-book-cover",
      requestId: "cover-book-b",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      assetId: sharedCover,
      validatedLocalAssetIds: [sharedCover],
    }, "agent");
    expect(secondCover.ok).toBe(true);
    const beforeWrongBookUndo = structuredClone(engine.getSnapshot().document);

    const rejected = engine.dispatch({
      type: "undo",
      requestId: "wrong-book-undo",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: beforeWrongBookUndo.revision,
      undoToken: firstCover.ok ? firstCover.undoToken : "",
    }, "agent");

    expect(rejected).toMatchObject({ ok: false, code: "undo_conflict", summary: expect.stringMatching(/another book/i) });
    expect(engine.getSnapshot().document).toEqual(beforeWrongBookUndo);
  });

  it("creates and composes a book through reversible structural commands", () => {
    const engine = new BookEngine();
    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-book",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-how-tides-move",
      title: "How Tides Move",
      ...preparedBook([
        { id: "moon-pulls", title: "The Moon Pulls", body: "Gravity reaches across the water." },
        { id: "coast-responds", title: "The Coast Responds", body: "The coast makes the rhythm visible." },
      ]),
      creationBrief: readyStoryBrief(2),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created.ok).toBe(true);
    expect(engine.getSnapshot().document).toMatchObject({
      title: "How Tides Move",
      coverAssetId: expect.stringMatching(/^asset:/),
      spreads: [
        { id: "moon-pulls", artwork: { cleanPlateAssetId: expect.stringMatching(/^asset:/) }, elements: [{ id: "layer-1-left" }, { id: "layer-1-right" }] },
        { id: "coast-responds", artwork: { cleanPlateAssetId: expect.stringMatching(/^asset:/) }, elements: [{ id: "layer-2-left" }, { id: "layer-2-right" }] },
      ],
    });

    const composed = engine.dispatch({
      type: "compose-spread",
      requestId: "compose-spread",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 2,
      spreadId: "moon-pulls",
      body: "The Moon's gravity pulls the ocean into two broad bulges.",
    }, "agent");
    expect(composed.ok).toBe(true);
    expect(engine.getSnapshot().document.spreads[0].body).toContain("two broad bulges");

    const undone = engine.dispatch({
      type: "undo",
      requestId: "undo-compose",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 3,
      undoToken: composed.ok ? composed.undoToken : "",
    }, "agent");
    expect(undone.ok).toBe(true);
    expect(engine.getSnapshot().document.spreads[0].body).toBe("Gravity reaches across the water.");
  });

  it("creates an authored frame sequence whose assetId is its resting frame", () => {
    const engine = new BookEngine();
    const prepared = preparedBook([{ id: "storm", title: "Storm", body: "The cloud gathers charge." }]);
    const spreads = prepared.spreads as CreateBookCommand["spreads"];
    const restingAssetId = spreads[0].layers![0].assetId;
    const flashAssetId = localAssetId(90);
    spreads[0].layers![0].frameAssetIds = [restingAssetId, flashAssetId, restingAssetId];
    prepared.validatedLocalAssetIds.push(flashAssetId);

    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-frame-sequence",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-frame-sequence",
      title: "A Small Storm",
      coverAssetId: prepared.coverAssetId,
      spreads,
      validatedLocalAssetIds: prepared.validatedLocalAssetIds,
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");

    expect(created.ok).toBe(true);
    expect(engine.getSnapshot().document.spreads[0].elements[0]).toMatchObject({
      assetId: restingAssetId,
      frameAssetIds: [restingAssetId, flashAssetId, restingAssetId],
    });
  });

  it("undoes and redoes book creation together with its shelf membership", () => {
    const engine = new BookEngine();
    const startingBookId = engine.getSnapshot().document.id;
    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-shelf-book",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-cloud-atlas",
      title: "Cloud Atlas",
      ...preparedBook([{ id: "cloud-shapes", title: "Cloud Shapes", body: "A field guide to the sky." }]),
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created.ok).toBe(true);
    expect(engine.getLibrary().books.some((book) => book.id === "book-cloud-atlas")).toBe(true);

    const undone = engine.dispatch({
      type: "undo",
      requestId: "undo-create-shelf-book",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 2,
      undoToken: created.ok ? created.undoToken : "",
    }, "agent");
    expect(undone.ok).toBe(true);
    expect(engine.getSnapshot().document.id).toBe(startingBookId);
    expect(engine.getLibrary().books.some((book) => book.id === "book-cloud-atlas")).toBe(false);

    const redone = engine.dispatch({
      type: "undo",
      requestId: "redo-create-shelf-book",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: engine.getSnapshot().document.revision,
      undoToken: undone.ok ? undone.undoToken : "",
    }, "agent");
    expect(redone.ok).toBe(true);
    expect(engine.getSnapshot().document.id).toBe("book-cloud-atlas");
    expect(engine.getLibrary().books.some((book) => book.id === "book-cloud-atlas")).toBe(true);
  });

  it("deletes a personal book under the coordinated library lifecycle and returns to the guide", async () => {
    const engine = new BookEngine();
    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-book-to-delete",
      expectedDocumentId: engine.getSnapshot().document.id,
      expectedRevision: engine.getSnapshot().document.revision,
      documentId: "book-to-delete",
      title: "A Temporary Bear",
      ...preparedBook([{ id: "opening", title: "Opening", body: "A book that can be removed." }]),
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created).toMatchObject({ ok: true });

    await expect(engine.removeBookCoordinated("book-to-delete")).resolves.toMatchObject({
      ok: true,
      nextBookId: "apertale-field-guide",
    });
    expect(engine.getSnapshot().document.id).toBe("apertale-field-guide");
    expect(engine.getLibrary().books.some((book) => book.id === "book-to-delete")).toBe(false);
    expect(new BookEngine().getLibrary().books.some((book) => book.id === "book-to-delete")).toBe(false);
  });

  it("keeps curated and published personal books when deletion is not safe", async () => {
    const engine = new BookEngine();
    await expect(engine.removeBookCoordinated("apertale-field-guide")).resolves.toMatchObject({
      ok: false,
      code: "sample_book",
    });

    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-published-book-to-keep",
      expectedDocumentId: engine.getSnapshot().document.id,
      expectedRevision: engine.getSnapshot().document.revision,
      documentId: "published-book-to-keep",
      title: "Shared Bear",
      ...preparedBook([{ id: "opening", title: "Opening", body: "A shared book must not be orphaned." }]),
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created).toMatchObject({ ok: true });
    localStorage.setItem("apertale.publication.v1:published-book-to-keep", JSON.stringify({
      documentId: "published-book-to-keep",
      bookId: "123e4567-e89b-42d3-a456-426614174099",
      manageToken: "p".repeat(43),
      status: "draft",
      uploadedAssetIds: [],
      attemptAssetIds: [],
    }));

    await expect(engine.removeBookCoordinated("published-book-to-keep")).resolves.toMatchObject({
      ok: false,
      code: "publication_exists",
    });
    expect(engine.getLibrary().books.some((book) => book.id === "published-book-to-keep")).toBe(true);
  });

  it("rolls a failed delete back to the latest durable cross-tab library", async () => {
    const owner = new BookEngine();
    const target = owner.dispatch({
      type: "create-book",
      requestId: "create-stale-delete-target",
      expectedDocumentId: owner.getSnapshot().document.id,
      expectedRevision: owner.getSnapshot().document.revision,
      documentId: "stale-delete-target",
      title: "Stale Delete Target",
      ...preparedBook([{ id: "opening", title: "Opening", body: "The deletion target." }]),
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(target).toMatchObject({ ok: true });
    const deletingTab = new BookEngine();

    const otherTab = new BookEngine();
    const concurrent = otherTab.dispatch({
      type: "create-book",
      requestId: "create-concurrent-book-before-delete-failure",
      expectedDocumentId: otherTab.getSnapshot().document.id,
      expectedRevision: otherTab.getSnapshot().document.revision,
      documentId: "concurrent-book-before-delete-failure",
      title: "Concurrent Book",
      ...preparedBook([{ id: "opening", title: "Opening", body: "This book must survive rollback." }]),
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(concurrent).toMatchObject({ ok: true });

    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    await expect(deletingTab.removeBookCoordinated("stale-delete-target")).resolves.toMatchObject({
      ok: false,
      code: "coordination_unavailable",
    });
    expect(deletingTab.getLibrary().books.some((book) => book.id === "stale-delete-target")).toBe(true);
    expect(deletingTab.getLibrary().books.some((book) => book.id === "concurrent-book-before-delete-failure")).toBe(true);
  });

  it("fails closed when the browser cannot coordinate saved library writes", async () => {
    vi.stubGlobal("navigator", {});
    const engine = new BookEngine();
    const command: CreateBookCommand = {
      type: "create-book",
      requestId: "create-without-locks",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-without-locks",
      title: "No Unsafe Write",
      ...preparedBook([{ id: "opening", title: "Opening", body: "A coordinated book." }]),
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    };

    await expect(engine.dispatchCoordinated(command, "agent")).resolves.toMatchObject({
      ok: false,
      code: "invalid",
      summary: expect.stringMatching(/cannot safely coordinate/i),
    });
    expect(engine.getLibrary().books.some((book) => book.id === command.documentId)).toBe(false);
  });

  it("serializes concurrent cross-tab creates without losing either book", async () => {
    const firstTab = new BookEngine();
    const secondTab = new BookEngine();
    const makeCommand = (engine: BookEngine, documentId: string): CreateBookCommand => ({
      type: "create-book",
      requestId: `create-${documentId}`,
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId,
      title: documentId,
      ...preparedBook([{ id: "opening", title: "Opening", body: "A complete coordinated book." }]),
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    });

    const [first, second] = await Promise.all([
      firstTab.dispatchCoordinated(makeCommand(firstTab, "book-concurrent-first"), "agent"),
      secondTab.dispatchCoordinated(makeCommand(secondTab, "book-concurrent-second"), "agent"),
    ]);

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    const durableIds = new BookEngine().getLibrary().books.map((book) => book.id);
    expect(durableIds).toEqual(expect.arrayContaining(["book-concurrent-first", "book-concurrent-second"]));
  });

  it("opens another book from a stale tab without overwriting the latest durable edit", async () => {
    const firstTab = new BookEngine();
    firstTab.reset();
    const staleTab = new BookEngine();
    const editedElement = firstTab.getSnapshot().document.spreads[0].elements[0];
    const editedX = editedElement.transform.x === 0.79 ? 0.71 : 0.79;
    await expect(firstTab.dispatchCoordinated({
      type: "edit",
      requestId: "cross-tab-edit-before-navigation",
      expectedDocumentId: firstTab.getSnapshot().document.id, expectedRevision: firstTab.getSnapshot().document.revision,
      elementId: editedElement.id,
      transform: { x: editedX },
    }, "human")).resolves.toMatchObject({ ok: true });

    await expect(staleTab.openBookCoordinated("apertale-atlas-of-wonders")).resolves.toEqual({ ok: true });
    expect(staleTab.getSnapshot().document.id).toBe("apertale-atlas-of-wonders");
    const verification = new BookEngine();
    expect(verification.openBook(firstTab.getSnapshot().document.id)).toBe(true);
    expect(verification.getSnapshot().document.spreads[0].elements[0].transform.x).toBe(editedX);
  });

  it("refreshes the current book atomically when a stale tab opens it again", async () => {
    const liveTab = new BookEngine();
    liveTab.reset();
    const staleTab = new BookEngine();
    const editedElement = liveTab.getSnapshot().document.spreads[0].elements[0];
    const editedX = editedElement.transform.x === 0.68 ? 0.62 : 0.68;
    await expect(liveTab.dispatchCoordinated({
      type: "edit",
      requestId: "cross-tab-edit-before-current-refresh",
      expectedDocumentId: liveTab.getSnapshot().document.id, expectedRevision: liveTab.getSnapshot().document.revision,
      elementId: editedElement.id,
      transform: { x: editedX },
    }, "human")).resolves.toMatchObject({ ok: true });

    await expect(staleTab.openBookCoordinated(staleTab.getSnapshot().document.id)).resolves.toEqual({ ok: true });
    expect(staleTab.getSnapshot().document.spreads[0].elements[0].transform.x).toBe(editedX);
  });

  it("refuses exact-context navigation after another tab advances the source revision", async () => {
    const liveTab = new BookEngine();
    liveTab.reset();
    const staleTab = new BookEngine();
    const expected = staleTab.getSnapshot().document;
    const editedElement = liveTab.getSnapshot().document.spreads[0].elements[0];
    const editedX = editedElement.transform.x === 0.74 ? 0.69 : 0.74;
    await expect(liveTab.dispatchCoordinated({
      type: "edit",
      requestId: "cross-tab-edit-before-exact-navigation",
      expectedDocumentId: expected.id,
      expectedRevision: expected.revision,
      elementId: editedElement.id,
      transform: { x: editedX },
    }, "human")).resolves.toMatchObject({ ok: true });

    await expect(staleTab.openBookCoordinated("apertale-atlas-of-wonders", "agent", undefined, {
      documentId: expected.id,
      revision: expected.revision,
    })).resolves.toMatchObject({
      ok: false,
      code: "revision_conflict",
      currentRevision: expected.revision + 1,
    });
    expect(staleTab.getSnapshot().document).toEqual(expected);
    const verification = new BookEngine();
    expect(verification.getSnapshot().document.spreads[0].elements[0].transform.x).toBe(editedX);
  });

  it("leaves its observable and internal book state untouched when coordinated navigation misses", async () => {
    const liveTab = new BookEngine();
    liveTab.reset();
    const staleTab = new BookEngine();
    const before = staleTab.getSnapshot();
    const editedElement = liveTab.getSnapshot().document.spreads[0].elements[0];
    await expect(liveTab.dispatchCoordinated({
      type: "edit",
      requestId: "cross-tab-edit-before-missing-navigation",
      expectedDocumentId: liveTab.getSnapshot().document.id, expectedRevision: liveTab.getSnapshot().document.revision,
      elementId: editedElement.id,
      transform: { x: editedElement.transform.x === 0.73 ? 0.67 : 0.73 },
    }, "human")).resolves.toMatchObject({ ok: true });

    await expect(staleTab.openBookCoordinated("missing-book")).resolves.toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(staleTab.getSnapshot()).toEqual(before);
    expect(staleTab.getLibrary().activeBookId).toBe(before.document.id);
  });

  it("does not commit a coordinated create that is aborted while waiting for the library lock", async () => {
    const held = deferred<void>();
    const started = deferred<void>();
    const holding = navigator.locks.request(BOOK_LIBRARY_MUTATION_LOCK_NAME, { mode: "exclusive" }, async () => {
      started.resolve();
      await held.promise;
    });
    await started.promise;
    const engine = new BookEngine();
    const controller = new AbortController();
    const pending = engine.dispatchCoordinated({
      type: "create-book",
      requestId: "create-aborted-while-queued",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-aborted-while-queued",
      title: "Canceled Book",
      ...preparedBook([{ id: "opening", title: "Opening", body: "This should never commit." }]),
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent", controller.signal);

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    held.resolve();
    await holding;
    expect(new BookEngine().getLibrary().books.some((book) => book.id === "book-aborted-while-queued")).toBe(false);
  });

  it("propagates callback failures after a coordinated mutation instead of reporting a false lock conflict", async () => {
    const engine = new BookEngine();
    engine.reset();
    const element = engine.getSnapshot().document.spreads[0].elements[0];
    const editedX = element.transform.x === 0.66 ? 0.61 : 0.66;
    const startingRevision = engine.getSnapshot().document.revision;
    const unsubscribe = engine.subscribe(() => {
      if (engine.getSnapshot().document.revision > startingRevision) throw new Error("subscriber failed");
    });

    await expect(engine.dispatchCoordinated({
      type: "edit",
      requestId: "propagate-coordinated-callback-failure",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: engine.getSnapshot().document.revision,
      elementId: element.id,
      transform: { x: editedX },
    }, "human")).rejects.toThrow("subscriber failed");
    unsubscribe();

    const durable = JSON.parse(localStorage.getItem(BOOK_LIBRARY_STORAGE_KEY) ?? "null") as {
      documents: DocumentState[];
    };
    const durableDocument = durable.documents.find((document) => document.id === engine.getSnapshot().document.id);
    const durableElement = durableDocument?.spreads.flatMap((spread) => spread.elements).find((item) => item.id === element.id);
    expect(durableElement?.transform.x).toBe(editedX);
  });

  it("waits for the shared publication lifecycle lock before undoing book creation", async () => {
    const engine = new BookEngine();
    const documentId = "book-undo-shared-lifecycle-lock";
    const created = await engine.dispatchCoordinated({
      type: "create-book",
      requestId: "create-before-shared-lifecycle-lock",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId,
      title: "Lifecycle Locked Book",
      ...preparedBook([{ id: "opening", title: "Opening", body: "Publication and removal share one lock." }]),
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created).toMatchObject({ ok: true });
    const held = deferred<void>();
    const started = deferred<void>();
    const holding = navigator.locks.request(bookLifecycleLockName(documentId), { mode: "exclusive" }, async () => {
      started.resolve();
      await held.promise;
    });
    await started.promise;

    let settled = false;
    const undoing = engine.dispatchCoordinated({
      type: "undo",
      requestId: "undo-waits-for-publication-lock",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: created.ok ? created.revision : 0,
      undoToken: created.ok ? created.undoToken : "",
    }, "agent").finally(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(new BookEngine().getLibrary().books.some((book) => book.id === documentId)).toBe(true);

    held.resolve();
    await holding;
    await expect(undoing).resolves.toMatchObject({ ok: true });
    expect(new BookEngine().getLibrary().books.some((book) => book.id === documentId)).toBe(false);
  });

  it("restores the latest library version of the previous book after creation undo", () => {
    const engine = new BookEngine();
    const previousId = engine.getSnapshot().document.id;
    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-before-editing-previous",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: engine.getSnapshot().document.revision,
      documentId: "book-temporary-creation",
      title: "Temporary Creation",
      ...preparedBook([{ id: "temporary", title: "Temporary", body: "This book can be undone." }]),
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created.ok).toBe(true);

    engine.openBook(previousId);
    const previousElement = engine.getSnapshot().document.spreads[0].elements[0];
    const editedX = previousElement.transform.x === 0.83 ? 0.74 : 0.83;
    const edited = engine.dispatch({
      type: "edit",
      requestId: "edit-previous-after-create",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: engine.getSnapshot().document.revision,
      elementId: previousElement.id,
      transform: { x: editedX },
    }, "human");
    expect(edited.ok).toBe(true);
    const latestPrevious = structuredClone(engine.getSnapshot().document);

    engine.openBook("book-temporary-creation");
    const undone = engine.dispatch({
      type: "undo",
      requestId: "undo-create-after-previous-edit",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: engine.getSnapshot().document.revision,
      undoToken: created.ok ? created.undoToken : "",
    }, "agent");

    expect(undone.ok).toBe(true);
    expect(engine.getSnapshot().document).toEqual(latestPrevious);
    expect(engine.getLibrary().books.find((book) => book.id === previousId)?.revision).toBe(latestPrevious.revision);
  });

  it("refuses to orphan publication state when creation is undone", () => {
    const engine = new BookEngine();
    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-before-publication",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: engine.getSnapshot().document.revision,
      documentId: "book-with-publication-state",
      title: "Published Creation",
      ...preparedBook([{ id: "published", title: "Published", body: "This book has external state." }]),
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created.ok).toBe(true);
    localStorage.setItem("apertale.publication.v1:book-with-publication-state", JSON.stringify({
      documentId: "book-with-publication-state",
      bookId: "123e4567-e89b-42d3-a456-426614174000",
      manageToken: "m".repeat(43),
      status: "publishing",
      uploadedAssetIds: [],
    }));
    const beforeUndo = structuredClone(engine.getSnapshot().document);

    const rejected = engine.dispatch({
      type: "undo",
      requestId: "undo-create-with-publication",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: beforeUndo.revision,
      undoToken: created.ok ? created.undoToken : "",
    }, "agent");

    expect(rejected).toMatchObject({ ok: false, code: "undo_conflict", summary: expect.stringMatching(/publication record/i) });
    expect(engine.getSnapshot().document).toEqual(beforeUndo);
    expect(engine.getLibrary().books.some((book) => book.id === beforeUndo.id)).toBe(true);
  });

  it("restores a created book when another tab publishes between the undo checks", () => {
    const engine = new BookEngine();
    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-before-cross-tab-publication",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: engine.getSnapshot().document.revision,
      documentId: "book-cross-tab-publication",
      title: "Cross-tab Publication",
      ...preparedBook([{ id: "opening", title: "Opening", body: "This book must never become an orphaned share." }]),
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created).toMatchObject({ ok: true });
    const originalSetItem = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, "setItem").mockImplementation((key: string, value: string) => {
      originalSetItem(key, value);
      if (key !== "apertale.library.v4") return;
      const persisted = JSON.parse(value) as { documents?: Array<{ id?: string }> };
      if (persisted.documents?.some((document) => document.id === "book-cross-tab-publication")) return;
      originalSetItem("apertale.publication.v1:book-cross-tab-publication", JSON.stringify({
        documentId: "book-cross-tab-publication",
        bookId: "123e4567-e89b-42d3-a456-426614174001",
        manageToken: "n".repeat(43),
        status: "draft",
        uploadedAssetIds: [],
        attemptAssetIds: [],
      }));
    });

    const rejected = engine.dispatch({
      type: "undo",
      requestId: "undo-during-cross-tab-publication",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: created.ok ? created.revision : 0,
      undoToken: created.ok ? created.undoToken : "",
    }, "agent");

    expect(rejected).toMatchObject({
      ok: false,
      code: "undo_conflict",
      summary: expect.stringMatching(/publishing began in another tab/i),
    });
    expect(engine.getSnapshot().document.id).toBe("book-cross-tab-publication");
    expect(engine.getLibrary().books.some((book) => book.id === "book-cross-tab-publication")).toBe(true);
  });

  it("refuses a cover undo that would make the restored cover a foreground asset", () => {
    const engine = new BookEngine();
    const prepared = preparedBook([{ id: "opening", title: "Opening", body: "A complete scene." }]);
    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-before-cover-undo-contract",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-cover-undo-contract",
      title: "Cover Undo Contract",
      ...prepared,
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created).toMatchObject({ ok: true });
    const originalCoverAssetId = prepared.coverAssetId;
    const replacementCoverAssetId = localAssetId(20);
    const changedCover = engine.dispatch({
      type: "set-book-cover",
      requestId: "change-cover-before-conflicting-layer",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: created.ok ? created.revision : 0,
      assetId: replacementCoverAssetId,
      validatedLocalAssetIds: [replacementCoverAssetId],
    }, "agent");
    expect(changedCover).toMatchObject({ ok: true });
    const added = engine.dispatch({
      type: "scene-patch",
      requestId: "reuse-old-cover-as-layer",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: changedCover.ok ? changedCover.revision : 0,
      spreadId: "opening",
      operations: [{
        op: "add",
        id: "former-cover-layer",
        label: "Former cover layer",
        assetId: originalCoverAssetId,
        page: "left",
        hover: "lift-glow",
      }],
      validatedLocalAssetIds: [originalCoverAssetId],
    }, "agent");
    expect(added).toMatchObject({ ok: true });
    const beforeUndo = structuredClone(engine.getSnapshot().document);

    const rejected = engine.dispatch({
      type: "undo",
      requestId: "reject-conflicting-cover-undo",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: added.ok ? added.revision : 0,
      undoToken: changedCover.ok ? changedCover.undoToken : "",
    }, "agent");

    expect(rejected).toMatchObject({ ok: false, code: "undo_conflict", summary: expect.stringMatching(/cover as a foreground/i) });
    expect(engine.getSnapshot().document).toEqual(beforeUndo);
  });

  it("allows an unrelated cover undo on a legacy book whose duplicate layer ids do not worsen", () => {
    const firstSpread = structuredClone(sampleBooks[0].spreads[0]);
    const secondSpread = structuredClone(firstSpread);
    firstSpread.id = "opening";
    firstSpread.order = 0;
    secondSpread.id = "ending";
    secondSpread.order = 1;
    const legacyDocument: DocumentState = {
      id: "legacy-duplicate-layer-ids",
      revision: 5,
      title: "Legacy Duplicate Layer Ids",
      coverTextureUrl: "/assets/covers/the-field-guide-v2.png",
      spreads: [firstSpread, secondSpread],
    };
    localStorage.setItem("apertale.library.v4", JSON.stringify({
      activeBookId: legacyDocument.id,
      documents: [legacyDocument],
      sampleSourceVersion: 4,
    }));
    const engine = new BookEngine();
    const replacementCoverAssetId = localAssetId(20);
    const changed = engine.dispatch({
      type: "set-book-cover",
      requestId: "change-legacy-duplicate-cover",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 5,
      assetId: replacementCoverAssetId,
      validatedLocalAssetIds: [replacementCoverAssetId],
    }, "agent");
    expect(changed).toMatchObject({ ok: true });

    const restored = engine.dispatch({
      type: "undo",
      requestId: "restore-legacy-duplicate-cover",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: changed.ok ? changed.revision : 0,
      undoToken: changed.ok ? changed.undoToken : "",
    }, "agent");

    expect(restored).toMatchObject({ ok: true });
    expect(engine.getSnapshot().document.coverAssetId).toBeUndefined();
  });

  it("refuses a scene undo that would exceed the current asset quota", () => {
    const engine = new BookEngine();
    const prepared = preparedBook(Array.from({ length: 12 }, (_, index) => ({
      id: `spread-${index + 1}`,
      title: `Spread ${index + 1}`,
      body: "A complete scene.",
    })));
    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-before-quota-undo",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-quota-undo",
      title: "Quota Undo",
      ...prepared,
      creationBrief: readyStoryBrief(12),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created).toMatchObject({ ok: true });
    const capacityAssets = Array.from({ length: 13 }, (_, index) => localAssetId(50 + index));
    engine.setSpread(1);
    const filled = engine.dispatch({
      type: "scene-patch",
      requestId: "fill-quota-before-undo",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: created.ok ? created.revision : 0,
      spreadId: "spread-2",
      operations: capacityAssets.map((assetId, index) => ({
        op: "add" as const,
        id: `capacity-${index + 1}`,
        label: `Capacity ${index + 1}`,
        assetId,
        page: index % 2 === 0 ? "left" as const : "right" as const,
        hover: "lift-glow" as const,
      })),
      validatedLocalAssetIds: capacityAssets,
    }, "agent");
    expect(filled).toMatchObject({ ok: true });
    const removedElementId = prepared.spreads[1].layers[0].id;
    const removed = engine.dispatch({
      type: "scene-patch",
      requestId: "remove-before-quota-undo",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: filled.ok ? filled.revision : 0,
      spreadId: "spread-2",
      operations: [{ op: "remove", elementId: removedElementId }],
    }, "agent");
    expect(removed).toMatchObject({ ok: true });
    const asset51 = localAssetId(63);
    engine.setSpread(0);
    const replaced = engine.dispatch({
      type: "scene-patch",
      requestId: "replace-capacity-before-undo",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: removed.ok ? removed.revision : 0,
      spreadId: "spread-1",
      operations: [{ op: "add", id: "asset-fifty-one", label: "Asset fifty one", assetId: asset51, page: "left", focus: "spotlight" }],
      validatedLocalAssetIds: [asset51],
    }, "agent");
    expect(replaced).toMatchObject({ ok: true });
    const beforeUndo = structuredClone(engine.getSnapshot().document);

    const rejected = engine.dispatch({
      type: "undo",
      requestId: "reject-over-quota-undo",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: replaced.ok ? replaced.revision : 0,
      undoToken: removed.ok ? removed.undoToken : "",
    }, "agent");

    expect(rejected).toMatchObject({ ok: false, code: "undo_conflict", summary: expect.stringMatching(/51 local images/i) });
    expect(engine.getSnapshot().document).toEqual(beforeUndo);
  });

  it("refuses a scene undo that would duplicate a layer id reused on another spread", () => {
    const engine = new BookEngine();
    const prepared = preparedBook([
      { id: "opening", title: "Opening", body: "The first scene." },
      { id: "ending", title: "Ending", body: "The second scene." },
    ]);
    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-before-cross-spread-id-undo",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-cross-spread-id-undo",
      title: "Cross-spread Id Undo",
      ...prepared,
      creationBrief: readyStoryBrief(2),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created).toMatchObject({ ok: true });

    const bufferAssetId = localAssetId(10);
    const buffered = engine.dispatch({
      type: "scene-patch",
      requestId: "buffer-first-spread-before-remove",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: created.ok ? created.revision : 0,
      spreadId: "opening",
      operations: [{
        op: "add",
        id: "opening-buffer",
        label: "Opening buffer",
        assetId: bufferAssetId,
        page: "left",
        hover: "lift-glow",
      }],
      validatedLocalAssetIds: [bufferAssetId],
    }, "agent");
    expect(buffered).toMatchObject({ ok: true });

    const reusedElementId = prepared.spreads[0].layers[0].id;
    const removed = engine.dispatch({
      type: "scene-patch",
      requestId: "remove-before-cross-spread-id-reuse",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: buffered.ok ? buffered.revision : 0,
      spreadId: "opening",
      operations: [{ op: "remove", elementId: reusedElementId }],
    }, "agent");
    expect(removed).toMatchObject({ ok: true });

    const reusedAssetId = localAssetId(11);
    engine.setSpread(1);
    const reused = engine.dispatch({
      type: "scene-patch",
      requestId: "reuse-id-on-second-spread",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: removed.ok ? removed.revision : 0,
      spreadId: "ending",
      operations: [{
        op: "add",
        id: reusedElementId,
        label: "Reused id on ending",
        assetId: reusedAssetId,
        page: "right",
        focus: "spotlight",
      }],
      validatedLocalAssetIds: [reusedAssetId],
    }, "agent");
    expect(reused).toMatchObject({ ok: true });
    const beforeUndo = structuredClone(engine.getSnapshot().document);

    const rejected = engine.dispatch({
      type: "undo",
      requestId: "reject-cross-spread-id-undo",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: reused.ok ? reused.revision : 0,
      undoToken: removed.ok ? removed.undoToken : "",
    }, "agent");

    expect(rejected).toMatchObject({
      ok: false,
      code: "undo_conflict",
      summary: expect.stringMatching(/duplicate a foreground layer id across the book/i),
    });
    expect(engine.getSnapshot().document).toEqual(beforeUndo);
  });

  it("restores the previous book at its reviewed revision when creation is undone", () => {
    const previous = {
      id: "ready-personal-book",
      revision: 5,
      title: "Ready Personal Book",
      coverTextureUrl: "/assets/covers/the-field-guide-v2.png",
      spreads: [{ ...structuredClone(sampleBooks[0].spreads[0]), id: "opening", order: 0 }],
    };
    const previousQuality = {
      creationBrief: readyStoryBrief(1),
      reviewRounds: 1,
      reviewStatus: "ready" as const,
      renderEvidence: [],
      report: {
        contractVersion: 2,
        rubricVersion: 2,
        reviewedRevision: 5,
        status: "ready" as const,
      },
    };
    localStorage.setItem("apertale.library.v4", JSON.stringify({
      activeBookId: previous.id,
      documents: [previous],
      sampleSourceVersion: 4,
      authoringQuality: { [previous.id]: previousQuality },
    }));
    const engine = new BookEngine();
    expect(engine.getQualityGate()).toMatchObject({ status: "ready", report: { status: "ready" } });

    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-over-ready-book",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 5,
      documentId: "book-created-after-ready",
      title: "Created After Ready",
      ...preparedBook([{ id: "new-opening", title: "New Opening", body: "A new book begins." }]),
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created.ok).toBe(true);

    const undone = engine.dispatch({
      type: "undo",
      requestId: "undo-create-over-ready-book",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: engine.getSnapshot().document.revision,
      undoToken: created.ok ? created.undoToken : "",
    }, "agent");

    expect(undone.ok).toBe(true);
    expect(engine.getSnapshot().document).toMatchObject({ id: previous.id, revision: 5 });
    expect(engine.getQualityLifecycle()).toEqual(previousQuality);
    expect(engine.getQualityGate()).toMatchObject({ status: "ready", report: { status: "ready" } });
  });

  it("rejects a create command that would overwrite an existing library book", () => {
    const engine = new BookEngine();
    const result = engine.dispatch({
      type: "create-book",
      requestId: "duplicate-shelf-book",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "apertale-atlas-of-wonders",
      title: "Replacement Atlas",
      ...preparedBook([{ id: "replacement", title: "Replacement", body: "This must not overwrite the sample." }]),
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(engine.getSnapshot().document.title).toBe("Atlas of Living Wonders");
  });

  it("fails closed when a direct create command omits material readiness fields", () => {
    const engine = new BookEngine();
    const result = engine.dispatch({
      type: "create-book",
      requestId: "missing-readiness",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-not-ready",
      title: "Not Ready",
      ...preparedBook([{ id: "only-spread", title: "Only Spread", body: "This must not be created." }]),
      creationBrief: { contractVersion: 2, bookType: "illustrated-storybook", spreadCount: 1 },
      validatedSourceAssetIds: [],
    }, "agent");

    expect(result).toMatchObject({
      ok: false,
      code: "creation_not_ready",
      readiness: {
        ready: false,
        blockingMissingFields: expect.arrayContaining([
          expect.objectContaining({ field: "premise" }),
          expect.objectContaining({ field: "audience" }),
          expect.objectContaining({ field: "visualDirection" }),
        ]),
      },
    });
    expect(engine.getLibrary().books.some((book) => book.id === "book-not-ready")).toBe(false);
    expect(engine.getSnapshot().document.revision).toBe(1);
  });

  it("does not persist a text-only shell when the prepared book artwork is missing", () => {
    const engine = new BookEngine();
    const startingDocumentId = engine.getSnapshot().document.id;
    const result = engine.dispatch({
      type: "create-book",
      requestId: "missing-prepared-artwork",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-empty-shell",
      title: "An Empty Shell",
      spreads: [{ id: "opening", title: "Opening", body: "Valid copy is not a finished illustrated book." }],
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    } as unknown as CreateBookCommand, "agent");

    expect(result).toMatchObject({
      ok: false,
      code: "creation_artifact_incomplete",
      issues: expect.arrayContaining([
        expect.stringMatching(/cover/i),
        expect.stringMatching(/spread 1/i),
      ]),
    });
    expect(engine.getLibrary().books.some((book) => book.id === "book-empty-shell")).toBe(false);
    expect(engine.getSnapshot().document.id).toBe(startingDocumentId);
    expect(engine.getSnapshot().document.revision).toBe(1);
  });

  it.each([
    {
      name: "only one foreground layer",
      mutate: (command: CreateBookCommand) => { command.spreads[0].layers = command.spreads[0].layers.slice(0, 1); },
      issue: /2–4 prepared foreground layers/i,
    },
    {
      name: "no explicit interaction",
      mutate: (command: CreateBookCommand) => {
        command.spreads[0].layers.forEach((layer) => {
          delete layer.hover;
          delete layer.focus;
          delete layer.reveal;
          delete layer.motion;
        });
      },
      issue: /explicit story-relevant interaction/i,
    },
    {
      name: "idle motion without reader interaction",
      mutate: (command: CreateBookCommand) => {
        command.spreads[0].layers.forEach((layer) => {
          delete layer.hover;
          delete layer.focus;
          delete layer.reveal;
          layer.motion = { preset: "gentle-float", durationMs: 5200, loop: true };
        });
      },
      issue: /explicit story-relevant interaction/i,
    },
    {
      name: "an unverified final base",
      mutate: (command: CreateBookCommand) => {
        const finalBase = command.spreads[0].background.cleanPlateAssetId;
        command.validatedLocalAssetIds = command.validatedLocalAssetIds.filter((assetId) => assetId !== finalBase);
      },
      issue: /unverified background/i,
    },
  ])("rejects a prepared manifest with $name before it reaches the library", ({ mutate, issue }) => {
    const engine = new BookEngine();
    const startingDocumentId = engine.getSnapshot().document.id;
    const prepared = preparedBook([{ id: "opening", title: "Opening", body: "A complete visual beginning." }]);
    const command: CreateBookCommand = {
      type: "create-book",
      requestId: `reject-${String(issue)}`,
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-rejected-prepared-manifest",
      title: "Rejected Prepared Manifest",
      ...prepared,
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    };
    mutate(command);

    expect(engine.dispatch(command, "agent")).toMatchObject({
      ok: false,
      code: "creation_artifact_incomplete",
      issues: expect.arrayContaining([expect.stringMatching(issue)]),
    });
    expect(engine.getLibrary().books.some((book) => book.id === command.documentId)).toBe(false);
    expect(engine.getSnapshot().document.id).toBe(startingDocumentId);
  });

  it("does not turn runtime fallback responses into authored quality evidence", () => {
    const engine = new BookEngine();
    const creationBrief = readyStoryBrief(1);
    const prepared = preparedBook([{ id: "opening", title: "Opening", body: "One subject carries the authored response." }]);
    const spreads = prepared.spreads as CreateBookCommand["spreads"];
    delete spreads[0].layers![1].focus;
    const passiveAssetId = localAssetId(90);
    spreads[0].layers!.push({
      id: "passive-layer",
      label: "Passive layer",
      assetId: passiveAssetId,
      page: "right",
    });
    prepared.validatedLocalAssetIds.push(passiveAssetId);

    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-one-authored-interaction",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-one-authored-interaction",
      title: "One Authored Interaction",
      coverAssetId: prepared.coverAssetId,
      spreads,
      validatedLocalAssetIds: prepared.validatedLocalAssetIds,
      creationBrief,
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created.ok).toBe(true);
    expect(engine.getSnapshot().document.spreads[0].elements.slice(1).every((element) => !element.interaction)).toBe(true);

    const authoredElementId = engine.getSnapshot().document.spreads[0].elements[0].id;
    const removed = engine.dispatch({
      type: "scene-patch",
      requestId: "remove-only-authored-interaction",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: engine.getSnapshot().document.revision,
      spreadId: "opening",
      operations: [{ op: "remove", elementId: authoredElementId }],
    }, "agent");
    expect(removed.ok).toBe(true);
    const interactionCheck = evaluateDeterministicQuality(
      engine.getSnapshot().document,
      [],
      creationBrief,
    ).find((check) => check.criterionId === "meaningful-interaction" && check.evidence[0]?.spreadId === "opening");
    expect(interactionCheck).toMatchObject({ outcome: "blocker" });
  });

  it("rejects duplicate layer ids across different spreads", () => {
    const engine = new BookEngine();
    const prepared = preparedBook([
      { id: "opening", title: "Opening", body: "One scene." },
      { id: "ending", title: "Ending", body: "Another scene." },
    ]);
    prepared.spreads[1].layers[0].id = prepared.spreads[0].layers[0].id;

    const result = engine.dispatch({
      type: "create-book",
      requestId: "reject-book-wide-duplicate-layer-id",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-duplicate-layer-ids",
      title: "Duplicate Layer Ids",
      ...prepared,
      creationBrief: readyStoryBrief(2),
      validatedSourceAssetIds: [],
    }, "agent");

    expect(result).toMatchObject({
      ok: false,
      code: "creation_artifact_incomplete",
      issues: expect.arrayContaining([expect.stringMatching(/unique across the whole book/i)]),
    });
    expect(engine.getLibrary().books.some((book) => book.id === "book-duplicate-layer-ids")).toBe(false);
  });

  it("rolls back a created book when durable browser storage fails", () => {
    const engine = new BookEngine();
    engine.reset();
    const startingDocument = structuredClone(engine.getSnapshot().document);
    const booksBefore = engine.getLibrary().books;
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    const result = engine.dispatch({
      type: "create-book",
      requestId: "create-storage-failure",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-storage-failure",
      title: "Storage Failure",
      ...preparedBook([{ id: "opening", title: "Opening", body: "This must roll back." }]),
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");

    expect(result).toMatchObject({ ok: false, code: "invalid", summary: expect.stringMatching(/could not save/i) });
    expect(engine.getSnapshot().document).toEqual(startingDocument);
    expect(engine.getLibrary().books).toEqual(booksBefore);
  });

  it("restores a full undo journal when book creation cannot be persisted", () => {
    const engine = cityEngine();
    let firstUndoToken = "";
    for (let index = 0; index < 32; index += 1) {
      const revision = engine.getSnapshot().document.revision;
      const mutation = engine.dispatch({
        type: "compose-spread",
        requestId: `fill-undo-journal-${index + 1}`,
        expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: revision,
        spreadId: "city-for-small-things",
        body: `Journal entry ${index + 1}.`,
      }, "agent");
      expect(mutation).toMatchObject({ ok: true });
      if (index === 0 && mutation.ok) firstUndoToken = mutation.undoToken;
    }
    const beforeFailure = structuredClone(engine.getSnapshot().document);
    const failedSetItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    const failedCreate = engine.dispatch({
      type: "create-book",
      requestId: "create-with-full-undo-journal",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: beforeFailure.revision,
      documentId: "book-full-undo-journal",
      title: "Full Undo Journal",
      ...preparedBook([{ id: "opening", title: "Opening", body: "This must roll back atomically." }]),
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(failedCreate).toMatchObject({ ok: false, code: "invalid", summary: expect.stringMatching(/could not save/i) });
    expect(engine.getSnapshot().document).toEqual(beforeFailure);

    failedSetItem.mockRestore();
    const retainedOldestUndo = engine.dispatch({
      type: "undo",
      requestId: "prove-oldest-undo-survived",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: beforeFailure.revision,
      undoToken: firstUndoToken,
    }, "agent");
    expect(retainedOldestUndo).toMatchObject({
      ok: false,
      code: "undo_conflict",
      summary: expect.stringMatching(/changed again/i),
    });
  });

  it("rolls back create undo and redo when durable browser storage fails", () => {
    const engine = new BookEngine();
    const documentId = "book-transactional-history";
    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-transactional-history",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId,
      title: "Transactional History",
      ...preparedBook([{ id: "opening", title: "Opening", body: "Undo and redo must be durable." }]),
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created).toMatchObject({ ok: true });
    const createdDocument = structuredClone(engine.getSnapshot().document);
    const createdSession = structuredClone(engine.getSnapshot().session);
    const createdLibrary = engine.getLibrary();
    const storedQuality = () => (
      JSON.parse(localStorage.getItem("apertale.library.v4") ?? "{}") as { authoringQuality?: Record<string, unknown> }
    ).authoringQuality ?? {};

    const failedSetItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    const failedUndo = engine.dispatch({
      type: "undo",
      requestId: "undo-transactional-history-fails",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: created.ok ? created.revision : 0,
      undoToken: created.ok ? created.undoToken : "",
    }, "agent");
    expect(failedUndo).toMatchObject({ ok: false, code: "invalid", summary: expect.stringMatching(/could not save/i) });
    expect(engine.getSnapshot().document).toEqual(createdDocument);
    expect(engine.getSnapshot().session).toEqual(createdSession);
    expect(engine.getLibrary()).toEqual(createdLibrary);
    expect(storedQuality()).toHaveProperty(documentId);
    expect(new BookEngine().getLibrary().books.some((book) => book.id === documentId)).toBe(true);
    expect(engine.dispatch({
      type: "undo",
      requestId: "undo-transactional-history-fails",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: created.ok ? created.revision : 0,
      undoToken: created.ok ? created.undoToken : "",
    }, "agent")).toEqual(failedUndo);

    failedSetItem.mockRestore();
    const undone = engine.dispatch({
      type: "undo",
      requestId: "undo-transactional-history-retry",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: created.ok ? created.revision : 0,
      undoToken: created.ok ? created.undoToken : "",
    }, "agent");
    expect(undone).toMatchObject({ ok: true });
    expect(storedQuality()).not.toHaveProperty(documentId);
    expect(new BookEngine().getLibrary().books.some((book) => book.id === documentId)).toBe(false);

    const failedRedoSetItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    const beforeFailedRedo = structuredClone(engine.getSnapshot().document);
    const sessionBeforeFailedRedo = structuredClone(engine.getSnapshot().session);
    const failedRedo = engine.dispatch({
      type: "undo",
      requestId: "redo-transactional-history-fails",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: undone.ok ? undone.revision : 0,
      undoToken: undone.ok ? undone.undoToken : "",
    }, "agent");
    expect(failedRedo).toMatchObject({ ok: false, code: "invalid", summary: expect.stringMatching(/could not save/i) });
    expect(engine.getSnapshot().document).toEqual(beforeFailedRedo);
    expect(engine.getSnapshot().session).toEqual(sessionBeforeFailedRedo);
    expect(storedQuality()).not.toHaveProperty(documentId);
    expect(new BookEngine().getLibrary().books.some((book) => book.id === documentId)).toBe(false);

    failedRedoSetItem.mockRestore();
    const redone = engine.dispatch({
      type: "undo",
      requestId: "redo-transactional-history-retry",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: undone.ok ? undone.revision : 0,
      undoToken: undone.ok ? undone.undoToken : "",
    }, "agent");
    expect(redone).toMatchObject({ ok: true });
    expect(storedQuality()).toHaveProperty(documentId);
    expect(new BookEngine().getLibrary().books.some((book) => book.id === documentId)).toBe(true);
  });

  it("accepts the fiftieth local artwork reference and rejects the fifty-first atomically", () => {
    const engine = new BookEngine();
    const prepared = preparedBook(Array.from({ length: 12 }, (_, index) => ({
      id: `spread-${index + 1}`,
      title: `Spread ${index + 1}`,
      body: `A complete scene for spread ${index + 1}.`,
    })));
    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-at-asset-capacity",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-at-asset-capacity",
      title: "At Asset Capacity",
      ...prepared,
      creationBrief: readyStoryBrief(12),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created).toMatchObject({ ok: true });
    const capacityAssets = Array.from({ length: 13 }, (_, index) => localAssetId(50 + index));
    const accepted = engine.dispatch({
      type: "scene-patch",
      requestId: "accept-fiftieth-asset",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: created.ok ? created.revision : 0,
      spreadId: "spread-1",
      operations: capacityAssets.map((assetId, index) => ({
        op: "add" as const,
        id: `capacity-${index + 1}`,
        label: `Capacity ${index + 1}`,
        assetId,
        page: index % 2 === 0 ? "left" as const : "right" as const,
        hover: "lift-glow" as const,
      })),
      validatedLocalAssetIds: capacityAssets,
    }, "agent");

    expect(accepted).toMatchObject({ ok: true });
    expect(listStoredPublishedAssetIds(engine.getSnapshot().document)).toHaveLength(50);
    const beforeRejected = structuredClone(engine.getSnapshot().document);
    const fiftyFirstAssetId = localAssetId(63);
    const rejected = engine.dispatch({
      type: "scene-patch",
      requestId: "reject-fifty-first-asset",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: accepted.ok ? accepted.revision : 0,
      spreadId: "spread-1",
      operations: [{
        op: "add",
        id: "one-beyond-limit",
        label: "One beyond limit",
        assetId: fiftyFirstAssetId,
        page: "right",
        focus: "spotlight",
      }],
      validatedLocalAssetIds: [fiftyFirstAssetId],
    }, "agent");

    expect(rejected).toMatchObject({ ok: false, code: "invalid", summary: expect.stringMatching(/51 local images/i) });
    expect(engine.getSnapshot().document).toEqual(beforeRejected);
  });

  it("rejects a cover that would raise a legacy no-cover book from 50 to 51 local images", () => {
    let nextAsset = 1;
    const takeAsset = () => localAssetId(nextAsset++);
    const spreads: DocumentState["spreads"] = Array.from({ length: 12 }, (_, order) => ({
      id: `legacy-spread-${order + 1}`,
      order,
      title: `Legacy spread ${order + 1}`,
      body: "A complete legacy scene already at browser-local asset capacity.",
      artwork: {
        sourceAssetId: takeAsset(),
        cleanPlateAssetId: takeAsset(),
        separation: "inpainted-clean-plate" as const,
      },
      elements: (["left", "right"] as const).map((page, layerIndex) => ({
        id: `legacy-layer-${order + 1}-${layerIndex + 1}`,
        label: `Legacy layer ${order + 1}.${layerIndex + 1}`,
        kind: "lifted" as const,
        assetId: takeAsset(),
        page,
        transform: { x: 0.5, y: 0.5, scaleX: 0.72, scaleY: 0.72, rotationDeg: 0 },
        depth: 0.1,
        locked: false,
        provenance: "agent" as const,
      })),
    }));
    spreads[0]!.artwork!.personalSourceAssetId = takeAsset();
    spreads[0]!.elements[0]!.frameAssetIds = [spreads[0]!.elements[0]!.assetId, takeAsset()];
    for (let index = 0; index < 13; index += 1) {
      spreads[0]!.elements.push({
        id: `legacy-capacity-${index + 1}`,
        label: `Legacy capacity ${index + 1}`,
        kind: "lifted",
        assetId: takeAsset(),
        page: index % 2 === 0 ? "left" : "right",
        transform: { x: 0.5, y: 0.5, scaleX: 0.72, scaleY: 0.72, rotationDeg: 0 },
        depth: 0.1,
        locked: false,
        provenance: "agent",
      });
    }
    expect(listStoredPublishedAssetIds({ id: "capacity", revision: 1, title: "Capacity", spreads })).toHaveLength(50);
    localStorage.setItem("apertale.library.v4", JSON.stringify({
      activeBookId: "legacy-no-cover-at-capacity",
      documents: [{
        id: "legacy-no-cover-at-capacity",
        revision: 7,
        title: "Legacy No-cover At Capacity",
        spreads,
      }],
      sampleSourceVersion: 3,
    }));
    const engine = new BookEngine();
    const beforeDocument = structuredClone(engine.getSnapshot().document);
    const beforeLibrary = structuredClone(engine.getLibrary());
    const fiftyFirstAssetId = takeAsset();

    const rejected = engine.dispatch({
      type: "set-book-cover",
      requestId: "reject-fifty-first-cover-asset",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: beforeDocument.revision,
      assetId: fiftyFirstAssetId,
      validatedLocalAssetIds: [fiftyFirstAssetId],
    }, "agent");

    expect(rejected).toMatchObject({ ok: false, code: "invalid", summary: expect.stringMatching(/51 local images/i) });
    expect(engine.getSnapshot().document).toEqual(beforeDocument);
    expect(engine.getLibrary()).toEqual(beforeLibrary);
  });

  it("adopts a ready brief once for a legacy personal book, then reaches publishable review", () => {
    const spread = structuredClone(sampleBooks[0].spreads[0]);
    spread.id = "opening";
    spread.order = 0;
    localStorage.setItem("apertale.library.v4", JSON.stringify({
      activeBookId: "legacy-personal-book",
      documents: [{
        id: "legacy-personal-book",
        revision: 5,
        title: "Legacy Personal Book",
        coverTextureUrl: "/assets/covers/the-field-guide-v2.png",
        spreads: [spread],
      }],
      sampleSourceVersion: 3,
    }));
    const engine = new BookEngine();
    expect(engine.beginQualityReview()).toMatchObject({ ok: false, code: "creation_brief_required" });

    expect(engine.adoptCreationBrief(readyStoryBrief(1), [], 5, ["The legacy cover has no trusted book-art role."]))
      .toMatchObject({ ok: false, code: "creation_artifact_incomplete" });
    const adopted = engine.adoptCreationBrief(readyStoryBrief(1), [], 5, []);
    expect(adopted).toMatchObject({ ok: true, currentRevision: 5, qualityGate: { status: "needs-review" } });
    expect(engine.adoptCreationBrief(readyStoryBrief(1), [], 5, [])).toMatchObject({
      ok: false,
      code: "creation_brief_already_attached",
    });

    expect(engine.recordRenderEvidence({
      documentId: "legacy-personal-book",
      revision: 4,
      scope: "spread",
      spreadId: "opening",
      theme: "paper-atelier",
      surface: "webgl",
      locator: ".book-scene canvas",
    })).toBe(false);
    expect(engine.recordRenderEvidence({
      documentId: "legacy-personal-book",
      revision: 5,
      scope: "cover",
      theme: "paper-atelier",
      surface: "shelf",
      locator: "[data-book-id] img",
    })).toBe(true);
    expect(engine.recordRenderEvidence({
      documentId: "legacy-personal-book",
      revision: 5,
      scope: "spread",
      spreadId: "opening",
      theme: "paper-atelier",
      surface: "webgl",
      locator: ".book-scene canvas",
    })).toBe(true);
    expect(engine.beginQualityReview()).toMatchObject({ ok: true, nextRound: 1 });
    const reviewed = engine.recordQualityReview({
      contractVersion: 2,
      reviewedRevision: 5,
      expectedRound: 1,
      sampleReady: true,
      summary: "The adopted legacy book matches the premium sample bar.",
      checks: QUALITY_VISUAL_CRITERION_IDS.map((criterionId) => ({
        criterionId,
        outcome: "pass" as const,
        message: `${criterionId} passed on rendered evidence.`,
        evidence: criterionId === "cover-appeal"
          ? [{ scope: "cover" as const, locator: "[data-book-id] img", description: "Rendered cover" }]
          : [{ scope: "spread" as const, spreadId: "opening", locator: ".book-scene canvas", description: "Rendered spread" }],
      })),
    });
    expect(reviewed).toMatchObject({ ok: true, qualityReport: { status: "ready", sampleReady: true } });
  });

  it("migrates a persisted v1 quality report into a fresh v2 review cycle", () => {
    const spread = structuredClone(sampleBooks[0].spreads[0]);
    spread.id = "opening";
    spread.order = 0;
    const documentId = "quality-v1-personal-book";
    const creationBrief = readyStoryBrief(1);
    localStorage.setItem("apertale.library.v4", JSON.stringify({
      activeBookId: documentId,
      documents: [{
        id: documentId,
        revision: 5,
        title: "Quality v1 Personal Book",
        coverTextureUrl: "/assets/covers/the-field-guide-v2.png",
        spreads: [spread],
      }],
      sampleSourceVersion: 4,
      authoringQuality: {
        [documentId]: {
          creationBrief,
          reviewRounds: 2,
          reviewStatus: "ready",
          renderEvidence: [{
            documentId,
            revision: 5,
            scope: "spread",
            spreadId: "opening",
            theme: "paper-atelier",
            surface: "webgl",
            locator: ".book-scene canvas",
            renderedAt: "2026-08-29T00:00:00.000Z",
          }],
          report: { contractVersion: 1, rubricVersion: 1, reviewedRevision: 5, status: "ready" },
        },
      },
    }));

    const engine = new BookEngine();
    expect(engine.getQualityGate()).toMatchObject({ status: "needs-review", nextRound: 1, remainingRounds: 2 });
    expect(engine.getQualityLifecycle()).toMatchObject({
      creationBrief,
      reviewRounds: 0,
      reviewStatus: "needs-review",
      renderEvidence: [],
    });
    expect(engine.getQualityLifecycle()).not.toHaveProperty("report");
    expect(engine.recordRenderEvidence({
      documentId,
      revision: 5,
      scope: "cover",
      theme: "paper-atelier",
      surface: "shelf",
      locator: "[data-book-id] img",
    })).toBe(true);
    expect(engine.recordRenderEvidence({
      documentId,
      revision: 5,
      scope: "spread",
      spreadId: "opening",
      theme: "paper-atelier",
      surface: "webgl",
      locator: ".book-scene canvas",
    })).toBe(true);
    expect(engine.beginQualityReview()).toMatchObject({ ok: true, nextRound: 1, remainingRounds: 2 });
    const reviewed = engine.recordQualityReview({
      contractVersion: 2,
      reviewedRevision: 5,
      expectedRound: 1,
      sampleReady: true,
      summary: "The migrated book passes the current quality contract.",
      checks: QUALITY_VISUAL_CRITERION_IDS.map((criterionId) => ({
        criterionId,
        outcome: "pass" as const,
        message: `${criterionId} passed on current rendered evidence.`,
        evidence: criterionId === "cover-appeal"
          ? [{ scope: "cover" as const, locator: "[data-book-id] img", description: "Rendered cover" }]
          : [{ scope: "spread" as const, spreadId: "opening", locator: ".book-scene canvas", description: "Rendered spread" }],
      })),
    });
    expect(reviewed).toMatchObject({ ok: true, qualityReport: { contractVersion: 2, rubricVersion: 2, status: "ready" } });
  });

  it("allows a legacy creation brief to be replaced before quality review", () => {
    const spread = structuredClone(sampleBooks[0].spreads[0]);
    spread.id = "opening";
    spread.order = 0;
    const documentId = "creation-v1-personal-book";
    localStorage.setItem("apertale.library.v4", JSON.stringify({
      activeBookId: documentId,
      documents: [{
        id: documentId,
        revision: 3,
        title: "Creation v1 Personal Book",
        coverTextureUrl: "/assets/covers/the-field-guide-v2.png",
        spreads: [spread],
      }],
      sampleSourceVersion: 4,
      authoringQuality: {
        [documentId]: {
          creationBrief: { ...readyStoryBrief(1), contractVersion: 1 },
          reviewRounds: 0,
          reviewStatus: "needs-review",
          renderEvidence: [],
        },
      },
    }));

    const engine = new BookEngine();
    expect(engine.beginQualityReview()).toMatchObject({ ok: false, code: "creation_brief_upgrade_required" });
    expect(engine.adoptCreationBrief(readyStoryBrief(1), [], 3, [])).toMatchObject({
      ok: true,
      qualityGate: { status: "needs-review", nextRound: 1 },
    });
    expect(engine.beginQualityReview()).toMatchObject({ ok: true, nextRound: 1 });
  });

  it("starts a fresh two-round cycle after editing an approved revision", () => {
    const spread = structuredClone(sampleBooks[0].spreads[0]);
    spread.id = "opening";
    spread.order = 0;
    localStorage.setItem("apertale.library.v4", JSON.stringify({
      activeBookId: "approved-personal-book",
      documents: [{
        id: "approved-personal-book",
        revision: 5,
        title: "Approved Personal Book",
        coverTextureUrl: "/assets/covers/the-field-guide-v2.png",
        spreads: [spread],
      }],
      sampleSourceVersion: 3,
      authoringQuality: {
        "approved-personal-book": {
          creationBrief: readyStoryBrief(1),
          reviewRounds: 2,
          reviewStatus: "ready",
          renderEvidence: [{
            documentId: "approved-personal-book",
            revision: 5,
            scope: "spread",
            spreadId: "opening",
            theme: "paper-atelier",
            surface: "webgl",
            locator: ".book-scene canvas",
            renderedAt: "2026-08-29T00:00:00.000Z",
          }],
          report: { contractVersion: 2, rubricVersion: 2, reviewedRevision: 5, status: "ready" },
        },
      },
    }));
    const engine = new BookEngine();
    expect(engine.getQualityGate()).toMatchObject({ status: "ready", remainingRounds: 0 });

    expect(engine.dispatch({
      type: "compose-spread",
      requestId: "edit-approved-book",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 5,
      spreadId: "opening",
      body: "The approved story now has a revised ending.",
    }, "agent")).toMatchObject({ ok: true, revision: 6 });
    expect(engine.getQualityGate()).toMatchObject({
      status: "needs-review",
      report: null,
      nextRound: 1,
      remainingRounds: 2,
    });
    expect(engine.beginQualityReview()).toMatchObject({ ok: true, nextRound: 1, remainingRounds: 2 });
  });

  it("cannot bypass source-photo verification by labelling the brief as a storybook", () => {
    const engine = new BookEngine();
    const missingAssetId = "asset:12345678-1234-4234-8234-123456789abc";
    const result = engine.dispatch({
      type: "create-book",
      requestId: "storybook-with-missing-photo",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-missing-photo",
      title: "A Portrait Story",
      ...preparedBook([{ id: "portrait", title: "Portrait", body: "A source-true beginning." }]),
      creationBrief: {
        ...readyStoryBrief(1),
        sourceAssets: [{ id: missingAssetId, name: "Portrait.png" }],
        photoPolicy: { sourceUse: "reference-and-compose", preserveIdentity: true, allowFaceChanges: false },
      },
      validatedSourceAssetIds: [],
    }, "agent");

    expect(result).toMatchObject({
      ok: false,
      code: "creation_not_ready",
      readiness: {
        blockingMissingFields: expect.arrayContaining([
          expect.objectContaining({ field: "sourceAssets" }),
        ]),
      },
    });
    expect(engine.getLibrary().books.some((book) => book.id === "book-missing-photo")).toBe(false);
  });

  it("enforces the ready brief's generated or preserved scene policy after create", () => {
    const sourceId = "asset:12345678-1234-4234-8234-123456789abc";
    const cleanPlate = "/assets/generated/story-city-clean-v2.png";
    const layerOne = "/assets/generated/story-city-boy-cutout-v3.png";
    const layerTwo = "/assets/generated/story-city-clouds-cutout-v3.png";
    const operations = (
      separation: "inpainted-clean-plate" | "preserved-photo-layout",
      personalSourceAssetId?: string,
    ) => [{
      op: "set-background" as const,
      cleanPlateAssetId: separation === "preserved-photo-layout" ? sourceId : cleanPlate,
      sourceAssetId: separation === "preserved-photo-layout" ? sourceId : "/assets/generated/wonders-colosseum.png",
      personalSourceAssetId,
      separation,
    }, {
      op: "add" as const,
      id: "layer-one",
      label: "Layer one",
      assetId: layerOne,
      page: "left" as const,
    }, {
      op: "add" as const,
      id: "layer-two",
      label: "Layer two",
      assetId: layerTwo,
      page: "right" as const,
    }];

    const story = new BookEngine();
    const storyCreated = story.dispatch({
      type: "create-book",
      requestId: "create-policy-story",
      expectedDocumentId: story.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-policy-story",
      title: "Policy Story",
      ...preparedBook([{ id: "opening", title: "Opening", body: "A generated beginning." }]),
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(storyCreated.ok).toBe(true);
    expect(story.dispatch({
      type: "scene-patch",
      requestId: "inject-undeclared-source",
      expectedDocumentId: story.getSnapshot().document.id, expectedRevision: storyCreated.ok ? storyCreated.revision : 0,
      spreadId: "opening",
      operations: operations("inpainted-clean-plate", sourceId),
      validatedLocalAssetIds: [sourceId],
    }, "agent")).toMatchObject({ ok: false, code: "invalid", summary: expect.stringMatching(/personal-photo/i) });
    expect(story.dispatch({
      type: "scene-patch",
      requestId: "wrong-preserved-story",
      expectedDocumentId: story.getSnapshot().document.id, expectedRevision: storyCreated.ok ? storyCreated.revision : 0,
      spreadId: "opening",
      operations: operations("preserved-photo-layout", sourceId),
      validatedLocalAssetIds: [sourceId],
    }, "agent")).toMatchObject({ ok: false, code: "invalid", summary: expect.stringMatching(/inpainted-clean-plate/i) });

    const albumBrief = {
      contractVersion: 2,
      bookType: "preserved-photo-album" as const,
      premise: "Keep one original portrait source-true.",
      audience: "The family",
      spreadCount: 1,
      visualDirection: "Quiet archival album",
      sourceAssets: [{ id: sourceId, name: "Original.png" }],
      photoPolicy: {
        sourceUse: "preserve-original-layout" as const,
        preserveIdentity: true,
        allowFaceChanges: false,
        allowCrop: false,
        allowColorCorrection: true,
      },
    };
    const album = new BookEngine();
    album.openBook("apertale-atlas-of-wonders");
    const albumCreated = album.dispatch({
      type: "create-book",
      requestId: "create-policy-album",
      expectedDocumentId: album.getSnapshot().document.id, expectedRevision: album.getSnapshot().document.revision,
      documentId: "book-policy-album",
      title: "Policy Album",
      ...preparedBook(
        [{ id: "opening", title: "Opening", body: "The original portrait remains intact." }],
        { separation: "preserved-photo-layout", personalSourceAssetId: sourceId },
      ),
      creationBrief: albumBrief,
      validatedSourceAssetIds: [sourceId],
    }, "agent");
    expect(albumCreated.ok).toBe(true);
    expect(album.dispatch({
      type: "scene-patch",
      requestId: "wrong-generated-album",
      expectedDocumentId: album.getSnapshot().document.id, expectedRevision: albumCreated.ok ? albumCreated.revision : 0,
      spreadId: "opening",
      operations: operations("inpainted-clean-plate"),
      validatedLocalAssetIds: [sourceId],
    }, "agent")).toMatchObject({ ok: false, code: "invalid", summary: expect.stringMatching(/preserved-photo-layout/i) });
    expect(album.dispatch({
      type: "scene-patch",
      requestId: "valid-preserved-album",
      expectedDocumentId: album.getSnapshot().document.id, expectedRevision: albumCreated.ok ? albumCreated.revision : 0,
      spreadId: "opening",
      operations: operations("preserved-photo-layout", sourceId),
      validatedLocalAssetIds: [sourceId],
    }, "agent")).toMatchObject({ ok: true });
  });

  it("creates a photo-led keepsake with separate composite and personal-source provenance", () => {
    const sourceId = "asset:12345678-1234-4234-8234-123456789abc";
    const engine = new BookEngine();
    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-photo-keepsake",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-photo-keepsake",
      title: "Family Light",
      ...preparedBook(
        [{ id: "opening", title: "Family Light", body: "A source-true memory becomes a new composition." }],
        { personalSourceAssetId: sourceId },
      ),
      creationBrief: {
        contractVersion: 2,
        bookType: "photo-led-keepsake",
        premise: "Turn one family portrait into a warm illustrated keepsake.",
        audience: "The family",
        spreadCount: 1,
        visualDirection: "Warm tactile collage",
        sourceAssets: [{ id: sourceId, name: "Portrait.png" }],
        photoPolicy: { sourceUse: "reference-and-compose", preserveIdentity: true, allowFaceChanges: false },
      },
      validatedSourceAssetIds: [sourceId],
    }, "agent");
    expect(created.ok).toBe(true);
    const beforeRejectedCover = structuredClone(engine.getSnapshot().document);
    const rejectedCover = engine.dispatch({
      type: "set-book-cover",
      requestId: "reject-source-photo-cover",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: created.ok ? created.revision : 0,
      assetId: sourceId,
      validatedLocalAssetIds: [sourceId],
    }, "agent");
    expect(rejectedCover).toMatchObject({
      ok: false,
      code: "invalid",
      summary: expect.stringMatching(/personal source photo.*dedicated cover/i),
    });
    expect(engine.getSnapshot().document).toEqual(beforeRejectedCover);

    const patched = engine.dispatch({
      type: "scene-patch",
      requestId: "compose-photo-keepsake",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: created.ok ? created.revision : 0,
      spreadId: "opening",
      validatedLocalAssetIds: [sourceId],
      operations: [{
        op: "set-background",
        sourceAssetId: "/assets/generated/city-spread.png",
        cleanPlateAssetId: "/assets/generated/story-city-clean-v2.png",
        personalSourceAssetId: sourceId,
        separation: "inpainted-clean-plate",
      }, {
        op: "add",
        id: "portrait-subject",
        label: "Portrait subject",
        assetId: "/assets/generated/story-city-boy-cutout-v3.png",
        page: "left",
      }, {
        op: "add",
        id: "memory-light",
        label: "Memory light",
        assetId: "/assets/generated/story-window-glow-cutout-v3.png",
        page: "right",
      }],
    }, "agent");
    expect(patched).toMatchObject({ ok: true });
    expect(engine.getSnapshot().document.spreads[0].artwork).toMatchObject({
      sourceAssetId: "/assets/generated/city-spread.png",
      cleanPlateAssetId: "/assets/generated/story-city-clean-v2.png",
      personalSourceAssetId: sourceId,
    });
  });

  it("stops the critique-patch loop after two blocker rounds", () => {
    const engine = new BookEngine();
    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-quality-loop",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-quality-loop",
      title: "Quality Loop",
      ...preparedBook([{ id: "opening", title: "Opening", body: "A beginning." }]),
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created.ok).toBe(true);
    const revision = engine.getSnapshot().document.revision;

    expect(engine.recordQualityReview(blockingVisualReview(revision, 1))).toMatchObject({
      ok: false,
      code: "quality_review_not_started",
    });
    expect(recordCompleteRenderEvidence(engine)).toEqual([true, true]);
    expect(engine.beginQualityReview()).toMatchObject({ ok: true, nextRound: 1 });
    const first = engine.recordQualityReview(blockingVisualReview(revision, 1));
    expect(first).toMatchObject({
      ok: true,
      qualityReport: { round: 1, status: "blocked" },
    });

    expect(engine.beginQualityReview()).toMatchObject({ ok: false, code: "quality_patch_required" });
    const patched = engine.dispatch({
      type: "compose-spread",
      requestId: "patch-after-critique",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: revision,
      spreadId: "opening",
      body: "A clearer beginning after critique.",
    }, "agent");
    expect(patched.ok).toBe(true);
    const patchedRevision = engine.getSnapshot().document.revision;
    expect(recordCompleteRenderEvidence(engine)).toEqual([true, true]);
    expect(engine.beginQualityReview()).toMatchObject({ ok: true, nextRound: 2 });
    const second = engine.recordQualityReview(blockingVisualReview(patchedRevision, 2));
    expect(second).toMatchObject({
      ok: true,
      qualityReport: { round: 2, status: "needs-user-input" },
    });
    expect(engine.beginQualityReview()).toMatchObject({
      ok: false,
      code: "quality_review_limit",
      qualityGate: { status: "needs-user-input", remainingRounds: 0 },
    });
  });

  it("does not consume a critique round while render evidence arrives spread by spread", () => {
    const engine = new BookEngine();
    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-render-evidence-retry",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-render-evidence-retry",
      title: "Render Evidence Retry",
      ...preparedBook([
        { id: "opening", title: "Opening", body: "A complete rendered beginning." },
        { id: "ending", title: "Ending", body: "A complete rendered ending." },
      ]),
      creationBrief: readyStoryBrief(2),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created).toMatchObject({ ok: true });
    const revision = engine.getSnapshot().document.revision;
    expect(engine.recordRenderEvidence({
      documentId: "book-render-evidence-retry",
      revision,
      scope: "cover",
      theme: "paper-atelier",
      surface: "shelf",
      locator: "[data-book-id] img",
    })).toBe(true);
    expect(engine.beginQualityReview()).toMatchObject({ ok: true, nextRound: 1 });
    const visual = blockingVisualReview(revision, 1);
    visual.sampleReady = true;
    visual.checks = visual.checks.map((check) => ({
      criterionId: check.criterionId,
      outcome: "pass",
      message: `${check.criterionId} passed.`,
      evidence: check.criterionId === "cover-appeal"
        ? check.evidence
        : ["opening", "ending"].map((spreadId) => ({
            scope: "spread" as const,
            spreadId,
            locator: ".book-scene canvas",
            description: `Rendered ${spreadId} spread`,
          })),
    }));
    expect(engine.recordQualityReview(visual)).toMatchObject({
      ok: false,
      code: "render_evidence_required",
      summary: expect.stringMatching(/2 spreads/),
    });
    expect(engine.getQualityLifecycle()).toMatchObject({ reviewRounds: 0, reviewStatus: "checking" });

    expect(engine.recordRenderEvidence({
      documentId: "book-render-evidence-retry",
      revision,
      scope: "spread",
      spreadId: "opening",
      theme: "paper-atelier",
      surface: "webgl",
      locator: ".book-scene canvas",
    })).toBe(true);
    expect(engine.recordQualityReview(visual)).toMatchObject({
      ok: false,
      code: "render_evidence_required",
      summary: expect.stringMatching(/1 spread/),
    });
    expect(engine.getQualityLifecycle()).toMatchObject({ reviewRounds: 0, reviewStatus: "checking" });

    expect(engine.recordRenderEvidence({
      documentId: "book-render-evidence-retry",
      revision,
      scope: "spread",
      spreadId: "ending",
      theme: "paper-atelier",
      surface: "webgl",
      locator: ".book-scene canvas",
    })).toBe(true);
    expect(engine.recordQualityReview(visual)).toMatchObject({
      ok: true,
      qualityReport: { round: 1, status: "ready", sampleReady: true },
    });
    expect(engine.getQualityLifecycle()).toMatchObject({ reviewRounds: 1, reviewStatus: "ready" });
  });

  it("reports every incomplete visual criterion without consuming a critique round", () => {
    const engine = new BookEngine();
    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-invalid-visual-review",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-invalid-visual-review",
      title: "Invalid Visual Review",
      ...preparedBook([{ id: "opening", title: "Opening", body: "A rendered beginning." }]),
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created).toMatchObject({ ok: true });
    expect(recordCompleteRenderEvidence(engine)).toEqual([true, true]);
    expect(engine.beginQualityReview()).toMatchObject({ ok: true, nextRound: 1 });

    const visual = blockingVisualReview(engine.getSnapshot().document.revision, 1);
    visual.checks.find((check) => check.criterionId === "spread-composition")!.evidence = [];
    visual.checks.find((check) => check.criterionId === "photo-fidelity-integration")!.message = "";
    expect(engine.recordQualityReview(visual)).toMatchObject({
      ok: false,
      code: "invalid_quality_review",
      summary: "Visual criteria are incomplete: spread-composition, photo-fidelity-integration.",
    });
    expect(engine.getQualityLifecycle()).toMatchObject({ reviewRounds: 0, reviewStatus: "checking" });
  });

  it("applies a bounded scene patch atomically and undoes the whole patch", () => {
    const engine = cityEngine();
    const originalX = engine.getSnapshot().document.spreads[0].elements[0].transform.x;
    const patched = engine.dispatch({
      type: "scene-patch",
      requestId: "scene-patch",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      spreadId: "city-for-small-things",
      operations: [
        { op: "update", elementId: "bird", transform: { x: 0.41 }, hover: "warm-rim" },
        {
          op: "add",
          id: "second-bird",
          label: "Second Bird",
          assetId: "/assets/generated/story-window-glow-cutout-v3.png",
          page: "left",
          reveal: {
            kind: "fact-card",
            title: "Arena engineering",
            summary: "A compact second view explains how the amphitheatre moved people.",
            facts: [{ label: "Entrances", value: "80 numbered arches" }],
            source: "Apertale sample knowledge",
          },
        },
        { op: "reorder", elementId: "second-bird", index: 0 },
      ],
    }, "agent");
    expect(patched).toMatchObject({ ok: true, changedIds: ["bird", "second-bird"] });
    expect(engine.getSnapshot().document.spreads[0].elements.map((element) => element.id)).toEqual(["second-bird", "bird", "city-flower-towers", "city-cloud-family", "paper-tower"]);
    expect(engine.getSnapshot().document.spreads[0].elements[0].interaction?.reveal).toMatchObject({
      kind: "fact-card",
      title: "Arena engineering",
      facts: [{ label: "Entrances", value: "80 numbered arches" }],
    });
    expect(engine.getSnapshot().document.spreads[0].elements[1]).toMatchObject({ transform: { x: 0.41 }, interaction: { hover: "warm-rim" } });

    const undone = engine.dispatch({
      type: "undo",
      requestId: "undo-scene-patch",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 2,
      undoToken: patched.ok ? patched.undoToken : "",
    }, "human");
    expect(undone.ok).toBe(true);
    expect(engine.getSnapshot().document.spreads[0].elements.map((element) => element.id)).toEqual(["bird", "city-flower-towers", "city-cloud-family", "paper-tower"]);
    expect(engine.getSnapshot().document.spreads[0].elements[0].transform.x).toBe(originalX);
  });

  it("undoes frame-sequence updates and conflicts after a newer frame edit", () => {
    const engine = cityEngine();
    const element = engine.getSnapshot().document.spreads[0].elements[0];
    const firstFrames = [element.assetId, "/assets/generated/story-window-glow-cutout-v3.png"];
    const patched = engine.dispatch({
      type: "scene-patch",
      requestId: "patch-frame-sequence",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      spreadId: "city-for-small-things",
      operations: [{ op: "update", elementId: element.id, frameAssetIds: firstFrames }],
    }, "agent");
    expect(patched).toMatchObject({ ok: true, changedIds: [element.id] });
    expect(engine.getSnapshot().document.spreads[0].elements[0].frameAssetIds).toEqual(firstFrames);

    const undone = engine.dispatch({
      type: "undo",
      requestId: "undo-frame-sequence",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 2,
      undoToken: patched.ok ? patched.undoToken : "",
    }, "agent");
    expect(undone).toMatchObject({ ok: true, changedIds: [element.id] });
    expect(engine.getSnapshot().document.spreads[0].elements[0].frameAssetIds).toBeUndefined();

    const redone = engine.dispatch({
      type: "undo",
      requestId: "redo-frame-sequence",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 3,
      undoToken: undone.ok ? undone.undoToken : "",
    }, "agent");
    expect(redone.ok).toBe(true);
    const newerFrames = [element.assetId, "/assets/generated/story-city-boy-cutout-v3.png"];
    expect(engine.dispatch({
      type: "scene-patch",
      requestId: "newer-frame-sequence",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 4,
      spreadId: "city-for-small-things",
      operations: [{ op: "update", elementId: element.id, frameAssetIds: newerFrames }],
    }, "agent")).toMatchObject({ ok: true });

    const conflicted = engine.dispatch({
      type: "undo",
      requestId: "conflict-old-frame-undo",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 5,
      undoToken: redone.ok ? redone.undoToken : "",
    }, "agent");
    expect(conflicted).toMatchObject({ ok: false, code: "undo_conflict" });
    expect(engine.getSnapshot().document.spreads[0].elements[0].frameAssetIds).toEqual(newerFrames);
  });

  it("undoes a remove-and-add replacement that keeps the same element id", () => {
    const engine = cityEngine();
    const original = structuredClone(engine.getSnapshot().document.spreads[0].elements[0]);
    const patched = engine.dispatch({
      type: "scene-patch",
      requestId: "replace-same-element-id",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      spreadId: "city-for-small-things",
      operations: [{
        op: "remove",
        elementId: original.id,
      }, {
        op: "add",
        id: original.id,
        label: "Replacement Bird",
        assetId: "/assets/generated/story-window-glow-cutout-v3.png",
        page: "right",
        transform: { x: 0.77, y: 0.31, scaleX: 0.51, scaleY: 0.64, rotationDeg: 12 },
      }],
    }, "agent");
    expect(patched).toMatchObject({ ok: true, changedIds: [original.id] });
    expect(engine.getSnapshot().document.spreads[0].elements.find((element) => element.id === original.id)).toMatchObject({
      label: "Replacement Bird",
      assetId: "/assets/generated/story-window-glow-cutout-v3.png",
      page: "right",
    });

    const undone = engine.dispatch({
      type: "undo",
      requestId: "undo-replace-same-element-id",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 2,
      undoToken: patched.ok ? patched.undoToken : "",
    }, "agent");
    expect(undone).toMatchObject({ ok: true, changedIds: [original.id] });
    const restored = engine.getSnapshot().document.spreads[0].elements.find((element) => element.id === original.id);
    expect(restored).toMatchObject({
      label: original.label,
      assetId: original.assetId,
      frameAssetIds: original.frameAssetIds,
      page: original.page,
      transform: original.transform,
    });
  });

  it("rejects bundled role confusion and repeated foreground finals without partially applying the patch", () => {
    const engine = cityEngine();
    const before = structuredClone(engine.getSnapshot().document);
    const spread = before.spreads[0];

    const wrongRole = engine.dispatch({
      type: "scene-patch",
      requestId: "reject-background-as-foreground",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: before.revision,
      spreadId: spread.id,
      operations: [{
        op: "add",
        id: "opaque-background-copy",
        label: "Opaque background copy",
        assetId: spread.artwork!.cleanPlateAssetId,
        page: "right",
      }],
    }, "agent");
    expect(wrongRole).toMatchObject({ ok: false, code: "invalid", summary: expect.stringMatching(/foreground role/i) });
    expect(engine.getSnapshot().document).toEqual(before);

    const repeatedFinal = engine.dispatch({
      type: "scene-patch",
      requestId: "reject-repeated-foreground-final",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: before.revision,
      spreadId: spread.id,
      operations: [{
        op: "add",
        id: "repeated-bird-final",
        label: "Repeated bird final",
        assetId: spread.elements[0].assetId,
        page: "right",
      }],
    }, "agent");
    expect(repeatedFinal).toMatchObject({ ok: false, code: "invalid", summary: expect.stringMatching(/distinct final assets/i) });
    expect(engine.getSnapshot().document).toEqual(before);
  });

  it("rejects image sequences on procedural markers and procedural ids inside image sequences", () => {
    const engine = cityEngine();
    const documentState = engine.getSnapshot().document;
    const spreadIndex = documentState.spreads.findIndex((candidate) => (
      candidate.elements.some(isProceduralElement)
      && candidate.elements.some((element) => !isProceduralElement(element))
    ));
    expect(spreadIndex).toBeGreaterThanOrEqual(0);
    engine.setSpread(spreadIndex);
    const before = structuredClone(engine.getSnapshot().document);
    const spread = before.spreads[spreadIndex];
    const marker = spread.elements.find(isProceduralElement)!;
    const image = spread.elements.find((element) => !isProceduralElement(element))!;
    const localFrame = localAssetId(900);

    const markerSequence = engine.dispatch({
      type: "scene-patch",
      requestId: "reject-procedural-marker-sequence",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: before.revision,
      spreadId: spread.id,
      operations: [{
        op: "update",
        elementId: marker.id,
        frameAssetIds: [marker.assetId, localFrame],
      }],
      validatedLocalAssetIds: [localFrame],
    }, "agent");
    expect(markerSequence).toMatchObject({ ok: false, code: "invalid" });
    expect(engine.getSnapshot().document).toEqual(before);

    const proceduralFrame = engine.dispatch({
      type: "scene-patch",
      requestId: "reject-procedural-sequence-frame",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: before.revision,
      spreadId: spread.id,
      operations: [{
        op: "update",
        elementId: image.id,
        frameAssetIds: [image.assetId, marker.assetId],
      }],
    }, "agent");
    expect(proceduralFrame).toMatchObject({ ok: false, code: "invalid" });
    expect(engine.getSnapshot().document).toEqual(before);
  });

  it("accepts the shared water-bob motion contract through scene patches", () => {
    const engine = cityEngine();
    engine.setSpread(1);
    const patched = engine.dispatch({
      type: "scene-patch",
      requestId: "water-bob-contract",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      spreadId: "river-home",
      operations: [{ op: "update", elementId: "river-paper-boat", motion: { preset: "water-bob", durationMs: 4200, loop: true } }],
    }, "agent");
    expect(patched.ok).toBe(true);
    expect(engine.getSnapshot().document.spreads[1].elements.find((element) => element.id === "river-paper-boat")?.motion?.preset).toBe("water-bob");
  });

  it("sets a clean spread background atomically and restores it on undo", () => {
    const engine = cityEngine();
    const patched = engine.dispatch({
      type: "scene-patch",
      requestId: "set-clean-background",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      spreadId: "city-for-small-things",
      operations: [{
        op: "set-background",
        sourceAssetId: "/assets/generated/guide-codex-spread-v2.png",
        cleanPlateAssetId: "/assets/generated/guide-codex-clean-v2.png",
      }, {
        op: "add",
        id: "clean-plate-foreground",
        label: "Clean plate foreground",
        assetId: "/assets/generated/story-window-glow-cutout-v3.png",
        page: "left",
      }],
    }, "agent");
    expect(patched).toMatchObject({ ok: true, changedIds: ["city-for-small-things:background", "clean-plate-foreground"] });
    expect(engine.getSnapshot().document.spreads[0].artwork).toEqual({
      sourceAssetId: "/assets/generated/guide-codex-spread-v2.png",
      cleanPlateAssetId: "/assets/generated/guide-codex-clean-v2.png",
      separation: "inpainted-clean-plate",
    });

    const undone = engine.dispatch({
      type: "undo",
      requestId: "undo-clean-background",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 2,
      undoToken: patched.ok ? patched.undoToken : "",
    }, "human");
    expect(undone).toMatchObject({ ok: true, changedIds: ["clean-plate-foreground", "city-for-small-things:background"] });
    expect(engine.getSnapshot().document.spreads[0].artwork).toEqual({
      sourceAssetId: "/assets/generated/city-spread.png",
      cleanPlateAssetId: "/assets/generated/story-city-clean-v2.png",
      separation: "inpainted-clean-plate",
    });
    expect(engine.getSnapshot().document.spreads[0].elements.some((element) => element.id === "clean-plate-foreground")).toBe(false);
  });

  it("accepts a cross-book local asset only after the trusted asset adapter validated it", () => {
    const engine = new BookEngine();
    const assetId = "asset:12345678-1234-4234-8234-123456789abc";
    const operation = {
      op: "add" as const,
      id: "travel-photo",
      label: "Travel photo",
      assetId,
      page: "right" as const,
    };

    const unvalidated = engine.dispatch({
      type: "scene-patch",
      requestId: "unvalidated-local-asset",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      spreadId: "flavian-amphitheatre",
      operations: [operation],
    }, "agent");
    expect(unvalidated).toMatchObject({ ok: false, code: "invalid" });

    const validated = engine.dispatch({
      type: "scene-patch",
      requestId: "validated-local-asset",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      spreadId: "flavian-amphitheatre",
      operations: [operation],
      validatedLocalAssetIds: [assetId],
    }, "agent");
    expect(validated).toMatchObject({ ok: true, changedIds: ["travel-photo"] });
    expect(engine.getSnapshot().document.spreads[0].elements.at(-1)).toMatchObject({ assetId, provenance: "agent" });
  });

  it("sets a dedicated local cover only after validation and supports safe undo", () => {
    const engine = new BookEngine();
    const assetId = "asset:12345678-1234-4234-8234-123456789abc";

    const rejected = engine.dispatch({
      type: "set-book-cover",
      requestId: "unvalidated-cover",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      assetId,
      validatedLocalAssetIds: [],
    }, "agent");
    expect(rejected).toMatchObject({ ok: false, code: "invalid" });

    const applied = engine.dispatch({
      type: "set-book-cover",
      requestId: "validated-cover",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      assetId,
      validatedLocalAssetIds: [assetId],
    }, "agent");
    expect(applied).toMatchObject({ ok: true, revision: 2 });
    expect(engine.getSnapshot().document.coverAssetId).toBe(assetId);
    expect(engine.getLibrary().books.find((book) => book.id === engine.getSnapshot().document.id)?.coverAssetId).toBe(assetId);

    const coverReuseWithoutAssetValidation = engine.dispatch({
      type: "scene-patch",
      requestId: "cover-is-not-scene-authorization",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 2,
      spreadId: "flavian-amphitheatre",
      operations: [{
        op: "add",
        id: "cover-copy",
        label: "Cover copy",
        assetId,
        page: "right",
      }],
    }, "agent");
    expect(coverReuseWithoutAssetValidation).toMatchObject({ ok: false, code: "invalid", currentRevision: 2 });

    const undone = engine.dispatch({
      type: "undo",
      requestId: "undo-cover",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 2,
      undoToken: applied.ok ? applied.undoToken : "",
    }, "agent");
    expect(undone).toMatchObject({ ok: true, revision: 3 });
    expect(engine.getSnapshot().document.coverAssetId).toBeUndefined();
  });

  it("does not reuse an interior foreground final as the book cover", () => {
    const engine = new BookEngine();
    const prepared = preparedBook([{ id: "opening", title: "Opening", body: "A layered opening." }]);
    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-before-cover-role-check",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-cover-role-check",
      title: "Cover Role Check",
      ...prepared,
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created.ok).toBe(true);
    const foregroundAssetId = engine.getSnapshot().document.spreads[0].elements[0].assetId;
    const before = structuredClone(engine.getSnapshot().document);

    const rejected = engine.dispatch({
      type: "set-book-cover",
      requestId: "reject-foreground-as-cover",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: before.revision,
      assetId: foregroundAssetId,
      validatedLocalAssetIds: [foregroundAssetId],
    }, "agent");

    expect(rejected).toMatchObject({ ok: false, code: "invalid", summary: expect.stringMatching(/cover as a foreground|cover.*foreground/i) });
    expect(engine.getSnapshot().document).toEqual(before);
  });

  it("keeps each sample book independent while switching the active shelf item", () => {
    const engine = cityEngine();
    expect(engine.getLibrary().books.find((book) => book.id === "apertale-atlas-of-wonders")?.coverTextureUrl).toBe("/assets/covers/atlas-of-living-wonders-v2.png");
    const edited = engine.dispatch({
      type: "edit",
      requestId: "move-city-bird",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      elementId: "bird",
      transform: { x: 0.71 },
    }, "human");
    expect(edited.ok).toBe(true);

    expect(engine.openBook("apertale-atlas-of-wonders")).toBe(true);
    expect(engine.getSnapshot().document).toMatchObject({ id: "apertale-atlas-of-wonders", revision: 1 });
    expect(engine.getSnapshot().document.spreads[0].elements.map((element) => element.id)).toEqual(["colosseum-procession", "colosseum-cypress", "colosseum-arena"]);

    expect(engine.openBook("apertale-your-story")).toBe(true);
    expect(engine.getSnapshot().document.revision).toBe(2);
    expect(engine.getSnapshot().document.spreads[0].elements[0].transform.x).toBe(0.71);
  });

  it("keeps complete render evidence for a fully rendered 12-spread book on both themes and surfaces", () => {
    localStorage.setItem("apertale.library.v4", JSON.stringify({
      activeBookId: "full-render-evidence-book",
      documents: [{
        id: "full-render-evidence-book",
        revision: 3,
        title: "Full Render Evidence Book",
        spreads: Array.from({ length: 12 }, (_, order) => ({
          id: `spread-${order + 1}`,
          order,
          title: `Spread ${order + 1}`,
          body: "A rendered spread.",
          elements: [],
        })),
      }],
      sampleSourceVersion: 3,
    }));
    const engine = new BookEngine();
    expect(engine.adoptCreationBrief(readyStoryBrief(12), [], 3, [])).toMatchObject({ ok: true });
    const document = engine.getSnapshot().document;

    for (const theme of THEME_IDS) {
      expect(engine.recordRenderEvidence({
        documentId: document.id,
        revision: document.revision,
        scope: "cover",
        theme,
        surface: "shelf",
        locator: `[data-book-id="${document.id}"] .library-cover-frame img`,
      })).toBe(true);
    }
    for (const spread of document.spreads) {
      for (const theme of THEME_IDS) {
        for (const surface of ["webgl", "fallback"] as const) {
          expect(engine.recordRenderEvidence({
            documentId: document.id,
            revision: document.revision,
            scope: "spread",
            spreadId: spread.id,
            theme,
            surface,
            locator: ".book-scene canvas",
          })).toBe(true);
        }
      }
    }
    // Re-recording one identity replaces its own entry instead of growing the buffer.
    expect(engine.recordRenderEvidence({
      documentId: document.id,
      revision: document.revision,
      scope: "spread",
      spreadId: document.spreads[0].id,
      theme: THEME_IDS[0],
      surface: "webgl",
      locator: ".book-scene canvas",
    })).toBe(true);

    const evidence = engine.getQualityLifecycle()?.renderEvidence ?? [];
    expect(evidence).toHaveLength(50);
    expect(new Set(evidence.map((item) => `${item.scope}:${item.spreadId ?? ""}:${item.theme}:${item.surface}`)).size).toBe(50);
    const completeness = evaluateDeterministicQuality(
      document,
      evidence,
      engine.getQualityLifecycle()?.creationBrief,
    ).find((check) => check.criterionId === "render-evidence-completeness");
    expect(completeness).toMatchObject({ outcome: "pass" });
  });

  it("does not resurrect cleared motion through a scene-patch interaction update", () => {
    const engine = cityEngine();
    const added = engine.dispatch({
      type: "scene-patch",
      requestId: "add-moving-gull",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      spreadId: "city-for-small-things",
      operations: [{
        op: "add",
        id: "moving-gull",
        label: "Moving gull",
        assetId: "/assets/generated/story-window-glow-cutout-v3.png",
        page: "left",
        motion: { preset: "water-bob", durationMs: 4200, loop: true },
        hover: "lift-glow",
      }],
    }, "agent");
    expect(added.ok).toBe(true);

    const retuned = engine.dispatch({
      type: "scene-patch",
      requestId: "retune-gull-hover",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: added.ok ? added.revision : 0,
      spreadId: "city-for-small-things",
      operations: [{ op: "update", elementId: "moving-gull", hover: "warm-rim" }],
    }, "agent");
    expect(retuned.ok).toBe(true);
    const stored = engine.getSnapshot().document.spreads[0].elements.find((element) => element.id === "moving-gull");
    expect(stored?.interaction).not.toHaveProperty("motion");

    const stilled = engine.dispatch({
      type: "animate",
      requestId: "still-the-gull",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: retuned.ok ? retuned.revision : 0,
      elementId: "moving-gull",
      motion: null,
    }, "human");
    expect(stilled.ok).toBe(true);
    const cleared = engine.getSnapshot().document.spreads[0].elements.find((element) => element.id === "moving-gull");
    expect(cleared?.motion).toBeUndefined();
    expect(cleared?.interaction).not.toHaveProperty("motion");
    expect(resolveInteraction(cleared!).motion).toBeUndefined();
  });

  const legacyInteractionMotion = { preset: "gentle-float", durationMs: 5200, loop: true };

  const legacyInteractionMotionEngine = () => {
    localStorage.setItem("apertale.library.v4", JSON.stringify({
      activeBookId: "legacy-interaction-motion-book",
      documents: [{
        id: "legacy-interaction-motion-book",
        revision: 2,
        title: "Legacy Interaction Motion Book",
        spreads: [{
          id: "legacy-spread",
          order: 0,
          title: "Legacy spread",
          body: "Two elements whose only animation lives in interaction.motion.",
          elements: ["legacy-drifter", "legacy-bobber"].map((id) => ({
            id,
            label: id === "legacy-drifter" ? "Legacy drifter" : "Legacy bobber",
            kind: "lifted",
            assetId: "/assets/generated/story-city-boy-cutout-v3.png",
            page: id === "legacy-drifter" ? "left" : "right",
            transform: { x: 0.5, y: 0.5, scaleX: 0.7, scaleY: 0.7, rotationDeg: 0 },
            depth: 0.1,
            locked: false,
            interaction: {
              hover: "lift-glow",
              focus: "spotlight",
              reveal: { kind: "caption", title: id, summary: "", facts: [] },
              hint: `Explore ${id}`,
              motion: legacyInteractionMotion,
            },
            provenance: "sample",
          })),
        }],
      }],
      sampleSourceVersion: 3,
    }));
    return new BookEngine();
  };

  it("keeps a legacy interaction-only motion alive across unrelated scene-patch interaction updates", () => {
    const engine = legacyInteractionMotionEngine();
    const retuned = engine.dispatch({
      type: "scene-patch",
      requestId: "retune-legacy-drifter-hover",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 2,
      spreadId: "legacy-spread",
      operations: [{ op: "update", elementId: "legacy-drifter", hover: "warm-rim" }],
    }, "agent");
    expect(retuned.ok).toBe(true);

    const stored = engine.getSnapshot().document.spreads[0].elements.find((element) => element.id === "legacy-drifter");
    expect(stored?.motion).toBeUndefined();
    expect(stored?.interaction?.hover).toBe("warm-rim");
    expect(stored?.interaction?.motion).toEqual(legacyInteractionMotion);
    expect(resolveInteraction(stored!).motion).toEqual(legacyInteractionMotion);
  });

  it("clears both motion representations on an explicit motion clear and keeps them cleared", () => {
    const engine = legacyInteractionMotionEngine();

    const stilled = engine.dispatch({
      type: "animate",
      requestId: "still-legacy-drifter",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 2,
      elementId: "legacy-drifter",
      motion: null,
    }, "human");
    expect(stilled.ok).toBe(true);

    const retuned = engine.dispatch({
      type: "scene-patch",
      requestId: "still-and-retune-legacy-bobber",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: stilled.ok ? stilled.revision : 0,
      spreadId: "legacy-spread",
      operations: [{ op: "update", elementId: "legacy-bobber", motion: null, hover: "warm-rim" }],
    }, "agent");
    expect(retuned.ok).toBe(true);

    const clearedDocument = engine.getSnapshot().document;
    for (const elementId of ["legacy-drifter", "legacy-bobber"]) {
      const stored = clearedDocument.spreads[0].elements.find((element) => element.id === elementId);
      expect(stored?.motion).toBeUndefined();
      expect(stored?.interaction).not.toHaveProperty("motion");
      expect(resolveInteraction(stored!).motion).toBeUndefined();
    }

    // A later unrelated interaction update must not resurrect the cleared motion.
    const revisited = engine.dispatch({
      type: "scene-patch",
      requestId: "retune-after-clear",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: retuned.ok ? retuned.revision : 0,
      spreadId: "legacy-spread",
      operations: [{ op: "update", elementId: "legacy-drifter", focus: "rise-and-center" }],
    }, "agent");
    expect(revisited.ok).toBe(true);
    const after = engine.getSnapshot().document.spreads[0].elements.find((element) => element.id === "legacy-drifter");
    expect(after?.interaction?.focus).toBe("rise-and-center");
    expect(after?.interaction).not.toHaveProperty("motion");
    expect(resolveInteraction(after!).motion).toBeUndefined();
  });

  it("enforces the inspected revision at the engine owner for critique begin and record", () => {
    const engine = new BookEngine();
    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-revision-owned-critique",
      expectedDocumentId: engine.getSnapshot().document.id, expectedRevision: 1,
      documentId: "book-revision-owned-critique",
      title: "Revision Owned Critique",
      ...preparedBook([{ id: "opening", title: "Opening", body: "A beginning." }]),
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created.ok).toBe(true);
    const revision = engine.getSnapshot().document.revision;

    expect(engine.beginQualityReview(revision + 1)).toEqual({
      ok: false,
      code: "revision_conflict",
      currentRevision: revision,
      summary: `Expected revision ${revision + 1}; refresh quality-review before starting critique.`,
    });
    expect(engine.beginQualityReview(revision)).toMatchObject({ ok: true, nextRound: 1 });
    expect(engine.recordQualityReview(blockingVisualReview(revision, 1), revision + 1)).toEqual({
      ok: false,
      code: "revision_conflict",
      currentRevision: revision,
      summary: `Expected revision ${revision + 1}; refresh quality-review before recording critique.`,
    });
    expect(recordCompleteRenderEvidence(engine)).toEqual([true, true]);
    expect(engine.recordQualityReview(blockingVisualReview(revision, 1), revision)).toMatchObject({
      ok: true,
      qualityReport: { round: 1 },
    });
  });
});
