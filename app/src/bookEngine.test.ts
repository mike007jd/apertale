import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookEngine } from "./bookEngine";
import { sampleBooks } from "./sampleBook";

const cityEngine = () => {
  const engine = new BookEngine();
  engine.openBook("apertale-your-story");
  return engine;
};

describe("BookEngine document contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("ships four independent sample books instead of one combined demo book", () => {
    expect(sampleBooks).toHaveLength(4);
    expect(sampleBooks.map((book) => book.id)).toEqual([
      "apertale-atlas-of-wonders",
      "apertale-how-world-works",
      "apertale-your-story",
      "apertale-lantern-garden",
    ]);
    expect(sampleBooks.map((book) => book.spreads.length)).toEqual([2, 1, 2, 1]);
    expect(new Set(sampleBooks.flatMap((book) => book.spreads.map((spread) => spread.id))).size).toBe(6);
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
    const engine = new BookEngine();
    const context = engine.getContext();
    expect(context.outline).toEqual([
      expect.objectContaining({ id: "flavian-amphitheatre", elementIds: ["colosseum"] }),
      expect.objectContaining({ id: "great-pyramid-of-giza", elementIds: ["great-pyramid"] }),
    ]);
    expect(context.library.books).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "apertale-atlas-of-wonders", spreadCount: 2 }),
      expect.objectContaining({ id: "apertale-how-world-works", spreadCount: 1 }),
      expect.objectContaining({ id: "apertale-your-story", spreadCount: 2 }),
      expect.objectContaining({ id: "apertale-lantern-garden", spreadCount: 1 }),
    ]));
    expect(context.currentSpread.elements).toEqual([
      expect.objectContaining({ id: "colosseum", label: "Colosseum", kind: "lifted", locked: false }),
    ]);
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(1500);
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
    const engine = new BookEngine();
    engine.setTheme("midnight-desk", "agent");
    expect(engine.getSnapshot().session.sceneThemeId).toBe("midnight-desk");
    expect(engine.getSnapshot().document.revision).toBe(1);
  });

  it("keeps Agent book and Preview actions visibly attributed until their own timeout", () => {
    const engine = cityEngine();
    engine.openBook("apertale-atlas-of-wonders", "agent");
    expect(engine.getSnapshot().lastAction).toMatchObject({ source: "agent", summary: "ChatGPT opened Atlas of Living Wonders" });

    vi.advanceTimersByTime(1600);
    engine.setPreview(true, "agent");
    expect(engine.getSnapshot().lastAction).toMatchObject({ source: "agent", summary: "ChatGPT entered Preview" });

    vi.advanceTimersByTime(1600);
    expect(engine.getSnapshot().lastAction).toMatchObject({ summary: "ChatGPT entered Preview" });
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
    const engine = new BookEngine();
    const retuned = engine.dispatch({
      type: "interact",
      requestId: "interact-1",
      expectedRevision: 1,
      elementId: "colosseum",
      interaction: { focus: "rise-and-center" },
    }, "agent");
    expect(retuned.ok).toBe(true);
    const landmark = () => engine.getSnapshot().document.spreads[0].elements[0];
    expect(landmark().interaction?.focus).toBe("rise-and-center");
    expect(landmark().interaction?.hover).toBe("tilt-toward-pointer");
    engine.dispatch({ type: "edit", requestId: "move-landmark", expectedRevision: 2, elementId: "colosseum", transform: { x: 0.44 } }, "human");
    const undone = engine.dispatch({
      type: "undo",
      requestId: "undo-interact",
      expectedRevision: 3,
      undoToken: retuned.ok ? retuned.undoToken : "",
    }, "human");
    expect(undone.ok).toBe(true);
    expect(landmark().interaction?.focus).toBe("orbit-inspect");
    expect(landmark().transform.x).toBe(0.44);
  });

  it("reports the resolved interaction of the selection to the Agent", () => {
    const engine = new BookEngine();
    engine.setSelection("colosseum");
    expect(engine.getContext().selection).toMatchObject({
      id: "colosseum",
      interaction: { hover: "tilt-toward-pointer", focus: "orbit-inspect", reveal: "fact-card" },
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

  it("adds a local photo to the visible spread and can undo and restore it", () => {
    const engine = new BookEngine();
    const element = {
      id: "photo-test",
      label: "Harbour photo",
      kind: "lifted" as const,
      assetId: "data:image/png;base64,AAAA",
      page: "right" as const,
      transform: { x: 0.5, y: 0.5, scaleX: 0.72, scaleY: 0.72, rotationDeg: 0 },
      depth: 0.12,
      locked: false,
      interaction: {
        hover: "lift-glow" as const,
        focus: "spotlight" as const,
        reveal: { kind: "caption" as const, title: "Harbour photo", summary: "Local", facts: [] },
      },
      provenance: "human" as const,
    };
    const added = engine.dispatch({
      type: "add",
      requestId: "add-photo",
      expectedRevision: 1,
      spreadId: "flavian-amphitheatre",
      element,
    }, "human");
    expect(added.ok).toBe(true);
    expect(engine.getSnapshot().document.spreads[0].elements.at(-1)?.id).toBe("photo-test");

    const removed = engine.dispatch({
      type: "undo",
      requestId: "remove-photo",
      expectedRevision: 2,
      undoToken: added.ok ? added.undoToken : "",
    }, "human");
    expect(removed.ok).toBe(true);
    expect(engine.getSnapshot().document.spreads[0].elements.some((item) => item.id === "photo-test")).toBe(false);

    const restored = engine.dispatch({
      type: "undo",
      requestId: "restore-photo",
      expectedRevision: 3,
      undoToken: removed.ok ? removed.undoToken : "",
    }, "human");
    expect(restored.ok).toBe(true);
    expect(engine.getSnapshot().document.spreads[0].elements.at(-1)).toMatchObject({ id: "photo-test", label: "Harbour photo" });
  });

  it("rejects oversized image data at the engine boundary", () => {
    const engine = new BookEngine();
    const result = engine.dispatch({
      type: "add",
      requestId: "oversized-photo",
      expectedRevision: 1,
      spreadId: "flavian-amphitheatre",
      element: {
        id: "oversized-photo",
        label: "Oversized photo",
        kind: "lifted",
        assetId: `data:image/png;base64,${"A".repeat(2_100_000)}`,
        page: "right",
        transform: { x: 0.5, y: 0.5, scaleX: 0.72, scaleY: 0.72, rotationDeg: 0 },
        depth: 0.12,
        locked: false,
        interaction: { hover: "none", focus: "none", reveal: { kind: "none", title: "", summary: "", facts: [] } },
        provenance: "human",
      },
    }, "human");

    expect(result.ok).toBe(false);
    expect(engine.getSnapshot().document.spreads[0].elements.some((item) => item.id === "oversized-photo")).toBe(false);
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

  it("rejects a create command that would overwrite an existing shelf book", () => {
    const engine = new BookEngine();
    const result = engine.dispatch({
      type: "create-book",
      requestId: "duplicate-shelf-book",
      expectedRevision: 1,
      documentId: "apertale-atlas-of-wonders",
      title: "Replacement Atlas",
      spreads: [{ id: "replacement", title: "Replacement", body: "This must not overwrite the sample." }],
    }, "agent");
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(engine.getSnapshot().document.title).toBe("Atlas of Living Wonders");
  });

  it("applies a bounded scene patch atomically and undoes the whole patch", () => {
    const engine = new BookEngine();
    const patched = engine.dispatch({
      type: "scene-patch",
      requestId: "scene-patch",
      expectedRevision: 1,
      spreadId: "flavian-amphitheatre",
      operations: [
        { op: "update", elementId: "colosseum", transform: { x: 0.41 }, hover: "warm-rim" },
        {
          op: "add",
          id: "second-colosseum",
          label: "Second Colosseum",
          assetId: "model:flavian-amphitheatre",
          modelId: "flavian-amphitheatre",
          page: "left",
          reveal: {
            kind: "fact-card",
            title: "Arena engineering",
            summary: "A compact second view explains how the amphitheatre moved people.",
            facts: [{ label: "Entrances", value: "80 numbered arches" }],
            source: "Apertale sample knowledge",
          },
        },
        { op: "reorder", elementId: "second-colosseum", index: 0 },
      ],
    }, "agent");
    expect(patched).toMatchObject({ ok: true, changedIds: ["colosseum", "second-colosseum"] });
    expect(engine.getSnapshot().document.spreads[0].elements.map((element) => element.id)).toEqual(["second-colosseum", "colosseum"]);
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
    expect(engine.getSnapshot().document.spreads[0].elements.map((element) => element.id)).toEqual(["colosseum"]);
    expect(engine.getSnapshot().document.spreads[0].elements[0].transform.x).toBe(0.5);
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

  it("keeps each sample book independent while switching the active shelf item", () => {
    const engine = cityEngine();
    expect(engine.getLibrary().books.find((book) => book.id === "apertale-atlas-of-wonders")?.coverTextureUrl).toBe("/assets/covers/atlas-of-living-wonders.jpg");
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
    expect(engine.getSnapshot().document.spreads[0].elements[0].id).toBe("colosseum");

    expect(engine.openBook("apertale-your-story")).toBe(true);
    expect(engine.getSnapshot().document.revision).toBe(2);
    expect(engine.getSnapshot().document.spreads[0].elements[0].transform.x).toBe(0.71);
  });
});
