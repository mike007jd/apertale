export type AuthoringSurfaceRequest = {
  requestId: string;
  surface: "reader" | "shelf";
  documentId: string;
  revision: number;
  spreadId?: string;
};

export type AuthoringSurfaceObservation = {
  documentId: string;
  revision: number;
  spreadId: string;
  preview: boolean;
  workshopOpen: boolean;
  libraryOpen: boolean;
  libraryMotion: "idle" | "opening-book" | "closing-book";
  blockingOverlayOpen: boolean;
  shelfBookIds: readonly string[];
};

/**
 * A Site Tool may report success only after the requested authoring surface is
 * actually committed and unobstructed. Rendering evidence remains a separate,
 * bounded signal: a missing image or stalled GPU must not hang the tool call.
 */
export function authoringSurfaceReady(
  request: AuthoringSurfaceRequest,
  observation: AuthoringSurfaceObservation,
) {
  if (
    observation.documentId !== request.documentId
    || observation.revision !== request.revision
    || observation.workshopOpen
    || observation.blockingOverlayOpen
    || observation.libraryMotion !== "idle"
  ) return false;

  if (request.surface === "reader") {
    return !observation.libraryOpen
      && (!request.spreadId || observation.spreadId === request.spreadId);
  }

  return observation.libraryOpen
    && !observation.preview
    && observation.shelfBookIds.includes(request.documentId);
}
