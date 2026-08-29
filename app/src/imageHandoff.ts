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
 * What cannot change is the transport. WebMCP tool arguments cross the agent
 * boundary as a JSON string, so a Blob cannot be passed; and the model never
 * holds the bytes of a photo anyway — an uploaded image reaches it as vision
 * tokens, not as a file it could re-emit. The browser also requires a real user
 * gesture to open a file picker, and the host documents that it cannot automate
 * file uploads. The final click is permanently the reader's.
 *
 * What can change is everything around that click. The Agent opens the drawer,
 * its own sentence is printed inside it, and the tool call stays pending until
 * the reader has chosen — so the asset ids return to the conversation directly
 * and nobody has to go back and say "I uploaded it".
 */

export type ImageHandoffRequest = {
  requestId: string;
  /** The Agent's own words, shown to the reader verbatim. */
  reason: string;
};

export type ImageHandoffOutcome =
  | { status: "provided"; assetIds: string[] }
  | { status: "dismissed"; reason: string };

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

/** Called by the reader surface once the imported assets have real ids. */
export function completeImageHandoff(assetIds: string[]) {
  pending?.settle({ status: "provided", assetIds });
}

/**
 * Called when the reader closes the drawer without choosing. It resolves
 * rather than rejects: a person declining to hand over a photo is an answer,
 * and the Agent must be able to say so instead of reporting a failure.
 */
export function dismissImageHandoff(reason = "The reader closed the photo drawer without adding an image.") {
  pending?.settle({ status: "dismissed", reason });
}

/** Cancellation from the agent side, through the tool's AbortSignal. */
export function abortImageHandoff() {
  pending?.settle({ status: "dismissed", reason: "The request was cancelled before the reader chose." });
}
