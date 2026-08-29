import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
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
  Minus,
  Plus,
  ImageSquare,
  LinkSimple,
  Sparkle,
  SpinnerGap,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { bookEngine, humanAnimate, humanEdit, humanInteract } from "./bookEngine";
import { releaseAssetUrls, resolveAssetUrl } from "./assetStore";
import {
  CREATION_LENGTHS,
  CREATION_PHOTO_USES,
  CREATION_SOURCES,
  CREATION_STYLES,
  INITIAL_CREATION_WORKSHOP,
  MAX_WORKSHOP_ASSETS,
  buildCreationWorkshopBrief,
  importCreationWorkshopAssets,
  persistCreationWorkshopAssetOrder,
  reduceCreationWorkshop,
  restoreCreationWorkshopAssets,
} from "./creationWorkshop";
import { AnimatePresence } from "motion/react";
import { Panel, Toast } from "./design/primitives";
import { ThemeSwitch } from "./design/ThemeSwitch";
import { completeImageHandoff, dismissImageHandoff, subscribeToImageHandoff, type ImageHandoffRequest } from "./imageHandoff";
import { recordDiagnostic } from "./diagnostics";
import { useFocusTrap } from "./focusTrap";
import { dedicatedCoverRendered, fallbackAssetPlan, fallbackImageLoadKeys, fallbackRenderComplete } from "./renderEvidence";
import {
  FOCUS_LABELS,
  FOCUS_RESPONSES,
  HOVER_LABELS,
  HOVER_RESPONSES,
  hasReveal,
  resolveInteraction,
} from "./interaction";
import { canTurnPage, createPageTurnSession, pageTurnNavDisabled } from "./pageTurn";
import { PublicationPanel } from "./PublicationPanel";
import { getPublicationRecord } from "./publishingClient";
import type { PublicationRecord } from "./publishingClient";
import type { BookSnapshot, FocusResponse, HoverResponse, MotionPreset, Spread, ThemeId, TurnState } from "./types";
import { registerWebMcpTools } from "./webmcp";

const runtimeParams = new URLSearchParams(window.location.search);
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const forceReducedMotion = runtimeParams.get("reducedMotion") === "1";
const forceFallback = runtimeParams.get("fallback") === "1";
/**
 * Freezes the case at a fixed openness so a mid-swing pose can be captured for
 * the visual QA record in app/qa. 0 is closed, 1 is open; anything outside that
 * range is ignored.
 */
const forcedOpenProgress = (() => {
  // URLSearchParams.get returns null when the parameter is absent, and
  // Number(null) is 0 - not NaN - so a missing parameter used to read as a
  // valid "freeze the book shut", which froze it for every visitor.
  const raw = runtimeParams.get("openProgress");
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
})();
const ThreeBook = lazy(() => import("./ThreeBook").then((module) => ({ default: module.ThreeBook })));

type OpeningBook = {
  id: string;
  title: string;
  coverUrl: string;
};

type LibraryMotion = "idle" | "opening-book" | "closing-book";
type LibraryTab = "yours" | "explore";

/**
 * A book belongs to the reader unless the samples set claims it, so `sample`
 * being false *or absent* means personal. Personal books lead the shelf; the
 * segmented control only appears once there is a second section worth showing.
 */
export function partitionLibraryBooks<Book extends { sample?: boolean }>(books: readonly Book[]) {
  const personal = books.filter((book) => !book.sample);
  const curated = books.filter((book) => Boolean(book.sample));
  return { personal, curated, tabbed: personal.length > 0 };
}

async function copyPlainText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // The selection fallback below keeps copy usable in restricted webviews.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.appendChild(textarea);
  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand?.("copy") ?? false;
  } catch {
    return false;
  } finally {
    textarea.remove();
    priorFocus?.focus();
  }
}

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

type FallbackLayer = {
  id: string;
  url: string;
  element: Spread["elements"][number];
};

