import { describe, expect, it } from "vitest";
import { authoringSurfaceReady, type AuthoringSurfaceObservation, type AuthoringSurfaceRequest } from "./authoringSurface";

const readerRequest: AuthoringSurfaceRequest = {
  requestId: "present-reader",
  surface: "reader",
  documentId: "book-one",
  revision: 4,
  spreadId: "spread-two",
};

const visibleReader: AuthoringSurfaceObservation = {
  documentId: "book-one",
  revision: 4,
  spreadId: "spread-two",
  preview: false,
  workshopOpen: false,
  libraryOpen: false,
  libraryMotion: "idle",
  transitionPending: false,
  blockingOverlayOpen: false,
  contentRendered: true,
  shelfBookIds: ["book-one"],
};

describe("authoring surface acknowledgement", () => {
  it("waits for the requested reader spread to be current and unobstructed", () => {
    expect(authoringSurfaceReady(readerRequest, visibleReader)).toBe(true);
    expect(authoringSurfaceReady(readerRequest, { ...visibleReader, spreadId: "spread-one" })).toBe(false);
    expect(authoringSurfaceReady(readerRequest, { ...visibleReader, workshopOpen: true })).toBe(false);
    expect(authoringSurfaceReady(readerRequest, { ...visibleReader, libraryOpen: true })).toBe(false);
    expect(authoringSurfaceReady(readerRequest, { ...visibleReader, libraryMotion: "closing-book" })).toBe(false);
    expect(authoringSurfaceReady(readerRequest, { ...visibleReader, transitionPending: true })).toBe(false);
    expect(authoringSurfaceReady(readerRequest, { ...visibleReader, revision: 5 })).toBe(false);
  });

  it("does not acknowledge a reader spread before its matching frame is rendered", () => {
    const visibleButUnrendered = { ...visibleReader, contentRendered: false };
    expect(authoringSurfaceReady(readerRequest, visibleButUnrendered)).toBe(false);
  });

  it("acknowledges a shelf only when the active book is visible outside Preview", () => {
    const shelfRequest: AuthoringSurfaceRequest = { ...readerRequest, requestId: "present-shelf", surface: "shelf", spreadId: undefined };
    const visibleShelf = { ...visibleReader, libraryOpen: true };
    expect(authoringSurfaceReady(shelfRequest, visibleShelf)).toBe(true);
    expect(authoringSurfaceReady(shelfRequest, { ...visibleShelf, preview: true })).toBe(false);
    expect(authoringSurfaceReady(shelfRequest, { ...visibleShelf, shelfBookIds: [] })).toBe(false);
    expect(authoringSurfaceReady(shelfRequest, { ...visibleShelf, transitionPending: true })).toBe(false);
    expect(authoringSurfaceReady(shelfRequest, { ...visibleShelf, blockingOverlayOpen: true })).toBe(false);
    expect(authoringSurfaceReady(shelfRequest, { ...visibleShelf, contentRendered: false })).toBe(false);
  });
});
