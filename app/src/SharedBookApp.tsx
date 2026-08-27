import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Moon, Sun, X } from "@phosphor-icons/react";
import { hasReveal, resolveInteraction } from "./interaction";
import type { BookSnapshot, DocumentState, ThemeId } from "./types";

const ThreeBook = lazy(() => import("./ThreeBook").then((module) => ({ default: module.ThreeBook })));

type SharedBookResponse = {
  ok: true;
  book: DocumentState;
};

function shareTokenFromPath() {
  const match = /^\/share\/([^/]+)\/?$/u.exec(window.location.pathname);
  return match?.[1] ?? "";
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
  const webGlAvailable = useMemo(supportsWebGl2, []);

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

  const snapshot = useMemo<BookSnapshot | null>(() => documentState ? {
    document: documentState,
    session: {
      currentSpreadIndex: spreadIndex,
      selectionId,
      sceneThemeId: theme,
      preview: false,
      quality: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "balanced",
    },
    lastAction: null,
  } : null, [documentState, selectionId, spreadIndex, theme]);

  if (error) {
    return <main className="app-shell"><section className="fallback-book"><article className="fallback-plate"><p>Shared book</p><h1>Unavailable</h1><p>{error}</p></article></section></main>;
  }
  if (!snapshot) {
    return <main className="app-shell"><section className="fallback-book is-loading" role="status"><article className="fallback-plate"><p>Opening shared book…</p></article></section></main>;
  }

  const spread = snapshot.document.spreads[spreadIndex];
  const selected = selectionId ? spread.elements.find((element) => element.id === selectionId) ?? null : null;
  const selectedInteraction = selected ? resolveInteraction(selected) : null;
  const showWebGl = webGlAvailable && !sceneFailed;
  const move = (direction: -1 | 1) => {
    setSelectionId(null);
    setSpreadIndex((current) => Math.max(0, Math.min(snapshot.document.spreads.length - 1, current + direction)));
  };

  return (
    <main className="app-shell is-preview">
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
              turn={null}
              readOnly
              onSelect={setSelectionId}
              onHover={() => undefined}
              onMoveElement={() => undefined}
              onPageGesture={(direction, phase, amount) => {
                if (phase === "end" && amount >= 0.35) move(direction === "forward" ? 1 : -1);
              }}
              onLoading={() => undefined}
              onReady={() => undefined}
              onFailure={() => setSceneFailed(true)}
            />
          </Suspense>
        ) : (
          <div className="fallback-book" aria-label={`Two-dimensional fallback for ${spread.title}`}>
            {spread.artwork?.cleanPlateAssetId || spread.textureUrl
              ? <img src={spread.artwork?.cleanPlateAssetId ?? spread.textureUrl} alt="" role="presentation" />
              : <article className="fallback-plate"><h1>{spread.title}</h1><p>{spread.body}</p></article>}
          </div>
        )}

        <button className="page-arrow page-arrow-left" onClick={() => move(-1)} disabled={spreadIndex === 0} aria-label="Previous spread"><ArrowLeft size={22} /></button>
        <button className="page-arrow page-arrow-right" onClick={() => move(1)} disabled={spreadIndex === snapshot.document.spreads.length - 1} aria-label="Next spread"><ArrowRight size={22} /></button>

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

      <div className="sr-only" aria-live="polite">{snapshot.document.title}. {spread.title}. {spread.body}</div>
    </main>
  );
}
