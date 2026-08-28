import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookEngine } from "./bookEngine";
import { hasReveal, resolveInteraction } from "./interaction";
import { sampleBooks } from "./sampleBook";

const cityEngine = () => {
  const engine = new BookEngine();
  engine.openBook("apertale-your-story");
  return engine;
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

  it("rejects a create command that would overwrite an existing library book", () => {
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
});
