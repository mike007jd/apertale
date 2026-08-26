import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowCounterClockwise,
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  DotsThree,
  Eye,
  EyeSlash,
  Lock,
  LockOpen,
  Moon,
  Minus,
  Plus,
  Sparkle,
  Sun,
  X,
} from "@phosphor-icons/react";
import { bookEngine, humanAnimate, humanEdit } from "./bookEngine";
import { recordDiagnostic } from "./diagnostics";
import type { MotionPreset, ThemeId, TurnState } from "./types";
import { registerWebMcpTools } from "./webmcp";

const runtimeParams = new URLSearchParams(window.location.search);
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches || runtimeParams.get("reducedMotion") === "1";
const forceFallback = runtimeParams.get("fallback") === "1";
const ThreeBook = lazy(() => import("./ThreeBook").then((module) => ({ default: module.ThreeBook })));

function supportsWebGl2() {
  if (forceFallback) return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2"));
  } catch {
    return false;
  }
}

function createRequestId() {
  return crypto.randomUUID();
}

export function App() {
  const snapshot = useSyncExternalStore(bookEngine.subscribe, bookEngine.getSnapshot, bookEngine.getSnapshot);
  const [turn, setTurn] = useState<TurnState>(null);
  const [webMcpAvailable, setWebMcpAvailable] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [sceneFailed, setSceneFailed] = useState(false);
  const turnFrame = useRef<number | null>(null);
  const webGlAvailable = useMemo(supportsWebGl2, []);
  const renderWebGl = webGlAvailable && !sceneFailed;

  const spread = snapshot.document.spreads[snapshot.session.currentSpreadIndex];
  const selected = snapshot.session.selectionId
    ? spread.elements.find((element) => element.id === snapshot.session.selectionId) ?? null
    : null;
  const isNight = snapshot.session.sceneThemeId === "midnight-desk";
  const canGoBack = snapshot.session.currentSpreadIndex > 0;
  const canGoForward = snapshot.session.currentSpreadIndex < snapshot.document.spreads.length - 1;

  useEffect(() => registerWebMcpTools(setWebMcpAvailable), []);

  useEffect(() => {
    if (!renderWebGl) recordDiagnostic("fallback:activated", { forced: forceFallback, initializationFailed: sceneFailed });
    if (prefersReducedMotion) recordDiagnostic("motion:reduced", { forced: runtimeParams.get("reducedMotion") === "1" });
  }, [renderWebGl, sceneFailed]);

  useEffect(() => {
    document.documentElement.dataset.theme = isNight ? "night" : "day";
  }, [isNight]);

  const animateTurn = useCallback((direction: "forward" | "backward", from: number, to: number, commit: boolean) => {
    if (turnFrame.current) cancelAnimationFrame(turnFrame.current);
    if (prefersReducedMotion) {
      if (commit) bookEngine.setSpread(snapshot.session.currentSpreadIndex + (direction === "forward" ? 1 : -1));
      setTurn(null);
      return;
    }
    const started = performance.now();
    const duration = 820;
    let frameCount = 0;
    const tick = (now: number) => {
      frameCount += 1;
      const linear = Math.min(1, (now - started) / duration);
      const eased = 0.5 - Math.cos(Math.PI * linear) / 2;
      const progress = from + (to - from) * eased;
      setTurn({ direction, progress });
      if (linear < 1) turnFrame.current = requestAnimationFrame(tick);
      else {
        const measuredDuration = Math.max(1, now - started);
        recordDiagnostic("page-turn:summary", {
          direction,
          durationMs: Math.round(measuredDuration),
          frames: frameCount,
          fps: Math.round((frameCount / measuredDuration) * 1000),
        });
        if (commit) bookEngine.setSpread(snapshot.session.currentSpreadIndex + (direction === "forward" ? 1 : -1));
        setTurn(null);
        turnFrame.current = null;
      }
    };
    turnFrame.current = requestAnimationFrame(tick);
  }, [snapshot.session.currentSpreadIndex]);

  const turnPage = useCallback((direction: "forward" | "backward") => {
    if (turn) return;
    if (direction === "forward" && !canGoForward) return;
    if (direction === "backward" && !canGoBack) return;
    animateTurn(direction, direction === "forward" ? 0 : 1, direction === "forward" ? 1 : 0, true);
  }, [animateTurn, canGoBack, canGoForward, turn]);

  const onPageGesture = useCallback((direction: "forward" | "backward", phase: "start" | "move" | "end", amount: number) => {
    if (phase === "start") {
      setTurn({ direction, progress: direction === "forward" ? 0 : 1 });
      return;
    }
    if (phase === "move") {
      setTurn({ direction, progress: direction === "forward" ? amount : 1 - amount });
      return;
    }
    const commit = amount > 0.32;
    const current = direction === "forward" ? amount : 1 - amount;
    const target = commit ? (direction === "forward" ? 1 : 0) : direction === "forward" ? 0 : 1;
    animateTurn(direction, current, target, commit);
  }, [animateTurn]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") turnPage("forward");
      if (event.key === "ArrowLeft") turnPage("backward");
      if (event.key === "Escape") {
        if (snapshot.session.preview) bookEngine.setPreview(false);
        else bookEngine.setSelection(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [snapshot.session.preview, turnPage]);

  useEffect(() => () => {
    if (turnFrame.current) cancelAnimationFrame(turnFrame.current);
  }, []);

  const liftSelected = () => {
    if (!selected) return;
    bookEngine.dispatch({ type: "lift", requestId: createRequestId(), expectedRevision: snapshot.document.revision, elementId: selected.id }, "human");
  };

  const toggleLock = () => {
    if (!selected) return;
    bookEngine.dispatch({ type: "edit", requestId: createRequestId(), expectedRevision: snapshot.document.revision, elementId: selected.id, locked: !selected.locked }, "human");
  };

  const applyMotion = (preset: MotionPreset | "none") => {
    if (!selected) return;
    humanAnimate(selected.id, preset === "none" ? null : { preset, durationMs: preset === "fly-across" ? 5200 : 3600, loop: true });
  };

  const adjustSelected = (kind: "scale" | "rotate", amount: number) => {
    if (!selected || selected.locked) return;
    if (kind === "scale") {
      const scale = Math.max(0.3, Math.min(1.8, selected.transform.scaleX + amount));
      humanEdit(selected.id, { scaleX: scale, scaleY: scale });
    } else humanEdit(selected.id, { rotationDeg: selected.transform.rotationDeg + amount });
  };

  const setTheme = (theme: ThemeId) => bookEngine.setTheme(theme, "human");

  const copyPrompt = async () => {
    const prompt = selected
      ? `Lift ${selected.label} and make it fly across the page.`
      : "Inspect this LivingBook and tell me what you can bring alive.";
    await navigator.clipboard?.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const confirmReset = () => {
    if (window.confirm("Restore the original Challenge sample book? Your local edits will be replaced.")) bookEngine.reset();
  };

  const undoLastAction = () => {
    const undoToken = snapshot.lastAction?.undoToken;
    if (!undoToken) return;
    bookEngine.dispatch({
      type: "undo",
      requestId: createRequestId(),
      expectedRevision: snapshot.document.revision,
      undoToken,
    }, "human");
  };

  return (
    <main className={`app-shell ${snapshot.session.preview ? "is-preview" : ""}`}>
      <header className="topbar">
        <button className="wordmark" onClick={() => bookEngine.setPreview(false)} aria-label="Return to editor">LivingBook</button>
        <div className="topbar-actions">
          <div className="theme-switch" role="group" aria-label="Scene theme">
            <button className={!isNight ? "is-active" : ""} onClick={() => setTheme("paper-atelier")} aria-label="Day theme" aria-pressed={!isNight}><Sun size={17} weight="regular" /> <span>Day</span></button>
            <button className={isNight ? "is-active" : ""} onClick={() => setTheme("midnight-desk")} aria-label="Night theme" aria-pressed={isNight}><Moon size={17} weight="regular" /> <span>Night</span></button>
          </div>
          <button className="preview-button" onClick={() => bookEngine.setPreview(!snapshot.session.preview)} aria-label={snapshot.session.preview ? "Exit preview" : "Preview book"}>
            {snapshot.session.preview ? <EyeSlash size={18} /> : <Eye size={18} />}
            <span>{snapshot.session.preview ? "Exit preview" : "Preview"}</span>
          </button>
        </div>
      </header>

      <section className="stage" aria-label={`${spread.title}. Spread ${snapshot.session.currentSpreadIndex + 1} of ${snapshot.document.spreads.length}`}>
        {renderWebGl ? (
          <Suspense fallback={<div className="fallback-book is-loading"><img src={spread.textureUrl} alt="" /></div>}>
            <ThreeBook
              snapshot={snapshot}
              turn={turn}
              onSelect={(elementId) => { bookEngine.setSelection(elementId); setShowMore(false); }}
              onMoveElement={(elementId, x, y) => humanEdit(elementId, { x, y })}
              onPageGesture={onPageGesture}
              onFailure={() => setSceneFailed(true)}
            />
          </Suspense>
        ) : (
          <div className="fallback-book" role="img" aria-label={`Two-dimensional fallback for ${spread.title}`}>
            <img src={spread.textureUrl} alt="" />
          </div>
        )}

        {!snapshot.session.preview && (
          <>
            <button className="page-arrow page-arrow-left" onClick={() => turnPage("backward")} disabled={!canGoBack || Boolean(turn)} aria-label="Previous spread"><ArrowLeft size={22} /></button>
            <button className="page-arrow page-arrow-right" onClick={() => turnPage("forward")} disabled={!canGoForward || Boolean(turn)} aria-label="Next spread"><ArrowRight size={22} /></button>
          </>
        )}

        {selected && !snapshot.session.preview && !turn && (
          <div className="selection-ui" aria-label={`${selected.label} selected`}>
            <div className="selection-ring" />
            <div className="context-menu">
              <button onClick={copyPrompt}><Sparkle size={17} /> Ask ChatGPT</button>
              <button onClick={liftSelected} className={selected.kind === "lifted" ? "is-on" : ""} disabled={selected.locked}>
                <ArrowUp size={17} /> {selected.kind === "lifted" ? "Lifted" : "Lift"}
              </button>
              <button onClick={toggleLock}>{selected.locked ? <Lock size={17} /> : <LockOpen size={17} />} {selected.locked ? "Unlock" : "Lock"}</button>
              <button className="icon-button" onClick={() => setShowMore(!showMore)} aria-label="More element controls"><DotsThree size={21} weight="bold" /></button>
            </div>
            {showMore && (
              <div className="element-panel">
                <div><span>Scale</span><button onClick={() => adjustSelected("scale", -0.1)} aria-label="Scale down"><Minus size={14} /></button><output>{Math.round(selected.transform.scaleX * 100)}%</output><button onClick={() => adjustSelected("scale", 0.1)} aria-label="Scale up"><Plus size={14} /></button></div>
                <div><span>Rotate</span><button onClick={() => adjustSelected("rotate", -8)} aria-label="Rotate counter-clockwise"><ArrowCounterClockwise size={14} /></button><output>{Math.round(selected.transform.rotationDeg)}°</output><button onClick={() => adjustSelected("rotate", 8)} aria-label="Rotate clockwise"><ArrowClockwise size={14} /></button></div>
                <label>
                  <span>Motion</span>
                  <select value={selected.motion?.preset ?? "none"} onChange={(event) => applyMotion(event.target.value as MotionPreset | "none")} disabled={selected.locked}>
                    <option value="none">Still</option>
                    <option value="gentle-float">Gentle float</option>
                    <option value="fly-across">Fly across</option>
                    <option value="soft-pulse">Soft pulse</option>
                  </select>
                </label>
              </div>
            )}
          </div>
        )}

        {snapshot.lastAction && (
          <div className={`agent-action agent-action-${snapshot.lastAction.phase}`} role="status">
            {snapshot.lastAction.phase === "success" ? <Check size={16} weight="bold" /> : <Sparkle size={16} />}
            <span>{snapshot.lastAction.summary}</span>
            {snapshot.lastAction.undoToken && <button onClick={undoLastAction}>Undo</button>}
          </div>
        )}
      </section>

      {!snapshot.session.preview && (
        <footer className="bottom-controls">
          <button className="outline-button" onClick={() => setShowOutline(!showOutline)} aria-expanded={showOutline}>Story</button>
          <button className="agent-prompt" onClick={copyPrompt}>
            <span>{copied ? "Prompt copied" : selected ? `Try in ChatGPT: Lift ${selected.label}` : "What should come alive?"}</span>
            <span className="spark-button">{copied ? <Check size={18} weight="bold" /> : <Sparkle size={19} weight="fill" />}</span>
          </button>
          <div className="page-progress"><strong>{snapshot.session.currentSpreadIndex + 1}</strong><span>/</span>{snapshot.document.spreads.length}</div>
        </footer>
      )}

      {showOutline && !snapshot.session.preview && (
        <aside className="story-outline" aria-label="Book outline">
          <div className="outline-head"><div><span>Story outline</span><small>Revision {snapshot.document.revision}</small></div><button onClick={() => setShowOutline(false)} aria-label="Close outline"><X size={18} /></button></div>
          <ol>
            {snapshot.document.spreads.map((item, index) => (
              <li key={item.id}><button className={index === snapshot.session.currentSpreadIndex ? "is-current" : ""} onClick={() => { bookEngine.setSpread(index); setShowOutline(false); }}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{item.title}</strong><small>{item.body}</small></div></button></li>
            ))}
          </ol>
          <div className="outline-foot">
            <span
              className={webMcpAvailable ? "is-connected" : ""}
              title={webMcpAvailable ? "This browser exposed the WebMCP tool runtime." : "This WebMCP-enabled app remains fully usable while the current browser has not exposed the tool runtime."}
            ><i /> {webMcpAvailable ? "WebMCP connected" : "WebMCP ready"}</span>
            <button onClick={confirmReset}><ArrowCounterClockwise size={15} /> Reset sample</button>
          </div>
        </aside>
      )}

      <div className="sr-only" aria-live="polite">
        {spread.title}. {spread.body}
      </div>
    </main>
  );
}
