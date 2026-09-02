/**
 * Everything a reader surface needs around the book itself: live-region
 * phrasing, the WebGL capability check, and the page-turn shell both surfaces
 * mount their renderer inside.
 *
 * `announce` was copy-pasted between App and SharedBookApp byte for byte,
 * comment included. A shared book that phrases its own status differently from
 * the editor is a bug no test would catch, because both copies are
 * individually correct.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TurnDirection } from "./pageDeformation";
import {
  canTurnPage,
  createPageTurnSession,
  pageTurnNavDisabled,
  pageTurnWaitState,
  type TurnReadiness,
} from "./pageTurnSession";
import { sceneFailureMatches } from "./renderEvidence";
import type { TurnState } from "./types";

/**
 * Live-region text. Screen readers run adjacent phrases together, so each part
 * is given terminal punctuation before they are joined — without it "Lifted"
 * and "Spread 3 of 12" are announced as one run-on sentence.
 */
export function announce(...parts: Array<string | undefined | null>) {
  return parts
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .map((part) => (/[.!?…:;]$/u.test(part) ? part : `${part}.`))
    .join(" ");
}

/**
 * Whether the 3D stage can run at all. `force` is the `?fallback=1` escape
 * hatch the editor exposes for capturing the 2D path; a shared book has no
 * such switch and passes nothing.
 */
export function supportsWebGl2(force = false) {
  if (force) return false;
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}

export type ReaderShellOptions = {
  /** Identity of the rendered position. Renderer readiness and an in-flight turn are both bound to it. */
  navigationKey: string;
  spreadIndex: number;
  spreadCount: number;
  /** Structure key of the scene on screen, so a retired renderer's failure cannot condemn the current one. */
  sceneKey: string | null;
  webGlAvailable: boolean;
  /** False while the surface deliberately keeps the 3D scene unmounted. */
  rendererMounted?: boolean;
  reducedMotion: boolean;
  /** Position adapter: moves the document to `index`. The one seam between the two surfaces. */
  commit: (index: number) => void;
};

/**
 * The page-turn half of a reader surface.
 *
 * The editor and the shared reader each had this: the same five ref mirrors,
 * the same renderer-readiness bookkeeping, the same rule that a spread commit
 * must re-arm the wait state and drop readiness *before* the index moves. Both
 * copies were individually correct, which is exactly how they drifted — the
 * shared reader skipped the animation for static fallback readers and the
 * editor animated an invisible leaf.
 *
 * The one real difference between the surfaces is where the spread index
 * lives: the editor's belongs to the book engine, the shared reader's is local
 * state. That difference is the `commit` adapter and nothing else.
 */
export function useReaderShell(options: ReaderShellOptions) {
  const { navigationKey, spreadIndex, spreadCount, sceneKey, webGlAvailable, rendererMounted = true, reducedMotion, commit } = options;
  const [turn, setTurn] = useState<TurnState>(null);
  const [readiness, setReadiness] = useState<TurnReadiness>({ navigationKey: "", backward: false, forward: false });
  const [failedSceneKey, setFailedSceneKey] = useState<string | null>(null);

  const sceneFailed = sceneFailureMatches(sceneKey, failedSceneKey);
  const renderWebGl = webGlAvailable && !sceneFailed;
  const rendererAvailable = renderWebGl && rendererMounted;
  const waitingForRenderer = pageTurnWaitState(rendererAvailable, navigationKey, readiness);

  /**
   * One live mirror instead of five. Session callbacks outlive the render that
   * created them, and a commit re-arms the wait state here before the surface
   * has re-rendered at its new position.
   */
  const live = useRef({ navigationKey, sceneKey, spreadIndex, spreadCount, waitingForRenderer, rendererAvailable, reducedMotion, commit });
  live.current = { navigationKey, sceneKey, spreadIndex, spreadCount, waitingForRenderer, rendererAvailable, reducedMotion, commit };

  const dropReadiness = useCallback(() => setReadiness({ navigationKey: "", backward: false, forward: false }), []);

  const session = useMemo(() => createPageTurnSession({
    setTurn,
    commit: (direction) => {
      // Order matters: the destination spread is unrenderable until the
      // renderer says otherwise, so re-arm the wait state and drop readiness
      // before the index moves.
      const waits = live.current.rendererAvailable;
      live.current.waitingForRenderer = { backward: waits, forward: waits };
      dropReadiness();
      live.current.commit(live.current.spreadIndex + (direction === "forward" ? 1 : -1));
    },
    navigationKey: () => live.current.navigationKey,
    // A delayed commit only makes sense while the renderer can draw the leaf.
    // Static fallback readers and reduced-motion users navigate immediately.
    reducedMotion: () => live.current.reducedMotion || !live.current.rendererAvailable,
    canTurn: (direction) => canTurnPage(
      direction,
      live.current.spreadIndex,
      live.current.spreadCount,
      live.current.waitingForRenderer[direction],
    ),
  }), [dropReadiness]);

  useEffect(() => {
    // Strict Mode intentionally runs an effect setup/cleanup/setup cycle in
    // development. Reactivate the stable session after that probe while
    // keeping callbacks from the disposed generation unable to commit.
    session.activate();
    return () => session.dispose();
  }, [session]);

  return {
    turn,
    setTurn,
    turnPage: session.turnPage,
    onPageGesture: session.onPageGesture,
    navDisabled: pageTurnNavDisabled(turn, spreadIndex, spreadCount, waitingForRenderer),
    renderWebGl,
    sceneFailed,
    /** Wire to the renderer: one turn direction now has its adjacent artwork on the GPU. */
    onPageTurnReady: useCallback((direction: TurnDirection, ready: boolean) => setReadiness((current) => (
      current.navigationKey === live.current.navigationKey
        ? current[direction] === ready ? current : { ...current, [direction]: ready }
        : { navigationKey: live.current.navigationKey, backward: false, forward: false, [direction]: ready }
    )), []),
    /** Wire to the renderer: the scene is rebuilding, so nothing it said before still holds. */
    onSceneLoading: dropReadiness,
    /** Wire to the renderer: this scene cannot run, so fall back to the 2D book. */
    onSceneFailure: useCallback((failureSceneKey: string) => {
      if (!sceneFailureMatches(live.current.sceneKey, failureSceneKey)) return;
      dropReadiness();
      setFailedSceneKey(failureSceneKey);
    }, [dropReadiness]),
  };
}
