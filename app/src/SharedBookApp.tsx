import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "@phosphor-icons/react";
import { clamp } from "./design/curves";
import { ThemeSwitch } from "./design/ThemeSwitch";
import { FallbackBook } from "./FallbackBook";
import { PortraitOrientationGate } from "./PortraitOrientationGate";
import { hasReveal, resolveInteraction } from "./interaction";
import { announce, supportsWebGl2, useReaderShell } from "./readerShell";
import { readerSceneStructureKey } from "./renderEvidence";
import { type BookSnapshot, type DocumentState, type ThemeId } from "./types";

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
  const spreadCount = documentState?.spreads.length ?? 0;

  const reader = useReaderShell({
    navigationKey: `${documentState?.id}:${spreadIndex}`,
    spreadIndex,
    spreadCount,
    sceneKey: activeSceneKey,
    webGlAvailable,
    reducedMotion,
    commit: (index) => {
      setSelectionId(null);
      setSpreadIndex(clamp(index, 0, spreadCount - 1));
    },
  });

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
  const nav = reader.navDisabled;

  return (
    <>
      <main className="app-shell is-preview is-shared-reader">
      <PortraitOrientationGate />
      <header className="topbar">
        <span className="wordmark" aria-label="Apertale shared book">Apertale</span>
        <div className="topbar-actions">
          <ThemeSwitch theme={theme} onChange={setTheme} groupLabel="Scene theme" />
          <span className="preview-button">Read only</span>
        </div>
      </header>

      <section className="stage" aria-label={`${spread.title}. Spread ${spreadIndex + 1} of ${snapshot.document.spreads.length}`}>
        {reader.renderWebGl ? (
          <Suspense fallback={<div className="fallback-book is-loading" />}>
            <ThreeBook
              snapshot={snapshot}
              turn={reader.turn}
              readOnly
              onSelect={setSelectionId}
              onHover={() => undefined}
              onMoveElement={() => undefined}
              onPageGesture={reader.onPageGesture}
              onPageTurnReady={reader.onPageTurnReady}
              onLoading={reader.onSceneLoading}
              onReady={() => undefined}
              onFailure={reader.onSceneFailure}
            />
          </Suspense>
        ) : (
          <FallbackBook snapshot={snapshot} spread={spread} audience="reader" onSelect={setSelectionId} />
        )}

        <button className="page-arrow page-arrow-left" onClick={() => reader.turnPage("backward")} disabled={nav.previous} aria-label="Previous spread"><ArrowLeft size={22} /></button>
        <button className="page-arrow page-arrow-right" onClick={() => reader.turnPage("forward")} disabled={nav.next} aria-label="Next spread"><ArrowRight size={22} /></button>

        <aside className="reader-sheet" aria-label="Reading panel">
          <div className="reader-sheet-copy" ref={readerCopy}>
            {spread.kicker && <p className="reader-sheet-kicker">{spread.kicker}</p>}
            <h2>{spread.title}</h2>
            <p>{spread.body}</p>
          </div>
          <div className="reader-sheet-controls">
            <button onClick={() => reader.turnPage("backward")} disabled={nav.previous} aria-label="Previous spread"><ArrowLeft size={24} /></button>
            <span className="reader-sheet-progress"><strong>{spreadIndex + 1}</strong> / {snapshot.document.spreads.length}</span>
            <button onClick={() => reader.turnPage("forward")} disabled={nav.next} aria-label="Next spread"><ArrowRight size={24} /></button>
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
    </>
  );
}
