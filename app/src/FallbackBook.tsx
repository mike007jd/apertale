import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { acquireAssetUrls, type AssetUrlLease } from "./assetStore";
import { recordDiagnostic } from "./diagnostics";
import {
  fallbackAssetPlan,
  fallbackImageLoadKeys,
  fallbackRenderComplete,
  type ReaderRenderEvidence,
} from "./renderEvidence";
import { spreadFraction } from "./stageGeometry";
import { isProceduralElement, spreadArtworkFit, type BookSnapshot, type Spread } from "./types";

type FallbackLayer = {
  id: string;
  url: string;
  element: Spread["elements"][number];
};

type FallbackBookProps = {
  snapshot: BookSnapshot;
  spread: Spread;
  audience?: "author" | "reader";
  sceneKey?: string;
  renderEvidenceToken?: string;
  onSelect: (elementId: string) => void;
  onReady?: (documentId: string) => void;
  onUnavailable?: (documentId: string) => void;
  onRendered?: (evidence: ReaderRenderEvidence & { surface: "fallback" }) => void;
};

/**
 * The single two-dimensional reader surface used by both authoring and public
 * shares. It resolves the exact final base and every non-procedural resting
 * layer, so losing WebGL never changes the visible book.
 */
export function FallbackBook({
  snapshot,
  spread,
  audience = "author",
  sceneKey,
  renderEvidenceToken,
  onSelect,
  onReady,
  onUnavailable,
  onRendered,
}: FallbackBookProps) {
  const evidenceKey = `${snapshot.document.id}:${snapshot.document.revision}:${spread.id}:${snapshot.session.sceneThemeId}`;
  const [resolved, setResolved] = useState<{ key: string; baseUrl: string; layers: FallbackLayer[] } | null>(null);
  const [loadedIds, setLoadedIds] = useState<Set<string>>(() => new Set());
  const [failed, setFailed] = useState(false);
  const reportedKey = useRef("");

  useEffect(() => {
    let canceled = false;
    let leases: AssetUrlLease[] = [];
    const { baseAssetId, foreground } = fallbackAssetPlan(spread);
    setResolved(null);
    setLoadedIds(new Set());
    setFailed(false);
    if (!baseAssetId) {
      setFailed(true);
      onUnavailable?.(snapshot.document.id);
      recordDiagnostic("fallback:final-base-missing", {
        documentId: snapshot.document.id,
        revision: snapshot.document.revision,
        spreadId: spread.id,
      });
      return () => { canceled = true; };
    }
    void acquireAssetUrls([baseAssetId, ...foreground.map((element) => element.assetId)]).then((acquired) => {
      if (canceled) {
        acquired.forEach((lease) => lease.release());
        return;
      }
      leases = acquired;
      const [baseLease, ...layerLeases] = acquired;
      const layers = foreground.map((element, index): FallbackLayer => ({
        id: element.id,
        url: layerLeases[index].url,
        element,
      }));
      setResolved({ key: evidenceKey, baseUrl: baseLease.url, layers });
    }).catch(() => {
      if (canceled) return;
      setFailed(true);
      onUnavailable?.(snapshot.document.id);
      recordDiagnostic("fallback:asset-resolve-failed", {
        documentId: snapshot.document.id,
        revision: snapshot.document.revision,
        spreadId: spread.id,
      });
    });
    return () => {
      canceled = true;
      leases.forEach((lease) => lease.release());
    };
  }, [evidenceKey, onUnavailable, snapshot.document.id, snapshot.document.revision, spread]);

  const activeResolved = resolved?.key === evidenceKey ? resolved : null;
  const focusedPage = spread.elements.find((element) => element.id === snapshot.session.selectionId)?.page ?? "right";
  const loadKeys = activeResolved
    ? fallbackImageLoadKeys(activeResolved.key, activeResolved.layers.map((layer) => layer.id))
    : [];
  useEffect(() => {
    const reportKey = `${activeResolved?.key ?? ""}:${renderEvidenceToken ?? ""}`;
    if (
      !activeResolved
      || !fallbackRenderComplete(loadKeys, loadedIds, failed)
      || reportedKey.current === reportKey
    ) return;
    reportedKey.current = reportKey;
    onReady?.(snapshot.document.id);
    if (sceneKey && onRendered) {
      onRendered({
        sceneKey,
        renderEvidenceToken,
        documentId: snapshot.document.id,
        revision: snapshot.document.revision,
        spreadId: spread.id,
        theme: snapshot.session.sceneThemeId,
        surface: "fallback",
        locator: ".fallback-book.is-composited",
      });
    }
  }, [activeResolved, failed, loadKeys, loadedIds, onReady, onRendered, renderEvidenceToken, sceneKey, snapshot.document.id, snapshot.document.revision, snapshot.session.sceneThemeId, spread.id]);

  const markLoaded = (id: string) => setLoadedIds((current) => {
    if (current.has(id)) return current;
    return new Set([...current, id]);
  });
  const markFailed = (id: string) => {
    setFailed(true);
    onUnavailable?.(snapshot.document.id);
    recordDiagnostic("fallback:asset-load-failed", {
      documentId: snapshot.document.id,
      revision: snapshot.document.revision,
      spreadId: spread.id,
      asset: id,
    });
  };

  if (failed) {
    return (
      <div className="fallback-book" aria-label={`Two-dimensional fallback for ${spread.title}`}>
        <article className="fallback-plate" role="status">
          {audience === "reader" ? (
            <>
              <h2>{spread.title}</h2>
              <p>{spread.body}</p>
              <small>Some artwork could not be loaded. Refresh to try again.</small>
            </>
          ) : (
            <>
              <h2>Visual review unavailable</h2>
              <p>One or more final scene assets could not be loaded. Re-import the missing asset before critique.</p>
            </>
          )}
        </article>
      </div>
    );
  }
  if (!activeResolved) return <div className="fallback-book is-loading" aria-label={`Loading two-dimensional fallback for ${spread.title}`} />;

  return (
    <div className="fallback-book is-composited" data-page={focusedPage} aria-label={`Two-dimensional fallback for ${spread.title}`}>
      <img
        className="fallback-composite-base"
        src={activeResolved.baseUrl}
        alt=""
        role="presentation"
        style={{ objectFit: spreadArtworkFit(spread) }}
        onLoad={() => markLoaded(loadKeys[0])}
        onError={() => markFailed(loadKeys[0])}
      />
      {spread.elements.map((element) => {
        const layerIndex = activeResolved.layers.findIndex((layer) => layer.id === element.id);
        const layer = layerIndex >= 0 ? activeResolved.layers[layerIndex] : undefined;
        const procedural = isProceduralElement(element);
        if (!layer && !procedural) return null;
        const style = {
          "--spread-x": `${spreadFraction(element) * 100}%`,
          "--page-x": `${element.transform.x * 100}%`,
          top: `${element.transform.y * 100}%`,
          zIndex: Math.max(1, Math.round(element.depth * 100)),
          transform: `translate(-50%, -50%) rotate(${element.transform.rotationDeg}deg) scale(${element.transform.scaleX}, ${element.transform.scaleY})`,
        } as CSSProperties;
        return (
          <button
            key={element.id}
            type="button"
            className={`fallback-interaction-target ${procedural ? "is-procedural" : "is-image"}`}
            data-page={element.page}
            style={style}
            aria-label={element.label}
            aria-pressed={snapshot.session.selectionId === element.id}
            onClick={() => onSelect(element.id)}
          >
            {layer ? (
              <img
                className="fallback-composite-layer"
                src={layer.url}
                alt=""
                role="presentation"
                onLoad={() => markLoaded(loadKeys[layerIndex + 1])}
                onError={() => markFailed(loadKeys[layerIndex + 1])}
              />
            ) : (
              <span
                className={`fallback-procedural-marker is-${element.assetId.slice(element.assetId.lastIndexOf(":") + 1)}`}
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
      <article className="fallback-composite-copy">
        {spread.kicker && <p>{spread.kicker}</p>}
        <h2>{spread.title}</h2>
        <p>{spread.body}</p>
      </article>
    </div>
  );
}
