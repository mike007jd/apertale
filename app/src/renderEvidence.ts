import { isProceduralElement, spreadBaseAssetId, type BookSnapshot, type Spread, type ThemeId } from "./types";
import { bundledShelfCoverPreviewUrl } from "./shelfCoverPreview";

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
  documentId: string;
  revision: number;
  assetId: string;
  url: string;
  renderElement: RenderElement & Pick<HTMLImageElement, "complete" | "naturalWidth">;
};

export type ResolvedCoverAsset = {
  assetId: string;
  url: string;
};

type ShelfCoverTarget = Omit<ShelfCoverEvidence, "renderElement">;

type ShelfBookCover = {
  id: string;
  revision: number;
  sample?: boolean;
  coverAssetId?: string;
  coverTextureUrl: string;
};

export function resolvedCoverAsset(
  book: ShelfBookCover,
  resolvedCovers: Readonly<Record<string, ResolvedCoverAsset>>,
) {
  const resolved = resolvedCovers[book.id];
  return resolved?.assetId === book.coverAssetId ? resolved : undefined;
}

export function shelfCoverTarget(
  book: ShelfBookCover,
  resolvedCovers: Readonly<Record<string, ResolvedCoverAsset>>,
): ShelfCoverTarget | undefined {
  const resolved = resolvedCoverAsset(book, resolvedCovers);
  if (!book.sample && !resolved) return undefined;
  return {
    documentId: book.id,
    revision: book.revision,
    assetId: resolved?.assetId ?? book.coverTextureUrl,
    url: resolved?.url ?? bundledShelfCoverPreviewUrl(book.coverTextureUrl),
  };
}

export function readerSceneStructureKey(snapshot: BookSnapshot, mode: "reader" | "workshop") {
  return JSON.stringify({
    id: snapshot.document.id,
    mode,
    coverAssetId: snapshot.document.coverAssetId,
    coverTextureUrl: snapshot.document.coverTextureUrl,
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
  target: ShelfCoverTarget | undefined,
  bounds: RenderBounds,
) {
  return Boolean(
    evidence
    && target
    && evidence.documentId === target.documentId
    && evidence.revision === target.revision
    && evidence.assetId === target.assetId
    && evidence.url === target.url
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
  resolvedDedicatedCover: ResolvedCoverAsset | undefined,
) {
  return !book.sample
    && Boolean(book.coverAssetId)
    && resolvedDedicatedCover?.assetId === book.coverAssetId
    && Boolean(resolvedDedicatedCover?.url);
}

export function fallbackRenderComplete(expectedIds: readonly string[], loadedIds: ReadonlySet<string>, failed: boolean) {
  return !failed
    && expectedIds.length > 0
    && expectedIds.every((assetId) => loadedIds.has(assetId));
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

/**
 * Bounds live renderer resources to the visible spread and its turn neighbors.
 * The current spread loads alone on a cold start; once ready, the two possible
 * turn destinations join the window.
 */
export function spreadResourceIndexes(currentIndex: number, spreadCount: number, currentLoaded: boolean) {
  if (currentIndex < 0 || currentIndex >= spreadCount) return [];
  if (!currentLoaded) return [currentIndex];
  return [currentIndex - 1, currentIndex, currentIndex + 1]
    .filter((index) => index >= 0 && index < spreadCount);
}

/**
 * Async image callbacks may arrive after a resource leaves and re-enters the
 * renderer window. Membership alone cannot distinguish that retired request
 * from the replacement, so both the desired set and the request identity must
 * still match before a callback may mutate scene state.
 */
export function resourceAttemptIsCurrent<T>(
  resourceId: string,
  desiredIds: ReadonlySet<string>,
  attempt: T,
  activeAttempts: ReadonlyMap<string, T>,
) {
  return desiredIds.has(resourceId) && activeAttempts.get(resourceId) === attempt;
}

/** A retired renderer may fail after another scene has already committed. */
export function sceneFailureMatches(activeSceneKey: string | null, failedSceneKey: string | null) {
  return Boolean(activeSceneKey && failedSceneKey === activeSceneKey);
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
