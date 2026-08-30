import { recordDiagnostic } from "./diagnostics";
import { durationMs } from "./design/tokens.generated";
import type { TurnState } from "./types";

export type TurnDirection = "forward" | "backward";
export type TurnWaitState = Record<TurnDirection, boolean>;
export type TurnReadiness = TurnWaitState & { navigationKey: string };
type PageTurnSurface = "editor" | "shared";

export type PageTurnSessionDeps = {
  surface: PageTurnSurface;
  now: () => number;
  requestFrame: (callback: (now: number) => void) => number;
  cancelFrame: (handle: number) => void;
  /** Publishes the live leaf state to the renderer. The object is mutated in place between frames. */
  setTurn: (turn: TurnState) => void;
  /** Advances the document index once, after the turn reaches its terminal state. */
  commit: (direction: TurnDirection) => void;
  /** Identifies the document position where this turn began. */
  navigationKey: () => unknown;
  reducedMotion: () => boolean;
  canTurn: (direction: TurnDirection) => boolean;
};

type DeformedPageVertex = {
  x: number;
  y: number;
  z: number;
};

type TurnContentPlan = {
  destinationIndex: number;
  turningSpreadIndex: number;
  underlaySpreadIndex: number;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

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

export function skipsPageTurnAnimation(reducedMotion: boolean, pageTurnVisible: boolean) {
  return reducedMotion || !pageTurnVisible;
}

/**
 * Owns one page-turn lifecycle from input through animation to a single spread
 * commit. UI surfaces supply timing, navigation, and renderer-readiness policy
 * through the dependency seam and share the same locking and cleanup rules.
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
    if (frame !== null) deps.cancelFrame(frame);
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
      surface: deps.surface,
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
    const started = deps.now();
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
        frame = deps.requestFrame(tick);
        return;
      }

      recordSummary(direction, started, now, frameCount);
      settleTurn(direction, commit);
    };

    frame = deps.requestFrame(tick);
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

/**
 * Resolves which spread is painted onto the moving leaf and which spread stays
 * physically underneath it. Keeping this explicit prevents the renderer from
 * dropping illustrated content while the document index is still unchanged.
 */
export function resolveTurnContentPlan(
  currentIndex: number,
  direction: TurnDirection,
  spreadCount: number,
): TurnContentPlan | null {
  const destinationIndex = currentIndex + (direction === "forward" ? 1 : -1);
  if (destinationIndex < 0 || destinationIndex >= spreadCount) return null;
  return {
    destinationIndex,
    turningSpreadIndex: direction === "forward" ? currentIndex : destinationIndex,
    underlaySpreadIndex: direction === "forward" ? destinationIndex : currentIndex,
  };
}

/**
 * Shared resting profile for both the open paper and a leaf at either end of a
 * turn. Keeping this in one place prevents the first animation frame from
 * snapping from a curved page to a flat sheet.
 */
export function restingPageDepth(baseX: number, baseY: number, pageWidth: number, pageHeight: number) {
  const u = clamp01((baseX + pageWidth / 2) / pageWidth);
  const arch = Math.sin(Math.PI * u) * 0.17;
  const outerLift = Math.pow(u, 5) * 0.055;
  const cornerLift = Math.pow(Math.abs(baseY) / (pageHeight / 2), 7) * 0.025;
  return arch + outerLift + cornerLift;
}

/**
 * Keeps the active leaf inside the physical scale of the open book.
 *
 * Rotating every vertex around the spine by its full distance produces a
 * physically literal sheet, but it also sends the outer edge several world
 * units toward a perspective camera. The page then balloons beyond the cover
 * at mid-turn. This curve preserves the horizontal fold while using a bounded
 * paper arch for depth, which reads like a cinematic page curl from the fixed
 * editor camera.
 */
export function deformPageVertex(
  baseX: number,
  baseY: number,
  progress: number,
  pageWidth: number,
  pageHeight = pageWidth * (5.18 / 4.2),
): DeformedPageVertex {
  const t = clamp01(progress);
  const distanceFromSpine = baseX + pageWidth / 2;
  const u = clamp01(distanceFromSpine / pageWidth);
  const turnAngle = Math.PI * t;
  const turnLift = Math.sin(turnAngle);
  const curl = Math.sin(Math.PI * u);
  const projectedDistance = Math.cos(turnAngle) * distanceFromSpine;
  const restingDepth = restingPageDepth(baseX, baseY, pageWidth, pageHeight);
  // Preserve a readable crescent at the midpoint. Returning the outer edge to
  // the spine collapsed the projected page into a razor-thin strip and made
  // its triangles and shadow read as a torn sheet.
  const sidewaysCurl = turnLift * pageWidth * (0.11 * u + 0.1 * curl);
  const boundedArch = turnLift * (
    0.12
    + 0.94 * curl
    + 0.2 * u
  );

  return {
    x: -pageWidth / 2 + projectedDistance + sidewaysCurl,
    y: baseY,
    z: restingDepth + boundedArch,
  };
}
