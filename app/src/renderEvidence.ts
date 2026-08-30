import { isProceduralElement, spreadBaseAssetId, type Spread } from "./types";

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
