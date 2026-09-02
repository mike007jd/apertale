import type { QualityRenderEvidence } from "./qualityContract";
import {
  dedicatedCoverRendered,
  readerRenderMatches,
  resolvedCoverAsset,
  shelfCoverMatches,
  shelfCoverTarget,
  type ReaderRenderEvidence,
  type ResolvedCoverAsset,
  type ShelfCoverEvidence,
} from "./renderEvidence";
import type { ThemeId } from "./types";

export type AuthoringSurfaceRequest = {
  requestId: string;
  surface: "reader" | "shelf";
  documentId: string;
  revision: number;
  spreadId?: string;
  theme: ThemeId;
  preview: boolean;
};

/** The token the renderer must echo back before a frame counts as this attempt's. */
export type ActiveAuthoringSurfaceRequest = AuthoringSurfaceRequest & {
  renderEvidenceToken: string;
};

export type AuthoringSurfaceObservation = {
  documentId: string;
  revision: number;
  spreadId: string;
  theme: ThemeId;
  preview: boolean;
  workshopOpen: boolean;
  libraryOpen: boolean;
  libraryMotion: "idle" | "opening-book" | "closing-book";
  transitionPending: boolean;
  blockingOverlayOpen: boolean;
  contentRendered: boolean;
  shelfBookIds: readonly string[];
};

/**
 * A Site Tool may report success only after the requested authoring surface is
 * committed, unobstructed, and has produced a matching frame. The caller owns
 * a bounded timeout, so a missing image or stalled GPU fails instead of
 * acknowledging stale pixels or hanging indefinitely.
 */
export function authoringSurfaceReady(
  request: AuthoringSurfaceRequest,
  observation: AuthoringSurfaceObservation,
) {
  if (
    observation.documentId !== request.documentId
    || observation.revision !== request.revision
    || observation.theme !== request.theme
    || observation.preview !== request.preview
    || observation.workshopOpen
    || observation.blockingOverlayOpen
    || observation.libraryMotion !== "idle"
    || observation.transitionPending
    || !observation.contentRendered
  ) return false;

  if (request.surface === "reader") {
    return !observation.libraryOpen
      && (!request.spreadId || observation.spreadId === request.spreadId);
  }

  return observation.libraryOpen
    && observation.shelfBookIds.includes(request.documentId);
}

type ViewportBounds = { top: number; right: number; bottom: number; left: number };

type PresentationShelfBook = {
  id: string;
  revision: number;
  sample?: boolean;
  coverAssetId?: string;
  coverTextureUrl: string;
};

/**
 * Everything the protocol needs to decide whether the requested frame is on
 * screen. The Adapter pushes this whole picture on every render instead of
 * replaying each field change as its own subscription.
 */
export type AuthoringSurfaceState = {
  documentId: string;
  revision: number;
  spreadId: string;
  theme: ThemeId;
  preview: boolean;
  workshopOpen: boolean;
  libraryOpen: boolean;
  libraryMotion: "idle" | "opening-book" | "closing-book";
  transitionPending: boolean;
  blockingOverlayOpen: boolean;
  shelfBooks: readonly PresentationShelfBook[];
  libraryBooks: readonly { id: string; sample?: boolean }[];
  resolvedCoverUrls: Readonly<Record<string, ResolvedCoverAsset>>;
  renderedShelfCovers: Readonly<Record<string, ShelfCoverEvidence>>;
  lastReaderRender: ReaderRenderEvidence | null;
  readerSceneKey: string;
  readerSurface: "webgl" | "fallback";
  viewportBounds?: ViewportBounds;
};

export type AuthoringPresentationAdapter = {
  /** The document the page is actually holding, so a stale request fails fast. */
  currentDocument: () => { id: string; revision: number };
  recordEvidence: (
    input: Omit<QualityRenderEvidence, "renderedAt">,
    signal: AbortSignal,
  ) => Promise<boolean>;
  /** Commit the requested surface: close blocking overlays and settle the view. */
  onPresent: (request: ActiveAuthoringSurfaceRequest) => void;
  onSettled: () => void;
};

// The in-app Browser may throttle a background WebGL tab to only a few rAFs
// per second. This remains a bounded failure, but leaves enough time for the
// eight stable frames required by the renderer instead of racing them.
export const AUTHORING_SURFACE_TIMEOUT_MS = 10_000;

