import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import {
  ArrowCounterClockwise,
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpenText,
  Books,
  Check,
  Copy,
  DotsThree,
  Eye,
  EyeSlash,
  Lock,
  LockOpen,
  Moon,
  Minus,
  Plus,
  ImageSquare,
  LinkSimple,
  Sparkle,
  SpinnerGap,
  Sun,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { bookEngine, humanAnimate, humanEdit, humanInteract } from "./bookEngine";
import { listAssetMetadata, releaseAssetUrls, resolveAssetUrl, storeLocalImage } from "./assetStore";
import { MAX_SOURCE_IMAGE_BYTES } from "./imageOptimizer";
import { recordDiagnostic } from "./diagnostics";
import {
  FOCUS_LABELS,
  FOCUS_RESPONSES,
  HOVER_LABELS,
  HOVER_RESPONSES,
  hasReveal,
  resolveInteraction,
} from "./interaction";
import { PublicationPanel } from "./PublicationPanel";
import { getPublicationRecord } from "./publishingClient";
import type { PublicationRecord } from "./publishingClient";
import type { BookSnapshot, FocusResponse, HoverResponse, MotionPreset, ThemeId, TurnState } from "./types";
import { registerWebMcpTools } from "./webmcp";

const runtimeParams = new URLSearchParams(window.location.search);
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const forceReducedMotion = runtimeParams.get("reducedMotion") === "1";
const forceFallback = runtimeParams.get("fallback") === "1";
const ThreeBook = lazy(() => import("./ThreeBook").then((module) => ({ default: module.ThreeBook })));

type OpeningBook = {
  id: string;
  title: string;
  coverUrl: string;
  sourceRect: MotionRect | null;
};

type MotionRect = { left: number; top: number; width: number; height: number };
type LibraryMotion = "idle" | "opening-book" | "closing-book";
type BookTransition = {
  id: string;
  title: string;
  coverUrl: string;
  spreadTextureUrl: string;
  spreadTitle: string;
  spreadBody: string;
  direction: "open" | "close";
  cardRect: MotionRect;
};

const CREATION_STYLES = ["Paper collage", "Watercolor storybook", "Cinematic editorial", "Surprise me"] as const;
const CREATION_LENGTHS = [4, 6, 8, 10, 12] as const;

function readRect(element: Element | null): MotionRect | null {
  if (!(element instanceof HTMLElement)) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function transitionStyle(cardRect: MotionRect): CSSProperties {
  const openHeight = Math.min(window.innerHeight * 0.68, 620);
  const openWidth = openHeight * (2 / 3);
  const openLeft = (window.innerWidth - openWidth) / 2;
  const openTop = (window.innerHeight - openHeight) / 2;
  const spreadWidth = Math.min(openWidth * 2.08, window.innerWidth * 0.82);
  return {
    "--book-card-x": `${cardRect.left}px`,
    "--book-card-y": `${cardRect.top}px`,
    "--book-card-w": `${cardRect.width}px`,
    "--book-card-h": `${cardRect.height}px`,
    "--book-open-dx": `${openLeft - cardRect.left}px`,
    "--book-open-dy": `${openTop - cardRect.top}px`,
    "--book-open-sx": `${openWidth / cardRect.width}`,
    "--book-open-sy": `${openHeight / cardRect.height}`,
    "--book-spread-x": `${(window.innerWidth - spreadWidth) / 2}px`,
    "--book-spread-y": `${openTop}px`,
    "--book-spread-w": `${spreadWidth}px`,
    "--book-spread-h": `${openHeight}px`,
  } as CSSProperties;
}

function BookTransitionOverlay({ transition, onDone }: { transition: BookTransition; onDone: () => void }) {
  // `animationend` is the normal settle signal, but a browser that skips or
  // interrupts the animation must never leave the shelf and reader both locked.
  useEffect(() => {
    const timer = window.setTimeout(onDone, 1600);
    return () => window.clearTimeout(timer);
  }, [onDone]);
  return (
    <div
      className={`book-nav-transition is-${transition.direction}`}
      style={transitionStyle(transition.cardRect)}
      aria-hidden="true"
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) onDone();
      }}
    >
      <div className={`book-nav-spread ${transition.spreadTextureUrl ? "has-art" : "has-copy"}`}>
        {transition.spreadTextureUrl ? (
          <img className="book-nav-spread-art" src={transition.spreadTextureUrl} alt="" />
        ) : (
          <article className="book-nav-spread-copy">
            <p>{transition.title}</p>
            <h2>{transition.spreadTitle}</h2>
            <span>{transition.spreadBody}</span>
          </article>
        )}
      </div>
      <div className="book-nav-cover">
        <img src={transition.coverUrl} alt="" />
      </div>
    </div>
  );
}

/**
 * Honest staged feedback for the one operation a reader is waiting on.
 *
 * The three stages map to real events: intent/prewarm, the renderer reporting
 * that it started loading this spread, and the long composition tail. Reduced
 * motion keeps the same status text and step marks without a sustained spin.
 */
const LOAD_STAGES = ["warming", "loading", "composing"] as const;
type LoadStage = (typeof LOAD_STAGES)[number];

const LOAD_STAGE_COPY: Record<LoadStage, string> = {
  warming: "Waking the reading stage",
  loading: "Loading this spread's artwork",
  composing: "Composing pages, lighting, and layers",
};

function BookLoadingFeedback({ title, placement, stage, reducedMotion }: {
  title: string;
  placement: "library" | "stage";
  stage: LoadStage;
  reducedMotion: boolean;
}) {
  const activeIndex = LOAD_STAGES.indexOf(stage);
  return (
    <div className={`book-loading-feedback is-${placement}`} role="status" aria-live="polite" aria-atomic="true">
      <div className="book-loading-card">
        <span className="book-loading-icon" aria-hidden="true">
          {reducedMotion ? <BookOpenText size={22} weight="bold" /> : <SpinnerGap size={22} weight="bold" />}
        </span>
        <span>
          <strong>Opening {title}</strong>
          <small>{LOAD_STAGE_COPY[stage]}</small>
          <ol className="book-loading-steps" aria-hidden="true">
            {LOAD_STAGES.map((step, index) => (
              <li key={step} className={index < activeIndex ? "is-done" : index === activeIndex ? "is-active" : ""} />
            ))}
          </ol>
        </span>
      </div>
    </div>
  );
}

/** Joins announcement fragments without producing the doubled `..` of naive concatenation. */
function announce(...parts: Array<string | undefined | null>) {
  return parts
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .map((part) => (/[.!?…:;]$/u.test(part) ? part : `${part}.`))
    .join(" ");
}

function supportsWebGl2() {
  if (forceFallback) return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2"));
  } catch {
    return false;
  }
}

function createRequestId() {
  return crypto.randomUUID();
}