function FallbackBook({ snapshot, spread, onReady, onUnavailable, onRendered }: {
  snapshot: BookSnapshot;
  spread: Spread;
  onReady: (documentId: string) => void;
  onUnavailable: (documentId: string) => void;
  onRendered: (evidence: {
    documentId: string;
    revision: number;
    spreadId: string;
    theme: ThemeId;
    surface: "fallback";
    locator: string;
  }) => void;
}) {
  const evidenceKey = `${snapshot.document.id}:${snapshot.document.revision}:${spread.id}:${snapshot.session.sceneThemeId}`;
  const [resolved, setResolved] = useState<{ key: string; baseUrl: string; layers: FallbackLayer[] } | null>(null);
  const [loadedIds, setLoadedIds] = useState<Set<string>>(() => new Set());
  const [failed, setFailed] = useState(false);
  const reportedKey = useRef("");

  useEffect(() => {
    let canceled = false;
    const { baseAssetId, foreground } = fallbackAssetPlan(spread);
    setResolved(null);
    setLoadedIds(new Set());
    setFailed(false);
    if (!baseAssetId) {
      setFailed(true);
      onUnavailable(snapshot.document.id);
      recordDiagnostic("fallback:final-base-missing", {
        documentId: snapshot.document.id,
        revision: snapshot.document.revision,
        spreadId: spread.id,
      });
      return () => { canceled = true; };
    }
    void Promise.all([
      resolveAssetUrl(baseAssetId),
      ...foreground.map(async (element): Promise<FallbackLayer> => ({
        id: element.id,
        url: await resolveAssetUrl(element.assetId),
        element,
      })),
    ]).then(([baseUrl, ...layers]) => {
      if (!canceled) setResolved({ key: evidenceKey, baseUrl, layers });
    }).catch(() => {
      if (canceled) return;
      setFailed(true);
      onUnavailable(snapshot.document.id);
      recordDiagnostic("fallback:asset-resolve-failed", {
        documentId: snapshot.document.id,
        revision: snapshot.document.revision,
        spreadId: spread.id,
      });
    });
    return () => { canceled = true; };
  }, [evidenceKey, onUnavailable, snapshot.document.id, snapshot.document.revision, spread]);

  const loadKeys = resolved
    ? fallbackImageLoadKeys(resolved.key, resolved.layers.map((layer) => layer.id))
    : [];
  const expectedCount = loadKeys.length;
  useEffect(() => {
    if (
      !resolved
      || !fallbackRenderComplete(expectedCount, loadedIds, failed)
      || reportedKey.current === resolved.key
    ) return;
    reportedKey.current = resolved.key;
    onReady(snapshot.document.id);
    onRendered({
      documentId: snapshot.document.id,
      revision: snapshot.document.revision,
      spreadId: spread.id,
      theme: snapshot.session.sceneThemeId,
      surface: "fallback",
      locator: ".fallback-book.is-composited",
    });
  }, [expectedCount, failed, loadedIds, onReady, onRendered, resolved, snapshot.document.id, snapshot.document.revision, snapshot.session.sceneThemeId, spread.id]);

  const markLoaded = (id: string) => setLoadedIds((current) => {
    if (current.has(id)) return current;
    return new Set([...current, id]);
  });
  const markFailed = (id: string) => {
    setFailed(true);
    onUnavailable(snapshot.document.id);
    recordDiagnostic("fallback:asset-load-failed", {
      documentId: snapshot.document.id,
      revision: snapshot.document.revision,
      spreadId: spread.id,
      asset: id,
    });
  };

  if (failed) {
    return (
      <div className="fallback-book" aria-label={`Two-dimensional fallback for ${spread.title}`}>
        <article className="fallback-plate" role="status">
          <h2>Visual review unavailable</h2>
          <p>One or more final scene assets could not be loaded. Re-import the missing asset before critique.</p>
        </article>
      </div>
    );
  }
  if (!resolved) return <div className="fallback-book is-loading" aria-label={`Loading two-dimensional fallback for ${spread.title}`} />;

  return (
    <div className="fallback-book is-composited" aria-label={`Two-dimensional fallback for ${spread.title}`}>
      <img
        className="fallback-composite-base"
        src={resolved.baseUrl}
        alt=""
        role="presentation"
        onLoad={() => markLoaded(loadKeys[0])}
        onError={() => markFailed(loadKeys[0])}
      />
      {resolved.layers.map(({ id, url, element }, index) => {
        const x = ((element.page === "right" ? 0.5 : 0) + element.transform.x * 0.5) * 100;
        const style = {
          left: `${x}%`,
          top: `${element.transform.y * 100}%`,
          zIndex: Math.max(1, Math.round(element.depth * 100)),
          transform: `translate(-50%, -50%) rotate(${element.transform.rotationDeg}deg) scale(${element.transform.scaleX}, ${element.transform.scaleY})`,
        } satisfies CSSProperties;
        return (
          <img
            key={id}
            className="fallback-composite-layer"
            src={url}
            alt=""
            role="presentation"
            style={style}
            onLoad={() => markLoaded(loadKeys[index + 1])}
            onError={() => markFailed(loadKeys[index + 1])}
          />
        );
      })}
      <article className="fallback-composite-copy">
        {spread.kicker && <p>{spread.kicker}</p>}
        <h2>{spread.title}</h2>
        <p>{spread.body}</p>
      </article>
    </div>
  );
}

function createRequestId() {
  return crypto.randomUUID();
}

