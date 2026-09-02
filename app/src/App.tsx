import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
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
  Trash,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { bookEngine, humanAnimate, humanEdit, humanInteract } from "./bookEngine";
import { deleteBookEverywhere } from "./bookLifecycle";
import { acquireAssetPreviewUrl, acquireAssetUrl, releaseAssetUrls, storeLocalImages, type AssetUrlLease } from "./assetStore";
import {
  CREATION_INTERACTION_DENSITIES,
  INITIAL_CREATION_WORKSHOP,
  MAX_WORKSHOP_ASSETS,
  admitWorkshopAssets,
  buildCreationWorkshopBrief,
  importCreationWorkshopAssets,
  workshopUsesPhotos,
  persistCreationWorkshopAssetOrder,
  reduceCreationWorkshop,
  restoreCreationWorkshopAssets,
} from "./creationWorkshop";
import { AnimatePresence, MotionConfig } from "motion/react";
import { smootherstep } from "./design/curves";
import { durationMs } from "./design/tokens";
import { announce, supportsWebGl2, useReaderShell } from "./readerShell";
import { spreadFraction } from "./stageGeometry";
import { Panel, Toast, WorkspaceTransition } from "./design/primitives";
import {
  INITIAL_CREATION_NAVIGATION,
  reduceCreationNavigation,
  workspaceMotionOrigin,
  type WorkspaceMotionOrigin,
} from "./design/creationNavigation";
import { ThemeSwitch } from "./design/ThemeSwitch";
import { FallbackBook } from "./FallbackBook";
import { PortraitOrientationGate } from "./PortraitOrientationGate";
import { completeImageHandoff, currentImageHandoff, describePartialImageHandoff, dismissImageHandoff, subscribeToImageHandoff, type ImageHandoffRequest } from "./imageHandoff";
import { recordDiagnostic } from "./diagnostics";
import {
  dedicatedCoverRendered,
  readerRenderMatches,
  readerSceneStructureKey,
  resolvedCoverAsset,
  shelfCoverMatches,
  shelfCoverTarget,
  type ReaderRenderEvidence,
  type ResolvedCoverAsset,
  type ShelfCoverEvidence,
} from "./renderEvidence";
import {
  FOCUS_LABELS,
  FOCUS_RESPONSES,
  HOVER_LABELS,
  HOVER_RESPONSES,
  hasReveal,
  resolveInteraction,
} from "./interaction";
import { PublicationPanel, commitPublicationRecordIfCurrent, publicationLauncherPresentation, publicationRecordForDocument } from "./PublicationPanel";
import { deletePublication, getPublicationRecord } from "./publishingClient";
import type { PublicationRecord } from "./publishingClient";
import { MAX_BOOK_PUBLISHABLE_ASSETS } from "./authoringContract";
import { type BookSnapshot, type FocusResponse, type HoverResponse, type MotionPreset, type ThemeId } from "./types";
import { authoringSurfaceReady, type AuthoringSurfaceRequest } from "./authoringSurface";
import { MAX_ANNOTATIONS_PER_SPREAD, addStoryboardAnnotation, clearStoryboardAnnotations, describeAnnotation, getStoryboardSnapshot, subscribeToStoryboard, undoStoryboardAnnotation } from "./storyboard";
import { registerWebMcpTools, type ToolActivity } from "./webmcp";
import { StoryPencilControls, WorkshopPickers } from "./workshopControls";
import { ElementAgentCard } from "./ElementAgentCard";

const runtimeParams = new URLSearchParams(window.location.search);
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const forceReducedMotion = runtimeParams.get("reducedMotion") === "1";
const forceFallback = runtimeParams.get("fallback") === "1";
let threeBookRendererPromise: Promise<typeof import("./ThreeBook")> | null = null;

/** Shares one retryable renderer import across React.lazy, idle warmup, and reader intent. */
export function warmThreeBookRenderer() {
  if (!threeBookRendererPromise) {
    threeBookRendererPromise = import("./ThreeBook").catch((error) => {
      threeBookRendererPromise = null;
      throw error;
    });
  }
  return threeBookRendererPromise;
}

const ThreeBook = lazy(() => warmThreeBookRenderer().then((module) => ({ default: module.ThreeBook })));

type OpeningBook = {
  id: string;
  title: string;
};

type LibraryMotion = "idle" | "opening-book" | "closing-book";
type LibraryTab = "yours" | "explore";
type PendingDestructiveAction =
  | { kind: "delete-book"; book: { id: string; title: string }; hasPublication: boolean; busy: boolean; error: string | null }
  | { kind: "reset-sample"; busy: boolean; error: string | null };

