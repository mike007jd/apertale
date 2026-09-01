/**
 * The seam between an Agent asking for a photo and the page reacting to it.
 *
 * Until now the page could not react at all. The readiness contract tells the
 * model to say "use the Image handoff control in Apertale", the model says it,
 * and then nothing happens on screen — the reader has to translate that
 * sentence into six clicks through a dialog whose headline reads "New book".
 * Measured end to end, a photo already on disk took eight to eleven actions
 * across two or three context switches to become an asset id the Agent could
 * reference.
 *
 * WebMCP arguments are JSON, so image bytes still enter through the browser's
 * file input or drop target. The tool opens that target and returns immediately;
 * the calling Agent can then use Computer Use or a browser file chooser without
 * being blocked by its own WebMCP call. The page cannot inspect the Agent's tool
 * inventory, so the Agent owns that capability check. When host UI automation
 * is unavailable, it opens the real asset folder and asks the reader to drag
 * its files once instead of making them hunt through a hidden work directory.
 */

export const IMAGE_HANDOFF_ASSET_USES = ["source-photo", "book-art"] as const;
export type ImageHandoffAssetUse = (typeof IMAGE_HANDOFF_ASSET_USES)[number];

export type ImageHandoffRequest = {
  requestId: string;
  /** Keeps reader-supplied references separate from generated final artwork. */
  assetUse: ImageHandoffAssetUse;
  /** The Agent's own words, shown to the reader verbatim. */
  reason: string;
};

type ImageHandoffOutcome =
  | { status: "provided"; assetIds: string[]; counts: ImageHandoffImportCounts }
  | { status: "partial"; assetIds: string[]; counts: ImageHandoffImportCounts; reason: string }
  | { status: "dismissed"; reason: string };

type ImageHandoffImportResult = {
  assetIds: string[];
  rejected: number;
  failed: number;
};

type ImageHandoffImportCounts = {
  accepted: number;
  rejected: number;
  failed: number;
};

type Pending = {
  request: ImageHandoffRequest;
  settle: (outcome: ImageHandoffOutcome) => void;
};

let pending: Pending | null = null;
const listeners = new Set<(request: ImageHandoffRequest | null) => void>();

function announce() {
  const request = pending?.request ?? null;
  listeners.forEach((listener) => listener(request));
}

/** Subscribed by the reader surface so the drawer can open on request. */
export function subscribeToImageHandoff(listener: (request: ImageHandoffRequest | null) => void) {
  listeners.add(listener);
  listener(pending?.request ?? null);
  return () => { listeners.delete(listener); };
}

export function currentImageHandoff() {
  return pending?.request ?? null;
}

/**
 * Settles only the request that initiated the action. Image decoding, a tool
 * AbortSignal, and React state can all finish after a newer request has
 * superseded the old one; none of those stale completions may answer the new
 * request with the old request's assets or cancellation.
 */
function settleImageHandoff(requestId: string, outcome: ImageHandoffOutcome) {
  if (pending?.request.requestId !== requestId) return false;
  pending.settle(outcome);
  return true;
}

/**
 * Opens the drawer and stays pending until the reader chooses or dismisses.
 * A second request supersedes the first rather than queueing: two drawers
 * cannot both be open, and an Agent that asks twice means the second ask.
 */
export function requestImageHandoff(request: ImageHandoffRequest): Promise<ImageHandoffOutcome> {
  pending?.settle({ status: "dismissed", reason: "Superseded by a newer request." });
  return new Promise<ImageHandoffOutcome>((resolve) => {
    pending = {
      request,
      settle: (outcome) => {
        pending = null;
        resolve(outcome);
        announce();
      },
    };
    announce();
  });
}

export function describePartialImageHandoff(counts: ImageHandoffImportCounts) {
  const problems = [
    counts.rejected > 0 ? `${counts.rejected} unsupported ${counts.rejected === 1 ? "file was" : "files were"} rejected` : null,
    counts.failed > 0 ? `${counts.failed} ${counts.failed === 1 ? "file" : "files"} could not be stored` : null,
  ].filter((problem): problem is string => Boolean(problem));
  return `${counts.accepted} ${counts.accepted === 1 ? "image was" : "images were"} added, but ${problems.join(" and ")}. Only the returned asset ids are available; add replacements if the complete set is still required.`;
}

/** Called by the reader surface once one or more imported assets have real ids. */
export function completeImageHandoff(requestId: string, imported: ImageHandoffImportResult) {
  if (imported.assetIds.length === 0) throw new TypeError("An image handoff cannot complete without an accepted asset.");
  const counts: ImageHandoffImportCounts = {
    accepted: imported.assetIds.length,
    rejected: imported.rejected,
    failed: imported.failed,
  };
  const outcome: ImageHandoffOutcome = counts.rejected > 0 || counts.failed > 0
    ? { status: "partial", assetIds: imported.assetIds, counts, reason: describePartialImageHandoff(counts) }
    : { status: "provided", assetIds: imported.assetIds, counts };
  return settleImageHandoff(requestId, outcome) ? outcome : null;
}

/**
 * Called when the reader closes the drawer without choosing. It resolves
 * rather than rejects: a person declining to hand over a photo is an answer,
 * and the Agent must be able to say so instead of reporting a failure.
 */
export function dismissImageHandoff(
  requestId: string,
  reason = "The reader closed the image drawer without adding an image.",
) {
  return settleImageHandoff(requestId, { status: "dismissed", reason });
}
