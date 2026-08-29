import { isProceduralElement, type Spread } from "./types";

export function fallbackAssetPlan(spread: Spread) {
  return {
    baseAssetId: spread.artwork?.cleanPlateAssetId ?? spread.textureUrl,
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