export function App() {
  const snapshot = useSyncExternalStore(bookEngine.subscribe, bookEngine.getSnapshot, bookEngine.getSnapshot);
  const [turn, setTurn] = useState<TurnState>(null);
  const [webMcpAvailable, setWebMcpAvailable] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [showLibrary, setShowLibrary] = useState(true);
  const [libraryMotion, setLibraryMotion] = useState<LibraryMotion>("idle");
  const [bookTransition, setBookTransition] = useState<BookTransition | null>(null);
  const [showCreateGuide, setShowCreateGuide] = useState(false);
  const [showElementAgentGuide, setShowElementAgentGuide] = useState(false);
  const [elementPromptCopied, setElementPromptCopied] = useState(false);
  const [creationSpreadCount, setCreationSpreadCount] = useState(6);
  const [creationStyle, setCreationStyle] = useState<(typeof CREATION_STYLES)[number]>("Paper collage");
  const [workshopAssetCount, setWorkshopAssetCount] = useState(0);
  const [assetImporting, setAssetImporting] = useState(false);
  const [openingBook, setOpeningBook] = useState<OpeningBook | null>(null);
  const [readyBookId, setReadyBookId] = useState<string | null>(null);
  const [sceneLoadingBookId, setSceneLoadingBookId] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => forceReducedMotion || motionPreference.matches);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [sceneFailed, setSceneFailed] = useState(false);
  const [resolvedCoverUrls, setResolvedCoverUrls] = useState<Record<string, string>>({});
  const [loadStage, setLoadStage] = useState<LoadStage>("warming");
  const [workshopImportError, setWorkshopImportError] = useState<string | null>(null);
  const [showPublication, setShowPublication] = useState(false);
  const [publicationRecord, setPublicationRecord] = useState<PublicationRecord | null>(null);
  const turnFrame = useRef<number | null>(null);
  const turnState = useRef<TurnState>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const librarySheet = useRef<HTMLDivElement | null>(null);
  const libraryOpener = useRef<HTMLElement | null>(null);
  const createGuideCard = useRef<HTMLDivElement | null>(null);
  const createGuideOpener = useRef<HTMLElement | null>(null);
  const elementAgentCard = useRef<HTMLDivElement | null>(null);
  const elementAgentOpener = useRef<HTMLElement | null>(null);
  const publicationOpener = useRef<HTMLElement | null>(null);
  const prewarmedBooks = useRef(new Map<string, { renderer: Promise<unknown>; media: Promise<unknown> }>());
  const loadToken = useRef(0);
  const openingBookRef = useRef<OpeningBook | null>(null);
  const openingFrame = useRef<number | null>(null);
  const libraryFrame = useRef<number | null>(null);
  const webGlAvailable = useMemo(supportsWebGl2, []);
  const renderWebGl = !showLibrary && webGlAvailable && !sceneFailed;
  const library = useMemo(() => bookEngine.getLibrary(), [snapshot.document.id, snapshot.document.revision]);
  const activeLibraryBook = library.books.find((book) => book.id === library.activeBookId);
  const workshopSnapshot = useMemo<BookSnapshot>(() => ({
    document: {
      id: "apertale-new-book-workshop",
      revision: 1,
      title: "Untitled Apertale",
      spreads: [{ id: "blank-workshop-spread", order: 0, title: "", body: "", elements: [] }],
    },
    session: {
      currentSpreadIndex: 0,
      selectionId: null,
      sceneThemeId: snapshot.session.sceneThemeId,
      preview: true,
      quality: snapshot.session.quality,
    },
    lastAction: null,
  }), [snapshot.session.quality, snapshot.session.sceneThemeId]);

  useEffect(() => {
    if (!showCreateGuide) return undefined;
    let canceled = false;
    listAssetMetadata(6)
      .then((assets) => {
        if (!canceled) setWorkshopAssetCount((current) => Math.max(current, assets.length));
      })
      .catch(() => recordDiagnostic("workbench:asset-list-failed", {}));
    return () => { canceled = true; };
  }, [showCreateGuide]);

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    const requestedSeconds = Number(runtimeParams.get("motionAudit"));
    if (!Number.isFinite(requestedSeconds) || requestedSeconds < 0.5 || requestedSeconds > 30) return undefined;
    document.documentElement.style.setProperty("--motion-navigation", `${requestedSeconds}s`);
    return () => { document.documentElement.style.removeProperty("--motion-navigation"); };
  }, []);

  useEffect(() => {
    let canceled = false;
    Promise.all(library.books.map(async (book) => {
      if (!book.coverAssetId) return [book.id, book.coverTextureUrl] as const;
      try {
        return [book.id, await resolveAssetUrl(book.coverAssetId)] as const;
      } catch {
        recordDiagnostic("asset:cover-resolve-failed", { bookId: book.id });
        return [book.id, book.coverTextureUrl] as const;
      }
    })).then((entries) => {
      if (!canceled) setResolvedCoverUrls(Object.fromEntries(entries));
    });
    return () => { canceled = true; };
  }, [library]);

  const spread = snapshot.document.spreads[snapshot.session.currentSpreadIndex];
  const selected = snapshot.session.selectionId
    ? spread.elements.find((element) => element.id === snapshot.session.selectionId) ?? null
    : null;
  const selectedInteraction = selected ? resolveInteraction(selected) : null;
  const hovered = hoveredId ? spread.elements.find((element) => element.id === hoveredId) ?? null : null;
  const isNight = snapshot.session.sceneThemeId === "midnight-desk";
  const canGoBack = snapshot.session.currentSpreadIndex > 0;
  const canGoForward = snapshot.session.currentSpreadIndex < snapshot.document.spreads.length - 1;
  const stageIsLoading = readyBookId !== snapshot.document.id || sceneLoadingBookId === snapshot.document.id;
  const libraryBusy = Boolean(openingBook || bookTransition || libraryMotion !== "idle");

  const isCreatorBook = Boolean(activeLibraryBook) && activeLibraryBook?.sample === false;

  /**
   * The mobile reader sheet scrolls its own copy. Turning the page swaps the
   * text in place, so without this the next spread opens mid-paragraph at the
   * previous spread's scroll offset instead of at its own first line.
   */
  const readerCopy = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    readerCopy.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [snapshot.document.id, snapshot.session.currentSpreadIndex]);

  useEffect(() => {
    if (!isCreatorBook) {
      setPublicationRecord(null);
      return;
    }
    setPublicationRecord(getPublicationRecord(snapshot.document.id));
  }, [isCreatorBook, snapshot.document.id]);

  /**
   * Prewarm exactly what the next screen needs, and only after a reader shows
   * intent (hover, focus, or the click that starts the cover transition). The
   * root shelf never reaches this, so Three.js, spreads, cutouts, and the Night
   * background stay off the cold path.
   */
  const prewarmReader = useCallback((bookId: string) => {
    const cached = prewarmedBooks.current.get(bookId);
    if (cached) return cached;
    const renderer: Promise<unknown> = import("./ThreeBook")
      .catch(() => recordDiagnostic("book:prewarm-renderer-failed", { documentId: bookId }));
    const info = bookEngine.getPrewarmMedia(bookId);
    const media: Promise<unknown> = info?.mediaRef
      ? resolveAssetUrl(info.mediaRef)
        .then((url) => {
          const image = new Image();
          image.decoding = "async";
          image.src = url;
          return image.decode();
        })
        .then(() => recordDiagnostic("book:prewarmed", { documentId: bookId, spreadId: info.spreadId }))
        .catch(() => recordDiagnostic("book:prewarm-media-failed", { documentId: bookId }))
      : Promise.resolve();
    const entry = { renderer, media };
    prewarmedBooks.current.set(bookId, entry);
    return entry;
  }, []);

  /** Stages only move forward, so a late signal can never rewind the message. */
  const advanceLoadStage = useCallback((next: LoadStage) => {
    setLoadStage((current) => (LOAD_STAGES.indexOf(next) > LOAD_STAGES.indexOf(current) ? next : current));
  }, []);

  useEffect(() => {
    if (loadStage !== "loading") return undefined;
    const timer = window.setTimeout(() => advanceLoadStage("composing"), 1800);
    return () => window.clearTimeout(timer);
  }, [advanceLoadStage, loadStage]);

  const hideLibrary = useCallback(() => {
    setShowLibrary(false);
    setLibraryMotion("idle");
    window.setTimeout(() => libraryOpener.current?.focus(), 0);
  }, []);

  const findLibraryCoverRect = useCallback((bookId: string) => readRect(
    librarySheet.current?.querySelector(`[data-book-id="${bookId}"] .library-cover-frame`) ?? null,
  ), []);

  const finishBookTransition = useCallback(() => {
    if (!bookTransition) return;
    recordDiagnostic("book:navigation-transition-settled", {
      documentId: bookTransition.id,
      direction: bookTransition.direction,
    });
    if (bookTransition.direction === "open") {
      openingBookRef.current = null;
      setOpeningBook(null);
      hideLibrary();
    } else {
      setLibraryMotion("idle");
      setBookTransition(null);
      window.setTimeout(() => librarySheet.current?.querySelector<HTMLElement>(".library-close")?.focus(), 0);
      return;
    }
    setBookTransition(null);
  }, [bookTransition, hideLibrary]);

  const beginOpenTransition = useCallback((book: OpeningBook) => {
    const sourceRect = book.sourceRect ?? findLibraryCoverRect(book.id);
    if (reducedMotion || !sourceRect) {
      recordDiagnostic("book:navigation-transition-reduced", { documentId: book.id, direction: "open" });
      openingBookRef.current = null;
      setOpeningBook(null);
      hideLibrary();
      return;
    }
    const liveSnapshot = bookEngine.getSnapshot();
    const transitionSpread = liveSnapshot.document.spreads[liveSnapshot.session.currentSpreadIndex]
      ?? liveSnapshot.document.spreads[0];
    openingBookRef.current = book;
    setOpeningBook(null);
    setLibraryMotion("opening-book");
    setBookTransition({
      id: book.id,
      title: book.title,
      coverUrl: book.coverUrl,
      spreadTextureUrl: transitionSpread?.textureUrl ?? "",
      spreadTitle: transitionSpread?.title ?? book.title,
      spreadBody: transitionSpread?.body ?? "",
      direction: "open",
      cardRect: sourceRect,
    });
    recordDiagnostic("book:navigation-transition-started", { documentId: book.id, direction: "open" });
  }, [findLibraryCoverRect, hideLibrary, reducedMotion]);

  const openLibrary = useCallback(() => {
    if (showLibrary || bookTransition || openingBookRef.current) return;
    libraryOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLibraryMotion("closing-book");
    setShowLibrary(true);
    if (reducedMotion) {
      setLibraryMotion("idle");
      recordDiagnostic("book:navigation-transition-reduced", { documentId: snapshot.document.id, direction: "close" });
      return;
    }
    libraryFrame.current = window.requestAnimationFrame(() => {
      libraryFrame.current = window.requestAnimationFrame(() => {
        libraryFrame.current = null;
        const cardRect = findLibraryCoverRect(snapshot.document.id);
        if (!cardRect) {
          setLibraryMotion("idle");
          return;
        }
        const liveSnapshot = bookEngine.getSnapshot();
        const transitionSpread = liveSnapshot.document.spreads[liveSnapshot.session.currentSpreadIndex]
          ?? liveSnapshot.document.spreads[0];
        setBookTransition({
          id: snapshot.document.id,
          title: snapshot.document.title,
          coverUrl: resolvedCoverUrls[snapshot.document.id] ?? activeLibraryBook?.coverTextureUrl ?? "",
          spreadTextureUrl: transitionSpread?.textureUrl ?? "",
          spreadTitle: transitionSpread?.title ?? snapshot.document.title,
          spreadBody: transitionSpread?.body ?? "",
          direction: "close",
          cardRect,
        });
        recordDiagnostic("book:navigation-transition-started", { documentId: snapshot.document.id, direction: "close" });
      });
    });
  }, [activeLibraryBook?.coverTextureUrl, bookTransition, findLibraryCoverRect, reducedMotion, resolvedCoverUrls, showLibrary, snapshot.document.id, snapshot.document.title]);

  const handleBookLoading = useCallback((documentId: string) => {
    setSceneLoadingBookId(documentId);
    advanceLoadStage("loading");
    recordDiagnostic("book:loading", { documentId });
  }, [advanceLoadStage]);

  const handleBookReady = useCallback((documentId: string) => {
    setReadyBookId(documentId);
    setLoadStage("warming");
    setSceneLoadingBookId((current) => current === documentId ? null : current);
    recordDiagnostic("book:ready", { documentId });
  }, []);

  useEffect(() => {
    if (!openingBook || snapshot.document.id !== openingBook.id) return;
    if (bookTransition?.direction === "open") return;
    beginOpenTransition(openingBook);
  }, [beginOpenTransition, bookTransition?.direction, openingBook, snapshot.document.id]);

  const closeCodexGuide = useCallback(() => {
    setShowCreateGuide(false);
    window.setTimeout(() => createGuideOpener.current?.focus(), 0);
  }, []);

  const openCodexGuide = useCallback(() => {
    createGuideOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCopied(false);
    setShowCreateGuide(true);
  }, []);

  const closePublication = useCallback(() => {
    setShowPublication(false);
    window.setTimeout(() => publicationOpener.current?.focus(), 0);
  }, []);

  const openPublication = useCallback(() => {
    publicationOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setShowPublication(true);
  }, []);

  const closeElementAgentGuide = useCallback(() => {
    setShowElementAgentGuide(false);
    window.setTimeout(() => elementAgentOpener.current?.focus(), 0);
  }, []);

  const openElementAgentGuide = useCallback(() => {
    if (!selected) return;
    elementAgentOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setElementPromptCopied(false);
    setShowElementAgentGuide(true);
  }, [selected]);

  const selectedElementPrompt = useMemo(() => {
    if (!selected || !selectedInteraction) return "";
    return [
      "Work on the Apertale page open beside this conversation.",
      "Call get_project_context with detail: selected-reveal and edit only the currently selected element in the current book. Do not create a new book.",
      `Selected element: ${selected.label}. Current spread: ${spread.title}.`,
      `Reader-facing intent: ${selectedInteraction.hint}.`,
      "Keep buildings, people, monuments, and resting props still at rest. Signal clickability with hover light or a short hover response only.",
      "If replacement artwork is needed, generate exactly one semantic subject as one native-transparent image. Never generate a sheet, contact grid, or multi-object image and crop pieces from it.",
      "Preserve the clean background plate, current book structure, and unrelated elements.",
    ].join("\n");
  }, [selected, selectedInteraction, spread.title]);

  const copySelectedElementPrompt = useCallback(async () => {
    if (!selectedElementPrompt || !selected) return;
    await navigator.clipboard?.writeText(selectedElementPrompt);
    setElementPromptCopied(true);
    recordDiagnostic("element-agent:starter-copied", { elementId: selected.id, spreadId: spread.id });
  }, [selected, selectedElementPrompt, spread.id]);

  const openBookFromLibrary = useCallback((bookId: string, source?: HTMLElement) => {
    if (openingBookRef.current || bookTransition) return;
    const book = library.books.find((candidate) => candidate.id === bookId);
    if (!book) return;
    // The three stages track real work: the renderer chunk arriving, this
    // spread's artwork decoding, and the scene being composed from both.
    const warm = prewarmReader(bookId);
    const token = loadToken.current + 1;
    loadToken.current = token;
    setLoadStage("warming");
    void warm.renderer.then(() => { if (loadToken.current === token) advanceLoadStage("loading"); });
    void Promise.all([warm.renderer, warm.media]).then(() => { if (loadToken.current === token) advanceLoadStage("composing"); });

    const nextOpening: OpeningBook = {
      id: book.id,
      title: book.title,
      coverUrl: resolvedCoverUrls[book.id] ?? book.coverTextureUrl,
      sourceRect: readRect(source?.querySelector(".library-cover-frame") ?? null) ?? findLibraryCoverRect(book.id),
    };

    if (bookId === snapshot.document.id && readyBookId === bookId) {
      setTurn(null);
      setHoveredId(null);
      setShowMore(false);
      setShowOutline(false);
      beginOpenTransition(nextOpening);
      return;
    }

    openingBookRef.current = nextOpening;
    setOpeningBook(nextOpening);
    recordDiagnostic("book:open-requested", { documentId: book.id });

    if (bookId === snapshot.document.id) return;
    openingFrame.current = window.requestAnimationFrame(() => {
      openingFrame.current = null;
      if (!bookEngine.openBook(bookId)) {
        openingBookRef.current = null;
        setOpeningBook(null);
        return;
      }
      setTurn(null);
      setHoveredId(null);
      setShowMore(false);
      setShowOutline(false);
    });
  }, [advanceLoadStage, beginOpenTransition, bookTransition, findLibraryCoverRect, library.books, prewarmReader, readyBookId, resolvedCoverUrls, snapshot.document.id]);

  useEffect(() => registerWebMcpTools(setWebMcpAvailable), []);

  useEffect(() => {
    const updateMotionPreference = () => {
      const reduced = forceReducedMotion || motionPreference.matches;
      setReducedMotion(reduced);
      document.documentElement.dataset.motion = reduced ? "reduced" : "full";
      bookEngine.setQuality(reduced ? "reduced" : "balanced");
      if (reduced) recordDiagnostic("motion:reduced", { forced: forceReducedMotion });
    };
    updateMotionPreference();
    if (forceReducedMotion) return undefined;
    motionPreference.addEventListener("change", updateMotionPreference);
    return () => motionPreference.removeEventListener("change", updateMotionPreference);
  }, []);

  useEffect(() => {
    if (!renderWebGl) recordDiagnostic("fallback:activated", { forced: forceFallback, initializationFailed: sceneFailed });
  }, [renderWebGl, sceneFailed]);

  useEffect(() => {
    document.documentElement.dataset.theme = isNight ? "night" : "day";
  }, [isNight]);

  const animateTurn = useCallback((direction: "forward" | "backward", from: number, to: number, commit: boolean) => {
    if (turnFrame.current) cancelAnimationFrame(turnFrame.current);
    if (reducedMotion) {
      if (commit) bookEngine.setSpread(snapshot.session.currentSpreadIndex + (direction === "forward" ? 1 : -1));
      setTurn(null);
      return;
    }
    const activeTurn = turnState.current ?? { direction, progress: from };
    activeTurn.direction = direction;
    activeTurn.progress = from;
    turnState.current = activeTurn;
    setTurn(activeTurn);
    const started = performance.now();
    const duration = Math.max(240, 760 * Math.abs(to - from));
    let frameCount = 0;
    const tick = (now: number) => {
      frameCount += 1;
      const linear = Math.min(1, (now - started) / duration);
      const eased = 0.5 - Math.cos(Math.PI * linear) / 2;
      activeTurn.progress = from + (to - from) * eased;
      if (linear < 1) turnFrame.current = requestAnimationFrame(tick);
      else {
        const measuredDuration = Math.max(1, now - started);
        recordDiagnostic("page-turn:summary", {
          direction,
          durationMs: Math.round(measuredDuration),
          frames: frameCount,
          fps: Math.round((frameCount / measuredDuration) * 1000),
        });
        turnState.current = null;
        setTurn(null);
        turnFrame.current = null;
        if (commit) bookEngine.setSpread(snapshot.session.currentSpreadIndex + (direction === "forward" ? 1 : -1));
      }
    };
    turnFrame.current = requestAnimationFrame(tick);
  }, [reducedMotion, snapshot.session.currentSpreadIndex]);

  const turnPage = useCallback((direction: "forward" | "backward") => {
    if (turnState.current) return;
    if (direction === "forward" && !canGoForward) return;
    if (direction === "backward" && !canGoBack) return;
    animateTurn(direction, direction === "forward" ? 0 : 1, direction === "forward" ? 1 : 0, true);
  }, [animateTurn, canGoBack, canGoForward]);

  const onPageGesture = useCallback((direction: "forward" | "backward", phase: "start" | "move" | "end", amount: number) => {
    if (phase === "start") {
      if (turnState.current) return;
      const activeTurn = { direction, progress: direction === "forward" ? 0 : 1 };
      turnState.current = activeTurn;
      setTurn(activeTurn);
      return;
    }
    if (phase === "move") {
      if (turnState.current) turnState.current.progress = direction === "forward" ? amount : 1 - amount;
      return;
    }
    if (!turnState.current) return;
    const commit = amount > 0.32;
    const current = direction === "forward" ? amount : 1 - amount;
    const target = commit ? (direction === "forward" ? 1 : 0) : direction === "forward" ? 0 : 1;
    animateTurn(direction, current, target, commit);
  }, [animateTurn]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && showPublication) return;
      if (event.key === "Escape" && showElementAgentGuide) {
        closeElementAgentGuide();
        return;
      }
      if (event.key === "Escape" && showCreateGuide) {
        closeCodexGuide();
        return;
      }
      if (event.key === "Escape" && showLibrary) {
        // Escape always resolves the shelf. When a cover transition is already
        // running, skip straight to the reader instead of ignoring the key.
        if (openingBook || bookTransition || libraryMotion !== "idle") {
          openingBookRef.current = null;
          setOpeningBook(null);
          setBookTransition(null);
          hideLibrary();
        } else {
          openBookFromLibrary(snapshot.document.id);
        }
        return;
      }
      if (showLibrary) return;
      if (event.key === "Escape") {
        if (showOutline) {
          setShowOutline(false);
          return;
        }
        if (snapshot.session.preview) bookEngine.setPreview(false);
        else bookEngine.setSelection(null);
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, select, textarea, [contenteditable="true"]')) return;
      if (event.key === "ArrowRight") turnPage("forward");
      if (event.key === "ArrowLeft") turnPage("backward");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bookTransition, closeCodexGuide, closeElementAgentGuide, hideLibrary, libraryMotion, openBookFromLibrary, openingBook, showCreateGuide, showElementAgentGuide, showLibrary, showOutline, showPublication, snapshot.document.id, snapshot.session.preview, turnPage]);

  useEffect(() => {
    if (!showLibrary) return undefined;
    const sheet = librarySheet.current;
    if (!sheet) return undefined;
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = [...sheet.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((control) => !control.hasAttribute("disabled"));
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    sheet.addEventListener("keydown", keepFocusInside);
    return () => sheet.removeEventListener("keydown", keepFocusInside);
  }, [showLibrary]);

  useEffect(() => {
    if (!showLibrary || libraryMotion !== "idle" || bookTransition) return;
    window.setTimeout(() => librarySheet.current?.querySelector<HTMLElement>(".library-close")?.focus(), 0);
  }, [bookTransition, libraryMotion, showLibrary]);

  useEffect(() => {
    if (!showCreateGuide) return undefined;
    const card = createGuideCard.current;
    if (!card) return undefined;
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = [...card.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((control) => !control.hasAttribute("disabled"));
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    card.addEventListener("keydown", keepFocusInside);
    return () => card.removeEventListener("keydown", keepFocusInside);
  }, [showCreateGuide]);

  useEffect(() => {
    if (!showElementAgentGuide) return undefined;
    const card = elementAgentCard.current;
    if (!card) return undefined;
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = [...card.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])')]
        .filter((control) => !control.hasAttribute("disabled"));
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    card.addEventListener("keydown", keepFocusInside);
    return () => card.removeEventListener("keydown", keepFocusInside);
  }, [showElementAgentGuide]);

  useEffect(() => () => {
    if (turnFrame.current) cancelAnimationFrame(turnFrame.current);
    if (openingFrame.current) cancelAnimationFrame(openingFrame.current);
    if (libraryFrame.current) cancelAnimationFrame(libraryFrame.current);
    releaseAssetUrls();
    turnState.current = null;
  }, []);

  const liftSelected = () => {
    if (!selected) return;
    bookEngine.dispatch({ type: "lift", requestId: createRequestId(), expectedRevision: snapshot.document.revision, elementId: selected.id }, "human");
  };

  const toggleLock = () => {
    if (!selected) return;
    bookEngine.dispatch({ type: "edit", requestId: createRequestId(), expectedRevision: snapshot.document.revision, elementId: selected.id, locked: !selected.locked }, "human");
  };

  const applyMotion = (preset: MotionPreset | "none") => {
    if (!selected) return;
    humanAnimate(selected.id, preset === "none" ? null : { preset, durationMs: preset === "fly-across" ? 5200 : preset === "water-bob" ? 4200 : 3600, loop: true });
  };

  const setHoverResponse = (hover: HoverResponse) => {
    if (!selected) return;
    humanInteract(selected.id, { hover });
  };

  const setFocusResponse = (focus: FocusResponse) => {
    if (!selected) return;
    humanInteract(selected.id, { focus });
  };

  const adjustSelected = (kind: "scale" | "rotate", amount: number) => {
    if (!selected || selected.locked) return;
    if (kind === "scale") {
      const scale = Math.max(0.3, Math.min(1.8, selected.transform.scaleX + amount));
      humanEdit(selected.id, { scaleX: scale, scaleY: scale });
    } else humanEdit(selected.id, { rotationDeg: selected.transform.rotationDeg + amount });
  };

  const setTheme = (theme: ThemeId) => bookEngine.setTheme(theme, "human");

  const importWorkshopPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setAssetImporting(true);
    setWorkshopImportError(null);
    let imported = 0;
    try {
      for (const file of Array.from(files).slice(0, 6 - workshopAssetCount)) {
        if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size <= 0 || file.size > MAX_SOURCE_IMAGE_BYTES) continue;
        const asset = await storeLocalImage(file);
        imported += 1;
        recordDiagnostic("workbench:asset-handed-off", { assetId: asset.id, originalSize: asset.originalSize ?? asset.size, size: asset.size, optimized: asset.optimized ?? false });
      }
      if (imported > 0) setWorkshopAssetCount((current) => Math.min(6, current + imported));
      else setWorkshopImportError("That file was not a usable image. Choose PNG, JPEG, or WebP under 12 MB, then try the handoff again.");
    } catch {
      setWorkshopImportError("This browser could not store those images. Free some space or try a private-window-free profile, then try again.");
    } finally {
      setAssetImporting(false);
    }
  };

  const createPrompt = useMemo(() => {
    return [
      "Work on the Apertale page that is open beside this conversation. It is a WebMCP-enabled living-book canvas.",
      "First call get_project_context. Then create a new independent book; never overwrite a curated sample.",
      `Use exactly ${creationSpreadCount} spreads and the visual direction: ${creationStyle}.`,
      "Ask me for a short description, intended audience, and any source photos or illustrations here in this Agent conversation unless I already supplied them. Do not ask me to enter the same brief again inside Apertale.",
      `Plan the complete book and a dedicated portrait cover before editing. Use your available image generation or editing capabilities for original artwork.${workshopAssetCount > 0 ? ` ${workshopAssetCount} image handoff${workshopAssetCount === 1 ? " is" : "s are"} already available through get_project_context(detail: "assets").` : ""}`,
      "If the current host cannot transfer an attached or generated image through WebMCP, ask me to use the small Image handoff control in Apertale, then refresh get_project_context(detail: \"assets\"). Do not pretend a media transfer succeeded.",
      "Build every spread through Apertale's Site Tools. Add purposeful hover, click, depth, and short frame animation only where they support the content. Keep the Apertale page open and show each revision there.",
    ].join("\n");
  }, [creationSpreadCount, creationStyle, workshopAssetCount]);

  const copyPrompt = async () => {
    await navigator.clipboard?.writeText(createPrompt);
    setCopied(true);
    recordDiagnostic("workbench:starter-copied", { spreads: creationSpreadCount, style: creationStyle });
    window.setTimeout(() => setCopied(false), 1800);
  };

  const confirmReset = () => {
    if (window.confirm("Restore the original Apertale sample book? Your local edits will be replaced.")) bookEngine.reset();
  };

  const undoLastAction = () => {
    const undoToken = snapshot.lastAction?.undoToken;
    if (!undoToken) return;
    bookEngine.dispatch({
      type: "undo",
      requestId: createRequestId(),
      expectedRevision: snapshot.document.revision,
      undoToken,
    }, "human");
  };

  return (
    <main className={`app-shell ${snapshot.session.preview ? "is-preview" : ""} ${showCreateGuide ? "is-creation-active" : ""} ${showElementAgentGuide ? "is-agent-handoff-active" : ""} ${bookTransition ? `is-book-nav-active is-book-nav-${bookTransition.direction}` : ""}`}>
      <header className="topbar" hidden={showLibrary || showCreateGuide} aria-hidden={showElementAgentGuide || undefined}>
        {!snapshot.session.preview && <button className="library-button" onClick={openLibrary} aria-label="Open book library"><Books size={18} /> <span>Books</span></button>}
        <button className="wordmark" onClick={() => { bookEngine.setPreview(false); openLibrary(); }} aria-label="Open book library">Apertale</button>
        <div className="topbar-actions">
          <div className="theme-switch" role="group" aria-label="Scene theme">
            <button className={!isNight ? "is-active" : ""} onClick={() => setTheme("paper-atelier")} aria-label="Day theme" aria-pressed={!isNight}><Sun size={17} weight="regular" /> <span>Day</span></button>
            <button className={isNight ? "is-active" : ""} onClick={() => setTheme("midnight-desk")} aria-label="Night theme" aria-pressed={isNight}><Moon size={17} weight="regular" /> <span>Night</span></button>
          </div>
          <button className="preview-button" onClick={() => bookEngine.setPreview(!snapshot.session.preview)} aria-label={snapshot.session.preview ? "Exit preview" : "Preview book"}>
            {snapshot.session.preview ? <EyeSlash size={18} /> : <Eye size={18} />}
            <span>{snapshot.session.preview ? "Exit preview" : "Preview"}</span>
          </button>
        </div>
      </header>

      {showLibrary && !snapshot.session.preview && !showCreateGuide && (
        <section
          className={`book-library ${libraryMotion !== "idle" ? `is-${libraryMotion}` : ""} ${bookTransition ? "is-transitioning" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="library-title"
          aria-hidden={showCreateGuide || undefined}
          aria-busy={libraryBusy}
        >
          <div className="library-atmosphere" />
          <div className="library-sheet" ref={librarySheet}>
            <header className="library-topbar">
              <button className="library-wordmark" onClick={(event) => openBookFromLibrary("apertale-field-guide", event.currentTarget)} disabled={libraryBusy}><BookOpenText size={19} /> Apertale</button>
              <div className="library-topbar-actions">
                <div className="theme-switch" role="group" aria-label="Library theme">
                  <button className={!isNight ? "is-active" : ""} onClick={() => setTheme("paper-atelier")} aria-label="Day theme" aria-pressed={!isNight} disabled={libraryBusy}><Sun size={17} /><span>Day</span></button>
                  <button className={isNight ? "is-active" : ""} onClick={() => setTheme("midnight-desk")} aria-label="Night theme" aria-pressed={isNight} disabled={libraryBusy}><Moon size={17} /><span>Night</span></button>
                </div>
                <button className="library-close" autoFocus onClick={() => openBookFromLibrary(snapshot.document.id)} aria-label="Return to open book" disabled={libraryBusy}><X size={20} /></button>
              </div>
            </header>
            <div className="library-intro">
              <p>Your living library</p>
              <h1 id="library-title">Open a world.<br />Then make one yours.</h1>
              <span>Browse anywhere. Create in Codex (ChatGPT desktop) with your own plan.</span>
              <div className="library-actions">
                <button className="create-codex-button" onClick={openCodexGuide} disabled={libraryBusy}><Sparkle size={18} weight="fill" /> Create with Codex</button>
                <button className="guide-book-button" onClick={() => openBookFromLibrary("apertale-field-guide")} onPointerEnter={() => prewarmReader("apertale-field-guide")} onFocus={() => prewarmReader("apertale-field-guide")} disabled={libraryBusy}><BookOpenText size={18} /> Read the Guide Book</button>
              </div>
              <p className="library-scroll-cue" aria-hidden="true">Swipe for all {library.books.length} books<ArrowRight size={14} weight="bold" /></p>
            </div>
            <div className="library-gallery" aria-label="Books in this library">
              {library.books.map((book, index) => (
                <button
                  key={book.id}
                  data-book-id={book.id}
                  className={`library-card library-card-${index + 1} ${book.id === library.activeBookId ? "is-active" : ""} ${openingBook?.id === book.id ? "is-opening" : ""}`}
                  onClick={(event) => openBookFromLibrary(book.id, event.currentTarget)}
                  onPointerEnter={() => prewarmReader(book.id)}
                  onFocus={() => prewarmReader(book.id)}
                  aria-busy={openingBook?.id === book.id}
                  disabled={libraryBusy}
                >
                  <span className="library-cover-frame">
                    <img
                      src={resolvedCoverUrls[book.id] ?? book.coverTextureUrl}
                      alt={`${book.title} cover`}
                      loading={index < 2 ? "eager" : "lazy"}
                      decoding="async"
                      fetchPriority={index === 0 ? "high" : "auto"}
                    />
                    {openingBook?.id === book.id && <span className="library-opening-badge" aria-hidden="true"><SpinnerGap size={15} weight="bold" /> Opening</span>}
                  </span>
                  <span className="library-card-copy">
                    <small>{book.id === "apertale-field-guide" ? "Start here" : book.sample ? "Curated demo" : "Your book"} · {book.spreadCount} spreads</small>
                    <strong>{book.title}</strong>
                  </span>
                </button>
              ))}
            </div>
            <p className="demo-disclosure">Curated samples use OpenAI-generated illustration. Create your own with Codex and ImageGen in your active conversation.</p>
            {openingBook && <BookLoadingFeedback title={openingBook.title} placement="library" stage={loadStage} reducedMotion={reducedMotion} />}
          </div>
        </section>
      )}

      {bookTransition && <BookTransitionOverlay transition={bookTransition} onDone={finishBookTransition} />}

      <section
        className={`stage ${showCreateGuide ? "is-creation-workshop" : ""}`}
        hidden={showLibrary && !showCreateGuide}
        aria-hidden={(showLibrary && !showCreateGuide) || undefined}
        aria-busy={!showCreateGuide && stageIsLoading}
        aria-label={showCreateGuide ? "Blank three-dimensional book workshop" : `${spread.title}. Spread ${snapshot.session.currentSpreadIndex + 1} of ${snapshot.document.spreads.length}`}
      >
        {showLibrary && !showCreateGuide ? null : renderWebGl ? (
          <Suspense fallback={showCreateGuide
            ? <div className="fallback-book workshop-blank-fallback is-loading" />
            : <div className="fallback-book is-loading"><img src={spread.textureUrl} alt="" /></div>}>
            <ThreeBook
              snapshot={showCreateGuide ? workshopSnapshot : snapshot}
              turn={showCreateGuide ? null : turn}
              mode={showCreateGuide ? "workshop" : "reader"}
              onSelect={showCreateGuide ? () => undefined : (elementId) => { bookEngine.setSelection(elementId); setShowMore(false); }}
              onHover={showCreateGuide ? () => undefined : setHoveredId}
              onMoveElement={showCreateGuide ? () => undefined : (elementId, x, y) => humanEdit(elementId, { x, y })}
              onPageGesture={showCreateGuide ? () => undefined : onPageGesture}
              onLoading={showCreateGuide ? () => undefined : handleBookLoading}
              onReady={showCreateGuide ? () => undefined : handleBookReady}
              onFailure={() => setSceneFailed(true)}
            />
          </Suspense>
        ) : showCreateGuide ? (
          <div className="fallback-book workshop-blank-fallback" aria-label="Blank two-dimensional book workshop" />
        ) : (
          <div className="fallback-book" aria-label={`Two-dimensional fallback for ${spread.title}`}>
            {spread.textureUrl ? (
              <img src={spread.textureUrl} alt="" role="presentation" onLoad={() => handleBookReady(snapshot.document.id)} />
            ) : (
              <article className="fallback-plate">
                {spread.kicker && <p className="fallback-kicker">{spread.kicker}</p>}
                <h2>{spread.title}</h2>
                <p>{spread.body}</p>
                {spread.elements.map((element) => {
                  const reveal = resolveInteraction(element).reveal;
                  if (reveal.kind !== "fact-card") return null;
                  return (
                    <dl key={element.id}>
                      {reveal.facts.map((fact) => (
                        <div key={fact.label}>
                          <dt>{fact.label}</dt>
                          <dd>{fact.value}</dd>
                        </div>
                      ))}
                    </dl>
                  );
                })}
              </article>
            )}
          </div>
        )}

        {stageIsLoading && !showLibrary && !showCreateGuide && <BookLoadingFeedback title={openingBook?.title ?? snapshot.document.title} placement="stage" stage={loadStage} reducedMotion={reducedMotion} />}

        {!snapshot.session.preview && !showCreateGuide && (
          <>
            <button className="page-arrow page-arrow-left" onClick={() => turnPage("backward")} disabled={!canGoBack || Boolean(turn)} aria-label="Previous spread"><ArrowLeft size={22} /></button>
            <button className="page-arrow page-arrow-right" onClick={() => turnPage("forward")} disabled={!canGoForward || Boolean(turn)} aria-label="Next spread"><ArrowRight size={22} /></button>
          </>
        )}

        {!showCreateGuide && (
          <aside className="reader-sheet" aria-label="Reading panel">
            <div className="reader-sheet-copy" ref={readerCopy}>
              {spread.kicker && <p className="reader-sheet-kicker">{spread.kicker}</p>}
              <h2>{spread.title}</h2>
              <p>{spread.body}</p>
            </div>
            <div className="reader-sheet-controls">
              <button onClick={() => turnPage("backward")} disabled={!canGoBack || Boolean(turn)} aria-label="Previous spread"><ArrowLeft size={24} /></button>
              <span className="reader-sheet-progress"><strong>{snapshot.session.currentSpreadIndex + 1}</strong> / {snapshot.document.spreads.length}</span>
              <button onClick={() => turnPage("forward")} disabled={!canGoForward || Boolean(turn)} aria-label="Next spread"><ArrowRight size={24} /></button>
            </div>
          </aside>
        )}

        {selected && !snapshot.session.preview && !turn && !showCreateGuide && (
          <div className="selection-ui" aria-label={`${selected.label} selected`}>
            <div className="selection-ring" />
            <div className={`context-menu ${selected.page === "right" ? "clears-right" : "clears-left"}`}>
              <button onClick={openElementAgentGuide}><Sparkle size={17} /> Ask Codex</button>
              <button onClick={liftSelected} className={selected.kind === "lifted" ? "is-on" : ""} disabled={selected.locked || selected.kind === "lifted"}>
                <ArrowUp size={17} /> {selected.kind === "lifted" ? "Lifted" : "Lift"}
              </button>
              <button onClick={toggleLock}>{selected.locked ? <Lock size={17} /> : <LockOpen size={17} />} {selected.locked ? "Unlock" : "Lock"}</button>
              <button className="icon-button" onClick={() => setShowMore(!showMore)} aria-label="More element controls"><DotsThree size={21} weight="bold" /></button>
            </div>
            {showMore && (
              <div className={`element-panel ${selected.page === "right" ? "clears-right" : "clears-left"}`}>
                <div><span>Scale</span><button onClick={() => adjustSelected("scale", -0.1)} aria-label="Scale down" disabled={selected.locked}><Minus size={14} /></button><output>{Math.round(selected.transform.scaleX * 100)}%</output><button onClick={() => adjustSelected("scale", 0.1)} aria-label="Scale up" disabled={selected.locked}><Plus size={14} /></button></div>
                <div><span>Rotate</span><button onClick={() => adjustSelected("rotate", -8)} aria-label="Rotate counter-clockwise" disabled={selected.locked}><ArrowCounterClockwise size={14} /></button><output>{Math.round(selected.transform.rotationDeg)}°</output><button onClick={() => adjustSelected("rotate", 8)} aria-label="Rotate clockwise" disabled={selected.locked}><ArrowClockwise size={14} /></button></div>
                <label>
                  <span>On hover</span>
                  <select value={selectedInteraction?.hover ?? "none"} onChange={(event) => setHoverResponse(event.target.value as HoverResponse)} disabled={selected.locked}>
                    {HOVER_RESPONSES.map((response) => (
                      <option key={response} value={response}>{HOVER_LABELS[response]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>On focus</span>
                  <select value={selectedInteraction?.focus ?? "none"} onChange={(event) => setFocusResponse(event.target.value as FocusResponse)} disabled={selected.locked}>
                    {FOCUS_RESPONSES.map((response) => (
                      <option key={response} value={response}>{FOCUS_LABELS[response]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Motion</span>
                  <select value={selected.motion?.preset ?? "none"} onChange={(event) => applyMotion(event.target.value as MotionPreset | "none")} disabled={selected.locked}>
                    <option value="none">Still</option>
                    <option value="gentle-float">Gentle float</option>
                    <option value="fly-across">Fly across</option>
                    <option value="water-bob">Water bob</option>
                    <option value="soft-pulse">Soft pulse</option>
                    <option value="slow-orbit">Slow orbit</option>
                  </select>
                </label>
              </div>
            )}
          </div>
        )}

        {!snapshot.session.preview && !showCreateGuide && spread.elements.length > 0 && (
          <nav className="element-rail" aria-label={`Interactive elements on ${spread.title}`}>
            {spread.elements.map((element) => {
              const interaction = resolveInteraction(element);
              const isSelected = element.id === snapshot.session.selectionId;
              return (
                <button
                  key={element.id}
                  className={`${isSelected ? "is-selected" : ""} ${element.id === hoveredId ? "is-hovered" : ""}`}
                  onClick={() => bookEngine.setSelection(isSelected ? null : element.id)}
                  onPointerEnter={() => setHoveredId(element.id)}
                  onPointerLeave={() => setHoveredId((current) => (current === element.id ? null : current))}
                  onFocus={() => setHoveredId(element.id)}
                  onBlur={() => setHoveredId((current) => (current === element.id ? null : current))}
                  aria-pressed={isSelected}
                >
                  <ImageSquare size={17} />
                  <span>
                    <strong>{element.label}</strong>
                    <small>{interaction.hint}</small>
                  </span>
                </button>
              );
            })}
          </nav>
        )}

        {hovered && hovered.id !== snapshot.session.selectionId && !snapshot.session.preview && !turn && !snapshot.lastAction && !showCreateGuide && (
          <p className="hover-hint" role="presentation">{resolveInteraction(hovered).hint}</p>
        )}

        {selected && selectedInteraction && hasReveal(selectedInteraction) && !turn && !showCreateGuide && (
          <aside
            className={`reveal-card reveal-${selectedInteraction.reveal.kind} ${selected.page === "right" ? "is-right" : "is-left"}`}
            aria-label={`${selectedInteraction.reveal.title} details`}
          >
            <header>
              <p>{selected.label}</p>
              <h2>{selectedInteraction.reveal.title}</h2>
            </header>
            <p className="reveal-summary">{selectedInteraction.reveal.summary}</p>
            {selectedInteraction.reveal.facts.length > 0 && (
              <dl>
                {selectedInteraction.reveal.facts.map((fact) => (
                  <div key={fact.label}>
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {selectedInteraction.reveal.source && <p className="reveal-source">{selectedInteraction.reveal.source}</p>}
            <button className="reveal-close" onClick={() => bookEngine.setSelection(null)} aria-label="Close details">
              <X size={16} />
            </button>
          </aside>
        )}

        {snapshot.lastAction && !showCreateGuide && (
          <div className={`agent-action agent-action-${snapshot.lastAction.phase}`} role="status">
            {snapshot.lastAction.phase === "success" ? <Check size={16} weight="bold" /> : <Sparkle size={16} />}
            <span>{snapshot.lastAction.summary}</span>
            {snapshot.lastAction.undoToken && <button onClick={undoLastAction}>Undo</button>}
          </div>
        )}
      </section>

      {!snapshot.session.preview && !showCreateGuide && (
        <footer className="bottom-controls" hidden={showLibrary}>
          <div className="bottom-left-actions">
            <button className="outline-button" onClick={() => setShowOutline(!showOutline)} aria-expanded={showOutline}>Story</button>
            {isCreatorBook && (
              <button
                className={`publish-button ${publicationRecord?.status === "published" ? "is-live" : ""}`}
                onClick={openPublication}
                aria-haspopup="dialog"
              >
                {publicationRecord?.status === "published" ? <LinkSimple size={17} weight="bold" /> : <UploadSimple size={17} weight="bold" />}
                <span>{publicationRecord?.status === "published" ? "Shared" : "Publish"}</span>
              </button>
            )}
          </div>
          <button className="agent-prompt" onClick={openCodexGuide}>
            <Sparkle size={17} weight="fill" />
            <span>Create with Codex</span>
          </button>
          <div className="page-progress"><strong>{snapshot.session.currentSpreadIndex + 1}</strong><span>/</span>{snapshot.document.spreads.length}</div>
        </footer>
      )}

      {showOutline && !snapshot.session.preview && !showCreateGuide && (
        <aside className="story-outline" aria-label="Book outline">
          <div className="outline-head"><div><span>Story outline</span><small>Revision {snapshot.document.revision}</small></div><button onClick={() => setShowOutline(false)} aria-label="Close outline"><X size={18} /></button></div>
          <ol>
            {snapshot.document.spreads.map((item, index) => (
              <li key={item.id}><button className={index === snapshot.session.currentSpreadIndex ? "is-current" : ""} onClick={() => { bookEngine.setSpread(index); setShowOutline(false); }}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{item.title}</strong><small>{item.body}</small></div></button></li>
            ))}
          </ol>
          <div className="outline-foot">
            <span
              className={webMcpAvailable ? "is-connected" : ""}
              title={webMcpAvailable ? "This browser exposed the WebMCP tool runtime." : "This WebMCP-enabled app remains fully usable while the current browser has not exposed the tool runtime."}
            ><i /> {webMcpAvailable ? "WebMCP connected" : "WebMCP ready"}</span>
            {activeLibraryBook?.sample && <button onClick={confirmReset}><ArrowCounterClockwise size={15} /> Reset sample</button>}
          </div>
        </aside>
      )}

      {showCreateGuide && !snapshot.session.preview && (
        <section className="creation-workshop" role="dialog" aria-modal="true" aria-labelledby="codex-guide-title">
          <div className="workshop-atmosphere" aria-hidden="true" />
          <div className="workshop-ui" ref={createGuideCard}>
            <header className="workshop-topbar">
              <button className="workshop-wordmark" onClick={closeCodexGuide}><BookOpenText size={19} /> Apertale</button>
              <span>New book workshop</span>
              <button className="workshop-close" autoFocus onClick={closeCodexGuide} aria-label="Close creation workshop"><X size={20} /></button>
            </header>

            <div className="workshop-intro">
              <p>Your blank book</p>
              <h2 id="codex-guide-title">Set the canvas.<br />Tell your Agent the story.</h2>
              <span>Choose only the shape of the book here. Your words and images belong in the Agent conversation.</span>
            </div>

            <div className="workshop-page-controls" aria-label="New book settings">
              <fieldset className="workshop-choice workshop-length">
                <legend><span>01</span> Length</legend>
                <div>
                  {CREATION_LENGTHS.map((count) => (
                    <button type="button" key={count} className={creationSpreadCount === count ? "is-selected" : ""} onClick={() => setCreationSpreadCount(count)} aria-pressed={creationSpreadCount === count}>
                      <strong>{count}</strong><small>spreads</small>
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="workshop-choice workshop-style">
                <legend><span>02</span> Visual direction</legend>
                <div>
                  {CREATION_STYLES.map((style) => (
                    <button type="button" key={style} className={creationStyle === style ? "is-selected" : ""} onClick={() => setCreationStyle(style)} aria-pressed={creationStyle === style}>
                      {style}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>

            <aside className="workshop-agent-panel" aria-label="Continue in your Agent">
              <div className={`workbench-status ${webMcpAvailable ? "is-connected" : ""}`}>
                <i /><span><strong>{webMcpAvailable ? "WebMCP connected" : "WebMCP-ready page"}</strong><small>{webMcpAvailable ? "Your Agent can operate this open book." : "Open this page in a WebMCP-capable Agent browser."}</small></span>
              </div>
              <p className="workshop-agent-boundary">Continue in Codex (ChatGPT desktop) beside this Site.</p>
              <div className="workshop-handoff-copy">
                <p>Continue in your Agent</p>
                <h3>Bring the idea.<br />Bring the pictures.</h3>
                <ol>
                  <li><span>1</span><strong>Copy the starter</strong></li>
                  <li><span>2</span><strong>Paste it in your Agent</strong></li>
                  <li><span>3</span><strong>Add your request and images there</strong></li>
                </ol>
              </div>
              <div className="workshop-selection-summary">
                <span>{creationSpreadCount} spreads</span>
                <span>{creationStyle}</span>
              </div>
              <button className="copy-starter-button" onClick={() => void copyPrompt()}>
                {copied ? <Check size={18} weight="bold" /> : <Copy size={18} weight="bold" />}
                {copied ? "Copied — paste in your Agent" : "Copy starter prompt"}
              </button>
              <div className="workshop-media-note">
                <p>Start by attaching photos in your Agent chat. If that host cannot hand them to WebMCP yet, use this fallback once; images up to 12 MB are optimized locally.</p>
                <button type="button" onClick={() => fileInput.current?.click()} disabled={assetImporting || workshopAssetCount >= 6}>
                  {assetImporting ? <SpinnerGap size={14} className="is-spinning" /> : <Plus size={14} />}
                  {assetImporting ? "Importing" : workshopAssetCount > 0 ? `${workshopAssetCount} image${workshopAssetCount === 1 ? "" : "s"} ready` : "Image handoff"}
                </button>
                <input ref={fileInput} hidden type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(event) => { void importWorkshopPhotos(event.currentTarget.files); event.currentTarget.value = ""; }} />
                {workshopImportError && (
                  <p className="workshop-import-error" role="alert">
                    <WarningCircle size={14} weight="fill" />
                    <span>{workshopImportError}</span>
                    <button type="button" onClick={() => { setWorkshopImportError(null); fileInput.current?.click(); }}>Choose another image</button>
                  </p>
                )}
              </div>
            </aside>
          </div>
        </section>
      )}

      {showElementAgentGuide && selected && !snapshot.session.preview && (
        <section className="element-agent-overlay" role="dialog" aria-modal="true" aria-labelledby="element-agent-title">
          <div className="element-agent-card" ref={elementAgentCard}>
            <header>
              <span><Sparkle size={16} weight="fill" /> Ask Codex about this element</span>
              <button autoFocus onClick={closeElementAgentGuide} aria-label="Close Ask Codex handoff"><X size={18} /></button>
            </header>
            <div className="element-agent-body">
              <p>Selected element</p>
              <h2 id="element-agent-title">{selected.label}</h2>
              <span>This keeps the current book and spread. It does not start a new book.</span>
              <dl>
                <div><dt>Book</dt><dd>{snapshot.document.title}</dd></div>
                <div><dt>Spread</dt><dd>{spread.title}</dd></div>
                <div><dt>Intent</dt><dd>{selectedInteraction?.hint}</dd></div>
              </dl>
            </div>
            <footer>
              <p>Continue in the Agent conversation beside this page.</p>
              <button className="copy-element-request" onClick={() => void copySelectedElementPrompt()}>
                {elementPromptCopied ? <Check size={17} weight="bold" /> : <Copy size={17} weight="bold" />}
                {elementPromptCopied ? "Copied — paste in your Agent" : "Copy element request"}
              </button>
            </footer>
          </div>
        </section>
      )}

      {showPublication && isCreatorBook && !snapshot.session.preview && (
        <PublicationPanel
          document={snapshot.document}
          record={publicationRecord}
          onRecordChange={setPublicationRecord}
          onClose={closePublication}
        />
      )}

      {!showLibrary && <div className="sr-only" aria-live="polite">
        {announce(
          spread.title,
          spread.body,
          ...(selectedInteraction && hasReveal(selectedInteraction)
            ? [
                selectedInteraction.reveal.title,
                selectedInteraction.reveal.summary,
                ...selectedInteraction.reveal.facts.map((fact) => `${fact.label}: ${fact.value}`),
              ]
            : []),
        )}
      </div>}
    </main>
  );
}