export function App() {
  const snapshot = useSyncExternalStore(bookEngine.subscribe, bookEngine.getSnapshot, bookEngine.getSnapshot);
  const [turn, setTurn] = useState<TurnState>(null);
  const [webMcpAvailable, setWebMcpAvailable] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [showLibrary, setShowLibrary] = useState(true);
  const [libraryMotion, setLibraryMotion] = useState<LibraryMotion>("idle");
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("yours");
  const [showCreateGuide, setShowCreateGuide] = useState(false);
  const [showElementAgentGuide, setShowElementAgentGuide] = useState(false);
  const [elementPromptCopied, setElementPromptCopied] = useState(false);
  const [elementPromptCopyError, setElementPromptCopyError] = useState(false);
  const [creationWorkshop, dispatchCreationWorkshop] = useReducer(reduceCreationWorkshop, INITIAL_CREATION_WORKSHOP);
  const [workshopHydrated, setWorkshopHydrated] = useState(false);
  const [workshopHydrationAttempt, setWorkshopHydrationAttempt] = useState(0);
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
  const creationSpreadCount = creationWorkshop.spreadCount;
  const creationStyle = creationWorkshop.visualDirection;
  const creationSource = creationWorkshop.mode;
  const creationPhotoUse = creationWorkshop.photoUse;
  const workshopAssets = creationWorkshop.assets;
  const pageTurnIndexRef = useRef(snapshot.session.currentSpreadIndex);
  const pageTurnCountRef = useRef(snapshot.document.spreads.length);
  const pageTurnDocumentRef = useRef(snapshot.document.id);
  const reducedMotionRef = useRef(reducedMotion);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const addPhotoButton = useRef<HTMLButtonElement | null>(null);
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
  pageTurnIndexRef.current = snapshot.session.currentSpreadIndex;
  pageTurnCountRef.current = snapshot.document.spreads.length;
  pageTurnDocumentRef.current = snapshot.document.id;
  reducedMotionRef.current = reducedMotion;

  const turnController = useMemo(() => createPageTurnSession({
    surface: "editor",
    now: () => performance.now(),
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    setTurn,
    commit: (direction) => bookEngine.setSpread(pageTurnIndexRef.current + (direction === "forward" ? 1 : -1)),
    navigationKey: () => `${pageTurnDocumentRef.current}:${pageTurnIndexRef.current}`,
    reducedMotion: () => reducedMotionRef.current,
    canTurn: (direction) => canTurnPage(direction, pageTurnIndexRef.current, pageTurnCountRef.current),
  }), []);

  useEffect(() => {
    turnController.activate();
    return () => turnController.dispose();
  }, [turnController]);

  const turnPage = turnController.turnPage;
  const onPageGesture = turnController.onPageGesture;
  const webGlAvailable = useMemo(supportsWebGl2, []);
  const renderWebGl = webGlAvailable && !sceneFailed;

  /**
   * 1 is a fully open book, 0 is the closed case facing the reader. The library
   * shows a closed book behind it; opening animates this to 1 while the shelf
   * fades, so the cover the reader clicked is the cover that swings.
   */
  const openProgress = useRef(forcedOpenProgress ?? (showLibrary ? 0 : 1));
  const openFrame = useRef<number | null>(null);
  const openCleanup = useRef<(() => void) | null>(null);
  const setOpenProgress = (value: number) => { openProgress.current = forcedOpenProgress ?? value; };

  const animateCase = useCallback((to: 0 | 1, done?: () => void) => {
    openCleanup.current?.();
    // A frozen case is a capture aid, not an animation: settle immediately so
    // the surrounding state machine still completes.
    if (reducedMotion || forcedOpenProgress !== null) {
      setOpenProgress(to);
      done?.();
      return;
    }
    // Close runs at 70% of open's duration with an accelerating curve: a board
    // being opened is a hand, a board falling shut is gravity.
    const duration = to === 1 ? 760 : 532;
    const started = performance.now();

    /**
     * Phased, not a single curve.
     *
     * A plain ease-out front-loads the motion, and the shelf fade sat on top of
     * exactly that part: by the time the shelf had cleared, the cover was
     * already 84% open, so the swing was over before anyone could see it. The
     * case now holds almost shut while the shelf clears, swings in full view,
     * and settles.
     *
     * Returns openness: 0 is a closed case facing the reader, 1 is open.
     */
    const openness = to === 1
      ? (t: number) => {
          if (t < 0.16) return 0.033 * (t / 0.16);
          if (t < 0.79) {
            const u = (t - 0.16) / 0.63;
            return 0.033 + (0.922 - 0.033) * (1 - Math.pow(1 - u, 2.2));
          }
          const u = (t - 0.79) / 0.21;
          return 0.922 + (1 - 0.922) * (1 - Math.pow(1 - u, 2));
        }
      // Closing is gravity, not a hand: it accelerates where opening decelerated.
      : (t: number) => {
          if (t < 0.12) return 1 - 0.056 * (t / 0.12);
          if (t < 0.865) {
            const u = (t - 0.12) / 0.745;
            return 0.944 - (0.944 - 0.044) * Math.pow(u, 1.9);
          }
          const u = (t - 0.865) / 0.135;
          return 0.044 * (1 - u);
        };

    /**
     * requestAnimationFrame stops on a hidden page, so a reader who switches
     * tabs mid-open would come back to a shelf that never went away and a book
     * that never opened. Settling on the way out is what a returning reader
     * expects to find anyway.
     */
    const stop = () => {
      if (openFrame.current !== null) cancelAnimationFrame(openFrame.current);
      openFrame.current = null;
      document.removeEventListener("visibilitychange", onHidden);
      openCleanup.current = null;
    };
    const settle = () => {
      stop();
      setOpenProgress(to);
      done?.();
    };
    function onHidden() {
      if (document.hidden) settle();
    }
    document.addEventListener("visibilitychange", onHidden);
    openCleanup.current = stop;

    const step = (now: number) => {
      const linear = Math.min(1, (now - started) / duration);
      setOpenProgress(openness(linear));
      if (linear < 1) {
        openFrame.current = requestAnimationFrame(step);
        return;
      }
      settle();
    };
    openFrame.current = requestAnimationFrame(step);
  }, [reducedMotion]);

  useEffect(() => () => openCleanup.current?.(), []);
  const library = useMemo(() => bookEngine.getLibrary(), [snapshot.document.id, snapshot.document.revision]);
  const activeLibraryBook = library.books.find((book) => book.id === library.activeBookId);
  const { personal: personalBooks, curated: curatedBooks, tabbed: libraryTabbed } = useMemo(
    () => partitionLibraryBooks(library.books),
    [library],
  );
  // With nothing personal yet there is no second section to offer, so Explore
  // is shown directly rather than parking the reader on an empty tab.
  const activeLibraryTab: LibraryTab = libraryTabbed ? libraryTab : "explore";
  const shelfBooks = activeLibraryTab === "yours" ? personalBooks : curatedBooks;
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
    if (!showCreateGuide || workshopHydrated) return undefined;
    let canceled = false;
    restoreCreationWorkshopAssets()
      .then((assets) => {
        if (canceled) return;
        dispatchCreationWorkshop({ type: "restore-assets", assets });
        setWorkshopHydrated(true);
      })
      .catch(() => {
        if (canceled) return;
        recordDiagnostic("workbench:asset-list-failed", {});
        setWorkshopImportError("Saved photos could not be restored. Try again before adding new images.");
      });
    return () => { canceled = true; };
  }, [showCreateGuide, workshopHydrated, workshopHydrationAttempt]);

  useEffect(() => {
    if (workshopHydrated) persistCreationWorkshopAssetOrder(workshopAssets);
  }, [workshopAssets, workshopHydrated]);

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    const requestedSeconds = Number(runtimeParams.get("motionAudit"));
    if (!Number.isFinite(requestedSeconds) || requestedSeconds < 0.5 || requestedSeconds > 30) return undefined;
    document.documentElement.style.setProperty("--motion-navigation", `${requestedSeconds}s`);
    return () => { document.documentElement.style.removeProperty("--motion-navigation"); };
  }, []);

  useEffect(() => {
    let canceled = false;
    // Only a successfully resolved dedicated cover earns an entry. A missing or
    // unresolvable cover keeps the bundled placeholder visible but must not
    // satisfy the deterministic cover-evidence blocker.
    Promise.all(library.books.map(async (book) => {
      if (!book.coverAssetId) return null;
      try {
        return [book.id, await resolveAssetUrl(book.coverAssetId)] as const;
      } catch {
        recordDiagnostic("asset:cover-resolve-failed", { bookId: book.id });
        return null;
      }
    })).then((entries) => {
      if (!canceled) {
        setResolvedCoverUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null)));
      }
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
  const pageTurnNav = pageTurnNavDisabled(
    turn,
    snapshot.session.currentSpreadIndex,
    snapshot.document.spreads.length,
  );
  const stageIsLoading = readyBookId !== snapshot.document.id || sceneLoadingBookId === snapshot.document.id;
  const libraryBusy = Boolean(openingBook || libraryMotion !== "idle");

  const isCreatorBook = Boolean(activeLibraryBook) && activeLibraryBook?.sample === false;
  const qualityGate = bookEngine.getQualityGate();

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

  const beginOpenTransition = useCallback((book: OpeningBook) => {
    if (reducedMotion) {
      recordDiagnostic("book:navigation-transition-reduced", { documentId: book.id, direction: "open" });
      openingBookRef.current = null;
      setOpeningBook(null);
      setOpenProgress(1);
      hideLibrary();
      return;
    }
    recordDiagnostic("book:cover-open-started", { documentId: book.id });
    openingBookRef.current = book;
    setOpeningBook(null);
    setLibraryMotion("opening-book");
    animateCase(1, () => {
      openingBookRef.current = null;
      hideLibrary();
      recordDiagnostic("book:cover-open-settled", { documentId: book.id });
    });
  }, [animateCase, hideLibrary, reducedMotion]);

  const openLibrary = useCallback(() => {
    if (showLibrary || openingBookRef.current) return;
    libraryOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLibraryMotion("closing-book");
    setShowLibrary(true);
    if (reducedMotion) {
      setLibraryMotion("idle");
      setOpenProgress(0);
      recordDiagnostic("book:navigation-transition-reduced", { documentId: snapshot.document.id, direction: "close" });
      return;
    }
    // The shelf is already mounted over the scene, so the case closes behind it
    // and the reader sees the cover come back rather than a card being redrawn.
    recordDiagnostic("book:cover-close-started", { documentId: snapshot.document.id });
    animateCase(0, () => {
      setLibraryMotion("idle");
      recordDiagnostic("book:cover-close-settled", { documentId: snapshot.document.id });
      window.setTimeout(() => librarySheet.current?.querySelector<HTMLElement>(".library-close")?.focus(), 0);
    });
  }, [animateCase, reducedMotion, showLibrary, snapshot.document.id]);

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

  const handleBookUnavailable = useCallback((documentId: string) => {
    setReadyBookId(documentId);
    setSceneLoadingBookId((current) => current === documentId ? null : current);
    recordDiagnostic("book:visual-review-unavailable", { documentId });
  }, []);

  /**
   * The cover swings only once the scene behind the shelf can actually draw
   * the book. Starting on the document switch instead meant the shelf faded
   * out onto an empty stage for the length of a WebGL cold start - the two
   * phases were strictly serial, which is what made click-to-readable take
   * roughly two and a half seconds. The shelf now holds its "Opening" state
   * during the warmup and the reader never sees the gap.
   */
  useEffect(() => {
    if (!openingBook || snapshot.document.id !== openingBook.id) return;
    if (readyBookId === openingBook.id) {
      beginOpenTransition(openingBook);
      return undefined;
    }
    /**
     * Readiness is a signal from the render loop, and the render loop stops on
     * a hidden page or a stalled GPU. Waiting for it unconditionally would trap
     * the reader on a shelf that says "Opening" forever, so the open proceeds
     * regardless after a bounded wait - the same failsafe the CSS transition
     * carried, kept for the same reason.
     */
    const failsafe = window.setTimeout(() => {
      recordDiagnostic("book:cover-open-unready", { documentId: openingBook.id });
      beginOpenTransition(openingBook);
    }, 2600);
    return () => window.clearTimeout(failsafe);
  }, [beginOpenTransition, openingBook, readyBookId, snapshot.document.id]);

  const closeCodexGuide = useCallback(() => {
    dismissImageHandoff();
    setShowCreateGuide(false);
    window.setTimeout(() => createGuideOpener.current?.focus(), 0);
  }, []);

  const openCodexGuide = useCallback(() => {
    createGuideOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCopied(false);
    setCopyError(false);
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
    setElementPromptCopyError(false);
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
    const didCopy = await copyPlainText(selectedElementPrompt);
    setElementPromptCopied(didCopy);
    setElementPromptCopyError(!didCopy);
    recordDiagnostic(didCopy ? "element-agent:starter-copied" : "element-agent:copy-blocked", { elementId: selected.id, spreadId: spread.id });
  }, [selected, selectedElementPrompt, spread.id]);

  const openBookFromLibrary = useCallback((bookId: string) => {
    if (openingBookRef.current) return;
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
  }, [advanceLoadStage, beginOpenTransition, library.books, prewarmReader, readyBookId, resolvedCoverUrls, snapshot.document.id]);

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
        if (openingBook || libraryMotion !== "idle") {
          openingBookRef.current = null;
          setOpeningBook(null);
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
  }, [closeCodexGuide, closeElementAgentGuide, hideLibrary, libraryMotion, openBookFromLibrary, openingBook, showCreateGuide, showElementAgentGuide, showLibrary, showOutline, showPublication, snapshot.document.id, snapshot.session.preview, turnPage]);

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
    if (!showLibrary || libraryMotion !== "idle") return;
    window.setTimeout(() => librarySheet.current?.querySelector<HTMLElement>(".library-close")?.focus(), 0);
  }, [libraryMotion, showLibrary]);

  // The shelf always opens on the reader's own books - including the first time
  // one exists - so a stale Explore selection never hides what they just made.
  useEffect(() => {
    if (showLibrary) setLibraryTab("yours");
  }, [showLibrary]);

  useFocusTrap(librarySheet, showLibrary);
  useFocusTrap(createGuideCard, showCreateGuide);
  useFocusTrap(elementAgentCard, showElementAgentGuide);

  useEffect(() => () => {
    if (openingFrame.current) cancelAnimationFrame(openingFrame.current);
    if (libraryFrame.current) cancelAnimationFrame(libraryFrame.current);
    releaseAssetUrls();
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

  /**
   * The Agent asks; the page answers. Before this the readiness contract told
   * the model to name a control the UI did not have, and the reader had to
   * translate a sentence into six clicks through a dialog headed "New book".
   */
  const [handoffRequest, setHandoffRequest] = useState<ImageHandoffRequest | null>(null);

  /**
   * Copy an image in the conversation, press paste on the page. The app had no
   * clipboard-in path whatsoever, so an image generated a moment earlier still
   * had to be saved to disk and picked back up through a file dialog.
   */
  // The importer closes over state that changes on every render, so the handler
  // is held in a ref. Without this the effect below needs no dependency array,
  // which detaches and reattaches a window listener on every single render.
  const pasteImporter = useRef<(files: FileList) => void>(() => undefined);
  pasteImporter.current = (files: FileList) => { void importWorkshopPhotos(files); };

  useEffect(() => {
    if (!showCreateGuide) return undefined;
    const onPaste = (event: ClipboardEvent) => {
      const files = event.clipboardData?.files;
      if (!files?.length) return;
      event.preventDefault();
      recordDiagnostic("handoff:pasted", { count: files.length });
      pasteImporter.current(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [showCreateGuide]);

  useEffect(() => subscribeToImageHandoff((request) => {
    setHandoffRequest(request);
    if (!request) return;
    recordDiagnostic("handoff:requested", { requestId: request.requestId, expectedCount: request.expectedCount });
    setShowCreateGuide(true);
    // Photos live behind a mode the reader has to pick first, which makes no
    // sense when the Agent has just asked for one.
    dispatchCreationWorkshop({ type: "set-mode", mode: "both" });
    // The picker itself still needs a real user gesture - the browser requires
    // one and the host cannot automate uploads - so the page gets as far as it
    // is allowed to and leaves exactly one click.
    window.setTimeout(() => addPhotoButton.current?.focus(), 60);
  }), []);

  const importWorkshopPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!workshopHydrated) {
      setWorkshopImportError("Wait for saved photos to finish restoring before adding new images.");
      return;
    }
    const room = MAX_WORKSHOP_ASSETS - workshopAssets.length;
    if (room <= 0) {
      setWorkshopImportError(`This brief already holds ${MAX_WORKSHOP_ASSETS} photos. Remove one to add another.`);
      return;
    }
    setAssetImporting(true);
    setWorkshopImportError(null);
    try {
      const batch = await importCreationWorkshopAssets(files, room);
      // Files keep their picked order, and each import appends to the end of the strip.
      for (const asset of batch.stored) {
        recordDiagnostic("workbench:asset-handed-off", { assetId: asset.id, originalSize: asset.originalSize ?? asset.size, size: asset.size, optimized: asset.optimized ?? false });
      }
      if (batch.imported.length > 0) {
        dispatchCreationWorkshop({ type: "append-assets", assets: batch.imported });
        // The pending tool call resolves with real ids, so the Agent resumes
        // immediately instead of waiting to be told the upload finished.
        if (handoffRequest) {
          completeImageHandoff(batch.imported.map((asset) => asset.id));
          recordDiagnostic("handoff:provided", { requestId: handoffRequest.requestId, count: batch.imported.length });
        }
      } else if (batch.failed > 0) {
        setWorkshopImportError("This browser could not store those images. Free some space, then try again.");
      } else {
        setWorkshopImportError("That file was not a usable image. Choose PNG, JPEG, or WebP under 12 MB.");
      }
    } finally {
      setAssetImporting(false);
    }
  };

  const moveWorkshopAsset = (index: number, direction: -1 | 1) => {
    dispatchCreationWorkshop({ type: "move-asset", index, direction });
  };

  const removeWorkshopAsset = (assetId: string) => {
    // This is a brief-level edit only. The blob stays in IndexedDB so existing
    // books and WebMCP asset lookups keep working.
    dispatchCreationWorkshop({ type: "remove-asset", assetId });
    recordDiagnostic("workbench:asset-removed-from-brief", { assetId });
    window.setTimeout(() => addPhotoButton.current?.focus(), 0);
  };

  const usesPhotos = creationSource !== "idea";
  const creationBrief = useMemo(() => buildCreationWorkshopBrief(creationWorkshop), [creationWorkshop]);
  const briefAssets = creationBrief.sourceAssets;
  const createPrompt = creationBrief.prompt;

  const copyPrompt = async () => {
    const didCopy = await copyPlainText(createPrompt);
    setCopied(didCopy);
    setCopyError(!didCopy);
    recordDiagnostic(didCopy ? "workbench:starter-copied" : "workbench:copy-blocked", { spreads: creationSpreadCount, style: creationStyle, source: creationSource, assets: briefAssets.length });
    if (didCopy) window.setTimeout(() => setCopied(false), 1800);
  };

  const confirmReset = () => {
    if (window.confirm("Restore the original Apertale sample book? Your local edits will be replaced.")) bookEngine.reset();
  };

  const selectLibraryTab = (tab: LibraryTab, tablist: HTMLElement | null) => {
    setLibraryTab(tab);
    tablist?.querySelector<HTMLElement>(`#library-tab-${tab}`)?.focus();
  };

  const onLibraryTabsKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const next: LibraryTab | null =
      event.key === "ArrowLeft" || event.key === "Home" ? "yours"
      : event.key === "ArrowRight" || event.key === "End" ? "explore"
      : null;
    if (!next) return;
    event.preventDefault();
    selectLibraryTab(next, event.currentTarget);
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
    <main className={`app-shell ${snapshot.session.preview ? "is-preview" : ""} ${showCreateGuide ? "is-creation-active" : ""} ${showElementAgentGuide ? "is-agent-handoff-active" : ""}`}>
      <header className="topbar" hidden={showLibrary || showCreateGuide} aria-hidden={showElementAgentGuide || undefined}>
        {!snapshot.session.preview && <button className="library-button" onClick={openLibrary} aria-label="Open book library"><Books size={18} /> <span>Books</span></button>}
        <button className="wordmark" onClick={() => { bookEngine.setPreview(false); openLibrary(); }} aria-label="Open book library">Apertale</button>
        <div className="topbar-actions">
          <ThemeSwitch theme={snapshot.session.sceneThemeId} onChange={setTheme} groupLabel="Scene theme" />
          <button className="preview-button" onClick={() => bookEngine.setPreview(!snapshot.session.preview)} aria-label={snapshot.session.preview ? "Exit preview" : "Preview book"}>
            {snapshot.session.preview ? <EyeSlash size={18} /> : <Eye size={18} />}
            <span>{snapshot.session.preview ? "Exit preview" : "Preview"}</span>
          </button>
        </div>
      </header>

      {showLibrary && !snapshot.session.preview && !showCreateGuide && (
        <section
          className={`book-library ${libraryMotion !== "idle" ? `is-${libraryMotion}` : ""}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="library-title"
          aria-hidden={showCreateGuide || undefined}
          aria-busy={libraryBusy}
        >
          <div className="library-atmosphere" />
          <div className="library-sheet" ref={librarySheet}>
            <header className="library-topbar">
              <button className="library-wordmark" onClick={() => openBookFromLibrary("apertale-field-guide")} disabled={libraryBusy}><BookOpenText size={19} /> Apertale</button>
              <div className="library-topbar-actions">
                <ThemeSwitch theme={snapshot.session.sceneThemeId} onChange={setTheme} groupLabel="Library theme" disabled={libraryBusy} />
                <button className="library-close" autoFocus onClick={() => openBookFromLibrary(snapshot.document.id)} aria-label="Return to open book" disabled={libraryBusy}><X size={20} /></button>
              </div>
            </header>
            <div className="library-intro">
              <p>Your living library</p>
              <h1 id="library-title">Open a world.<br />Then make one yours.</h1>
              <span>Browse anywhere. Create in Codex (ChatGPT desktop) with your own plan.</span>
              <div className="library-actions">
                <button className="create-codex-button" onClick={openCodexGuide} disabled={libraryBusy}><Sparkle size={18} weight="fill" /> Create your own</button>
                <button className="guide-book-button" onClick={() => openBookFromLibrary("apertale-field-guide")} onPointerEnter={() => prewarmReader("apertale-field-guide")} onFocus={() => prewarmReader("apertale-field-guide")} disabled={libraryBusy}><BookOpenText size={18} /> Read the Guide Book</button>
              </div>
            </div>
            {libraryTabbed && (
              <div className="library-tabs" role="tablist" aria-label="Library sections" onKeyDown={onLibraryTabsKeyDown}>
                <button
                  type="button"
                  id="library-tab-yours"
                  role="tab"
                  className={activeLibraryTab === "yours" ? "is-active" : ""}
                  aria-selected={activeLibraryTab === "yours"}
                  aria-controls="library-shelf"
                  tabIndex={activeLibraryTab === "yours" ? 0 : -1}
                  onClick={(event) => selectLibraryTab("yours", event.currentTarget.parentElement)}
                  disabled={libraryBusy}
                >
                  Your books <span className="library-tab-count" aria-hidden="true">{personalBooks.length}</span>
                </button>
                <button
                  type="button"
                  id="library-tab-explore"
                  role="tab"
                  className={activeLibraryTab === "explore" ? "is-active" : ""}
                  aria-selected={activeLibraryTab === "explore"}
                  aria-controls="library-shelf"
                  tabIndex={activeLibraryTab === "explore" ? 0 : -1}
                  onClick={(event) => selectLibraryTab("explore", event.currentTarget.parentElement)}
                  disabled={libraryBusy}
                >
                  Explore <span className="library-tab-count" aria-hidden="true">{curatedBooks.length}</span>
                </button>
              </div>
            )}
            <div
              id="library-shelf"
              className="library-shelf"
              role={libraryTabbed ? "tabpanel" : "group"}
              aria-labelledby={libraryTabbed ? `library-tab-${activeLibraryTab}` : undefined}
              aria-label={libraryTabbed ? undefined : "Books in this library"}
              tabIndex={0}
            >
              <div className="library-gallery">
                {shelfBooks.map((book, index) => (
                  <button
                    key={book.id}
                    data-book-id={book.id}
                    className={`library-card library-card-${(index % 5) + 1} ${book.id === library.activeBookId ? "is-active" : ""} ${openingBook?.id === book.id ? "is-opening" : ""}`}
                    onClick={() => openBookFromLibrary(book.id)}
                    onPointerEnter={() => prewarmReader(book.id)}
                    onFocus={() => prewarmReader(book.id)}
                    aria-busy={openingBook?.id === book.id}
                    disabled={libraryBusy}
                  >
                    <span className="library-cover-frame">
                      <img
                        src={resolvedCoverUrls[book.id] ?? book.coverTextureUrl}
                        alt={`${book.title} cover`}
                        loading={index < 4 ? "eager" : "lazy"}
                        decoding="async"
                        fetchPriority={index === 0 ? "high" : "auto"}
                        onLoad={() => {
                          if (dedicatedCoverRendered(book, resolvedCoverUrls[book.id])) {
                            bookEngine.recordRenderEvidence({
                              documentId: book.id,
                              revision: book.revision,
                              scope: "cover",
                              theme: snapshot.session.sceneThemeId,
                              surface: "shelf",
                              locator: `[data-book-id="${book.id}"] .library-cover-frame img`,
                            });
                          }
                        }}
                      />
                      {openingBook?.id === book.id && <span className="library-opening-badge" aria-hidden="true"><SpinnerGap size={15} weight="bold" /> Opening</span>}
                    </span>
                    <span className="library-card-copy">
                      {/* The shelf tab already says whether these are curated
                          samples or the reader's own books, so repeating it on
                          every card spent the label's width on nothing. Only
                          the Field Guide earns a prefix, because "start here"
                          is a call to action rather than a category. */}
                      <small>{book.id === "apertale-field-guide" ? "Start here · " : ""}{book.spreadCount} {book.spreadCount === 1 ? "spread" : "spreads"}</small>
                      <strong>{book.title}</strong>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <p className="demo-disclosure">Curated samples use OpenAI-generated illustration. Create your own in Codex.</p>
            {openingBook && <BookLoadingFeedback title={openingBook.title} placement="library" stage={loadStage} reducedMotion={reducedMotion} />}
          </div>
        </section>
      )}


      <section
        className={`stage ${showCreateGuide ? "is-creation-workshop" : ""}`}
        /**
         * Hidden only while the shelf is SETTLED over it. `hidden` applies
         * display:none, so keying this on showLibrary alone meant both the
         * cover open and the cover close ran to completion inside a display:none
         * subtree - the shelf then vanished onto an already-open book, and
         * reappeared over an already-shut one. Neither animation was ever on
         * screen. While a transition is running the stage must be visible;
         * that is the entire point of the transition.
         */
        hidden={showLibrary && libraryMotion === "idle" && !showCreateGuide}
        aria-hidden={(showLibrary && libraryMotion === "idle" && !showCreateGuide) || undefined}
        aria-busy={!showCreateGuide && stageIsLoading}
        aria-label={showCreateGuide ? "Blank three-dimensional book workshop" : `${spread.title}. Spread ${snapshot.session.currentSpreadIndex + 1} of ${snapshot.document.spreads.length}`}
      >
        {renderWebGl ? (
          <Suspense fallback={showCreateGuide
            ? <div className="fallback-book workshop-blank-fallback is-loading" />
            : <div className="fallback-book is-loading"><img src={spread.textureUrl} alt="" /></div>}>
            <ThreeBook
              snapshot={showCreateGuide ? workshopSnapshot : snapshot}
              turn={showCreateGuide ? null : turn}
              mode={showCreateGuide ? "workshop" : "reader"}
              openProgress={openProgress}
              onSelect={showCreateGuide ? () => undefined : (elementId) => { bookEngine.setSelection(elementId); setShowMore(false); }}
              onHover={showCreateGuide ? () => undefined : setHoveredId}
              onMoveElement={showCreateGuide ? () => undefined : (elementId, x, y) => humanEdit(elementId, { x, y })}
              onPageGesture={showCreateGuide ? () => undefined : onPageGesture}
              onLoading={showCreateGuide ? () => undefined : handleBookLoading}
              onReady={showCreateGuide ? () => undefined : handleBookReady}
              onRendered={showCreateGuide ? undefined : (evidence) => {
                bookEngine.recordRenderEvidence({
                  documentId: evidence.documentId,
                  revision: evidence.revision,
                  scope: "spread",
                  spreadId: evidence.spreadId,
                  theme: evidence.theme,
                  surface: evidence.surface,
                  locator: evidence.locator,
                });
              }}
              onFailure={() => setSceneFailed(true)}
            />
          </Suspense>
        ) : showCreateGuide ? (
          <div className="fallback-book workshop-blank-fallback" aria-label="Blank two-dimensional book workshop" />
        ) : (
          <FallbackBook
            snapshot={snapshot}
            spread={spread}
            onReady={handleBookReady}
            onUnavailable={handleBookUnavailable}
            onRendered={(evidence) => {
              bookEngine.recordRenderEvidence({
                documentId: evidence.documentId,
                revision: evidence.revision,
                scope: "spread",
                spreadId: evidence.spreadId,
                theme: evidence.theme,
                surface: evidence.surface,
                locator: evidence.locator,
              });
            }}
          />
        )}

        {stageIsLoading && !showLibrary && !showCreateGuide && <BookLoadingFeedback title={openingBook?.title ?? snapshot.document.title} placement="stage" stage={loadStage} reducedMotion={reducedMotion} />}

        {!snapshot.session.preview && !showCreateGuide && (
          <>
            <button className="page-arrow page-arrow-left" onClick={() => turnPage("backward")} disabled={pageTurnNav.previous} aria-label="Previous spread"><ArrowLeft size={22} /></button>
            <button className="page-arrow page-arrow-right" onClick={() => turnPage("forward")} disabled={pageTurnNav.next} aria-label="Next spread"><ArrowRight size={22} /></button>
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
              <button onClick={() => turnPage("backward")} disabled={pageTurnNav.previous} aria-label="Previous spread"><ArrowLeft size={24} /></button>
              <span className="reader-sheet-progress"><strong>{snapshot.session.currentSpreadIndex + 1}</strong> / {snapshot.document.spreads.length}</span>
              <button onClick={() => turnPage("forward")} disabled={pageTurnNav.next} aria-label="Next spread"><ArrowRight size={24} /></button>
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
            <AnimatePresence>
            {showMore && (
              <Panel key="element-panel" from="scale" className={`element-panel ${selected.page === "right" ? "clears-right" : "clears-left"}`}>
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
              </Panel>
            )}
            </AnimatePresence>
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

        {/* Status used to appear and vanish on a class toggle, so a reader who
            looked away never learned that anything had happened. Presence
            animation is the whole point of routing it through Toast. */}
        <Toast
          open={Boolean(snapshot.lastAction) && !showCreateGuide}
          className={`agent-action agent-action-${snapshot.lastAction?.phase ?? "success"}`}
        >
          {snapshot.lastAction?.phase === "success" ? <Check size={16} weight="bold" /> : <Sparkle size={16} />}
          <span>{snapshot.lastAction?.summary}</span>
          {snapshot.lastAction?.undoToken && <button onClick={undoLastAction}>Undo</button>}
        </Toast>
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
            <span>Create your own</span>
          </button>
          <div className="page-progress"><strong>{snapshot.session.currentSpreadIndex + 1}</strong><span>/</span>{snapshot.document.spreads.length}</div>
        </footer>
      )}

      <AnimatePresence>
      {showOutline && !snapshot.session.preview && !showCreateGuide && (
        <Panel key="story-outline" from="left" className="story-outline" aria-label="Book outline" role="complementary">
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
        </Panel>
      )}
      </AnimatePresence>

      {showCreateGuide && !snapshot.session.preview && (
        <section className="creation-workshop" role="dialog" aria-modal="true" aria-labelledby="codex-guide-title">
          <div className="workshop-atmosphere" aria-hidden="true" />
          <div className="workshop-ui" ref={createGuideCard}>
            <header className="workshop-topbar">
              <button className="workshop-wordmark" onClick={closeCodexGuide}><BookOpenText size={19} /> Apertale</button>
              <button className="workshop-close" autoFocus onClick={closeCodexGuide} aria-label="Close creation workshop"><X size={20} /></button>
            </header>

            <div className="workshop-sheet">
              <div className="workshop-sheet-scroll">
                <div className="workshop-headline">
                  <p>New book</p>
                  <h2 id="codex-guide-title">Make one yours.</h2>
                </div>

                <p className={`workshop-signal ${webMcpAvailable ? "is-connected" : ""}`}>
                  <i aria-hidden="true" />
                  <span>{webMcpAvailable ? "Ready beside Codex" : "Read here. Open in Codex (ChatGPT desktop) to create."}</span>
                </p>

                <div className="workshop-readiness is-incomplete" role="status">
                  <WarningCircle size={16} weight="fill" />
                  <div>
                    <strong>Finish the brief in Codex</strong>
                    <span>{creationBrief.readiness.questions.slice(0, 3).join(" ")}</span>
                  </div>
                </div>

                <fieldset className="workshop-field">
                  <legend>Start from</legend>
                  <div className="workshop-segment">
                    {CREATION_SOURCES.map((source) => (
                      <button
                        type="button"
                        key={source.id}
                        className={`workshop-option ${creationSource === source.id ? "is-selected" : ""}`}
                        onClick={() => dispatchCreationWorkshop({ type: "set-mode", mode: source.id })}
                        aria-pressed={creationSource === source.id}
                      >{source.label}</button>
                    ))}
                  </div>
                </fieldset>

                {usesPhotos && (
                  <fieldset className="workshop-field">
                    <legend>Photo use</legend>
                    <div className="workshop-segment workshop-photo-use">
                      {CREATION_PHOTO_USES.map((choice) => (
                        <button
                          type="button"
                          key={choice.id}
                          className={`workshop-option ${creationPhotoUse === choice.id ? "is-selected" : ""}`}
                          onClick={() => dispatchCreationWorkshop({ type: "set-photo-use", photoUse: choice.id })}
                          aria-pressed={creationPhotoUse === choice.id}
                        >{choice.label}</button>
                      ))}
                    </div>
                  </fieldset>
                )}

                <fieldset className="workshop-field">
                  <legend>Spreads</legend>
                  <div className="workshop-lengths">
                    {CREATION_LENGTHS.map((count) => (
                      <button
                        type="button"
                        key={count}
                        className={`workshop-option ${creationSpreadCount === count ? "is-selected" : ""}`}
                        onClick={() => dispatchCreationWorkshop({ type: "set-spread-count", spreadCount: count })}
                        aria-pressed={creationSpreadCount === count}
                        aria-label={`${count} spreads`}
                      >{count}</button>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="workshop-field">
                  <legend>Style</legend>
                  <div className="workshop-chips">
                    {CREATION_STYLES.map((style) => (
                      <button
                        type="button"
                        key={style}
                        className={`workshop-option ${creationStyle === style ? "is-selected" : ""}`}
                        onClick={() => dispatchCreationWorkshop({ type: "set-visual-direction", visualDirection: style })}
                        aria-pressed={creationStyle === style}
                      >{style}</button>
                    ))}
                  </div>
                </fieldset>

                {usesPhotos && (
                  <section className="workshop-photos" aria-label="Source images, in book order">
                    {/* The Agent's own sentence, printed where the reader acts
                        on it. A request that only exists in the chat pane is
                        what made this step feel disconnected. */}
                    <Toast open={Boolean(handoffRequest)} className="workshop-handoff-request">
                      <Sparkle size={16} weight="fill" />
                      <span>{handoffRequest?.reason}</span>
                    </Toast>
                    <div className="workshop-photos-head">
                      <span>Photos<small>{workshopAssets.length}/{MAX_WORKSHOP_ASSETS}</small></span>
                      <button
                        type="button"
                        ref={addPhotoButton}
                        className="workshop-add-photo"
                        onClick={() => fileInput.current?.click()}
                        disabled={!workshopHydrated || assetImporting || workshopAssets.length >= MAX_WORKSHOP_ASSETS}
                      >
                        {!workshopHydrated || assetImporting ? <SpinnerGap size={15} className="is-spinning" /> : <Plus size={15} weight="bold" />}
                        <span>{!workshopHydrated ? "Restoring" : assetImporting ? "Adding" : "Add"}</span>
                      </button>
                    </div>

                    {workshopAssets.length === 0 ? (
                      <button type="button" className="workshop-photo-empty" onClick={() => fileInput.current?.click()} disabled={!workshopHydrated || assetImporting}>
                        <ImageSquare size={22} />
                        <span>Add photos in the order they should appear</span>
                      </button>
                    ) : (
                      <ol className="workshop-photo-strip">
                        {workshopAssets.map((asset, index) => (
                          <li key={asset.id} className="workshop-photo">
                            <figure>
                              {asset.url
                                ? <img src={asset.url} alt="" decoding="async" loading="lazy" />
                                : <span className="workshop-photo-missing" aria-hidden="true"><ImageSquare size={20} /></span>}
                              <figcaption>
                                <span className="workshop-photo-index">{index + 1}</span>
                                <span className="workshop-photo-name">{asset.name}</span>
                              </figcaption>
                            </figure>
                            <div className="workshop-photo-actions">
                              <button type="button" onClick={() => moveWorkshopAsset(index, -1)} disabled={index === 0} aria-label={`Move ${asset.name} earlier`}><ArrowLeft size={15} weight="bold" /></button>
                              <button type="button" onClick={() => moveWorkshopAsset(index, 1)} disabled={index === workshopAssets.length - 1} aria-label={`Move ${asset.name} later`}><ArrowRight size={15} weight="bold" /></button>
                              <button type="button" onClick={() => removeWorkshopAsset(asset.id)} aria-label={`Remove ${asset.name} from this brief`}><X size={15} weight="bold" /></button>
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}

                    <input ref={fileInput} hidden type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={!workshopHydrated || assetImporting} onChange={(event) => { void importWorkshopPhotos(event.currentTarget.files); event.currentTarget.value = ""; }} />

                    {workshopImportError && (
                      <p className="workshop-import-error" role="alert">
                        <WarningCircle size={14} weight="fill" />
                        <span>{workshopImportError}</span>
                        <button type="button" onClick={() => {
                          setWorkshopImportError(null);
                          if (workshopHydrated) fileInput.current?.click();
                          else setWorkshopHydrationAttempt((attempt) => attempt + 1);
                        }}>{workshopHydrated ? "Try another image" : "Try restoring again"}</button>
                      </p>
                    )}
                  </section>
                )}
              </div>

              <div className="workshop-actionbar">
                <p className="workshop-summary">
                  {creationSpreadCount} spreads · {creationStyle}{briefAssets.length > 0 ? ` · ${briefAssets.length} photo${briefAssets.length === 1 ? "" : "s"}` : ""}
                </p>
                <button className="copy-starter-button" onClick={() => void copyPrompt()}>
                  {copied ? <Check size={18} weight="bold" /> : <Copy size={18} weight="bold" />}
                  {copied ? "Copied — paste beside this page" : "Copy questions for Codex"}
                </button>
                {copyError && (
                  <div className="copy-fallback" role="alert">
                    <span>Copy was blocked. Select the brief below.</span>
                    <textarea readOnly value={createPrompt} onFocus={(event) => event.currentTarget.select()} aria-label="Creation brief to copy manually" />
                  </div>
                )}
              </div>
            </div>
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
              {elementPromptCopyError && (
                <div className="copy-fallback" role="alert">
                  <span>Copy was blocked. Select the request below.</span>
                  <textarea readOnly value={selectedElementPrompt} onFocus={(event) => event.currentTarget.select()} aria-label="Element request to copy manually" />
                </div>
              )}
            </footer>
          </div>
        </section>
      )}

      {showPublication && isCreatorBook && !snapshot.session.preview && (
        <PublicationPanel
          document={snapshot.document}
          record={publicationRecord}
          qualityGate={qualityGate}
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
