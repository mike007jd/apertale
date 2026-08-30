import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "@phosphor-icons/react";
import { MotionConfig } from "motion/react";
import { ThemeSwitch } from "./design/ThemeSwitch";
import { FallbackBook } from "./FallbackBook";
import { hasReveal, resolveInteraction } from "./interaction";
import { announce, supportsWebGl2 } from "./readerShell";
import { readerSceneStructureKey, sceneFailureMatches } from "./renderEvidence";
import {
  canTurnPage,
  createPageTurnSession,
  pageTurnNavDisabled,
  skipsPageTurnAnimation,
} from "./pageTurn";
import type { TurnDirection, TurnWaitState } from "./pageTurn";
import { type BookSnapshot, type DocumentState, type ThemeId, type TurnState } from "./types";

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
export function SharedBookApp() {
  const [documentState, setDocumentState] = useState<DocumentState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [selectionId, setSelectionId] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeId>("paper-atelier");
  const [failedSceneKey, setFailedSceneKey] = useState<string | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [pageTurnReady, setPageTurnReady] = useState<Record<TurnDirection, boolean>>({ backward: false, forward: false });
  const [turn, setTurn] = useState<TurnState>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const forceFallback = new URLSearchParams(window.location.search).get("fallback") === "1";
  const webGlAvailable = useMemo(() => supportsWebGl2(forceFallback), [forceFallback]);
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
  const activeSceneKey = snapshot ? readerSceneStructureKey(snapshot, "reader") : null;
  const sceneFailed = sceneFailureMatches(activeSceneKey, failedSceneKey);
  const spreadIndexRef = useRef(0);
  const spreadCountRef = useRef(0);
  const documentIdRef = useRef<string | null>(null);
  const reducedMotionRef = useRef(false);
  const pageTurnVisibleRef = useRef(webGlAvailable);
  const rendererAvailableRef = useRef(webGlAvailable);
  const waitingForRendererRef = useRef<TurnWaitState>({ backward: webGlAvailable, forward: webGlAvailable });
  spreadIndexRef.current = spreadIndex;
  spreadCountRef.current = documentState?.spreads.length ?? 0;
  documentIdRef.current = documentState?.id ?? null;
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

  const turnController = useMemo(() => createPageTurnSession({
    surface: "shared",
    now: () => performance.now(),
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    setTurn,
    commit: commitSpread,
    navigationKey: () => `${documentIdRef.current}:${spreadIndexRef.current}`,
    // A delayed commit only makes sense while ThreeBook can render the leaf.
    // Static fallback readers and reduced-motion users navigate immediately.
    reducedMotion: () => skipsPageTurnAnimation(reducedMotionRef.current, pageTurnVisibleRef.current),
    canTurn: (direction) => canTurnPage(
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
  const nav = pageTurnNavDisabled(turn, spreadIndex, snapshot.document.spreads.length, waitingForRenderer);

  return (
    <MotionConfig reducedMotion={reducedMotion ? "always" : "never"}>
      <main className="app-shell is-preview is-shared-reader">
      <header className="topbar">
        <span className="wordmark" aria-label="Apertale shared book">Apertale</span>
        <div className="topbar-actions">
          <ThemeSwitch theme={theme} onChange={setTheme} groupLabel="Scene theme" />
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
              onFailure={(failureSceneKey) => {
                if (!sceneFailureMatches(activeSceneKey, failureSceneKey)) return;
                setSceneReady(false);
                setPageTurnReady({ backward: false, forward: false });
                setFailedSceneKey(failureSceneKey);
              }}
            />
          </Suspense>
        ) : (
          <FallbackBook snapshot={snapshot} spread={spread} audience="reader" onSelect={setSelectionId} />
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
    </MotionConfig>
  );
}