function measureWorkspaceMotionOrigin(element: HTMLElement | null): WorkspaceMotionOrigin {
  return workspaceMotionOrigin(element?.getBoundingClientRect() ?? null, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
}

export function readerSceneShouldMount(state: {
  showLibrary: boolean;
  showCreateGuide: boolean;
  openingBookMatchesDocument: boolean;
  readerReady: boolean;
  libraryMotion: LibraryMotion;
}) {
  return state.readerReady
    || state.showCreateGuide
    || !state.showLibrary
    || state.openingBookMatchesDocument
    || state.libraryMotion !== "idle";
}

type PendingAuthoringSurface = {
  request: AuthoringSurfaceRequest;
  signal: AbortSignal;
  settling: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

type ActiveAuthoringSurfaceRequest = AuthoringSurfaceRequest & {
  renderEvidenceToken: string;
};

// The in-app Browser may throttle a background WebGL tab to only a few rAFs
// per second. This remains a bounded failure, but leaves enough time for the
// eight stable frames required by the renderer instead of racing them.
const AUTHORING_SURFACE_TIMEOUT_MS = 10_000;

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

export function shelfCoverAssetPlan<Book extends { id: string; coverAssetId?: string }>(
  shelfVisible: boolean,
  books: readonly Book[],
) {
  return new Map(shelfVisible
    ? books.flatMap((book) => (book.coverAssetId ? [[book.id, book.coverAssetId] as const] : []))
    : []);
}

async function copyPlainText(text: string): Promise<boolean> {
  // On failure the callers reveal a visible select-and-copy textarea instead.
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
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
      {placement === "stage" && <div className="fallback-book book-loading-skeleton is-loading" aria-hidden="true" />}
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


export function App() {
  const snapshot = useSyncExternalStore(bookEngine.subscribe, bookEngine.getSnapshot, bookEngine.getSnapshot);
  const pageTurnNavigationKey = `${snapshot.document.id}:${snapshot.document.revision}:${snapshot.session.currentSpreadIndex}`;
  const [webMcpAvailable, setWebMcpAvailable] = useState(false);
  const [codexFoundPage, setCodexFoundPage] = useState(false);
  const [agentActivity, setAgentActivity] = useState<ToolActivity | null>(null);
  const agentActivityTimeout = useRef(0);
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [showLibrary, setShowLibrary] = useState(true);
  const [libraryMotion, setLibraryMotion] = useState<LibraryMotion>("idle");
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("yours");
  const [deletingBookId, setDeletingBookId] = useState<string | null>(null);
  const [pendingDestructiveAction, setPendingDestructiveAction] = useState<PendingDestructiveAction | null>(null);
  const [creationNavigation, dispatchCreationNavigation] = useReducer(
    reduceCreationNavigation,
    INITIAL_CREATION_NAVIGATION,
  );
  const creationNavigationRef = useRef(creationNavigation);
  creationNavigationRef.current = creationNavigation;
  const showCreateGuide = creationNavigation.workspaceOpen;
  const creationTransitionBusy = creationNavigation.phase !== "idle";
  const [creationTransitionOrigins, setCreationTransitionOrigins] = useState(() => {
    const fallback = measureWorkspaceMotionOrigin(null);
    return { source: fallback, action: fallback };
  });
  const [showElementAgentGuide, setShowElementAgentGuide] = useState(false);
  const [elementPromptCopied, setElementPromptCopied] = useState(false);
  const [elementPromptCopyError, setElementPromptCopyError] = useState(false);
  const [creationWorkshop, dispatchCreationWorkshop] = useReducer(reduceCreationWorkshop, INITIAL_CREATION_WORKSHOP);
  const storyboard = useSyncExternalStore(subscribeToStoryboard, getStoryboardSnapshot, getStoryboardSnapshot);
  const [workshopSpreadIndex, setWorkshopSpreadIndex] = useState(0);
  const [storyPencilActive, setStoryPencilActive] = useState(false);
  const [storyboardNotice, setStoryboardNotice] = useState<string | null>(null);
  // What Codex will read from the stroke just drawn, shown for a moment so the
  // reader sees the interpretation, not only the red line.
  const [lastMark, setLastMark] = useState<string | null>(null);
  const lastMarkTimeout = useRef(0);
  const previousStoryboard = useRef(storyboard);
  const storyboardNoticeTimeout = useRef(0);
  const [workshopHydrated, setWorkshopHydrated] = useState(false);
  const [workshopHydrationAttempt, setWorkshopHydrationAttempt] = useState(0);
  const [assetImporting, setAssetImporting] = useState(false);
  const [openingBook, setOpeningBook] = useState<OpeningBook | null>(null);
  const [readyBookId, setReadyBookId] = useState<string | null>(null);
  const [sceneLoadingBookId, setSceneLoadingBookId] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => forceReducedMotion || motionPreference.matches);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [resolvedCoverUrls, setResolvedCoverUrls] = useState<Record<string, ResolvedCoverAsset>>({});
  const [loadStage, setLoadStage] = useState<LoadStage>("warming");
  const [workshopImportError, setWorkshopImportError] = useState<string | null>(null);
  const [showPublication, setShowPublication] = useState(false);
  const [publicationRecord, setPublicationRecord] = useState<PublicationRecord | null>(null);
  const [authoringSurfaceRequest, setAuthoringSurfaceRequest] = useState<ActiveAuthoringSurfaceRequest | null>(null);
  const [lastReaderRender, setLastReaderRender] = useState<ReaderRenderEvidence | null>(null);
  const [renderedShelfCovers, setRenderedShelfCovers] = useState<Record<string, ShelfCoverEvidence>>({});
  const creationSpreadCount = creationWorkshop.spreadCount;
  const creationStyle = creationWorkshop.visualDirection;
  const creationInteractionDensity = creationWorkshop.interactionDensity;
  const creationSource = creationWorkshop.mode;
  const workshopAssets = creationWorkshop.assets;
  const activeWorkshopSpreadIndex = Math.min(workshopSpreadIndex, creationSpreadCount - 1);
  const currentStoryboardSpread = storyboard.spreads.find((item) => item.index === activeWorkshopSpreadIndex);
  const storyboardVisible = storyboard.spreads.some((item) => item.marks.length > 0);
  const reducedMotionRef = useRef(reducedMotion);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const addPhotoButton = useRef<HTMLButtonElement | null>(null);
  const stage = useRef<HTMLElement | null>(null);
  const librarySheet = useRef<HTMLDialogElement | null>(null);
  const libraryOpener = useRef<HTMLElement | null>(null);
  const createGuideCard = useRef<HTMLDialogElement | null>(null);
  const createGuideOpener = useRef<HTMLElement | null>(null);
  const elementAgentCard = useRef<HTMLDialogElement | null>(null);
  const elementAgentOpener = useRef<HTMLElement | null>(null);
  const publicationOpener = useRef<HTMLElement | null>(null);
  const destructiveActionDialog = useRef<HTMLDialogElement | null>(null);
  const destructiveActionOpener = useRef<HTMLElement | null>(null);
  const activeDocumentIdRef = useRef(snapshot.document.id);
  activeDocumentIdRef.current = snapshot.document.id;
  const pendingAuthoringSurface = useRef<PendingAuthoringSurface | null>(null);
  const lastPrewarm = useRef<{ key: string; entry: { renderer: Promise<unknown>; media: Promise<unknown> } } | null>(null);
  const coverAssetLeases = useRef(new Map<string, { assetId: string; lease: AssetUrlLease }>());
  const workshopAssetLeases = useRef(new Map<string, AssetUrlLease>());
  const workshopAssetsRef = useRef(workshopAssets);
  const workshopImportInFlight = useRef(false);
  const loadToken = useRef(0);
  const openingBookRef = useRef<OpeningBook | null>(null);
  const openingFrame = useRef<number | null>(null);
  const libraryFrame = useRef<number | null>(null);
  reducedMotionRef.current = reducedMotion;

  useLayoutEffect(() => {
    workshopAssetsRef.current = workshopAssets;
  }, [workshopAssets]);

  useEffect(() => {
    setWorkshopSpreadIndex((current) => Math.min(current, creationSpreadCount - 1));
  }, [creationSpreadCount]);

  useEffect(() => {
    if (!showCreateGuide) setStoryPencilActive(false);
  }, [showCreateGuide]);

  const showStoryboardNotice = useCallback((notice: string) => {
    setStoryboardNotice(notice);
    window.clearTimeout(storyboardNoticeTimeout.current);
    storyboardNoticeTimeout.current = window.setTimeout(() => setStoryboardNotice(null), 4200);
  }, []);

  // The reader's marks vanish when Codex applies them. Say so, or the reader
  // cannot tell an applied correction from a mis-tap on Undo.
  useEffect(() => {
    const previous = previousStoryboard.current;
    previousStoryboard.current = storyboard;
    if (storyboard.revision <= previous.revision) return;
    const applied = storyboard.spreads.filter((spread) => {
      const before = previous.spreads.find((item) => item.index === spread.index);
      return before && before.annotations.length > 0 && spread.annotations.length === 0 && spread.sketchRevision > before.sketchRevision;
    });
    const sketched = storyboard.spreads.filter((spread) => spread.sketchRevision === storyboard.revision);
    const notice = applied.length === 1
      ? `Codex applied your marks on spread ${applied[0].index + 1}`
      : applied.length > 1
        ? `Codex applied your marks on ${applied.length} spreads`
        : sketched.length === 1 && previous.spreads.some((spread) => spread.index === sketched[0].index)
          ? `Codex revised spread ${sketched[0].index + 1}`
          : sketched.length > 0
            ? `Codex sketched ${sketched.length} spread${sketched.length === 1 ? "" : "s"}`
            : null;
    if (!notice) return;
    showStoryboardNotice(notice);
  }, [storyboard, showStoryboardNotice]);

  // The agent-action toast is hidden inside the workshop, so "Codex read your
  // marks" would vanish exactly where it matters; route it to the pencil notice.
  useEffect(() => {
    const action = snapshot.lastAction;
    if (!showCreateGuide || action?.source !== "agent" || action.phase !== "success") return;
    showStoryboardNotice(action.summary);
  }, [showCreateGuide, showStoryboardNotice, snapshot.lastAction]);

  const workshopSnapshot = useMemo<BookSnapshot>(() => ({
    document: {
      id: "apertale-new-book-workshop",
      revision: 1,
      title: "Untitled Apertale",
      spreads: Array.from({ length: creationSpreadCount }, (_, index) => ({
        id: `blank-workshop-spread-${index + 1}`,
        order: index,
        title: "",
        body: "",
        elements: [],
      })),
    },
    session: {
      currentSpreadIndex: activeWorkshopSpreadIndex,
      selectionId: null,
      sceneThemeId: snapshot.session.sceneThemeId,
      preview: true,
      quality: snapshot.session.quality,
    },
    lastAction: null,
  }), [activeWorkshopSpreadIndex, creationSpreadCount, snapshot.session.quality, snapshot.session.sceneThemeId]);
  const webGlAvailable = useMemo(() => supportsWebGl2(forceFallback), []);
  const readerSceneKey = readerSceneStructureKey(snapshot, "reader");
  const activeSceneKey = showCreateGuide ? readerSceneStructureKey(workshopSnapshot, "workshop") : readerSceneKey;
  const shouldMountReaderScene = readerSceneShouldMount({
    showLibrary,
    showCreateGuide,
    openingBookMatchesDocument: openingBook?.id === snapshot.document.id,
    readerReady: readyBookId === snapshot.document.id,
    libraryMotion,
  });
  const reader = useReaderShell({
    navigationKey: pageTurnNavigationKey,
    spreadIndex: snapshot.session.currentSpreadIndex,
    spreadCount: snapshot.document.spreads.length,
    sceneKey: activeSceneKey,
    webGlAvailable,
    rendererMounted: shouldMountReaderScene,
    reducedMotion,
    commit: (index) => bookEngine.setSpread(index),
  });
  const { turn, setTurn, turnPage, onPageGesture, renderWebGl } = reader;

  /**
   * 1 is a fully open book, 0 is the closed case facing the reader. The library
   * shows a closed book behind it; opening animates this to 1 while the shelf
   * fades, so the cover the reader clicked is the cover that swings.
   */
  const openProgress = useRef(showLibrary ? 0 : 1);
  const openFrame = useRef<number | null>(null);
  const openCleanup = useRef<(() => void) | null>(null);
  const setOpenProgress = (value: number) => { openProgress.current = value; };

  const animateCase = useCallback((to: 0 | 1, done?: () => void) => {
    openCleanup.current?.();
    if (reducedMotion) {
      setOpenProgress(to);
      done?.();
      return;
    }
    // A whole book changing place needs more readable time than one page
    // turning. The shelf and case still share this one clock in both
    // directions, but no longer borrow the shorter page-navigation token.
    const duration = durationMs.book;

    /*
     * One curve, end to end. This was three self-terminating power segments
     * glued together, and the joins WERE the jank: measured, velocity stepped
     * 15x at t=0.16, the cover came to a literal dead stop and restarted at
     * t=0.79, and the close landed with speed still in it.
     *
     * The hold that used to be segment one existed because the shelf fade was
     * covering the swing - but that was the wrong curve to deform. The shelf
     * clears on its own compressed sub-timeline instead, which is how the
     * reference implementations solve the same problem.
     */
    /**
     * The clock starts on the first frame, not at the click. A measured ~217ms
     * of main-thread stall follows the click while the scene settles, and
     * starting the clock before it meant the gesture was already a fifth over
     * before anything could be drawn.
     */
    let started: number | null = null;

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
      started ??= now;
      const linear = Math.min(1, (now - started) / duration);
      const eased = smootherstep(linear);
      setOpenProgress(to === 1 ? eased : 1 - eased);
      if (linear < 1) {
        openFrame.current = requestAnimationFrame(step);
        return;
      }
      settle();
    };
    openFrame.current = requestAnimationFrame(step);
  }, [reducedMotion]);

  useEffect(() => () => openCleanup.current?.(), []);
  const library = bookEngine.getLibrary();
  const activeLibraryBook = library.books.find((book) => book.id === library.activeBookId);
  const { personal: personalBooks, curated: curatedBooks, tabbed: libraryTabbed } = partitionLibraryBooks(library.books);
  // With nothing personal yet there is no second section to offer, so Explore
  // is shown directly rather than parking the reader on an empty tab.
  const activeLibraryTab: LibraryTab = libraryTabbed ? libraryTab : "explore";
  const shelfBooks = activeLibraryTab === "yours" ? personalBooks : curatedBooks;
  useEffect(() => {
    if (!showCreateGuide || workshopHydrated) return undefined;
    let canceled = false;
    restoreCreationWorkshopAssets()
      .then(({ assets, leases }) => {
        if (canceled) {
          leases.forEach((lease) => lease.release());
          return;
        }
        leases.forEach((lease) => {
          const previous = workshopAssetLeases.current.get(lease.assetId);
          if (previous) lease.release();
          else workshopAssetLeases.current.set(lease.assetId, lease);
        });
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
    let canceled = false;
    const plannedAssets = shelfCoverAssetPlan(
      showLibrary && !snapshot.session.preview && !showCreateGuide,
      shelfBooks,
    );
    coverAssetLeases.current.forEach((retained, bookId) => {
      if (plannedAssets.get(bookId) === retained.assetId) return;
      retained.lease.release();
      coverAssetLeases.current.delete(bookId);
    });
    // Remove stale bindings synchronously. A slow replacement cover must never
    // let the previous asset satisfy presentation or render evidence.
    setResolvedCoverUrls((current) => {
      const retained = Object.fromEntries(Object.entries(current).filter(
        ([bookId, resolved]) => plannedAssets.get(bookId) === resolved.assetId,
      ));
      return Object.keys(retained).length === Object.keys(current).length ? current : retained;
    });
    for (const [bookId, assetId] of plannedAssets) {
      const retained = coverAssetLeases.current.get(bookId);
      if (retained?.assetId === assetId) continue;
      void acquireAssetPreviewUrl(assetId).then((lease) => {
        if (canceled) {
          lease.release();
          return;
        }
        const previous = coverAssetLeases.current.get(bookId);
        if (previous?.assetId === assetId) {
          lease.release();
          return;
        }
        previous?.lease.release();
        coverAssetLeases.current.set(bookId, { assetId, lease });
        setResolvedCoverUrls((current) => {
          const previous = current[bookId];
          if (previous?.assetId === assetId && previous.url === lease.url) return current;
          return { ...current, [bookId]: { assetId, url: lease.url } };
        });
      }).catch(() => {
        if (!canceled) recordDiagnostic("asset:cover-resolve-failed", { bookId });
      });
    }
    return () => { canceled = true; };
  }, [shelfBooks, showCreateGuide, showLibrary, snapshot.session.preview]);

  const spread = snapshot.document.spreads[snapshot.session.currentSpreadIndex];
  const selected = snapshot.session.selectionId
    ? spread.elements.find((element) => element.id === snapshot.session.selectionId) ?? null
    : null;
  const selectedInteraction = selected ? resolveInteraction(selected) : null;
  const hovered = hoveredId ? spread.elements.find((element) => element.id === hoveredId) ?? null : null;

  /**
   * Anchor the selection ring when there is no renderer to anchor it.
   *
   * The WebGL scene projects the focused element every frame into
   * --selection-x/y. On the flat fallback nobody writes them, so a selection
   * made from the element rail left the ring parked at its CSS default,
   * circling whatever happened to sit near the middle of the stage.
   *
   * The composited fallback places its own layers at a percentage of the
   * book's padding box, so reusing that arithmetic puts the ring exactly on
   * the layer it belongs to rather than approximately near it.
   */
  useLayoutEffect(() => {
    const host = stage.current;
    // Left untouched while the renderer owns these properties: it writes them
    // every frame, and clearing them here would blank the ring for one frame
    // on every selection change.
    if (!host || renderWebGl || !selected) return undefined;
    const place = () => {
      const book = host.querySelector<HTMLElement>(".fallback-book.is-composited");
      if (!book) return;
      const hostBox = host.getBoundingClientRect();
      const bookBox = book.getBoundingClientRect();
      // clientLeft/clientTop are the border widths, and the layers are
      // positioned against the padding box the border encloses.
      const left = bookBox.left - hostBox.left + book.clientLeft;
      const top = bookBox.top - hostBox.top + book.clientTop;
      host.style.setProperty("--selection-x", `${left + spreadFraction(selected) * book.clientWidth}px`);
      host.style.setProperty("--selection-y", `${top + selected.transform.y * book.clientHeight}px`);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(host);
    return () => {
      observer.disconnect();
      host.style.removeProperty("--selection-x");
      host.style.removeProperty("--selection-y");
    };
  }, [renderWebGl, selected]);
  const isNight = snapshot.session.sceneThemeId === "midnight-desk";
  const pageTurnNav = reader.navDisabled;
  const stageIsLoading = readyBookId !== snapshot.document.id || sceneLoadingBookId === snapshot.document.id;
  const libraryBusy = Boolean(openingBook || deletingBookId || pendingDestructiveAction || libraryMotion !== "idle");

  const isCreatorBook = Boolean(activeLibraryBook) && activeLibraryBook?.sample === false;
  const visiblePublicationRecord = publicationRecordForDocument(snapshot.document.id, publicationRecord);
  const publicationLauncher = publicationLauncherPresentation(
    visiblePublicationRecord,
    snapshot.document.revision,
  );

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
    setShowPublication(false);
    if (!isCreatorBook) {
      setPublicationRecord(null);
      return;
    }
    setPublicationRecord(getPublicationRecord(snapshot.document.id));
  }, [isCreatorBook, snapshot.document.id]);

  const handlePublicationRecordChange = useCallback((expectedDocumentId: string, next: PublicationRecord | null) => (
    commitPublicationRecordIfCurrent(
      activeDocumentIdRef.current,
      expectedDocumentId,
      next,
      setPublicationRecord,
    )
  ), []);

  /**
   * Prewarm exactly what the next screen needs, and only after a reader shows
   * intent (hover, focus, or the click that starts the cover transition). The
   * idle shelf warmup may already have cached the renderer code, but spreads,
   * cutouts, and their Blob URLs stay behind this explicit reader intent.
   */
  const prewarmReader = useCallback((bookId: string) => {
    const info = bookEngine.getPrewarmMedia(bookId);
    const prewarmKey = `${bookId}:${info?.spreadId ?? ""}:${info?.mediaRef ?? ""}`;
    if (lastPrewarm.current?.key === prewarmKey) return lastPrewarm.current.entry;
    const renderer: Promise<unknown> = warmThreeBookRenderer()
      .catch(() => recordDiagnostic("book:prewarm-renderer-failed", { documentId: bookId }));
    const media: Promise<unknown> = info?.mediaRef
      ? acquireAssetUrl(info.mediaRef)
        .then(async (lease) => {
          try {
            const image = new Image();
            image.decoding = "async";
            image.src = lease.url;
            await image.decode();
          } finally {
            lease.release();
          }
        })
        .then(() => recordDiagnostic("book:prewarmed", { documentId: bookId, spreadId: info.spreadId }))
        .catch(() => recordDiagnostic("book:prewarm-media-failed", { documentId: bookId }))
      : Promise.resolve();
    const entry = { renderer, media };
    // Dynamic imports are cached by the module loader. Keeping only the latest
    // media intent bounds our own cache while a changed spread/asset identity
    // naturally produces a fresh decode.
    lastPrewarm.current = { key: prewarmKey, entry };
    return entry;
  }, []);

  useEffect(() => {
    if (!showLibrary || libraryMotion !== "idle" || showCreateGuide || snapshot.session.preview) return undefined;
    const timer = window.setTimeout(() => {
      void warmThreeBookRenderer()
        .then(() => recordDiagnostic("book:renderer-idle-prewarmed", {}))
        .catch(() => recordDiagnostic("book:prewarm-renderer-failed", {}));
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [libraryMotion, showCreateGuide, showLibrary, snapshot.session.preview]);

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

  const cancelLibraryTransition = useCallback(() => {
    if (openingFrame.current !== null) {
      cancelAnimationFrame(openingFrame.current);
      openingFrame.current = null;
    }
    if (libraryFrame.current !== null) {
      cancelAnimationFrame(libraryFrame.current);
      libraryFrame.current = null;
    }
    openCleanup.current?.();
  }, []);

  const settleLibraryToReader = useCallback(() => {
    // Escape is an explicit settle, not merely a visibility toggle. Cancel a
    // close that has not reached animateCase yet as well as a case animation
    // already in flight, then restore the fully-open reader pose.
    cancelLibraryTransition();
    setOpenProgress(1);
    openingBookRef.current = null;
    setOpeningBook(null);
    hideLibrary();
  }, [cancelLibraryTransition, hideLibrary]);

  const settleLibraryToShelf = useCallback(() => {
    // Site Tools may interrupt either direction of the case animation. Cancel
    // every pending clock before acknowledging the shelf, otherwise a stale
    // open callback can hide it after the tool has already reported success.
    cancelLibraryTransition();
    openingBookRef.current = null;
    setOpeningBook(null);
    setOpenProgress(0);
    setLibraryMotion("idle");
    setShowLibrary(true);
  }, [cancelLibraryTransition]);

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

  /**
   * Where the book sits on the shelf, in stage-relative CSS pixels.
   *
   * The renderer unprojects this so the case can start the open from the exact
   * slot the reader clicked and land back in it on the way home. Without it the
   * book opens in the middle of the screen with no relationship to the shelf,
   * which reads as a cut rather than as picking a book up.
   */
  const handoffRect = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  const measureShelfCard = useCallback((bookId: string) => {
    const card = librarySheet.current?.querySelector(`[data-book-id="${bookId}"] .library-cover-frame`);
    if (!card) return null;
    const c = card.getBoundingClientRect();
    if (c.width < 2 || c.height < 2) return null;
    // Viewport coordinates, not stage-relative: the stage is display:none at
    // the moment the reader clicks, so its own rect is all zeros and any
    // subtraction here would silently be against nothing. The renderer
    // converts against the canvas it is actually drawing into.
    return { x: c.left, y: c.top, width: c.width, height: c.height };
  }, []);

  useEffect(() => {
    if (libraryMotion === "idle") return undefined;
    const remeasure = () => { handoffRect.current = measureShelfCard(snapshot.document.id); };
    window.addEventListener("resize", remeasure);
    return () => window.removeEventListener("resize", remeasure);
  }, [libraryMotion, measureShelfCard, snapshot.document.id]);

  const openLibrary = useCallback(() => {
    if (showLibrary || openingBookRef.current) return;
    libraryOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Return to the section that owns this book so the measured destination
    // exists when the case travels back into its slot.
    setLibraryTab(activeLibraryBook?.sample === true ? "explore" : "yours");
    setLibraryMotion("closing-book");
    setShowLibrary(true);
    if (reducedMotion) {
      setLibraryMotion("idle");
      setOpenProgress(0);
      recordDiagnostic("book:navigation-transition-reduced", { documentId: snapshot.document.id, direction: "close" });
      return;
    }
    // The destination slot does not exist until the shelf has laid out, so the
    // close waits two frames for a real rect before it starts travelling. A
    // book that shuts in mid-air and then cuts to the shelf is the thing this
    // is here to avoid.
    libraryFrame.current = window.requestAnimationFrame(() => {
      libraryFrame.current = window.requestAnimationFrame(() => {
        libraryFrame.current = null;
        handoffRect.current = measureShelfCard(snapshot.document.id);
        recordDiagnostic("book:cover-close-started", {
          documentId: snapshot.document.id,
          anchored: Boolean(handoffRect.current),
        });
        animateCase(0, () => {
          setLibraryMotion("idle");
          recordDiagnostic("book:cover-close-settled", { documentId: snapshot.document.id });
          window.setTimeout(() => librarySheet.current?.querySelector<HTMLElement>(".library-close")?.focus(), 0);
        });
      });
    });
  }, [activeLibraryBook?.sample, animateCase, measureShelfCard, reducedMotion, showLibrary, snapshot.document.id]);

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

  const restoreCreateGuideFocus = useCallback(() => {
    window.setTimeout(() => {
      const previousOpener = createGuideOpener.current;
      const liveOpener = previousOpener?.isConnected
        ? previousOpener
        : document.querySelector<HTMLElement>("[data-creation-opener]");
      liveOpener?.focus();
    }, 0);
  }, []);

  const closeCodexGuide = useCallback(() => {
    const request = currentImageHandoff();
    if (request) dismissImageHandoff(request.requestId);
    setPartialImageHandoff(null);
    if (creationNavigationRef.current.phase !== "idle") return;
    if (reducedMotionRef.current) {
      dispatchCreationNavigation({ type: "hide-immediately" });
      restoreCreateGuideFocus();
      return;
    }
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCreationTransitionOrigins((current) => ({ ...current, action: measureWorkspaceMotionOrigin(active) }));
    dispatchCreationNavigation({ type: "request-close" });
  }, [restoreCreateGuideFocus]);

  const beginOpenCodexGuide = useCallback((opener: HTMLElement | null) => {
    const current = creationNavigationRef.current;
    if (current.phase !== "idle" || current.workspaceOpen) return;
    createGuideOpener.current = opener;
    setCopiedPrompt(null);
    setCopyError(false);
    if (reducedMotionRef.current) {
      dispatchCreationNavigation({ type: "show-immediately" });
      return;
    }
    const source = measureWorkspaceMotionOrigin(opener);
    setCreationTransitionOrigins({ source, action: source });
    dispatchCreationNavigation({ type: "request-open" });
  }, []);

  const openCodexGuide = useCallback(() => {
    beginOpenCodexGuide(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  }, [beginOpenCodexGuide]);

  const handleCreationTransitionComplete = useCallback(() => {
    const returnsToSource = creationNavigation.phase === "revealing-source";
    dispatchCreationNavigation({ type: "animation-complete" });
    if (returnsToSource) restoreCreateGuideFocus();
  }, [creationNavigation.phase, restoreCreateGuideFocus]);

  const cancelCreationTransitionToSource = useCallback(() => {
    dispatchCreationNavigation({ type: "hide-immediately" });
    restoreCreateGuideFocus();
  }, [restoreCreateGuideFocus]);

  const closePublication = useCallback((expectedDocumentId?: string) => {
    if (expectedDocumentId && activeDocumentIdRef.current !== expectedDocumentId) return;
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
    handoffRect.current = measureShelfCard(bookId);
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
      void bookEngine.openBookCoordinated(bookId).then((result) => {
        if (!result.ok) {
          openingBookRef.current = null;
          setOpeningBook(null);
          return;
        }
        setTurn(null);
        setHoveredId(null);
        setShowMore(false);
        setShowOutline(false);
      });
    });
  }, [advanceLoadStage, beginOpenTransition, library.books, prewarmReader, readyBookId, snapshot.document.id]);

  const presentAuthoringSurface = useCallback((request: AuthoringSurfaceRequest, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    const current = bookEngine.getSnapshot();
    if (request.documentId !== current.document.id || request.revision !== current.document.revision) {
      reject(new Error("The requested authoring surface no longer matches the active book revision."));
      return;
    }
    if (signal.aborted) {
      reject(new DOMException("Authoring surface request was cancelled.", "AbortError"));
      return;
    }
    const previous = pendingAuthoringSurface.current;
    if (previous) {
      previous.cleanup();
      previous.reject(new DOMException("Superseded by a newer authoring surface request.", "AbortError"));
    }
    let timeout = 0;
    const finishWithError = (error: Error) => {
      if (pendingAuthoringSurface.current?.request.requestId !== request.requestId) return;
      pendingAuthoringSurface.current.cleanup();
      pendingAuthoringSurface.current = null;
      setAuthoringSurfaceRequest(null);
      reject(error);
    };
    const onAbort = () => finishWithError(new DOMException("Authoring surface request was cancelled.", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    pendingAuthoringSurface.current = {
      request,
      signal,
      settling: false,
      resolve,
      reject,
      cleanup: () => {
        signal.removeEventListener("abort", onAbort);
        window.clearTimeout(timeout);
      },
    };
    timeout = window.setTimeout(() => finishWithError(new Error("The requested authoring surface did not become visible.")), AUTHORING_SURFACE_TIMEOUT_MS);
    setAuthoringSurfaceRequest({ ...request, renderEvidenceToken: crypto.randomUUID() });
    dispatchCreationNavigation({ type: "hide-immediately" });
    setShowElementAgentGuide(false);
    setShowPublication(false);
    setTurn(null);
    setHoveredId(null);
    setShowMore(false);
    setShowOutline(false);
    if (request.surface === "shelf") {
      const activeBook = bookEngine.getLibrary().books.find((book) => book.id === request.documentId);
      setLibraryTab(activeBook?.sample ? "explore" : "yours");
      settleLibraryToShelf();
      return;
    }
    settleLibraryToReader();
  }), [settleLibraryToReader, settleLibraryToShelf]);

  useLayoutEffect(() => {
    if (
      authoringSurfaceRequest?.surface !== "shelf"
      || showCreateGuide
      || !showLibrary
      || libraryMotion !== "idle"
    ) return;
    const targetCard = Array.from(librarySheet.current?.querySelectorAll<HTMLElement>("[data-book-id]") ?? [])
      .find((card) => card.dataset.bookId === authoringSurfaceRequest.documentId);
    targetCard?.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });
  }, [activeLibraryTab, authoringSurfaceRequest, libraryMotion, showCreateGuide, showLibrary]);

  useEffect(() => {
    if (!authoringSurfaceRequest) return undefined;
    const activeSpreadId = snapshot.document.spreads[snapshot.session.currentSpreadIndex]?.id ?? "";
    const visibleShelfIds = shelfBooks.map((book) => book.id);
    const requestedSpreadId = authoringSurfaceRequest.spreadId ?? activeSpreadId;
    const requestedShelfBook = shelfBooks.find((book) => book.id === authoringSurfaceRequest.documentId);
    const requestedCover = requestedShelfBook
      ? shelfCoverTarget(requestedShelfBook, resolvedCoverUrls)
      : undefined;
    const viewportBounds = { top: 0, right: window.innerWidth, bottom: window.innerHeight, left: 0 };
    const contentRendered = authoringSurfaceRequest.surface === "reader"
      ? readerRenderMatches(lastReaderRender, {
        sceneKey: readerSceneKey,
        renderEvidenceToken: authoringSurfaceRequest.renderEvidenceToken,
        documentId: authoringSurfaceRequest.documentId,
        revision: authoringSurfaceRequest.revision,
        spreadId: requestedSpreadId,
        theme: authoringSurfaceRequest.theme,
        surface: renderWebGl ? "webgl" : "fallback",
      })
      : shelfCoverMatches(
        renderedShelfCovers[authoringSurfaceRequest.documentId],
        requestedCover,
        viewportBounds,
      );
    const ready = authoringSurfaceReady(authoringSurfaceRequest, {
      documentId: snapshot.document.id,
      revision: snapshot.document.revision,
      spreadId: activeSpreadId,
      theme: snapshot.session.sceneThemeId,
      preview: snapshot.session.preview,
      workshopOpen: showCreateGuide,
      libraryOpen: showLibrary,
      libraryMotion,
      transitionPending: openingFrame.current !== null || libraryFrame.current !== null || openCleanup.current !== null,
      blockingOverlayOpen: showElementAgentGuide || showPublication || showOutline || Boolean(openingBook) || Boolean(pendingDestructiveAction),
      contentRendered,
      shelfBookIds: visibleShelfIds,
    });
    if (!ready) return undefined;
    const pending = pendingAuthoringSurface.current;
    if (pending?.request.requestId !== authoringSurfaceRequest.requestId) return undefined;
    if (pending.settling) return undefined;
    pending.settling = true;
    const libraryBook = library.books.find((book) => book.id === authoringSurfaceRequest.documentId);
    const recordVisibleEvidence = async () => {
      if (!libraryBook || libraryBook.sample) return;
      const input = authoringSurfaceRequest.surface === "reader"
        ? lastReaderRender && {
          documentId: lastReaderRender.documentId,
          revision: lastReaderRender.revision,
          spreadId: lastReaderRender.spreadId,
          theme: lastReaderRender.theme,
          surface: lastReaderRender.surface,
          locator: lastReaderRender.locator,
          scope: "spread" as const,
        }
        : requestedShelfBook
          && requestedCover
          && dedicatedCoverRendered(requestedShelfBook, resolvedCoverAsset(requestedShelfBook, resolvedCoverUrls))
          ? {
              documentId: requestedCover.documentId,
              revision: requestedCover.revision,
              theme: authoringSurfaceRequest.theme,
              surface: "shelf" as const,
              locator: `[data-book-id="${requestedCover.documentId}"] .library-cover-frame img`,
              scope: "cover" as const,
            }
          : null;
      if (!input || !await bookEngine.recordRenderEvidenceCoordinated(input, pending.signal)) {
        throw new Error("The visible authoring frame could not be recorded for quality review.");
      }
    };
    void recordVisibleEvidence().then(() => {
      if (pendingAuthoringSurface.current !== pending) return;
      pending.cleanup();
      pendingAuthoringSurface.current = null;
      setAuthoringSurfaceRequest(null);
      pending.resolve();
    }, (error: unknown) => {
      if (pendingAuthoringSurface.current !== pending) return;
      pending.cleanup();
      pendingAuthoringSurface.current = null;
      setAuthoringSurfaceRequest(null);
      pending.reject(error instanceof Error ? error : new Error("The visible authoring frame could not be recorded."));
    });
    return undefined;
  }, [authoringSurfaceRequest, lastReaderRender, library.books, libraryMotion, openingBook, pendingDestructiveAction, readerSceneKey, renderWebGl, renderedShelfCovers, resolvedCoverUrls, shelfBooks, showCreateGuide, showElementAgentGuide, showLibrary, showOutline, showPublication, snapshot.document.id, snapshot.document.revision, snapshot.document.spreads, snapshot.session.currentSpreadIndex, snapshot.session.preview, snapshot.session.sceneThemeId]);

  useEffect(() => () => {
    const pending = pendingAuthoringSurface.current;
    if (!pending) return;
    pending.cleanup();
    pending.reject(new DOMException("Authoring surface unmounted.", "AbortError"));
    pendingAuthoringSurface.current = null;
  }, []);

  useEffect(() => registerWebMcpTools(
    setWebMcpAvailable,
    presentAuthoringSurface,
    (activity) => {
      setCodexFoundPage(true);
      setAgentActivity(activity);
      window.clearTimeout(agentActivityTimeout.current);
      // A finished call lingers long enough to read, then clears itself.
      if (activity.phase !== "start") agentActivityTimeout.current = window.setTimeout(() => setAgentActivity(null), 2400);
    },
    () => beginOpenCodexGuide(null),
  ), [beginOpenCodexGuide, presentAuthoringSurface]);

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
    if (!renderWebGl) recordDiagnostic("fallback:activated", { forced: forceFallback, initializationFailed: reader.sceneFailed });
  }, [reader.sceneFailed, renderWebGl]);

  useEffect(() => {
    document.documentElement.dataset.theme = isNight ? "night" : "day";
  }, [isNight]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pendingDestructiveAction) {
        event.preventDefault();
        closeDestructiveAction();
        return;
      }
      if (creationTransitionBusy) {
        if (event.key === "Escape") {
          event.preventDefault();
          cancelCreationTransitionToSource();
        } else if (
          event.key === "Tab"
          || event.key === "Enter"
          || event.key === " "
          || event.key.startsWith("Arrow")
        ) {
          event.preventDefault();
        }
        return;
      }
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
        if (
          openingBookRef.current
          || libraryFrame.current !== null
          || openCleanup.current !== null
          || openingBook
          || libraryMotion !== "idle"
        ) {
          settleLibraryToReader();
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
  }, [cancelCreationTransitionToSource, closeCodexGuide, closeDestructiveAction, closeElementAgentGuide, creationTransitionBusy, libraryMotion, openBookFromLibrary, openingBook, pendingDestructiveAction, settleLibraryToReader, showCreateGuide, showElementAgentGuide, showLibrary, showOutline, showPublication, snapshot.document.id, snapshot.session.preview, turnPage]);

  useEffect(() => {
    if (!showLibrary || libraryMotion !== "idle") return;
    window.setTimeout(() => librarySheet.current?.querySelector<HTMLElement>(".library-close")?.focus(), 0);
  }, [libraryMotion, showLibrary]);

  useLayoutEffect(() => {
    if (!showLibrary) return;
    const sheet = librarySheet.current;
    if (!sheet) return;
    // The interactive shelf is modal. During the locked physical handoff it
    // briefly becomes modeless so the WebGL stage can paint above it without
    // replacing the shelf with an empty room.
    if (sheet.open) sheet.close();
    if (libraryMotion === "idle") sheet.showModal();
    else sheet.show();
    if (sheet.contains(document.activeElement)) return;
    sheet.querySelector<HTMLElement>("#library-shelf")?.focus();
  }, [libraryMotion, showCreateGuide, showLibrary]);

  useEffect(() => {
    const dialog = createGuideCard.current;
    if (!showCreateGuide || !dialog) return;
    if (dialog.open) dialog.close();
    if (storyPencilActive) dialog.show();
    else dialog.showModal();
  }, [showCreateGuide, storyPencilActive]);

  useEffect(() => {
    const dialog = elementAgentCard.current;
    if (showElementAgentGuide && dialog && !dialog.open) dialog.showModal();
  }, [showElementAgentGuide]);

  useEffect(() => {
    const dialog = destructiveActionDialog.current;
    if (pendingDestructiveAction && dialog && !dialog.open) dialog.showModal();
  }, [pendingDestructiveAction]);

  useEffect(() => () => {
    if (openingFrame.current) cancelAnimationFrame(openingFrame.current);
    if (libraryFrame.current) cancelAnimationFrame(libraryFrame.current);
    coverAssetLeases.current.forEach(({ lease }) => lease.release());
    coverAssetLeases.current.clear();
    workshopAssetLeases.current.forEach((lease) => lease.release());
    workshopAssetLeases.current.clear();
    releaseAssetUrls();
  }, []);

  const liftSelected = () => {
    if (!selected) return;
    void bookEngine.dispatchCoordinated({ type: "lift", requestId: crypto.randomUUID(), expectedDocumentId: snapshot.document.id, expectedRevision: snapshot.document.revision, elementId: selected.id }, "human");
  };

  const toggleLock = () => {
    if (!selected) return;
    void bookEngine.dispatchCoordinated({ type: "edit", requestId: crypto.randomUUID(), expectedDocumentId: snapshot.document.id, expectedRevision: snapshot.document.revision, elementId: selected.id, locked: !selected.locked }, "human");
  };

  const applyMotion = (preset: MotionPreset | "none") => {
    if (!selected) return;
    void humanAnimate(selected.id, preset === "none" ? null : { preset, durationMs: preset === "fly-across" ? 5200 : preset === "water-bob" ? 4200 : 3600, loop: true });
  };

  const setHoverResponse = (hover: HoverResponse) => {
    if (!selected) return;
    void humanInteract(selected.id, { hover });
  };

  const setFocusResponse = (focus: FocusResponse) => {
    if (!selected) return;
    void humanInteract(selected.id, { focus });
  };

  const adjustSelected = (kind: "scale" | "rotate", amount: number) => {
    if (!selected || selected.locked) return;
    if (kind === "scale") {
      const scale = Math.max(0.3, Math.min(1.8, selected.transform.scaleX + amount));
      void humanEdit(selected.id, { scaleX: scale, scaleY: scale });
    } else void humanEdit(selected.id, { rotationDeg: selected.transform.rotationDeg + amount });
  };

  const setTheme = (theme: ThemeId) => bookEngine.setTheme(theme, "human");

  /**
   * The Agent asks; the page answers. Before this the readiness contract told
   * the model to name a control the UI did not have, and the reader had to
   * translate a sentence into six clicks through a dialog headed "New book".
   */
  const [handoffRequest, setHandoffRequest] = useState<ImageHandoffRequest | null>(null);
  // A partial batch settles the tool call honestly, but the reader still needs
  // the same drawer and purpose while replacing rejected or failed files.
  const [partialImageHandoff, setPartialImageHandoff] = useState<ImageHandoffRequest | null>(null);

  /**
   * Copy an image in the conversation, press paste on the page. The app had no
   * clipboard-in path whatsoever, so an image generated a moment earlier still
   * had to be saved to disk and picked back up through a file dialog.
   */
  // The importer closes over state that changes on every render, so the handler
  // is held in a ref. A layout effect refreshes it after a render commits but
  // before the browser can dispatch a paste event; a passive effect leaves a
  // stale-callback window, while a render-time write can leak discarded state.
  const pasteImporter = useRef<(files: FileList) => void>(() => undefined);

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
    setPartialImageHandoff(null);
    recordDiagnostic("handoff:requested", { requestId: request.requestId });
    // A tool call must reveal the drawer it promises to open. Preview and the
    // other modal surfaces can otherwise keep it hidden, so exit or close them
    // before showing the reader the Agent's request.
    bookEngine.setPreview(false);
    setShowElementAgentGuide(false);
    setShowPublication(false);
    beginOpenCodexGuide(null);
    if (request.assetUse === "source-photo") {
      // Reader references belong to the next creation brief. Generated final
      // art is deliberately registry-only and must never change this mode.
      dispatchCreationWorkshop({ type: "set-mode", mode: "both" });
    }
    // The page cannot choose a local path itself. Focus the control so host
    // Computer Use or the reader can make the one file-picker choice.
    window.setTimeout(() => addPhotoButton.current?.focus(), 60);
  }), []);

  const importWorkshopPhotos = async (files: Iterable<File> | null) => {
    // FileList is live: clearing the picker empties it while an awaited import
    // is still iterating. Freeze the selection before the first async boundary.
    const selectedFiles = Array.from(files ?? []);
    if (selectedFiles.length === 0) return;
    if (workshopImportInFlight.current) {
      setWorkshopImportError("Wait for the current image import to finish before adding another batch.");
      return;
    }
    // Bind the eventual completion to the request visible when this import
    // began. A newer Agent request may supersede it while images are decoded.
    const handoffRequestId = handoffRequest?.requestId ?? null;
    const requestAtStart = handoffRequest ?? partialImageHandoff;
    const isBookArt = requestAtStart?.assetUse === "book-art";
    if (!isBookArt && !workshopHydrated) {
      setWorkshopImportError("Wait for saved photos to finish restoring before adding new images.");
      return;
    }
    const room = isBookArt ? MAX_BOOK_PUBLISHABLE_ASSETS : MAX_WORKSHOP_ASSETS - workshopAssetsRef.current.length;
    if (room <= 0) {
      setWorkshopImportError(isBookArt
        ? `A book may reference at most ${MAX_BOOK_PUBLISHABLE_ASSETS} uploaded images.`
        : `This brief already holds ${MAX_WORKSHOP_ASSETS} photos. Remove one to add another.`);
      return;
    }
    workshopImportInFlight.current = true;
    setAssetImporting(true);
    setWorkshopImportError(null);
    try {
      const photoBatch = isBookArt ? null : await importCreationWorkshopAssets(selectedFiles, room);
      const bookArtBatch = isBookArt ? await storeLocalImages(selectedFiles, { assetUse: "book-art", limit: room }) : null;
      const stored = photoBatch?.stored ?? bookArtBatch?.assets ?? [];
      let deliveredAssetIds = bookArtBatch?.assets.map((asset) => asset.id) ?? [];
      const failed = photoBatch?.failed ?? bookArtBatch?.failed ?? 0;
      let rejected = photoBatch?.rejected ?? bookArtBatch?.rejected ?? 0;
      if (photoBatch) {
        const admitted = admitWorkshopAssets(workshopAssetsRef.current, photoBatch.imported);
        const admittedIds = new Set(admitted.map((asset) => asset.id));
        rejected += photoBatch.imported.length - admitted.length;
        deliveredAssetIds = admitted.map((asset) => asset.id);
        photoBatch.leases.forEach((lease) => {
          if (!admittedIds.has(lease.assetId)) {
            lease.release();
            return;
          }
          const previous = workshopAssetLeases.current.get(lease.assetId);
          if (previous) lease.release();
          else workshopAssetLeases.current.set(lease.assetId, lease);
        });
        if (admitted.length > 0) {
          workshopAssetsRef.current = [...workshopAssetsRef.current, ...admitted];
          dispatchCreationWorkshop({ type: "append-assets", assets: admitted });
        }
      }
      const deliveredIds = new Set(deliveredAssetIds);
      // Files keep their picked order, and each import appends to the end of the strip.
      for (const asset of stored) {
        if (!deliveredIds.has(asset.id)) continue;
        recordDiagnostic("workbench:asset-handed-off", { assetId: asset.id, assetUse: requestAtStart?.assetUse ?? "source-photo", originalSize: asset.originalSize ?? asset.size, size: asset.size, optimized: asset.optimized ?? false });
      }
      if (deliveredAssetIds.length > 0) {
        // The drawer request already returned. Completing it now closes the UI
        // state while the Agent refreshes the asset registry for the real ids.
        const outcome = handoffRequestId
          ? completeImageHandoff(handoffRequestId, { assetIds: deliveredAssetIds, rejected, failed })
          : null;
        if (outcome) {
          recordDiagnostic(outcome.status === "partial" ? "handoff:partial" : "handoff:provided", {
            requestId: handoffRequestId,
            assetUse: requestAtStart?.assetUse ?? "source-photo",
            ...outcome.counts,
          });
          if (outcome.status === "partial") {
            setPartialImageHandoff(requestAtStart);
            setWorkshopImportError(outcome.reason);
          } else {
            setPartialImageHandoff(null);
            if (isBookArt) closeCodexGuide();
          }
        } else if (handoffRequestId === null && (rejected > 0 || failed > 0)) {
          setWorkshopImportError(describePartialImageHandoff({ accepted: deliveredAssetIds.length, rejected, failed }));
        }
      } else if (failed > 0) {
        setWorkshopImportError("This browser could not store those images. Free some space, then try again.");
      } else if (rejected > 0) {
        setWorkshopImportError("That file was not a usable image. Choose PNG, JPEG, or WebP under 12 MB.");
      } else {
        setWorkshopImportError("No image was added.");
      }
    } finally {
      workshopImportInFlight.current = false;
      setAssetImporting(false);
    }
  };
  useLayoutEffect(() => {
    pasteImporter.current = (files: FileList) => { void importWorkshopPhotos(files); };
  });

  const moveWorkshopAsset = (index: number, direction: -1 | 1) => {
    dispatchCreationWorkshop({ type: "move-asset", index, direction });
  };

  const removeWorkshopAsset = (assetId: string) => {
    // This is a brief-level edit only. The blob stays in IndexedDB so existing
    // books and WebMCP asset lookups keep working.
    workshopAssetLeases.current.get(assetId)?.release();
    workshopAssetLeases.current.delete(assetId);
    dispatchCreationWorkshop({ type: "remove-asset", assetId });
    recordDiagnostic("workbench:asset-removed-from-brief", { assetId });
    window.setTimeout(() => addPhotoButton.current?.focus(), 0);
  };

  const usesPhotos = workshopUsesPhotos(creationWorkshop);
  const displayedImageHandoff = handoffRequest ?? partialImageHandoff;
  const handoffIsBookArt = displayedImageHandoff?.assetUse === "book-art";
  const showImagePicker = usesPhotos || Boolean(displayedImageHandoff);
  const pickerReady = handoffIsBookArt || workshopHydrated;
  const pickerAtCapacity = !handoffIsBookArt && workshopAssets.length >= MAX_WORKSHOP_ASSETS;
  const creationBrief = useMemo(() => buildCreationWorkshopBrief(creationWorkshop), [creationWorkshop]);
  const creationInteractionChoice = CREATION_INTERACTION_DENSITIES.find((choice) => choice.id === creationInteractionDensity)!;
  const briefAssets = creationBrief.sourceAssets;
  const createPrompt = creationBrief.prompt;
  const copied = copiedPrompt === createPrompt;

  const copyPrompt = async () => {
    const didCopy = await copyPlainText(createPrompt);
    setCopiedPrompt(didCopy ? createPrompt : null);
    setCopyError(!didCopy);
    recordDiagnostic(didCopy ? "workbench:starter-copied" : "workbench:copy-blocked", { spreads: creationSpreadCount, style: creationStyle, interactionDensity: creationInteractionDensity, source: creationSource, assets: briefAssets.length });
  };

  function closeDestructiveAction() {
    if (pendingDestructiveAction?.busy) return;
    const opener = destructiveActionOpener.current;
    destructiveActionOpener.current = null;
    setPendingDestructiveAction(null);
    window.setTimeout(() => {
      if (opener?.isConnected) opener.focus();
    }, 0);
  }

  const confirmReset = (opener: HTMLElement) => {
    destructiveActionOpener.current = opener;
    setPendingDestructiveAction({ kind: "reset-sample", busy: false, error: null });
  };

  const deleteBookFromLibrary = (book: { id: string; title: string }, opener: HTMLElement) => {
    if (libraryBusy) return;
    destructiveActionOpener.current = opener;
    setPendingDestructiveAction({ kind: "delete-book", book, hasPublication: Boolean(getPublicationRecord(book.id)), busy: false, error: null });
  };

  const runDestructiveAction = async () => {
    const action = pendingDestructiveAction;
    if (!action || action.busy) return;
    setPendingDestructiveAction({ ...action, busy: true, error: null });

    if (action.kind === "reset-sample") {
      try {
        if (!await bookEngine.resetCoordinated()) {
          setPendingDestructiveAction((current) => current?.kind === "reset-sample"
            ? { ...current, busy: false, error: "Apertale could not safely restore the sample. Try again." }
            : current);
          return;
        }
        const opener = destructiveActionOpener.current;
        destructiveActionOpener.current = null;
        setPendingDestructiveAction(null);
        window.setTimeout(() => {
          if (opener?.isConnected) opener.focus();
        }, 0);
      } catch (error) {
        setPendingDestructiveAction((current) => current?.kind === "reset-sample"
          ? { ...current, busy: false, error: error instanceof Error ? error.message : "Apertale could not restore the sample." }
          : current);
      }
      return;
    }

    setDeletingBookId(action.book.id);
    try {
      const hasPublication = Boolean(getPublicationRecord(action.book.id));
      const result = await deleteBookEverywhere(
        action.book.id,
        hasPublication,
        deletePublication,
        (documentId) => bookEngine.removeBookCoordinated(documentId),
      );
      handlePublicationRecordChange(action.book.id, getPublicationRecord(action.book.id));
      if (!result.ok) {
        setPendingDestructiveAction((current) => current?.kind === "delete-book" && current.book.id === action.book.id
          ? { ...current, busy: false, error: result.summary }
          : current);
        return;
      }
      setRenderedShelfCovers((current) => {
        if (!(action.book.id in current)) return current;
        const next = { ...current };
        delete next[action.book.id];
        return next;
      });
      destructiveActionOpener.current = null;
      setPendingDestructiveAction(null);
      announce(`${action.book.title} deleted from Your books.`);
      setLibraryTab("yours");
      settleLibraryToShelf();
      window.setTimeout(() => librarySheet.current?.querySelector<HTMLElement>("#library-shelf")?.focus(), 0);
    } catch (error) {
      handlePublicationRecordChange(action.book.id, getPublicationRecord(action.book.id));
      setPendingDestructiveAction((current) => current?.kind === "delete-book" && current.book.id === action.book.id
        ? { ...current, busy: false, error: error instanceof Error ? error.message : "Apertale could not delete this book." }
        : current);
    } finally {
      setDeletingBookId(null);
    }
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
    void bookEngine.dispatchCoordinated({
      type: "undo",
      requestId: crypto.randomUUID(),
      expectedDocumentId: snapshot.document.id,
      expectedRevision: snapshot.document.revision,
      undoToken,
    }, "human");
  };

  return (
    <MotionConfig reducedMotion={reducedMotion ? "always" : "never"}>
      <main
        className={`app-shell ${snapshot.session.preview ? "is-preview" : ""} ${showCreateGuide ? "is-creation-active" : ""} ${showElementAgentGuide ? "is-agent-handoff-active" : ""} ${creationTransitionBusy ? "is-workspace-transitioning" : ""}`}
        aria-busy={creationTransitionBusy || undefined}
      >
      <PortraitOrientationGate />
      {/* Which Site tool Codex is running right now. Lives outside every
          panel and the workshop toggle, so it survives the whole handoff. */}
      <Toast open={Boolean(agentActivity)} className={`agent-activity agent-activity-${agentActivity?.phase ?? "start"}`}>
        {agentActivity?.phase === "done"
          ? <Check size={15} weight="bold" aria-hidden="true" />
          : <Sparkle size={15} weight="fill" className={agentActivity?.phase === "start" ? "is-spinning" : undefined} aria-hidden="true" />}
        <span>Codex · {agentActivity?.title}{agentActivity?.phase === "error" ? " failed" : ""}</span>
      </Toast>
      <header className="topbar" hidden={showLibrary || showCreateGuide} aria-hidden={showElementAgentGuide || undefined}>
        {!snapshot.session.preview && <button className="library-button" onClick={openLibrary} aria-label="Open book library"><Books size={18} /> <span>Books</span></button>}
        <button className="wordmark" onClick={() => { bookEngine.setPreview(false); openLibrary(); }} aria-label="Open book library">Apertale</button>
        <div className="topbar-actions">
          <ThemeSwitch theme={snapshot.session.sceneThemeId} onChange={setTheme} groupLabel="Scene theme" />
          <button className="preview-button" onClick={() => bookEngine.setPreview(!snapshot.session.preview)} aria-label={snapshot.session.preview ? "Edit book" : "Preview book"}>
            {snapshot.session.preview ? <EyeSlash size={18} /> : <Eye size={18} />}
            <span>{snapshot.session.preview ? "Edit" : "Preview"}</span>
          </button>
        </div>
      </header>

      {showLibrary && !snapshot.session.preview && !showCreateGuide && (
        <section
          className={`book-library ${libraryMotion !== "idle" ? `is-${libraryMotion}` : ""}`}
          aria-hidden={showCreateGuide || undefined}
        >
          <div className="library-atmosphere" />
          <dialog className="library-sheet" ref={librarySheet} aria-labelledby="library-title" aria-busy={libraryBusy} inert={libraryMotion !== "idle" ? true : undefined}>
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
                <button className="create-codex-button" data-creation-opener onClick={openCodexGuide} disabled={libraryBusy}><Sparkle size={18} weight="fill" /> Create your own</button>
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
                  <div
                    key={book.id}
                    data-book-id={book.id}
                    className={`library-card-shell library-card-${(index % 5) + 1} ${book.id === library.activeBookId ? "is-active" : ""} ${openingBook?.id === book.id ? "is-opening" : ""} ${libraryMotion !== "idle" && book.id === snapshot.document.id ? "is-handoff" : ""}`}
                  >
                    <button
                      className="library-card"
                      onClick={() => openBookFromLibrary(book.id)}
                      onPointerEnter={() => prewarmReader(book.id)}
                      onFocus={() => prewarmReader(book.id)}
                      aria-busy={openingBook?.id === book.id}
                      disabled={libraryBusy}
                    >
                      <span className="library-cover-frame">
                        <img
                          key={`${book.id}:${book.revision}:${book.coverAssetId ?? book.coverTextureUrl}:${resolvedCoverAsset(book, resolvedCoverUrls)?.url ?? "unresolved"}`}
                          src={shelfCoverTarget(book, resolvedCoverUrls)?.url ?? "/assets/generated/day-background.webp"}
                          alt={`${book.title} cover`}
                          loading={index < 4 ? "eager" : "lazy"}
                          decoding="async"
                          fetchPriority={index === 0 ? "high" : "auto"}
                          onLoad={(event) => {
                            const target = shelfCoverTarget(book, resolvedCoverUrls);
                            if (!target) return;
                            const renderElement = event.currentTarget;
                            const expectedUrl = new URL(target.url, window.location.href).href;
                            if ((renderElement.currentSrc || renderElement.src) !== expectedUrl) return;
                            const renderedCover = { ...target, renderElement };
                            setRenderedShelfCovers((current) => current[book.id]?.assetId === target.assetId
                              && current[book.id]?.revision === target.revision
                              && current[book.id]?.url === target.url
                              && current[book.id]?.renderElement === renderElement
                              ? current
                              : { ...current, [book.id]: renderedCover });
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
                    {!book.sample && (
                      <button
                        className="library-delete-button"
                        type="button"
                        onClick={(event) => deleteBookFromLibrary(book, event.currentTarget)}
                        aria-label={`Delete ${book.title}`}
                        title="Delete book"
                        disabled={libraryBusy}
                      >
                        {deletingBookId === book.id
                          ? <SpinnerGap size={17} weight="bold" className="is-spinning" />
                          : <Trash size={17} weight="bold" />}
                        <span>Delete</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <p className="demo-disclosure">Curated samples use OpenAI-generated illustration. Create your own in Codex.</p>
            {openingBook && <BookLoadingFeedback title={openingBook.title} placement="library" stage={loadStage} reducedMotion={reducedMotion} />}
          </dialog>
        </section>
      )}


      <section
        ref={stage}
        className={`stage ${showCreateGuide ? "is-creation-workshop" : ""} ${storyboardVisible ? "has-storyboard" : ""} ${storyPencilActive ? "is-story-pencil-active" : ""}`}
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
        aria-hidden={(showLibrary && !showCreateGuide) || undefined}
        inert={showLibrary && !showCreateGuide ? true : undefined}
        aria-busy={!showCreateGuide && stageIsLoading}
        aria-label={showCreateGuide ? "Blank three-dimensional book workshop" : `${spread.title}. Spread ${snapshot.session.currentSpreadIndex + 1} of ${snapshot.document.spreads.length}`}
      >
        {shouldMountReaderScene && (renderWebGl ? (
          <Suspense fallback={showCreateGuide
            ? <div className="fallback-book workshop-blank-fallback is-loading" />
            : <div className="fallback-book is-loading"><img src={spread.textureUrl} alt="" /></div>}>
            <ThreeBook
              snapshot={showCreateGuide ? workshopSnapshot : snapshot}
              turn={showCreateGuide ? null : turn}
              renderEvidenceToken={authoringSurfaceRequest?.surface === "reader"
                ? authoringSurfaceRequest.renderEvidenceToken
                : undefined}
              mode={showCreateGuide ? "workshop" : "reader"}
              workshopDrawing={showCreateGuide
                ? { revision: storyboard.revision, spread: currentStoryboardSpread }
                : storyboard.createdDocumentId === snapshot.document.id
                  ? { revision: storyboard.revision, spread: storyboard.spreads.find((item) => item.index === snapshot.session.currentSpreadIndex) }
                  : undefined}
              annotationEnabled={showCreateGuide && storyPencilActive}
              // Preview is a reader's view, and the workshop book is a prop.
              // Neither may be dragged, and on a phone the canvas is the only
              // surface large enough that a stray drag reaches it at all.
              readOnly={snapshot.session.preview || showCreateGuide}
              openProgress={openProgress}
              handoffRect={handoffRect}
              onSelect={showCreateGuide ? () => undefined : (elementId) => { bookEngine.setSelection(elementId); setShowMore(false); }}
              onHover={showCreateGuide ? () => undefined : setHoveredId}
              onMoveElement={showCreateGuide ? () => undefined : (elementId, x, y) => { void humanEdit(elementId, { x, y }); }}
              onPageGesture={showCreateGuide ? () => undefined : onPageGesture}
              onAnnotationStroke={showCreateGuide
                ? (stroke) => {
                  addStoryboardAnnotation(activeWorkshopSpreadIndex, stroke);
                  const read = describeAnnotation(stroke, currentStoryboardSpread?.marks ?? []);
                  const page = read.page === "both" ? "Both pages" : `${read.page[0].toUpperCase()}${read.page.slice(1)} page`;
                  setLastMark(`${page} · ${read.shape} · ${read.near[0] ?? "new element"}`);
                  window.clearTimeout(lastMarkTimeout.current);
                  lastMarkTimeout.current = window.setTimeout(() => setLastMark(null), 3000);
                }
                : undefined}
              onPageTurnReady={showCreateGuide ? undefined : reader.onPageTurnReady}
              onLoading={showCreateGuide ? () => undefined : handleBookLoading}
              onReady={showCreateGuide ? () => undefined : handleBookReady}
              onRendered={showCreateGuide ? undefined : setLastReaderRender}
              onFailure={reader.onSceneFailure}
            />
          </Suspense>
        ) : showCreateGuide ? (
          <div className="fallback-book workshop-blank-fallback" aria-label="Blank two-dimensional book workshop" />
        ) : (
          <FallbackBook
            snapshot={snapshot}
            spread={spread}
            sceneKey={readerSceneKey}
            renderEvidenceToken={authoringSurfaceRequest?.surface === "reader"
              ? authoringSurfaceRequest.renderEvidenceToken
              : undefined}
            onSelect={(elementId) => { bookEngine.setSelection(elementId); setShowMore(false); }}
            onReady={handleBookReady}
            onUnavailable={handleBookUnavailable}
            onRendered={setLastReaderRender}
          />
        ))}

        {stageIsLoading && !showLibrary && !showCreateGuide && <BookLoadingFeedback title={openingBook?.title ?? snapshot.document.title} placement="stage" stage={loadStage} reducedMotion={reducedMotion} />}

        {!stageIsLoading && !snapshot.session.preview && !showCreateGuide && (
          <>
            <button className="page-arrow page-arrow-left" onClick={() => turnPage("backward")} disabled={pageTurnNav.previous} aria-label="Previous spread"><ArrowLeft size={22} /></button>
            <button className="page-arrow page-arrow-right" onClick={() => turnPage("forward")} disabled={pageTurnNav.next} aria-label="Next spread"><ArrowRight size={22} /></button>
          </>
        )}

        {!stageIsLoading && !showCreateGuide && (
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

        {!stageIsLoading && selected && !snapshot.session.preview && !turn && !showCreateGuide && (
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

        {!stageIsLoading && !snapshot.session.preview && !showCreateGuide && spread.elements.length > 0 && (
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

        {!stageIsLoading && hovered && hovered.id !== snapshot.session.selectionId && !snapshot.session.preview && !turn && !snapshot.lastAction && !showCreateGuide && (
          <p className="hover-hint" role="presentation">{resolveInteraction(hovered).hint}</p>
        )}

        {!stageIsLoading && selected && selectedInteraction && hasReveal(selectedInteraction) && !turn && !showCreateGuide && (
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
          open={Boolean(snapshot.lastAction) && !showCreateGuide && !stageIsLoading}
          className={`agent-action agent-action-${snapshot.lastAction?.phase ?? "success"}`}
        >
          {snapshot.lastAction?.phase === "success" ? <Check size={16} weight="bold" /> : <Sparkle size={16} />}
          <span>{snapshot.lastAction?.summary}</span>
          {snapshot.lastAction?.undoToken && <button onClick={undoLastAction}>Undo</button>}
        </Toast>
      </section>

      {!stageIsLoading && !snapshot.session.preview && !showCreateGuide && (
        <footer className="bottom-controls" hidden={showLibrary}>
          <div className="bottom-left-actions">
            <button className="outline-button" onClick={() => setShowOutline(!showOutline)} aria-expanded={showOutline}>Story</button>
            {isCreatorBook && (
              <>
                <button
                  className={`publish-button ${publicationLauncher.state === "shared" ? "is-live" : ""}`}
                  onClick={openPublication}
                  aria-haspopup="dialog"
                >
                  {publicationLauncher.state === "shared"
                    ? <LinkSimple size={17} weight="bold" />
                    : publicationLauncher.state === "publishing"
                      ? <SpinnerGap size={17} weight="bold" className="is-spinning" />
                      : <UploadSimple size={17} weight="bold" />}
                  <span>{publicationLauncher.label}</span>
                </button>
                <button
                  className="publish-button is-danger"
                  onClick={(event) => deleteBookFromLibrary(snapshot.document, event.currentTarget)}
                  aria-label={`Delete ${snapshot.document.title}`}
                  aria-haspopup="dialog"
                >
                  <Trash size={17} weight="bold" />
                  <span>Delete</span>
                </button>
              </>
            )}
          </div>
          <button className="agent-prompt" data-creation-opener onClick={openCodexGuide} aria-label="Create your own">
            <Sparkle size={17} weight="fill" />
            <span className="agent-prompt-label agent-prompt-label-full" aria-hidden="true">Create your own</span>
            <span className="agent-prompt-label agent-prompt-label-compact" aria-hidden="true">Create</span>
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
            ><i /> {webMcpAvailable ? "Site tools ready" : "WebMCP ready"}</span>
            {activeLibraryBook?.sample && <button onClick={(event) => confirmReset(event.currentTarget)}><ArrowCounterClockwise size={15} /> Reset sample</button>}
          </div>
        </Panel>
      )}
      </AnimatePresence>

      {showCreateGuide && !snapshot.session.preview && (
        <section className="creation-workshop">
          <div className="workshop-atmosphere" aria-hidden="true" />
          <dialog className="workshop-ui" ref={createGuideCard} aria-labelledby="codex-guide-title">
            {storyboardVisible && !handoffIsBookArt && (
              <StoryPencilControls
                index={activeWorkshopSpreadIndex}
                count={creationSpreadCount}
                caption={currentStoryboardSpread?.caption}
                active={storyPencilActive}
                annotationCount={currentStoryboardSpread?.annotations.length ?? 0}
                annotationLimit={MAX_ANNOTATIONS_PER_SPREAD}
                lastMark={lastMark ?? undefined}
                onPrevious={() => setWorkshopSpreadIndex((index) => Math.max(0, index - 1))}
                onNext={() => setWorkshopSpreadIndex((index) => Math.min(creationSpreadCount - 1, index + 1))}
                onToggle={() => setStoryPencilActive((active) => !active)}
                onUndo={() => undoStoryboardAnnotation(activeWorkshopSpreadIndex)}
                onClear={() => clearStoryboardAnnotations(activeWorkshopSpreadIndex)}
              />
            )}
            <Toast open={Boolean(storyboardNotice)} className="story-pencil-notice">
              <Check size={16} weight="bold" />
              <span>{storyboardNotice}</span>
            </Toast>
            <header className="workshop-topbar">
              <button
                className="library-button"
                onClick={() => { setShowLibrary(true); setLibraryMotion("idle"); closeCodexGuide(); }}
                aria-label="Return to book library"
              ><Books size={18} /> <span>Books</span></button>
              <button className="workshop-close" autoFocus onClick={closeCodexGuide} aria-label={handoffIsBookArt ? "Close image handoff" : "Close creation workshop"}><X size={20} /></button>
            </header>

            <Panel from="scale" className="workshop-sheet">
              <div className="workshop-sheet-scroll">
                <div className="workshop-headline">
                  <p>{handoffIsBookArt ? "Artwork handoff" : "New book"}</p>
                  <h2 id="codex-guide-title">{handoffIsBookArt ? "Add the finished book art." : "Make one yours."}</h2>
                </div>

                {!handoffIsBookArt && <p className={`workshop-signal ${webMcpAvailable ? "is-connected" : ""}`}>
                  <i aria-hidden="true" />
                  <span>{webMcpAvailable ? "Site tools ready for Codex" : "Read here. Open in Codex (ChatGPT desktop) to create."}</span>
                </p>}

                {!handoffIsBookArt && <WorkshopPickers workshop={creationWorkshop} dispatch={dispatchCreationWorkshop} />}
                {showImagePicker && (
                  <section
                    className="workshop-photos"
                    aria-label={handoffIsBookArt ? "Generated book artwork handoff" : "Source images, in book order"}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = pickerReady && !assetImporting && !pickerAtCapacity ? "copy" : "none";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (!pickerReady || assetImporting || pickerAtCapacity) return;
                      void importWorkshopPhotos(event.dataTransfer.files);
                    }}
                  >
                    {/* The Agent's own sentence, printed where the reader acts
                        on it. A request that only exists in the chat pane is
                        what made this step feel disconnected. */}
                    <Toast open={Boolean(displayedImageHandoff)} className="workshop-handoff-request">
                      <Sparkle size={16} weight="fill" />
                      <span>{displayedImageHandoff?.reason}</span>
                    </Toast>
                    <div className="workshop-photos-head">
                      <span>{handoffIsBookArt ? "Book art" : "Photos"}<small>{handoffIsBookArt ? `up to ${MAX_BOOK_PUBLISHABLE_ASSETS} files` : `${workshopAssets.length}/${MAX_WORKSHOP_ASSETS}`}</small></span>
                      <button
                        type="button"
                        ref={addPhotoButton}
                        className="workshop-add-photo"
                        onClick={() => fileInput.current?.click()}
                        disabled={!pickerReady || assetImporting || pickerAtCapacity}
                      >
                        {!pickerReady || assetImporting ? <SpinnerGap size={15} className="is-spinning" /> : <Plus size={15} weight="bold" />}
                        <span>{!pickerReady ? "Restoring" : assetImporting ? "Adding" : handoffIsBookArt ? "Choose folder" : "Add"}</span>
                      </button>
                    </div>

                    {handoffIsBookArt || workshopAssets.length === 0 ? (
                      <button type="button" className="workshop-photo-empty" onClick={() => fileInput.current?.click()} disabled={!pickerReady || assetImporting}>
                        <UploadSimple size={22} />
                        <span>{handoffIsBookArt ? "Drop finished art here, or choose its folder" : "Drop photos here, paste, or choose files"}</span>
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

                    <input ref={fileInput} hidden type="file" multiple accept="image/png,image/jpeg,image/webp" {...(handoffIsBookArt ? { webkitdirectory: "" } : {})} disabled={!pickerReady || assetImporting} onChange={(event) => { void importWorkshopPhotos(event.currentTarget.files); event.currentTarget.value = ""; }} />

                    {workshopImportError && (
                      <p className="workshop-import-error" role="alert">
                        <WarningCircle size={14} weight="fill" />
                        <span>{workshopImportError}</span>
                        <button type="button" onClick={() => {
                          setWorkshopImportError(null);
                          if (pickerReady) fileInput.current?.click();
                          else setWorkshopHydrationAttempt((attempt) => attempt + 1);
                        }}>{pickerReady ? "Try another image" : "Try restoring again"}</button>
                      </p>
                    )}
                  </section>
                )}
              </div>

              {!handoffIsBookArt && <div className="workshop-actionbar">
                <p className="workshop-summary">
                  {creationSpreadCount} spreads · {creationStyle} · {creationInteractionChoice.label}{briefAssets.length > 0 ? ` · ${briefAssets.length} photo${briefAssets.length === 1 ? "" : "s"}` : ""}
                </p>
                <div className={`workshop-starter-actions ${copied ? "is-followup" : ""}`}>
                  <button
                    className="copy-starter-button"
                    onClick={() => void copyPrompt()}
                    aria-label={copied ? "Copy starter prompt again" : "Copy starter prompt"}
                  >
                    <Copy size={18} weight="bold" />
                    {copied ? "Copy again" : "Copy starter prompt"}
                  </button>
                  <span
                    className={`workshop-codex-status ${codexFoundPage ? "is-active" : ""}`}
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    aria-hidden={!copied}
                  >
                    {codexFoundPage
                      ? <Check size={18} weight="bold" aria-hidden="true" />
                      : webMcpAvailable
                        ? <SpinnerGap size={18} weight="bold" className={copied ? "is-spinning" : undefined} aria-hidden="true" />
                        : <Sparkle size={18} weight="fill" aria-hidden="true" />}
                    {codexFoundPage ? "Codex found this page" : webMcpAvailable ? "Waiting for Codex" : "Paste in Codex"}
                  </span>
                </div>
                {copyError && (
                  <div className="copy-fallback" role="alert">
                    <span>Copy was blocked. Select the brief below.</span>
                    <textarea readOnly value={createPrompt} onFocus={(event) => event.currentTarget.select()} aria-label="Creation brief to copy manually" />
                  </div>
                )}
              </div>}
            </Panel>
          </dialog>
        </section>
      )}

      {showElementAgentGuide && selected && !snapshot.session.preview && (
        <ElementAgentCard
          dialogRef={elementAgentCard}
          label={selected.label}
          bookTitle={snapshot.document.title}
          spreadTitle={spread.title}
          hint={selectedInteraction?.hint}
          prompt={selectedElementPrompt}
          copied={elementPromptCopied}
          copyError={elementPromptCopyError}
          onCopy={() => void copySelectedElementPrompt()}
          onClose={closeElementAgentGuide}
        />
      )}

      {showPublication && isCreatorBook && !snapshot.session.preview && (
        <PublicationPanel
          key={snapshot.document.id}
          document={snapshot.document}
          record={visiblePublicationRecord}
          onRecordChange={handlePublicationRecordChange}
          onClose={closePublication}
        />
      )}

      {pendingDestructiveAction && (
        <dialog
          className="agent-card publication-card destructive-action-card"
          ref={destructiveActionDialog}
          role="alertdialog"
          aria-labelledby="destructive-action-title"
          aria-describedby="destructive-action-description"
          aria-busy={pendingDestructiveAction.busy}
          onCancel={(event) => {
            event.preventDefault();
            closeDestructiveAction();
          }}
        >
          <div className="publication-body">
            <h2 id="destructive-action-title">
              {pendingDestructiveAction.kind === "delete-book"
                ? `Delete “${pendingDestructiveAction.book.title}”?`
                : "Restore original sample?"}
            </h2>
            <span className="publication-lede" id="destructive-action-description">
              {pendingDestructiveAction.kind === "delete-book"
                ? pendingDestructiveAction.hasPublication
                  ? "This removes the saved book, its public link, and its uploaded copy. This cannot be undone."
                  : "This removes the saved book from this browser. This cannot be undone."
                : "This replaces your local edits with the original sample."}
            </span>
            {pendingDestructiveAction.error && (
              <p className="publication-notice is-error" role="alert">
                <WarningCircle size={16} weight="fill" />
                <span>{pendingDestructiveAction.error}</span>
              </p>
            )}
          </div>
          <footer className="publication-actions">
            <div className="destructive-action-buttons">
              <button className="publication-secondary" autoFocus onClick={closeDestructiveAction} disabled={pendingDestructiveAction.busy}>
                {pendingDestructiveAction.kind === "delete-book" ? "Keep book" : "Keep my edits"}
              </button>
              <button className="publication-danger" onClick={() => { void runDestructiveAction(); }} disabled={pendingDestructiveAction.busy}>
                {pendingDestructiveAction.busy
                  ? <SpinnerGap size={17} weight="bold" className="is-spinning" />
                  : pendingDestructiveAction.kind === "delete-book"
                    ? <Trash size={17} weight="fill" />
                    : <ArrowCounterClockwise size={17} weight="bold" />}
                {pendingDestructiveAction.kind === "delete-book"
                  ? pendingDestructiveAction.busy ? "Deleting" : "Delete book"
                  : pendingDestructiveAction.busy ? "Restoring" : "Restore sample"}
              </button>
            </div>
          </footer>
        </dialog>
      )}

      <WorkspaceTransition
        phase={creationNavigation.phase}
        sourceOrigin={creationTransitionOrigins.source}
        actionOrigin={creationTransitionOrigins.action}
        onPhaseComplete={handleCreationTransitionComplete}
      />

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
    </MotionConfig>
  );
}
