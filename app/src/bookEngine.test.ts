import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookEngine } from "./bookEngine";
import { hasReveal, resolveInteraction } from "./interaction";
import { evaluateDeterministicQuality, QUALITY_VISUAL_CRITERION_IDS, assertPublishableQuality, type QualityVisualReviewSubmission } from "./qualityContract";
import { sampleBooks } from "./sampleBook";
import { THEME_IDS } from "./types";

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

const blockingVisualReview = (revision: number, expectedRound: number): QualityVisualReviewSubmission => ({
  contractVersion: 1,
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
      expect(
        layeredShowcase.elements.filter((element) => !element.assetId.startsWith("procedural:")).length,
        `${layeredShowcase.title} should ship multiple real foreground layers`,
      ).toBeGreaterThanOrEqual(2);
    });
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
      .filter((element) => !element.assetId.startsWith("procedural:"));
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
    const taj = atlas.spreads.find((item) => item.id === "taj-mahal")!.elements.find((element) => element.id === "taj-monument")!;
    taj.transform.x = 0.91;
    taj.interaction!.focus = "orbit-inspect";
    localStorage.setItem("apertale.library.v4", JSON.stringify({ activeBookId: atlas.id, documents }));

    const migrated = new BookEngine().getSnapshot().document;
    const migratedTaj = migrated.spreads.find((item) => item.id === "taj-mahal")!.elements.find((element) => element.id === "taj-monument")!;
    expect(migratedTaj.transform.x).toBe(0.91);
    expect(migratedTaj.interaction?.focus).toBe("spotlight");
  });

  it("commits one revision and returns an undo token", () => {
    const engine = cityEngine();
    const result = engine.dispatch({ type: "lift", requestId: "lift-1", expectedRevision: 1, elementId: "bird" }, "agent");
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
      expect.objectContaining({ id: "colosseum-procession", kind: "lifted" }),
      expect.objectContaining({ id: "colosseum-cypress", kind: "lifted" }),
    ]));
    expect(context.capabilities).toContain("set-book-cover");
    expect(context.capabilities).toContain("full-spread-illustration-stage");
    expect(context.capabilities).toContain("layered-image-interaction");
    expect(context.capabilities).toContain("browser-image-optimization");
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(2150);
  });

  it("rejects stale revisions without mutating state", () => {
    const engine = cityEngine();
    const result = engine.dispatch({ type: "lift", requestId: "stale", expectedRevision: 99, elementId: "bird" }, "agent");
    expect(result).toMatchObject({ ok: false, code: "revision_conflict", currentRevision: 1 });
    expect(engine.getSnapshot().document.revision).toBe(1);
  });

  it("is idempotent by requestId", () => {
    const engine = cityEngine();
    const command = { type: "lift" as const, requestId: "same", expectedRevision: 1, elementId: "bird" };
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
      expectedRevision: 1,
      elementId: "bird",
      motion: { preset: "fly-across", durationMs: 5200, loop: true },
    }, "agent");
    expect(animated.ok).toBe(true);
    engine.dispatch({ type: "edit", requestId: "move-1", expectedRevision: 2, elementId: "bird", transform: { x: 0.76 } }, "human");
    const undone = engine.dispatch({
      type: "undo",
      requestId: "undo-1",
      expectedRevision: 3,
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
      expectedRevision: 1,
      spreadId: "city-for-small-things",
      body: "A clockwork city wakes beneath the paper clouds.",
    }, "agent");
    expect(composed.ok).toBe(true);

    engine.dispatch({
      type: "edit",
      requestId: "move-after-compose",
      expectedRevision: 2,
      elementId: "bird",
      transform: { x: 0.77 },
    }, "human");
    const undone = engine.dispatch({
      type: "undo",
      requestId: "undo-compose-after-move",
      expectedRevision: 3,
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
      expectedRevision: 1,
      elementId: "bird",
      interaction: { focus: "rise-and-center" },
    }, "agent");
    expect(retuned.ok).toBe(true);
    const landmark = () => engine.getSnapshot().document.spreads[0].elements[0];
    expect(landmark().interaction?.focus).toBe("rise-and-center");
    expect(landmark().interaction?.hover).toBe("lift-glow");
    engine.dispatch({ type: "edit", requestId: "move-landmark", expectedRevision: 2, elementId: "bird", transform: { x: 0.44 } }, "human");
    const undone = engine.dispatch({
      type: "undo",
      requestId: "undo-interact",
      expectedRevision: 3,
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
    const lifted = engine.dispatch({ type: "lift", requestId: "lift-redo", expectedRevision: 1, elementId: "bird" }, "human");
    expect(lifted.ok).toBe(true);
    const undone = engine.dispatch({
      type: "undo",
      requestId: "undo-redo",
      expectedRevision: 2,
      undoToken: lifted.ok ? lifted.undoToken : "",
    }, "human");
    expect(undone.ok).toBe(true);
    const redone = engine.dispatch({
      type: "undo",
      requestId: "redo",
      expectedRevision: 3,
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
      expectedRevision: 1,
      elementId: "bird",
      transform: { x: 0.7 },
    }, "human");
    expect(first.ok).toBe(true);
    engine.dispatch({
      type: "edit",
      requestId: "agent-transform",
      expectedRevision: 2,
      elementId: "bird",
      transform: { x: 0.82 },
    }, "agent");
    const result = engine.dispatch({
      type: "undo",
      requestId: "conflicting-undo",
      expectedRevision: 3,
      undoToken: first.ok ? first.undoToken : "",
    }, "human");
    expect(result).toMatchObject({ ok: false, code: "undo_conflict", currentRevision: 3 });
    expect(engine.getSnapshot().document.spreads[0].elements[0].transform.x).toBe(0.82);
  });

  it("allows an Agent undo token to be used by the human history", () => {
    const engine = cityEngine();
    const agentLift = engine.dispatch({ type: "lift", requestId: "agent-lift", expectedRevision: 1, elementId: "bird" }, "agent");
    expect(agentLift.ok).toBe(true);
    const humanUndo = engine.dispatch({
      type: "undo",
      requestId: "human-undo-agent",
      expectedRevision: 2,
      undoToken: agentLift.ok ? agentLift.undoToken : "",
    }, "human");
    expect(humanUndo.ok).toBe(true);
    expect(engine.getSnapshot().document.spreads[0].elements[0].kind).toBe("embedded");
  });

  it("creates and composes a book through reversible structural commands", () => {
    const engine = new BookEngine();
    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-book",
      expectedRevision: 1,
      documentId: "book-how-tides-move",
      title: "How Tides Move",
      spreads: [
        { id: "moon-pulls", title: "The Moon Pulls", body: "Gravity reaches across the water." },
        { id: "coast-responds", title: "The Coast Responds", body: "The coast makes the rhythm visible." },
      ],
      creationBrief: readyStoryBrief(2),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created.ok).toBe(true);
    expect(engine.getSnapshot().document).toMatchObject({ title: "How Tides Move", spreads: [{ id: "moon-pulls" }, { id: "coast-responds" }] });

    const composed = engine.dispatch({
      type: "compose-spread",
      requestId: "compose-spread",
      expectedRevision: 2,
      spreadId: "moon-pulls",
      body: "The Moon's gravity pulls the ocean into two broad bulges.",
    }, "agent");
    expect(composed.ok).toBe(true);
    expect(engine.getSnapshot().document.spreads[0].body).toContain("two broad bulges");

    const undone = engine.dispatch({
      type: "undo",
      requestId: "undo-compose",
      expectedRevision: 3,
      undoToken: composed.ok ? composed.undoToken : "",
    }, "agent");
    expect(undone.ok).toBe(true);
    expect(engine.getSnapshot().document.spreads[0].body).toBe("Gravity reaches across the water.");
  });

  it("undoes and redoes book creation together with its shelf membership", () => {
    const engine = new BookEngine();
    const startingBookId = engine.getSnapshot().document.id;
    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-shelf-book",
      expectedRevision: 1,
      documentId: "book-cloud-atlas",
      title: "Cloud Atlas",
      spreads: [{ id: "cloud-shapes", title: "Cloud Shapes", body: "A field guide to the sky." }],
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created.ok).toBe(true);
    expect(engine.getLibrary().books.some((book) => book.id === "book-cloud-atlas")).toBe(true);

    const undone = engine.dispatch({
      type: "undo",
      requestId: "undo-create-shelf-book",
      expectedRevision: 2,
      undoToken: created.ok ? created.undoToken : "",
    }, "agent");
    expect(undone.ok).toBe(true);
    expect(engine.getSnapshot().document.id).toBe(startingBookId);
    expect(engine.getLibrary().books.some((book) => book.id === "book-cloud-atlas")).toBe(false);

    const redone = engine.dispatch({
      type: "undo",
      requestId: "redo-create-shelf-book",
      expectedRevision: 3,
      undoToken: undone.ok ? undone.undoToken : "",
    }, "agent");
    expect(redone.ok).toBe(true);
    expect(engine.getSnapshot().document.id).toBe("book-cloud-atlas");
    expect(engine.getLibrary().books.some((book) => book.id === "book-cloud-atlas")).toBe(true);
  });

  it("rejects a create command that would overwrite an existing library book", () => {
    const engine = new BookEngine();
    const result = engine.dispatch({
      type: "create-book",
      requestId: "duplicate-shelf-book",
      expectedRevision: 1,
      documentId: "apertale-atlas-of-wonders",
      title: "Replacement Atlas",
      spreads: [{ id: "replacement", title: "Replacement", body: "This must not overwrite the sample." }],
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
      expectedRevision: 1,
      documentId: "book-not-ready",
      title: "Not Ready",
      spreads: [{ id: "only-spread", title: "Only Spread", body: "This must not be created." }],
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

    const adopted = engine.adoptCreationBrief(readyStoryBrief(1), [], 5);
    expect(adopted).toMatchObject({ ok: true, currentRevision: 5, qualityGate: { status: "needs-review" } });
    expect(engine.adoptCreationBrief(readyStoryBrief(1), [], 5)).toMatchObject({
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
      contractVersion: 1,
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
    expect(reviewed).toMatchObject({ ok: true, qualityReport: { status: "ready", publishAllowed: true } });
    if (!reviewed.ok) throw new Error("Expected a ready legacy review.");
    expect(() => assertPublishableQuality(engine.getSnapshot().document, reviewed.qualityReport)).not.toThrow();
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
          report: { reviewedRevision: 5, publishAllowed: true },
        },
      },
    }));
    const engine = new BookEngine();
    expect(engine.getQualityGate()).toMatchObject({ status: "ready", remainingRounds: 0 });

    expect(engine.dispatch({
      type: "compose-spread",
      requestId: "edit-approved-book",
      expectedRevision: 5,
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
      expectedRevision: 1,
      documentId: "book-missing-photo",
      title: "A Portrait Story",
      spreads: [{ id: "portrait", title: "Portrait", body: "A source-true beginning." }],
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
      expectedRevision: 1,
      documentId: "book-policy-story",
      title: "Policy Story",
      spreads: [{ id: "opening", title: "Opening", body: "A generated beginning." }],
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(storyCreated.ok).toBe(true);
    expect(story.dispatch({
      type: "scene-patch",
      requestId: "inject-undeclared-source",
      expectedRevision: storyCreated.ok ? storyCreated.revision : 0,
      spreadId: "opening",
      operations: operations("inpainted-clean-plate", sourceId),
      validatedLocalAssetIds: [sourceId],
    }, "agent")).toMatchObject({ ok: false, code: "invalid", summary: expect.stringMatching(/personal-photo/i) });
    expect(story.dispatch({
      type: "scene-patch",
      requestId: "wrong-preserved-story",
      expectedRevision: storyCreated.ok ? storyCreated.revision : 0,
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
      expectedRevision: album.getSnapshot().document.revision,
      documentId: "book-policy-album",
      title: "Policy Album",
      spreads: [{ id: "opening", title: "Opening", body: "The original portrait remains intact." }],
      creationBrief: albumBrief,
      validatedSourceAssetIds: [sourceId],
    }, "agent");
    expect(albumCreated.ok).toBe(true);
    expect(album.dispatch({
      type: "scene-patch",
      requestId: "wrong-generated-album",
      expectedRevision: albumCreated.ok ? albumCreated.revision : 0,
      spreadId: "opening",
      operations: operations("inpainted-clean-plate"),
      validatedLocalAssetIds: [sourceId],
    }, "agent")).toMatchObject({ ok: false, code: "invalid", summary: expect.stringMatching(/preserved-photo-layout/i) });
    expect(album.dispatch({
      type: "scene-patch",
      requestId: "valid-preserved-album",
      expectedRevision: albumCreated.ok ? albumCreated.revision : 0,
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
      expectedRevision: 1,
      documentId: "book-photo-keepsake",
      title: "Family Light",
      spreads: [{ id: "opening", title: "Family Light", body: "A source-true memory becomes a new composition." }],
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

    const patched = engine.dispatch({
      type: "scene-patch",
      requestId: "compose-photo-keepsake",
      expectedRevision: created.ok ? created.revision : 0,
      spreadId: "opening",
      validatedLocalAssetIds: [sourceId],
      operations: [{
        op: "set-background",
        sourceAssetId: "/assets/generated/wonders-colosseum.png",
        cleanPlateAssetId: "/assets/generated/wonders-colosseum-clean-v2.png",
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
      sourceAssetId: "/assets/generated/wonders-colosseum.png",
      cleanPlateAssetId: "/assets/generated/wonders-colosseum-clean-v2.png",
      personalSourceAssetId: sourceId,
    });
  });

  it("stops the critique-patch loop after two blocker rounds", () => {
    const engine = new BookEngine();
    const created = engine.dispatch({
      type: "create-book",
      requestId: "create-quality-loop",
      expectedRevision: 1,
      documentId: "book-quality-loop",
      title: "Quality Loop",
      spreads: [{ id: "opening", title: "Opening", body: "A beginning." }],
      creationBrief: readyStoryBrief(1),
      validatedSourceAssetIds: [],
    }, "agent");
    expect(created.ok).toBe(true);
    const revision = engine.getSnapshot().document.revision;

    expect(engine.recordQualityReview(blockingVisualReview(revision, 1))).toMatchObject({
      ok: false,
      code: "quality_review_not_started",
    });
    expect(engine.beginQualityReview()).toMatchObject({ ok: true, nextRound: 1 });
    const first = engine.recordQualityReview(blockingVisualReview(revision, 1));
    expect(first).toMatchObject({
      ok: true,
      qualityReport: { round: 1, status: "blocked", publishAllowed: false },
    });

    expect(engine.beginQualityReview()).toMatchObject({ ok: false, code: "quality_patch_required" });
    const patched = engine.dispatch({
      type: "compose-spread",
      requestId: "patch-after-critique",
      expectedRevision: revision,
      spreadId: "opening",
      body: "A clearer beginning after critique.",
    }, "agent");
    expect(patched.ok).toBe(true);
    const patchedRevision = engine.getSnapshot().document.revision;
    expect(engine.beginQualityReview()).toMatchObject({ ok: true, nextRound: 2 });
    const second = engine.recordQualityReview(blockingVisualReview(patchedRevision, 2));
    expect(second).toMatchObject({
      ok: true,
      qualityReport: { round: 2, status: "needs-user-input", publishAllowed: false },
    });
    expect(engine.beginQualityReview()).toMatchObject({
      ok: false,
      code: "quality_review_limit",
      qualityGate: { status: "needs-user-input", remainingRounds: 0 },
    });
  });

  it("applies a bounded scene patch atomically and undoes the whole patch", () => {
    const engine = cityEngine();
    const originalX = engine.getSnapshot().document.spreads[0].elements[0].transform.x;
    const patched = engine.dispatch({
      type: "scene-patch",
      requestId: "scene-patch",
      expectedRevision: 1,
      spreadId: "city-for-small-things",
      operations: [
        { op: "update", elementId: "bird", transform: { x: 0.41 }, hover: "warm-rim" },
        {
          op: "add",
          id: "second-bird",
          label: "Second Bird",
          assetId: "/assets/generated/story-city-boy-cutout-v3.png",
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
      expectedRevision: 2,
      undoToken: patched.ok ? patched.undoToken : "",
    }, "human");
    expect(undone.ok).toBe(true);
    expect(engine.getSnapshot().document.spreads[0].elements.map((element) => element.id)).toEqual(["bird", "city-flower-towers", "city-cloud-family", "paper-tower"]);
    expect(engine.getSnapshot().document.spreads[0].elements[0].transform.x).toBe(originalX);
  });

  it("accepts the shared water-bob motion contract through scene patches", () => {
    const engine = cityEngine();
    engine.setSpread(1);
    const patched = engine.dispatch({
      type: "scene-patch",
      requestId: "water-bob-contract",
      expectedRevision: 1,
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
      expectedRevision: 1,
      spreadId: "city-for-small-things",
      operations: [{
        op: "set-background",
        sourceAssetId: "/assets/generated/city-spread.png",
        cleanPlateAssetId: "/assets/generated/story-river-clean-v2.png",
      }, {
        op: "add",
        id: "clean-plate-foreground",
        label: "Clean plate foreground",
        assetId: "/assets/generated/story-city-boy-cutout-v3.png",
        page: "left",
      }],
    }, "agent");
    expect(patched).toMatchObject({ ok: true, changedIds: ["city-for-small-things:background", "clean-plate-foreground"] });
    expect(engine.getSnapshot().document.spreads[0].artwork).toEqual({
      sourceAssetId: "/assets/generated/city-spread.png",
      cleanPlateAssetId: "/assets/generated/story-river-clean-v2.png",
      separation: "inpainted-clean-plate",
    });

    const undone = engine.dispatch({
      type: "undo",
      requestId: "undo-clean-background",
      expectedRevision: 2,
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
    const assetId = "asset:12345678-1234-1234-1234-123456789abc";
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
      expectedRevision: 1,
      spreadId: "flavian-amphitheatre",
      operations: [operation],
    }, "agent");
    expect(unvalidated).toMatchObject({ ok: false, code: "invalid" });

    const validated = engine.dispatch({
      type: "scene-patch",
      requestId: "validated-local-asset",
      expectedRevision: 1,
      spreadId: "flavian-amphitheatre",
      operations: [operation],
      validatedLocalAssetIds: [assetId],
    }, "agent");
    expect(validated).toMatchObject({ ok: true, changedIds: ["travel-photo"] });
    expect(engine.getSnapshot().document.spreads[0].elements.at(-1)).toMatchObject({ assetId, provenance: "agent" });
  });

  it("sets a dedicated local cover only after validation and supports safe undo", () => {
    const engine = new BookEngine();
    const assetId = "asset:12345678-1234-1234-1234-123456789abc";

    const rejected = engine.dispatch({
      type: "set-book-cover",
      requestId: "unvalidated-cover",
      expectedRevision: 1,
      assetId,
      validatedLocalAssetIds: [],
    }, "agent");
    expect(rejected).toMatchObject({ ok: false, code: "invalid" });

    const applied = engine.dispatch({
      type: "set-book-cover",
      requestId: "validated-cover",
      expectedRevision: 1,
      assetId,
      validatedLocalAssetIds: [assetId],
    }, "agent");
    expect(applied).toMatchObject({ ok: true, revision: 2 });
    expect(engine.getSnapshot().document.coverAssetId).toBe(assetId);
    expect(engine.getLibrary().books.find((book) => book.id === engine.getSnapshot().document.id)?.coverAssetId).toBe(assetId);

    const coverReuseWithoutAssetValidation = engine.dispatch({
      type: "scene-patch",
      requestId: "cover-is-not-scene-authorization",
      expectedRevision: 2,
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
      expectedRevision: 2,
      undoToken: applied.ok ? applied.undoToken : "",
    }, "agent");
    expect(undone).toMatchObject({ ok: true, revision: 3 });
    expect(engine.getSnapshot().document.coverAssetId).toBeUndefined();
  });

  it("keeps each sample book independent while switching the active shelf item", () => {
    const engine = cityEngine();
    expect(engine.getLibrary().books.find((book) => book.id === "apertale-atlas-of-wonders")?.coverTextureUrl).toBe("/assets/covers/atlas-of-living-wonders-v2.png");
    const edited = engine.dispatch({
      type: "edit",
      requestId: "move-city-bird",
      expectedRevision: 1,
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
    expect(engine.adoptCreationBrief(readyStoryBrief(12), [], 3)).toMatchObject({ ok: true });
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
      expectedRevision: 1,
      spreadId: "city-for-small-things",
      operations: [{
        op: "add",
        id: "moving-gull",
        label: "Moving gull",
        assetId: "/assets/generated/story-city-boy-cutout-v3.png",
        page: "left",
        motion: { preset: "water-bob", durationMs: 4200, loop: true },
        hover: "lift-glow",
      }],
    }, "agent");
    expect(added.ok).toBe(true);

    const retuned = engine.dispatch({
      type: "scene-patch",
      requestId: "retune-gull-hover",
      expectedRevision: added.ok ? added.revision : 0,
      spreadId: "city-for-small-things",
      operations: [{ op: "update", elementId: "moving-gull", hover: "warm-rim" }],
    }, "agent");
    expect(retuned.ok).toBe(true);
    const stored = engine.getSnapshot().document.spreads[0].elements.find((element) => element.id === "moving-gull");
    expect(stored?.interaction).not.toHaveProperty("motion");

    const stilled = engine.dispatch({
      type: "animate",
      requestId: "still-the-gull",
      expectedRevision: retuned.ok ? retuned.revision : 0,
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
      expectedRevision: 2,
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
      expectedRevision: 2,
      elementId: "legacy-drifter",
      motion: null,
    }, "human");
    expect(stilled.ok).toBe(true);

    const retuned = engine.dispatch({
      type: "scene-patch",
      requestId: "still-and-retune-legacy-bobber",
      expectedRevision: stilled.ok ? stilled.revision : 0,
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
      expectedRevision: retuned.ok ? retuned.revision : 0,
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
      expectedRevision: 1,
      documentId: "book-revision-owned-critique",
      title: "Revision Owned Critique",
      spreads: [{ id: "opening", title: "Opening", body: "A beginning." }],
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
    expect(engine.recordQualityReview(blockingVisualReview(revision, 1), revision)).toMatchObject({
      ok: true,
      qualityReport: { round: 1 },
    });
  });
});
