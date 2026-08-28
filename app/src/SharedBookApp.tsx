import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Moon, Sun, X } from "@phosphor-icons/react";
import { recordDiagnostic } from "./diagnostics";
import { hasReveal, resolveInteraction } from "./interaction";
import type { BookSnapshot, DocumentState, ThemeId, TurnState } from "./types";

const ThreeBook = lazy(() => import("./ThreeBook").then((module) => ({ default: module.ThreeBook })));

type SharedBookResponse = {
  ok: true;
  book: DocumentState;
};

function shareTokenFromPath() {
  const match = /^\/share\/([^/]+)\/?$/u.exec(window.location.pathname);
  return match?.[1] ?? "";
}

/** Joins announcement fragments without producing the doubled `..` of naive concatenation. */
function announce(...parts: Array<string | undefined | null>) {
  return parts
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .map((part) => (/[.!?…:;]$/u.test(part) ? part : `${part}.`))
    .join(" ");
}

type TurnDirection = "forward" | "backward";

export type SharedTurnDeps = {
  now: () => number;
  requestFrame: (callback: (now: number) => void) => number;
  cancelFrame: (handle: number) => void;
  /** Publishes the live leaf state to the renderer. The object is mutated in place between frames. */
  setTurn: (turn: TurnState) => void;
  /** Advances the read-only document index. Only ever called once a turn has settled. */
  commit: (direction: TurnDirection) => void;
  reducedMotion: () => boolean;
  canTurn: (direction: TurnDirection) => boolean;
};

/** Arrow and sheet controls stay inert while a leaf is in flight, including at the first/last spread. */
export function sharedReaderCanTurn(
  direction: TurnDirection,
  spreadIndex: number,
  spreadCount: number,
  waitingForRenderer = false,
) {
  if (waitingForRenderer) return false;
  return direction === "forward" ? spreadIndex < spreadCount - 1 : spreadIndex > 0;
}

type TurnWaitState = Record<TurnDirection, boolean>;

export function sharedReaderNavDisabled(
  turn: TurnState,
  spreadIndex: number,
  spreadCount: number,
  waitingForRenderer: TurnWaitState = { backward: false, forward: false },
) {
  const locked = turn !== null;
  return {
    previous: locked || !sharedReaderCanTurn("backward", spreadIndex, spreadCount, waitingForRenderer.backward),
    next: locked || !sharedReaderCanTurn("forward", spreadIndex, spreadCount, waitingForRenderer.forward),
  };
}

export function sharedReaderSkipsPageTurnAnimation(reducedMotion: boolean, pageTurnVisible: boolean) {
  return reducedMotion || !pageTurnVisible;
}

/**
 * The public reader turns pages with the same stateful leaf the editing reader
 * uses: the spread index only moves once the animation settles, so an arrow
 * click or a drag never swaps the illustrated spread underneath a leaf that is
 * still mid-flight. The controller is a plain factory rather than inline
 * component code so the commit timing stays directly testable without a DOM.
 */
