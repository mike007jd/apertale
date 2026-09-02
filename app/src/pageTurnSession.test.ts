// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canTurnPage,
  createPageTurnSession,
  pageTurnNavDisabled,
  pageTurnWaitState,
} from "./pageTurnSession";
import type { TurnState } from "./types";

type Harness = ReturnType<typeof makeHarness>;

/**
 * The session drives real `requestAnimationFrame` and `performance.now`, so
 * the test owns the clock instead of a dependency seam. jsdom supplies both;
 * fake timers make them steppable.
 */
beforeEach(() => vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] }));
afterEach(() => vi.useRealTimers());

function makeHarness(options: { spreadCount?: number; reducedMotion?: boolean } = {}) {
  const commits: Array<"forward" | "backward"> = [];
  const turns: TurnState[] = [];
  let index = 0;
  const count = options.spreadCount ?? 4;
  let reducedMotion = options.reducedMotion ?? false;

  const controller = createPageTurnSession({
    setTurn: (turn) => turns.push(turn),
    commit: (direction) => {
      commits.push(direction);
      index = Math.max(0, Math.min(count - 1, index + (direction === "forward" ? 1 : -1)));
    },
    navigationKey: () => index,
    reducedMotion: () => reducedMotion,
    canTurn: (direction) => (direction === "forward" ? index < count - 1 : index > 0),
  });

  return {
    controller,
    commits,
    turns,
    advance: (ms: number) => vi.advanceTimersByTime(ms),
    hasPendingFrame: () => vi.getTimerCount() > 0,
    currentIndex: () => index,
    setIndex: (value: number) => { index = value; },
    setReducedMotion: (value: boolean) => { reducedMotion = value; },
    liveTurn: () => turns[turns.length - 1],
  };
}

/** Drives a turn all the way past its longest possible duration. */
function settle(harness: Harness) {
  for (let step = 0; step < 80 && harness.hasPendingFrame(); step += 1) harness.advance(16);
}

