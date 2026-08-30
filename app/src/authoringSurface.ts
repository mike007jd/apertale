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
