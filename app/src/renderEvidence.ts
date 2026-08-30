import { isProceduralElement, spreadBaseAssetId, type BookSnapshot, type Spread, type ThemeId } from "./types";

type RenderBounds = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type RenderElement = Pick<HTMLElement, "isConnected" | "getBoundingClientRect">;

export type ReaderRenderEvidence = {
  sceneKey: string;
  renderEvidenceToken?: string;
  documentId: string;
  revision: number;
  spreadId: string;
  theme: ThemeId;
  surface: "webgl" | "fallback";
  locator: string;
};

export type ShelfCoverEvidence = {
  url: string;
  renderElement: RenderElement & Pick<HTMLImageElement, "complete" | "naturalWidth">;
};

export function readerSceneStructureKey(snapshot: BookSnapshot, mode: "reader" | "workshop") {
  return JSON.stringify({
    id: snapshot.document.id,
    mode,
    spreads: snapshot.document.spreads.map((spread) => ({
      id: spread.id,
      title: spread.title,
      body: spread.body,
      kicker: spread.kicker,
      textureUrl: spread.textureUrl,
      artwork: spread.artwork,
      elements: spread.elements.map((element) => [element.id, element.assetId, ...(element.frameAssetIds ?? [])]),
    })),
  });
}

function renderElementVisible(element: RenderElement, bounds: RenderBounds) {
  if (!element.isConnected) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0
    && rect.height > 0
    && rect.right > bounds.left
    && rect.left < bounds.right
    && rect.bottom > bounds.top
    && rect.top < bounds.bottom;
}

/**
 * A successful frame belongs to one scene structure and one presentation
 * attempt. A retired renderer cannot satisfy a later request by replaying
 * metadata from the live snapshot while its passive cleanup is pending.
 */
export function readerRenderMatches(
  evidence: ReaderRenderEvidence | null,
  target: Required<Pick<ReaderRenderEvidence, "sceneKey" | "renderEvidenceToken" | "documentId" | "revision" | "spreadId" | "theme" | "surface">>,
) {
  return Boolean(
    evidence
    && evidence.sceneKey === target.sceneKey
    && evidence.renderEvidenceToken === target.renderEvidenceToken
    && evidence.documentId === target.documentId
    && evidence.revision === target.revision
    && evidence.spreadId === target.spreadId
    && evidence.theme === target.theme
    && evidence.surface === target.surface,
  );
}

/** A shelf ACK is tied to the currently mounted, decoded, visible cover node. */
export function shelfCoverMatches(
  evidence: ShelfCoverEvidence | undefined,
  expectedUrl: string | undefined,
  bounds: RenderBounds,
) {
  return Boolean(
    evidence
    && expectedUrl
    && evidence.url === expectedUrl
    && evidence.renderElement.complete
    && evidence.renderElement.naturalWidth > 0
    && renderElementVisible(evidence.renderElement, bounds),
  );
}

export function fallbackAssetPlan(spread: Spread) {
  return {
    baseAssetId: spreadBaseAssetId(spread),
    foreground: spread.elements.filter((element) => !isProceduralElement(element)),
  };
}

/**
 * Shelf cover evidence is only honest when the frame that loaded is the book's
 * resolved dedicated cover. A bundled placeholder or spread texture must leave
 * the missing-cover blocker deterministic instead of satisfying it.
 */
export function dedicatedCoverRendered(
  book: { sample?: boolean; coverAssetId?: string },
  resolvedDedicatedCoverUrl: string | undefined,
) {
  return !book.sample && Boolean(book.coverAssetId) && Boolean(resolvedDedicatedCoverUrl);
}

export function fallbackRenderComplete(expectedCount: number, loadedIds: ReadonlySet<string>, failed: boolean) {
  return !failed && expectedCount > 0 && loadedIds.size === expectedCount;
}

export function fallbackImageLoadKeys(renderKey: string, foregroundIds: readonly string[]) {
  return [
    `base:${renderKey}`,
    ...foregroundIds.map((elementId) => `layer:${elementId}`),
  ];
}

/**
 * Chooses the next spread textures requested by the live renderer.
 *
 * The current spread is a correctness dependency, so a cache miss requests it
 * alone. Only once it is available may neighboring spreads use bandwidth as a
 * navigation optimization.
 */
export function spreadLoadIndexes(currentIndex: number, spreadCount: number, currentLoaded: boolean) {
  if (currentIndex < 0 || currentIndex >= spreadCount) return [];
  if (!currentLoaded) return [currentIndex];
  return [currentIndex - 1, currentIndex + 1].filter((index) => index >= 0 && index < spreadCount);
}

export function sceneAssetsReadyForEvidence(
  expectedElementIds: readonly string[],
  pendingElementIds: ReadonlySet<string>,
  failedAssetKeys: ReadonlySet<string>,
  frameProgress: ReadonlyMap<string, { loaded: number; total: number }>,
) {
  return expectedElementIds.every((elementId) => {
    if (pendingElementIds.has(elementId)) return false;
    if ([...failedAssetKeys].some((key) => key.startsWith(`${elementId}:`))) return false;
    const progress = frameProgress.get(elementId);
    return Boolean(progress && (progress.total === 0 || progress.loaded === progress.total));
  });
}
