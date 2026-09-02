import { recordDiagnostic } from "./diagnostics";
import { durationMs } from "./design/tokens";
import type { TurnDirection } from "./pageDeformation";
import type { TurnState } from "./types";

export type TurnWaitState = Record<TurnDirection, boolean>;
export type TurnReadiness = TurnWaitState & { navigationKey: string };

type PageTurnSessionDeps = {
  /** Publishes the live leaf state to the renderer. The object is mutated in place between frames. */
  setTurn: (turn: TurnState) => void;
  /** Advances the document index once, after the turn reaches its terminal state. */
  commit: (direction: TurnDirection) => void;
  /** Identifies the document position where this turn began. */
  navigationKey: () => unknown;
  reducedMotion: () => boolean;
  canTurn: (direction: TurnDirection) => boolean;
};

/** A turn is available only when its destination exists and its rendering boundary is ready. */
export function canTurnPage(
  direction: TurnDirection,
  spreadIndex: number,
  spreadCount: number,
  waitingForRenderer = false,
) {
  if (waitingForRenderer) return false;
  return direction === "forward" ? spreadIndex < spreadCount - 1 : spreadIndex > 0;
}

export function pageTurnNavDisabled(
  turn: TurnState,
  spreadIndex: number,
  spreadCount: number,
  waitingForRenderer: TurnWaitState = { backward: false, forward: false },
) {
  const locked = turn !== null;
  return {
    previous: locked || !canTurnPage("backward", spreadIndex, spreadCount, waitingForRenderer.backward),
    next: locked || !canTurnPage("forward", spreadIndex, spreadCount, waitingForRenderer.forward),
  };
}

/** Stale renderer callbacks cannot unlock a different book revision or spread. */
export function pageTurnWaitState(
  rendererAvailable: boolean,
  navigationKey: string,
  readiness: TurnReadiness,
): TurnWaitState {
  const current = readiness.navigationKey === navigationKey;
  return {
    backward: rendererAvailable && (!current || !readiness.backward),
    forward: rendererAvailable && (!current || !readiness.forward),
  };
}

/**
 * Owns one page-turn lifecycle from input through animation to a single spread
 * commit. The reader shell supplies navigation and renderer-readiness policy
 * through the dependency seam; locking, stale-frame suppression and cleanup
 * rules are the same for every surface.
 */
export function createPageTurnSession(deps: PageTurnSessionDeps) {
  let frame: number | null = null;
  let active: { direction: TurnDirection; progress: number } | null = null;
  let gestureHeld = false;
  let disposed = false;
  let generation = 0;
  let navigationKey: unknown;

  const restProgress = (direction: TurnDirection) => (direction === "forward" ? 0 : 1);
  const settledProgress = (direction: TurnDirection) => (direction === "forward" ? 1 : 0);
  const progressFor = (direction: TurnDirection, amount: number) => (direction === "forward" ? amount : 1 - amount);

  const stopFrame = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };

  const settleTurn = (direction: TurnDirection, commit: boolean) => {
    if (disposed) return;
    const navigationUnchanged = Object.is(navigationKey, deps.navigationKey());
    active = null;
    gestureHeld = false;
    frame = null;
    navigationKey = undefined;
    deps.setTurn(null);
    if (commit && navigationUnchanged) deps.commit(direction);
  };

  const recordSummary = (direction: TurnDirection, started: number, now: number, frames: number) => {
    const durationMs = Math.max(1, now - started);
    recordDiagnostic("page-turn:summary", {
      direction,
      durationMs: Math.round(durationMs),
      frames,
      fps: Math.round((frames / durationMs) * 1000),
    });
  };

  const animateTurn = (direction: TurnDirection, from: number, to: number, commit: boolean) => {
    if (disposed) return;
    stopFrame();
    gestureHeld = false;
    if (deps.reducedMotion()) {
      settleTurn(direction, commit);
      return;
    }

    const turn = active ?? { direction, progress: from };
    turn.direction = direction;
    turn.progress = from;
    active = turn;
    deps.setTurn(turn);
    const started = performance.now();
    const duration = Math.max(240, durationMs.navigation * Math.abs(to - from));
    const animationGeneration = generation;
    let frameCount = 0;

    const tick = (now: number) => {
      if (disposed || animationGeneration !== generation) return;
      if (!Object.is(navigationKey, deps.navigationKey())) {
        settleTurn(direction, false);
        return;
      }
      frameCount += 1;
      if (deps.reducedMotion()) {
        recordSummary(direction, started, now, frameCount);
        settleTurn(direction, commit);
        return;
      }

      const linear = Math.min(1, (now - started) / duration);
      const eased = 0.5 - Math.cos(Math.PI * linear) / 2;
      turn.progress = from + (to - from) * eased;
      if (linear < 1) {
        frame = requestAnimationFrame(tick);
        return;
      }

      recordSummary(direction, started, now, frameCount);
      settleTurn(direction, commit);
    };

    frame = requestAnimationFrame(tick);
  };

  const turnPage = (direction: TurnDirection) => {
    if (disposed || active || !deps.canTurn(direction)) return;
    navigationKey = deps.navigationKey();
    animateTurn(direction, restProgress(direction), settledProgress(direction), true);
  };

  const onPageGesture = (direction: TurnDirection, phase: "start" | "move" | "end", amount: number) => {
    if (disposed) return;
    if (active && !Object.is(navigationKey, deps.navigationKey())) {
      settleTurn(active.direction, false);
      return;
    }
    if (phase === "start") {
      if (active || !deps.canTurn(direction)) return;
      gestureHeld = true;
      navigationKey = deps.navigationKey();
      active = { direction, progress: restProgress(direction) };
      deps.setTurn(active);
      return;
    }
    if (phase === "move") {
      if (!gestureHeld || !active || active.direction !== direction) return;
      active.progress = progressFor(direction, amount);
      return;
    }
    if (!gestureHeld || !active) return;

    const heldDirection = active.direction;
    const directionMatches = heldDirection === direction;
    const commit = directionMatches && amount > 0.32;
    const current = directionMatches ? progressFor(heldDirection, amount) : active.progress;
    const target = commit ? settledProgress(heldDirection) : restProgress(heldDirection);
    gestureHeld = false;
    animateTurn(heldDirection, current, target, commit);
  };

  const dispose = () => {
    generation += 1;
    disposed = true;
    gestureHeld = false;
    stopFrame();
    active = null;
    navigationKey = undefined;
  };

  const activate = () => {
    if (!disposed) return;
    generation += 1;
    disposed = false;
    navigationKey = undefined;
    deps.setTurn(null);
  };

  return { turnPage, onPageGesture, activate, dispose };
}