export function createSharedTurnController(deps: SharedTurnDeps) {
  let frame: number | null = null;
  let active: { direction: TurnDirection; progress: number } | null = null;
  let gestureHeld = false;
  let disposed = false;
  let generation = 0;

  const restProgress = (direction: TurnDirection) => (direction === "forward" ? 0 : 1);
  const settledProgress = (direction: TurnDirection) => (direction === "forward" ? 1 : 0);
  const progressFor = (direction: TurnDirection, amount: number) => (direction === "forward" ? amount : 1 - amount);

  const stopFrame = () => {
    if (frame !== null) deps.cancelFrame(frame);
    frame = null;
  };

  const settleTurn = (direction: TurnDirection, commit: boolean) => {
    if (disposed) return;
    active = null;
    gestureHeld = false;
    frame = null;
    deps.setTurn(null);
    if (!disposed && commit) deps.commit(direction);
  };

  const animateTurn = (direction: TurnDirection, from: number, to: number, commit: boolean) => {
    if (disposed) return;
    stopFrame();
    gestureHeld = false;
    if (deps.reducedMotion()) {
      // Reduced motion resolves instantly, including a gesture that already
      // claimed the lock, so the reader can never be left unable to turn.
      settleTurn(direction, commit);
      return;
    }
    const turn = active ?? { direction, progress: from };
    turn.direction = direction;
    turn.progress = from;
    active = turn;
    deps.setTurn(turn);
    const started = deps.now();
    const duration = Math.max(240, 760 * Math.abs(to - from));
    const animationGeneration = generation;
    let frameCount = 0;
    const tick = (now: number) => {
      if (disposed || animationGeneration !== generation) return;
      frameCount += 1;
      if (deps.reducedMotion()) {
        const measuredDuration = Math.max(1, now - started);
        recordDiagnostic("page-turn:summary", {
          direction,
          surface: "shared",
          durationMs: Math.round(measuredDuration),
          frames: frameCount,
          fps: Math.round((frameCount / measuredDuration) * 1000),
        });
        settleTurn(direction, commit);
        return;
      }
      const linear = Math.min(1, (now - started) / duration);
      const eased = 0.5 - Math.cos(Math.PI * linear) / 2;
      turn.progress = from + (to - from) * eased;
      if (linear < 1) {
        if (disposed) return;
        frame = deps.requestFrame(tick);
        return;
      }
      const measuredDuration = Math.max(1, now - started);
      recordDiagnostic("page-turn:summary", {
        direction,
        surface: "shared",
        durationMs: Math.round(measuredDuration),
        frames: frameCount,
        fps: Math.round((frameCount / measuredDuration) * 1000),
      });
      settleTurn(direction, commit);
    };
    frame = deps.requestFrame(tick);
  };

  const turnPage = (direction: TurnDirection) => {
    if (disposed || active) return;
    if (!deps.canTurn(direction)) return;
    animateTurn(direction, restProgress(direction), settledProgress(direction), true);
  };

  const onPageGesture = (direction: TurnDirection, phase: "start" | "move" | "end", amount: number) => {
    if (disposed) return;
    if (phase === "start") {
      if (active || !deps.canTurn(direction)) return;
      gestureHeld = true;
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
    const held = active.direction;
    const matches = held === direction;
    const commit = matches && amount > 0.32;
    const current = matches ? progressFor(held, amount) : active.progress;
    const target = commit ? settledProgress(held) : restProgress(held);
    gestureHeld = false;
    animateTurn(held, current, target, commit);
  };

  const dispose = () => {
    generation += 1;
    disposed = true;
    gestureHeld = false;
    stopFrame();
    active = null;
  };

  const activate = () => {
    if (!disposed) return;
    generation += 1;
    disposed = false;
    deps.setTurn(null);
  };

  return { turnPage, onPageGesture, isTurning: () => !disposed && active !== null, activate, dispose };
}

function supportsWebGl2() {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}

export function SharedBookApp() {
  const [documentState, setDocumentState] = useState<DocumentState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [selectionId, setSelectionId] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeId>("paper-atelier");
  const [sceneFailed, setSceneFailed] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [pageTurnReady, setPageTurnReady] = useState<Record<TurnDirection, boolean>>({ backward: false, forward: false });
  const [turn, setTurn] = useState<TurnState>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const webGlAvailable = useMemo(supportsWebGl2, []);
  const spreadIndexRef = useRef(0);
  const spreadCountRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const pageTurnVisibleRef = useRef(webGlAvailable);
  const rendererAvailableRef = useRef(webGlAvailable);
  const waitingForRendererRef = useRef<TurnWaitState>({ backward: webGlAvailable, forward: webGlAvailable });
  spreadIndexRef.current = spreadIndex;
  spreadCountRef.current = documentState?.spreads.length ?? 0;
  reducedMotionRef.current = reducedMotion;
  rendererAvailableRef.current = webGlAvailable && !sceneFailed;
  pageTurnVisibleRef.current = webGlAvailable && !sceneFailed && sceneReady;
  waitingForRendererRef.current = {
    backward: webGlAvailable && !sceneFailed && (!sceneReady || !pageTurnReady.backward),
    forward: webGlAvailable && !sceneFailed && (!sceneReady || !pageTurnReady.forward),
  };

  useEffect(() => {
    const controller = new AbortController();
    const token = shareTokenFromPath();
    fetch(`/api/shared/${token}`, { signal: controller.signal, headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? "This shared book is unavailable or has been revoked." : "This shared book could not be loaded.");
        return response.json() as Promise<SharedBookResponse>;
      })
      .then((payload) => setDocumentState(payload.book))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "This shared book could not be loaded.");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme === "midnight-desk" ? "night" : "day";
  }, [theme]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setReducedMotion(preference.matches);
      document.documentElement.dataset.motion = preference.matches ? "reduced" : "full";
    };
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  const commitSpread = useCallback((direction: "forward" | "backward") => {
    const rendererWait = rendererAvailableRef.current;
    waitingForRendererRef.current = { backward: rendererWait, forward: rendererWait };
    setPageTurnReady({ backward: false, forward: false });
    setSelectionId(null);
    setSpreadIndex((current) => Math.max(0, Math.min(spreadCountRef.current - 1, current + (direction === "forward" ? 1 : -1))));
  }, []);

  const turnController = useMemo(() => createSharedTurnController({
    now: () => performance.now(),
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    setTurn,
    commit: commitSpread,
    // A delayed commit only makes sense while ThreeBook can render the leaf.
    // Static fallback readers and reduced-motion users navigate immediately.
    reducedMotion: () => sharedReaderSkipsPageTurnAnimation(reducedMotionRef.current, pageTurnVisibleRef.current),
    canTurn: (direction) => sharedReaderCanTurn(
      direction,
      spreadIndexRef.current,
      spreadCountRef.current,
      waitingForRendererRef.current[direction],
    ),
  }), [commitSpread]);

  useEffect(() => {
    // Strict Mode intentionally runs an effect setup/cleanup/setup cycle in
    // development. Reactivate the stable controller after that probe while
    // keeping callbacks from the disposed generation unable to commit.
    turnController.activate();
    return () => turnController.dispose();
  }, [turnController]);

  const turnPage = turnController.turnPage;
  const onPageGesture = turnController.onPageGesture;

  /**
   * The mobile reader sheet scrolls its own copy, so a page turn has to return
   * the anonymous reader to the top of the new spread rather than leaving them
   * at the previous spread's offset.
   */
  const readerCopy = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    readerCopy.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [spreadIndex]);

  const snapshot = useMemo<BookSnapshot | null>(() => documentState ? {
    document: documentState,
    session: {
      currentSpreadIndex: spreadIndex,
      selectionId,
      sceneThemeId: theme,
      preview: false,
      quality: reducedMotion ? "reduced" : "balanced",
    },
    lastAction: null,
  } : null, [documentState, reducedMotion, selectionId, spreadIndex, theme]);

  if (error) {
    return <main className="app-shell"><section className="fallback-book"><article className="fallback-plate"><p className="fallback-kicker">Shared book</p><h2>Unavailable</h2><p>{error}</p></article></section></main>;
  }
  if (!snapshot) {
    return <main className="app-shell"><section className="fallback-book is-loading" role="status"><article className="fallback-plate"><p>Opening shared book…</p></article></section></main>;
  }

  const spread = snapshot.document.spreads[spreadIndex];
  const selected = selectionId ? spread.elements.find((element) => element.id === selectionId) ?? null : null;
  const selectedInteraction = selected ? resolveInteraction(selected) : null;
  const showWebGl = webGlAvailable && !sceneFailed;
  const waitingForRenderer: TurnWaitState = {
    backward: showWebGl && (!sceneReady || !pageTurnReady.backward),
    forward: showWebGl && (!sceneReady || !pageTurnReady.forward),
  };
  const nav = sharedReaderNavDisabled(turn, spreadIndex, snapshot.document.spreads.length, waitingForRenderer);

  return (
    <main className="app-shell is-preview is-shared-reader">
      <header className="topbar">
        <span className="wordmark" aria-label="Apertale shared book">Apertale</span>
        <div className="topbar-actions">
          <div className="theme-switch" role="group" aria-label="Scene theme">
            <button className={theme === "paper-atelier" ? "is-active" : ""} onClick={() => setTheme("paper-atelier")} aria-pressed={theme === "paper-atelier"}><Sun size={17} /> <span>Day</span></button>
            <button className={theme === "midnight-desk" ? "is-active" : ""} onClick={() => setTheme("midnight-desk")} aria-pressed={theme === "midnight-desk"}><Moon size={17} /> <span>Night</span></button>
          </div>
          <span className="preview-button">Read only</span>
        </div>
      </header>

      <section className="stage" aria-label={`${spread.title}. Spread ${spreadIndex + 1} of ${snapshot.document.spreads.length}`}>
        {showWebGl ? (
          <Suspense fallback={<div className="fallback-book is-loading" />}>
            <ThreeBook
              snapshot={snapshot}
              turn={turn}
              readOnly
              onSelect={setSelectionId}
              onHover={() => undefined}
              onMoveElement={() => undefined}
              onPageGesture={onPageGesture}
              onPageTurnReady={(direction, ready) => setPageTurnReady((current) => (
                current[direction] === ready ? current : { ...current, [direction]: ready }
              ))}
              onLoading={() => {
                setSceneReady(false);
                setPageTurnReady({ backward: false, forward: false });
              }}
              onReady={() => setSceneReady(true)}
              onFailure={() => {
                setSceneReady(false);
                setPageTurnReady({ backward: false, forward: false });
                setSceneFailed(true);
              }}
            />
          </Suspense>
        ) : (
          <div className="fallback-book" aria-label={`Two-dimensional fallback for ${spread.title}`}>
            {spread.artwork?.cleanPlateAssetId || spread.textureUrl
              ? <img src={spread.artwork?.cleanPlateAssetId ?? spread.textureUrl} alt="" role="presentation" />
              : <article className="fallback-plate"><h1>{spread.title}</h1><p>{spread.body}</p></article>}
          </div>
        )}

        <button className="page-arrow page-arrow-left" onClick={() => turnPage("backward")} disabled={nav.previous} aria-label="Previous spread"><ArrowLeft size={22} /></button>
        <button className="page-arrow page-arrow-right" onClick={() => turnPage("forward")} disabled={nav.next} aria-label="Next spread"><ArrowRight size={22} /></button>

        <aside className="reader-sheet" aria-label="Reading panel">
          <div className="reader-sheet-copy" ref={readerCopy}>
            {spread.kicker && <p className="reader-sheet-kicker">{spread.kicker}</p>}
            <h2>{spread.title}</h2>
            <p>{spread.body}</p>
          </div>
          <div className="reader-sheet-controls">
            <button onClick={() => turnPage("backward")} disabled={nav.previous} aria-label="Previous spread"><ArrowLeft size={24} /></button>
            <span className="reader-sheet-progress"><strong>{spreadIndex + 1}</strong> / {snapshot.document.spreads.length}</span>
            <button onClick={() => turnPage("forward")} disabled={nav.next} aria-label="Next spread"><ArrowRight size={24} /></button>
          </div>
        </aside>

        {selected && selectedInteraction && hasReveal(selectedInteraction) && (
          <aside className={`reveal-card reveal-${selectedInteraction.reveal.kind} ${selected.page === "right" ? "is-right" : "is-left"}`} aria-label={`${selectedInteraction.reveal.title} details`}>
            <header><p>{selected.label}</p><h2>{selectedInteraction.reveal.title}</h2></header>
            <p className="reveal-summary">{selectedInteraction.reveal.summary}</p>
            {selectedInteraction.reveal.facts.length > 0 && <dl>{selectedInteraction.reveal.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
            {selectedInteraction.reveal.source && <p className="reveal-source">{selectedInteraction.reveal.source}</p>}
            <button className="reveal-close" onClick={() => setSelectionId(null)} aria-label="Close details"><X size={16} /></button>
          </aside>
        )}
      </section>

      <div className="sr-only" aria-live="polite">{announce(snapshot.document.title, spread.title, spread.body)}</div>
    </main>
  );
}
