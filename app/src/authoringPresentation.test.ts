import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTHORING_SURFACE_TIMEOUT_MS,
  authoringSurfaceReady,
  createAuthoringPresentation,
  type ActiveAuthoringSurfaceRequest,
  type AuthoringPresentationAdapter,
  type AuthoringSurfaceObservation,
  type AuthoringSurfaceRequest,
  type AuthoringSurfaceState,
} from "./authoringPresentation";
import type { ReaderRenderEvidence } from "./renderEvidence";

const readerRequest: AuthoringSurfaceRequest = {
  requestId: "present-reader",
  surface: "reader",
  documentId: "book-one",
  revision: 4,
  spreadId: "spread-two",
  theme: "paper-atelier",
  preview: false,
};

const visibleReader: AuthoringSurfaceObservation = {
  documentId: "book-one",
  revision: 4,
  spreadId: "spread-two",
  theme: "paper-atelier",
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

  it("does not acknowledge a frame for a different theme or preview target", () => {
    const nightPreviewRequest: AuthoringSurfaceRequest = { ...readerRequest, theme: "midnight-desk", preview: true };
    const dayEditorFrame: AuthoringSurfaceObservation = { ...visibleReader, theme: "paper-atelier" };
    expect(authoringSurfaceReady(nightPreviewRequest, dayEditorFrame)).toBe(false);
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

const DOCUMENT = { id: "book-one", revision: 4 };

const idleState: AuthoringSurfaceState = {
  documentId: DOCUMENT.id,
  revision: DOCUMENT.revision,
  spreadId: "spread-two",
  theme: "paper-atelier",
  preview: false,
  workshopOpen: true,
  libraryOpen: false,
  libraryMotion: "idle",
  transitionPending: false,
  blockingOverlayOpen: false,
  shelfBooks: [],
  libraryBooks: [{ id: DOCUMENT.id }],
  resolvedCoverUrls: {},
  renderedShelfCovers: {},
  lastReaderRender: null,
  readerSceneKey: "scene-key",
  readerSurface: "webgl",
  viewportBounds: { top: 0, right: 1280, bottom: 800, left: 0 },
};

function renderedFrame(request: ActiveAuthoringSurfaceRequest): ReaderRenderEvidence {
  return {
    sceneKey: idleState.readerSceneKey,
    renderEvidenceToken: request.renderEvidenceToken,
    documentId: request.documentId,
    revision: request.revision,
    spreadId: "spread-two",
    theme: request.theme,
    surface: "webgl",
    locator: ".book-scene canvas",
  };
}

/**
 * A fake surface Adapter: it records what the protocol asked the view to do
 * and lets a test hand back the frame the renderer would have produced.
 */
function fakeSurface(overrides: Partial<AuthoringPresentationAdapter> = {}) {
  const presented: ActiveAuthoringSurfaceRequest[] = [];
  const recorded: unknown[] = [];
  let settledCount = 0;
  const adapter: AuthoringPresentationAdapter = {
    currentDocument: () => DOCUMENT,
    recordEvidence: async (input) => {
      recorded.push(input);
      return true;
    },
    onPresent: (request) => { presented.push(request); },
    onSettled: () => { settledCount += 1; },
    ...overrides,
  };
  return {
    presentation: createAuthoringPresentation(adapter),
    presented,
    recorded,
    settled: () => settledCount,
  };
}

const readerPresentation: AuthoringSurfaceRequest = {
  requestId: "present-reader",
  surface: "reader",
  documentId: DOCUMENT.id,
  revision: DOCUMENT.revision,
  spreadId: "spread-two",
  theme: "paper-atelier",
  preview: false,
};

describe("authoring presentation protocol", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("resolves only after the requested frame is observed, and records it as evidence", async () => {
    const surface = fakeSurface();
    const settled = surface.presentation.present(readerPresentation, new AbortController().signal);
    const request = surface.presented[0];
    expect(request.renderEvidenceToken).toBeTruthy();

    // Still inside the workshop with no matching frame: nothing may settle.
    surface.presentation.observe(idleState);
    expect(surface.recorded).toHaveLength(0);

    surface.presentation.observe({ ...idleState, workshopOpen: false, lastReaderRender: renderedFrame(request) });
    await expect(settled).resolves.toBeUndefined();
    expect(surface.recorded).toEqual([{
      documentId: DOCUMENT.id,
      revision: DOCUMENT.revision,
      spreadId: "spread-two",
      theme: "paper-atelier",
      surface: "webgl",
      locator: ".book-scene canvas",
      scope: "spread",
    }]);
    expect(surface.settled()).toBe(1);
  });

  it("ignores a frame stamped with a superseded evidence token", async () => {
    const surface = fakeSurface();
    void surface.presentation.present(readerPresentation, new AbortController().signal).catch(() => undefined);
    const stale = surface.presented[0];
    void surface.presentation.present({ ...readerPresentation, requestId: "present-reader-again" }, new AbortController().signal)
      .catch(() => undefined);

    surface.presentation.observe({ ...idleState, workshopOpen: false, lastReaderRender: renderedFrame(stale) });
    expect(surface.recorded).toHaveLength(0);
  });

  it("fails the caller when the requested surface never becomes visible", async () => {
    const surface = fakeSurface();
    const settled = surface.presentation.present(readerPresentation, new AbortController().signal);
    vi.advanceTimersByTime(AUTHORING_SURFACE_TIMEOUT_MS);
    await expect(settled).rejects.toThrow("did not become visible");
    expect(surface.settled()).toBe(1);
  });

  it("rejects a stale request instead of presenting a revision the page no longer holds", async () => {
    const surface = fakeSurface();
    await expect(surface.presentation.present({ ...readerPresentation, revision: 3 }, new AbortController().signal))
      .rejects.toThrow("no longer matches the active book revision");
    expect(surface.presented).toHaveLength(0);
  });

  it("rejects a pending presentation when the surface unmounts", async () => {
    const surface = fakeSurface();
    const settled = surface.presentation.present(readerPresentation, new AbortController().signal);
    surface.presentation.dispose();
    await expect(settled).rejects.toThrow("unmounted");

    // A late frame for the disposed request may not resolve anything.
    surface.presentation.observe({ ...idleState, workshopOpen: false, lastReaderRender: renderedFrame(surface.presented[0]) });
    expect(surface.recorded).toHaveLength(0);
  });

  it("fails the caller when the visible frame cannot be recorded for quality review", async () => {
    const surface = fakeSurface({ recordEvidence: async () => false });
    const settled = surface.presentation.present(readerPresentation, new AbortController().signal);
    surface.presentation.observe({ ...idleState, workshopOpen: false, lastReaderRender: renderedFrame(surface.presented[0]) });
    await expect(settled).rejects.toThrow("could not be recorded");
  });

  it("acknowledges a curated sample without attaching personal render evidence", async () => {
    const surface = fakeSurface();
    const settled = surface.presentation.present(readerPresentation, new AbortController().signal);
    surface.presentation.observe({
      ...idleState,
      workshopOpen: false,
      libraryBooks: [{ id: DOCUMENT.id, sample: true }],
      lastReaderRender: renderedFrame(surface.presented[0]),
    });
    await expect(settled).resolves.toBeUndefined();
    expect(surface.recorded).toHaveLength(0);
  });
});