describe("page-turn session lifecycle", () => {
  it("locks navigation until the animated reader has a complete frame", () => {
    expect(pageTurnNavDisabled(null, 1, 4, { backward: true, forward: true })).toEqual({
      previous: true,
      next: true,
    });
    expect(pageTurnNavDisabled(null, 1, 4, { backward: false, forward: false })).toEqual({
      previous: false,
      next: false,
    });
    expect(canTurnPage("forward", 1, 4, true)).toBe(false);
    expect(canTurnPage("backward", 1, 4, true)).toBe(false);
    expect(canTurnPage("forward", 1, 4, false)).toBe(true);
  });

  it("unlocks only the page-turn direction whose adjacent artwork is ready", () => {
    expect(pageTurnNavDisabled(null, 1, 4, { backward: false, forward: true })).toEqual({
      previous: false,
      next: true,
    });
    expect(pageTurnNavDisabled(null, 1, 4, { backward: true, forward: false })).toEqual({
      previous: true,
      next: false,
    });
  });

  it("ignores renderer readiness from another revision or spread", () => {
    const readiness = { navigationKey: "book-a:4:0", backward: true, forward: true };
    expect(pageTurnWaitState(true, "book-a:4:0", readiness)).toEqual({ backward: false, forward: false });
    expect(pageTurnWaitState(true, "book-a:4:5", readiness)).toEqual({ backward: true, forward: true });
    expect(pageTurnWaitState(true, "book-a:5:0", readiness)).toEqual({ backward: true, forward: true });
    expect(pageTurnWaitState(false, "book-a:5:0", readiness)).toEqual({ backward: false, forward: false });
  });

  it("holds the spread and locks navigation 80ms after an arrow click", () => {
    const harness = makeHarness();
    harness.controller.turnPage("forward");
    harness.advance(80);

    expect(harness.commits).toEqual([]);
    expect(harness.currentIndex()).toBe(0);
    expect(harness.liveTurn()).toMatchObject({ direction: "forward" });
    expect(harness.liveTurn()!.progress).toBeGreaterThan(0);
    expect(harness.liveTurn()!.progress).toBeLessThan(1);
    expect(pageTurnNavDisabled(harness.liveTurn(), harness.currentIndex(), 4)).toEqual({
      previous: true,
      next: true,
    });
  });

  it("advances the spread exactly once when the turn settles", () => {
    const harness = makeHarness();
    harness.controller.turnPage("forward");
    settle(harness);
    expect(harness.commits).toEqual(["forward"]);
    expect(harness.currentIndex()).toBe(1);
    expect(harness.liveTurn()).toBeNull();
    expect(pageTurnNavDisabled(harness.liveTurn(), harness.currentIndex(), 4)).toEqual({
      previous: false,
      next: false,
    });
  });

  it("locks out a second turn while one is running", () => {
    const harness = makeHarness();
    harness.controller.turnPage("forward");
    harness.advance(16);
    harness.controller.turnPage("forward");
    settle(harness);
    expect(harness.commits).toEqual(["forward"]);
  });

  it("does not overwrite explicit navigation that happens during a turn", () => {
    const harness = makeHarness();
    harness.controller.turnPage("forward");
    harness.advance(80);
    harness.setIndex(2);
    harness.advance(16);

    expect(harness.commits).toEqual([]);
    expect(harness.currentIndex()).toBe(2);
    expect(harness.liveTurn()).toBeNull();
    expect(harness.hasPendingFrame()).toBe(false);
  });

  it("refuses to turn past either boundary", () => {
    const harness = makeHarness({ spreadCount: 2 });
    harness.controller.turnPage("backward");
    expect(harness.hasPendingFrame()).toBe(false);
    expect(harness.commits).toEqual([]);

    harness.controller.turnPage("forward");
    settle(harness);
    expect(harness.currentIndex()).toBe(1);

    harness.controller.turnPage("forward");
    expect(harness.hasPendingFrame()).toBe(false);
    expect(harness.commits).toEqual(["forward"]);
  });

  it("ignores a gesture that starts past a spread boundary", () => {
    const harness = makeHarness({ spreadCount: 2 });
    harness.controller.onPageGesture("backward", "start", 0);
    harness.controller.onPageGesture("backward", "end", 0.9);
    expect(harness.turns).toEqual([]);
    expect(harness.commits).toEqual([]);

    harness.controller.turnPage("forward");
    settle(harness);
    harness.controller.onPageGesture("forward", "start", 0);
    harness.controller.onPageGesture("forward", "move", 0.8);
    harness.controller.onPageGesture("forward", "end", 0.8);
    expect(harness.commits).toEqual(["forward"]);
    expect(harness.currentIndex()).toBe(1);
  });

  it("ignores the opposite gesture direction and does not hijack an in-flight turn", () => {
    const harness = makeHarness();
    harness.controller.turnPage("forward");
    harness.advance(16);
    const inFlight = harness.liveTurn()!.progress;

    harness.controller.onPageGesture("forward", "start", 0);
    harness.controller.onPageGesture("forward", "move", 0.9);
    harness.controller.onPageGesture("backward", "move", 0.9);
    expect(harness.liveTurn()!.progress).toBe(inFlight);

    harness.controller.onPageGesture("backward", "end", 0.9);
    harness.controller.onPageGesture("forward", "end", 0.9);
    settle(harness);
    expect(harness.commits).toEqual(["forward"]);
    expect(harness.currentIndex()).toBe(1);
  });

  it("cancels a mismatched-direction gesture back to the same spread", () => {
    const harness = makeHarness();
    harness.controller.onPageGesture("forward", "start", 0);
    harness.controller.onPageGesture("forward", "move", 0.5);
    harness.controller.onPageGesture("backward", "end", 0.9);
    settle(harness);
    expect(harness.commits).toEqual([]);
    expect(harness.currentIndex()).toBe(0);
    expect(harness.liveTurn()).toBeNull();
  });

  it("commits immediately and animates nothing under reduced motion", () => {
    const harness = makeHarness({ reducedMotion: true });
    harness.controller.turnPage("forward");
    expect(harness.commits).toEqual(["forward"]);
    expect(harness.hasPendingFrame()).toBe(false);
    expect(harness.liveTurn()).toBeNull();
    expect(pageTurnNavDisabled(harness.liveTurn(), harness.currentIndex(), 4)).toEqual({
      previous: false,
      next: false,
    });
  });

  it("releases the lock when a reduced-motion gesture ends", () => {
    const harness = makeHarness({ reducedMotion: true });
    harness.controller.onPageGesture("forward", "start", 0);
    expect(harness.liveTurn()).toMatchObject({ direction: "forward", progress: 0 });
    expect(pageTurnNavDisabled(harness.liveTurn(), harness.currentIndex(), 4)).toEqual({
      previous: true,
      next: true,
    });

    harness.controller.onPageGesture("forward", "move", 0.5);
    harness.controller.onPageGesture("forward", "end", 0.5);
    expect(harness.commits).toEqual(["forward"]);
    expect(harness.liveTurn()).toBeNull();

    harness.controller.turnPage("forward");
    expect(harness.commits).toEqual(["forward", "forward"]);
  });

  it("settles an in-flight turn immediately when reduced motion is enabled", () => {
    const harness = makeHarness();
    harness.controller.turnPage("forward");
    harness.advance(16);
    expect(harness.commits).toEqual([]);
    harness.setReducedMotion(true);
    harness.advance(16);
    expect(harness.commits).toEqual(["forward"]);
    expect(harness.hasPendingFrame()).toBe(false);
    expect(harness.liveTurn()).toBeNull();
  });

  it("tracks a drag and cancels back to the same spread below the commit threshold", () => {
    const harness = makeHarness();
    harness.controller.onPageGesture("forward", "start", 0);
    harness.controller.onPageGesture("forward", "move", 0.2);
    expect(harness.liveTurn()!.progress).toBeCloseTo(0.2, 8);

    harness.controller.onPageGesture("forward", "end", 0.2);
    settle(harness);
    expect(harness.commits).toEqual([]);
    expect(harness.currentIndex()).toBe(0);
    expect(harness.liveTurn()).toBeNull();
  });

  it("finishes a drag past the commit threshold before advancing", () => {
    const harness = makeHarness();
    harness.controller.turnPage("forward");
    settle(harness);
    expect(harness.currentIndex()).toBe(1);

    harness.controller.onPageGesture("backward", "start", 0);
    expect(harness.liveTurn()!.progress).toBe(1);

    harness.controller.onPageGesture("backward", "move", 0.6);
    expect(harness.liveTurn()!.progress).toBeCloseTo(0.4, 8);

    harness.controller.onPageGesture("backward", "end", 0.6);
    harness.advance(16);
    expect(harness.commits).toEqual(["forward"]);
    settle(harness);
    expect(harness.commits).toEqual(["forward", "backward"]);
    expect(harness.currentIndex()).toBe(0);
  });

  it("cancels the pending frame on dispose and ignores a late tick", () => {
    const harness = makeHarness();
    harness.controller.turnPage("forward");
    harness.controller.dispose();
    expect(harness.hasPendingFrame()).toBe(false);

    harness.advance(800);
    expect(harness.commits).toEqual([]);
    expect(harness.currentIndex()).toBe(0);

    harness.controller.turnPage("forward");
    expect(harness.commits).toEqual([]);
    expect(harness.hasPendingFrame()).toBe(false);
  });

  it("reactivates after the Strict Mode effect lifecycle probe", () => {
    const harness = makeHarness();
    harness.controller.dispose();
    harness.controller.activate();

    harness.controller.turnPage("forward");
    settle(harness);

    expect(harness.commits).toEqual(["forward"]);
    expect(harness.currentIndex()).toBe(1);
    expect(harness.liveTurn()).toBeNull();
  });
});
