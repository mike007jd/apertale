import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookEngine } from "./bookEngine";

describe("BookEngine document contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("commits one revision and returns an undo token", () => {
    const engine = new BookEngine();
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
      expect.objectContaining({ id: "city-for-small-things", elementIds: ["bird"] }),
      expect.objectContaining({ id: "lantern-garden", elementIds: ["fox"] }),
      expect.objectContaining({ id: "river-home", elementIds: [] }),
    ]);
    expect(context.currentSpread.elements).toEqual([
      expect.objectContaining({ id: "bird", label: "Bird", kind: "embedded", locked: false }),
    ]);
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(1500);
  });

  it("rejects stale revisions without mutating state", () => {
    const engine = new BookEngine();
    const result = engine.dispatch({ type: "lift", requestId: "stale", expectedRevision: 99, elementId: "bird" }, "agent");
    expect(result).toMatchObject({ ok: false, code: "revision_conflict", currentRevision: 1 });
    expect(engine.getSnapshot().document.revision).toBe(1);
  });

  it("is idempotent by requestId", () => {
    const engine = new BookEngine();
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

  it("undoes motion while preserving a later transform", () => {
    const engine = new BookEngine();
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

  it("returns a usable token that can undo an undo", () => {
    const engine = new BookEngine();
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
    const engine = new BookEngine();
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
    const engine = new BookEngine();
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
});