type PendingPresentation = {
  request: ActiveAuthoringSurfaceRequest;
  signal: AbortSignal;
  settling: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

/**
 * Owns one presentation at a time: it holds the pending request and its
 * evidence token, decides from pushed observations whether the requested frame
 * is genuinely visible, records that frame as revision-bound evidence, and
 * settles the caller's promise. The Adapter only pushes state and performs the
 * view changes the protocol asks for.
 */
export function createAuthoringPresentation(adapter: AuthoringPresentationAdapter) {
  let pending: PendingPresentation | null = null;

  const clear = (active: PendingPresentation) => {
    if (pending !== active) return false;
    pending = null;
    active.cleanup();
    return true;
  };

  const present = (request: AuthoringSurfaceRequest, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    const current = adapter.currentDocument();
    if (request.documentId !== current.id || request.revision !== current.revision) {
      reject(new Error("The requested authoring surface no longer matches the active book revision."));
      return;
    }
    if (signal.aborted) {
      reject(new DOMException("Authoring surface request was cancelled.", "AbortError"));
      return;
    }
    const superseded = pending;
    if (superseded && clear(superseded)) {
      superseded.reject(new DOMException("Superseded by a newer authoring surface request.", "AbortError"));
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const active: PendingPresentation = {
      request: { ...request, renderEvidenceToken: crypto.randomUUID() },
      signal,
      settling: false,
      resolve,
      reject,
      cleanup: () => {
        signal.removeEventListener("abort", onAbort);
        clearTimeout(timeout);
      },
    };
    function fail(error: Error) {
      if (!clear(active)) return;
      adapter.onSettled();
      reject(error);
    }
    function onAbort() {
      fail(new DOMException("Authoring surface request was cancelled.", "AbortError"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(
      () => fail(new Error("The requested authoring surface did not become visible.")),
      AUTHORING_SURFACE_TIMEOUT_MS,
    );
    pending = active;
    adapter.onPresent(active.request);
  });

  const evidenceInput = (
    request: ActiveAuthoringSurfaceRequest,
    state: AuthoringSurfaceState,
    shelfBook: PresentationShelfBook | undefined,
    cover: ReturnType<typeof shelfCoverTarget>,
  ): Omit<QualityRenderEvidence, "renderedAt"> | null => {
    if (request.surface === "reader") {
      const render = state.lastReaderRender;
      return render && {
        documentId: render.documentId,
        revision: render.revision,
        spreadId: render.spreadId,
        theme: render.theme,
        surface: render.surface,
        locator: render.locator,
        scope: "spread",
      };
    }
    if (!shelfBook || !cover || !dedicatedCoverRendered(shelfBook, resolvedCoverAsset(shelfBook, state.resolvedCoverUrls))) return null;
    return {
      documentId: cover.documentId,
      revision: cover.revision,
      theme: request.theme,
      surface: "shelf",
      locator: `[data-book-id="${cover.documentId}"] .library-cover-frame img`,
      scope: "cover",
    };
  };

  const observe = (state: AuthoringSurfaceState) => {
    const active = pending;
    if (!active || active.settling) return;
    const { request } = active;
    const requestedSpreadId = request.spreadId ?? state.spreadId;
    const shelfBook = state.shelfBooks.find((book) => book.id === request.documentId);
    const cover = shelfBook ? shelfCoverTarget(shelfBook, state.resolvedCoverUrls) : undefined;
    const contentRendered = request.surface === "reader"
      ? readerRenderMatches(state.lastReaderRender, {
        sceneKey: state.readerSceneKey,
        renderEvidenceToken: request.renderEvidenceToken,
        documentId: request.documentId,
        revision: request.revision,
        spreadId: requestedSpreadId,
        theme: request.theme,
        surface: state.readerSurface,
      })
      : shelfCoverMatches(
        state.renderedShelfCovers[request.documentId],
        cover,
        state.viewportBounds ?? { top: 0, right: window.innerWidth, bottom: window.innerHeight, left: 0 },
      );
    const ready = authoringSurfaceReady(request, {
      documentId: state.documentId,
      revision: state.revision,
      spreadId: state.spreadId,
      theme: state.theme,
      preview: state.preview,
      workshopOpen: state.workshopOpen,
      libraryOpen: state.libraryOpen,
      libraryMotion: state.libraryMotion,
      transitionPending: state.transitionPending,
      blockingOverlayOpen: state.blockingOverlayOpen,
      contentRendered,
      shelfBookIds: state.shelfBooks.map((book) => book.id),
    });
    if (!ready) return;
    active.settling = true;
    const libraryBook = state.libraryBooks.find((book) => book.id === request.documentId);
    const recordVisibleEvidence = async () => {
      // Curated samples carry no personal quality lifecycle to attach evidence to.
      if (!libraryBook || libraryBook.sample) return;
      const input = evidenceInput(request, state, shelfBook, cover);
      if (!input || !await adapter.recordEvidence(input, active.signal)) {
        throw new Error("The visible authoring frame could not be recorded for quality review.");
      }
    };
    void recordVisibleEvidence().then(() => {
      if (!clear(active)) return;
      adapter.onSettled();
      active.resolve();
    }, (error: unknown) => {
      if (!clear(active)) return;
      adapter.onSettled();
      active.reject(error instanceof Error ? error : new Error("The visible authoring frame could not be recorded."));
    });
  };

  /** The surface is gone, so no frame can ever satisfy the caller. */
  const dispose = () => {
    const active = pending;
    if (!active || !clear(active)) return;
    active.reject(new DOMException("Authoring surface unmounted.", "AbortError"));
  };

  return { present, observe, dispose };
}

export type AuthoringPresentation = ReturnType<typeof createAuthoringPresentation>;
