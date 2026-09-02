import { initialDocument, initialSession, sampleBooks } from "./sampleBook";
import { BoundedMap } from "./boundedMap";
import {
  bookLifecycleLockManager,
  bookLifecycleLockName,
  BOOK_LIBRARY_MUTATION_LOCK_NAME,
  BOOK_LIBRARY_STORAGE_KEY,
} from "./bookLifecycle";
import { isStoredAssetId } from "./assetId";
import { MAX_BOOK_PUBLISHABLE_ASSETS, assessCreationReadiness, interactionLayerTarget, type CreationBriefPayload } from "./authoringContract";
import {
  bookAssetReferenceFindings,
  bookAssetReferenceIssueKey,
  bookAssetReferenceManifest,
  formatBookAssetReferenceIssue,
} from "./bookAssetContract";
import { recordDiagnostic } from "./diagnostics";
import { defaultInteraction, FOCUS_RESPONSES, HOVER_RESPONSES, REVEAL_KINDS, hasAuthoredInteraction, resolveInteraction } from "./interaction";
import { listProjectAssetReferences, listStoredPublishedAssetIds } from "./projectArtifact";
import { getPublicationRecord } from "./publishingClient";
import {
  adoptCreationBrief as adoptCreationBriefLifecycle,
  beginQualityReview as beginQualityReviewLifecycle,
  recordQualityReview as recordQualityReviewLifecycle,
  recordRenderEvidence as recordRenderEvidenceLifecycle,
} from "./qualityLifecycle";
import {
  QUALITY_REVIEW_MAX_ROUNDS,
  QUALITY_REVIEW_STATUSES,
  creationArtifactIssues,
  creationAssetPolicyIssues,
  isCurrentQualityReport,
  qualityGateState,
} from "./qualityContract";
import { BOOK_ELEMENT_ID_PATTERN, DIRECT_MANIPULATION, MOTION_PRESETS, MAX_BOOK_SPREADS, isProceduralAssetId, isProceduralElement, spreadBaseAssetId } from "./types";
import type {
  AuthoringQualityLifecycle,
  QualityGateState,
  QualityRenderEvidence,
  QualityVisualReviewSubmission,
} from "./qualityContract";
import type {
  AnimateCommand,
  BookElement,
  BookSnapshot,
  CommandSource,
  ComposeSpreadCommand,
  CreateBookCommand,
  DocumentCommand,
  DocumentResult,
  DocumentState,
  EditCommand,
  InteractCommand,
  InteractionSpec,
  LayeredArtwork,
  MotionSpec,
  MutationResult,
  PreparedBookLayer,
  QualityTier,
  RevealSpec,
  ScenePatchCommand,
  SetBookCoverCommand,
  Spread,
  ThemeId,
  Transform2D,
  VisibleAction,
} from "./types";

const SAMPLE_SOURCE_VERSION = 4;
const REQUEST_RESULT_LIMIT = 128;
const UNDO_RECORD_LIMIT = 32;

type ElementField = "label" | "kind" | "assetId" | "frameAssetIds" | "page" | "depth" | "locked" | "motion" | "transform" | "interaction" | "provenance";

type ElementUndoRecord = {
  operation: "update";
  token: string;
  documentId: string;
  elementId: string;
  fields: ElementField[];
  before: Partial<BookElement>;
  after: Partial<BookElement>;
};

type SpreadField = "title" | "body" | "kicker";

type ComposeSpreadUndoRecord = {
  operation: "compose";
  token: string;
  documentId: string;
  spreadId: string;
  fields: SpreadField[];
  before: Partial<Pick<Spread, SpreadField>>;
  after: Partial<Pick<Spread, SpreadField>>;
};

type CreateBookUndoRecord = {
  operation: "create-book";
  token: string;
  documentId: string;
  direction: "undo" | "redo";
  previous: DocumentState;
  created: DocumentState;
  previousQuality?: AuthoringQualityLifecycle;
  createdQuality: AuthoringQualityLifecycle;
};

type BookCoverUndoRecord = {
  operation: "set-cover";
  token: string;
  documentId: string;
  before?: string;
  after?: string;
};

type ScenePatchElementUndo = {
  elementId: string;
  fields: ElementField[];
  before: BookElement | null;
  after: BookElement | null;
};

type ScenePatchUndoRecord = {
  operation: "scene-patch";
  token: string;
  documentId: string;
  spreadId: string;
  beforeOrder: string[];
  afterOrder: string[];
  elements: ScenePatchElementUndo[];
  artwork?: {
    before?: LayeredArtwork;
    after?: LayeredArtwork;
  };
};

type UndoRecord = ElementUndoRecord | ComposeSpreadUndoRecord | CreateBookUndoRecord | BookCoverUndoRecord | ScenePatchUndoRecord;

const clone = <T,>(value: T): T => structuredClone(value);

const freshRequestId = () => crypto.randomUUID();

const validTransform = (transform: Partial<Transform2D> | undefined) => !transform || Object.entries(transform).every(([field, value]) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (field === "x" || field === "y") return value >= 0 && value <= 1;
  if (field === "scaleX" || field === "scaleY") return value >= 0.3 && value <= 1.8;
  if (field === "rotationDeg") return value >= -180 && value <= 180;
  return false;
});

const validReveal = (reveal: RevealSpec | undefined) => !reveal || (
  REVEAL_KINDS.includes(reveal.kind)
  && (reveal.kind === "none" || (reveal.title.trim().length >= 1 && reveal.title.trim().length <= 100))
  && reveal.summary.trim().length <= 500
  && Array.isArray(reveal.facts)
  && reveal.facts.length <= 8
  && reveal.facts.every((fact) => fact.label.trim().length >= 1 && fact.label.trim().length <= 64 && fact.value.trim().length >= 1 && fact.value.trim().length <= 160)
  && (typeof reveal.source === "undefined" || reveal.source.trim().length <= 200)
);

const validMotion = (motion: MotionSpec | null | undefined) => typeof motion === "undefined"
  || motion === null
  || (MOTION_PRESETS.includes(motion.preset)
    && motion.durationMs >= 400
    && motion.durationMs <= 20_000
    && typeof motion.loop === "boolean");

const normalizeReveal = (reveal: RevealSpec) => ({
  kind: reveal.kind,
  title: reveal.title.trim(),
  summary: reveal.summary.trim(),
  facts: reveal.facts.map((fact) => ({ label: fact.label.trim(), value: fact.value.trim() })),
  source: reveal.source?.trim() || undefined,
});

function materializeBookLayer(
  layer: PreparedBookLayer,
  source: CommandSource,
  validAssetId: (assetId: string) => boolean,
): BookElement | null {
  const validImageAssetId = (assetId: string) => validAssetId(assetId) && !isProceduralAssetId(assetId);
  const validFrameAssets = typeof layer.frameAssetIds === "undefined"
    || (
      !isProceduralAssetId(layer.assetId)
      && layer.frameAssetIds.length >= 2
      && layer.frameAssetIds.length <= 6
      && layer.frameAssetIds[0] === layer.assetId
      && layer.frameAssetIds.every(validImageAssetId)
    );
  if (
    !BOOK_ELEMENT_ID_PATTERN.test(layer.id)
    || layer.label.trim().length < 1
    || layer.label.trim().length > 64
    || !["left", "right"].includes(layer.page)
    || (layer.kind && !["embedded", "lifted", "decoration"].includes(layer.kind))
    || !validAssetId(layer.assetId)
    || !validFrameAssets
    || !validTransform(layer.transform)
    || (typeof layer.depth === "number" && (layer.depth < 0 || layer.depth > 0.5))
    || !validMotion(layer.motion)
    || (layer.hover && !HOVER_RESPONSES.includes(layer.hover))
    || (layer.focus && !FOCUS_RESPONSES.includes(layer.focus))
    || !validReveal(layer.reveal)
  ) return null;

  const hasExplicitInteraction = typeof layer.hover !== "undefined"
    || typeof layer.focus !== "undefined"
    || typeof layer.reveal !== "undefined";

  return {
    id: layer.id,
    label: layer.label.trim(),
    assetId: layer.assetId,
    frameAssetIds: layer.frameAssetIds,
    page: layer.page,
    kind: layer.kind ?? "lifted",
    transform: { x: 0.5, y: 0.5, scaleX: 0.72, scaleY: 0.72, rotationDeg: 0, ...layer.transform },
    depth: layer.depth ?? 0.1,
    locked: layer.locked ?? false,
    motion: layer.motion,
    ...(hasExplicitInteraction
      ? {
          interaction: {
            hover: layer.hover ?? "none",
            focus: layer.focus ?? "none",
            reveal: layer.reveal
              ? normalizeReveal(layer.reveal)
              : { kind: "none" as const, title: "", summary: "", facts: [] },
            hint: `Explore ${layer.label.trim()}`,
          },
        }
      : {}),
    provenance: source,
  };
}

type StoredLibrary = {
  activeBookId: string;
  documents: DocumentState[];
  sampleSourceVersion?: number;
  authoringQuality?: Record<string, AuthoringQualityLifecycle>;
};

type CoordinatedOpenResult =
  | { ok: true }
  | {
      ok: false;
      code: "revision_conflict";
      currentRevision: number;
      summary: string;
    }
  | {
      ok: false;
      code: "not_found" | "coordination_unavailable";
      summary: string;
    };

type CoordinatedRemoveResult =
  | { ok: true; nextBookId: string; summary: string }
  | {
      ok: false;
      code: "not_found" | "sample_book" | "publication_exists" | "coordination_unavailable";
      summary: string;
    };

function validDocument(parsed: DocumentState) {
  return typeof parsed.id === "string"
    && typeof parsed.title === "string"
    && Number.isInteger(parsed.revision)
    && parsed.revision >= 1
    && Array.isArray(parsed.spreads)
    && parsed.spreads.length >= 1
    && parsed.spreads.length <= MAX_BOOK_SPREADS
    && parsed.spreads.every((spread, order) => (
      typeof spread.id === "string"
      && typeof spread.title === "string"
      && typeof spread.body === "string"
      && spread.order === order
      && Array.isArray(spread.elements)
    ));
}

function defaultLibrary(): StoredLibrary {
  return {
    activeBookId: initialDocument.id,
    documents: clone(sampleBooks),
    sampleSourceVersion: SAMPLE_SOURCE_VERSION,
    authoringQuality: {},
  };
}

function validQualityLifecycle(value: unknown): value is AuthoringQualityLifecycle {
  if (!value || typeof value !== "object") return false;
  const lifecycle = value as Partial<AuthoringQualityLifecycle>;
  return Boolean(lifecycle.creationBrief && typeof lifecycle.creationBrief === "object")
    && Number.isInteger(lifecycle.reviewRounds)
    && Number(lifecycle.reviewRounds) >= 0
    && Number(lifecycle.reviewRounds) <= QUALITY_REVIEW_MAX_ROUNDS
    && (QUALITY_REVIEW_STATUSES as readonly string[]).includes(String(lifecycle.reviewStatus))
    && Array.isArray(lifecycle.renderEvidence);
}

function normalizeQualityLifecycle(lifecycle: AuthoringQualityLifecycle): AuthoringQualityLifecycle {
  if (lifecycle.report && !isCurrentQualityReport(lifecycle.report)) {
    return {
      creationBrief: clone(lifecycle.creationBrief),
      reviewRounds: 0,
      reviewStatus: "needs-review",
      renderEvidence: [],
    };
  }
  return clone(lifecycle);
}

function loadLibrary(): StoredLibrary {
  try {
    const raw = localStorage.getItem(BOOK_LIBRARY_STORAGE_KEY);
    if (!raw) return defaultLibrary();
    const parsed = JSON.parse(raw) as StoredLibrary;
    if (!Array.isArray(parsed.documents) || !parsed.documents.every(validDocument)) return defaultLibrary();
    const documents = clone(parsed.documents);
    const shouldMigrateSampleSemantics = (parsed.sampleSourceVersion ?? 0) < SAMPLE_SOURCE_VERSION;
    sampleBooks.forEach((sample) => {
      const storedSample = documents.find((book) => book.id === sample.id);
      if (!storedSample) {
        documents.push(clone(sample));
        return;
      }
      // Untouched curated demos follow the version shipped with the app. Once
      // a reader has edited a sample (revision > 1), preserve their local fork
      // and keep Reset sample as the explicit way back to source truth.
      if (storedSample.revision === 1) {
        const sampleIndex = documents.indexOf(storedSample);
        documents[sampleIndex] = clone(sample);
        return;
      }
      storedSample.coverTextureUrl = sample.coverTextureUrl;
      sample.spreads.forEach((spread) => {
        const storedSpread = storedSample.spreads.find((candidate) => candidate.id === spread.id);
        if (!storedSpread) {
          storedSample.spreads.push(clone(spread));
          return;
        }
        const removedLegacyModel = storedSpread.elements.some((element) => element.assetId.startsWith("model:"));
        const adoptsGroundedComposite = spread.textureUrl === spread.artwork?.sourceAssetId
          && storedSpread.textureUrl !== spread.textureUrl;
        storedSpread.elements = storedSpread.elements.filter((element) => !element.assetId.startsWith("model:"));
        spread.elements.forEach((element) => {
          const storedElement = storedSpread.elements.find((candidate) => candidate.id === element.id);
          if (!storedElement) {
            storedSpread.elements.push(clone(element));
          } else if (shouldMigrateSampleSemantics) {
            const replacesImageWithProcedural = !isProceduralElement(storedElement) && isProceduralElement(element);
            // Curated books receive shipped interaction/asset bug fixes once,
            // independently of the reader's document revision. Preserve the
            // reader's position while replacing stale visual contracts.
            storedElement.assetId = element.assetId;
            storedElement.frameAssetIds = clone(element.frameAssetIds);
            storedElement.kind = element.kind;
            storedElement.motion = clone(element.motion);
            storedElement.interaction = clone(element.interaction);
            if (replacesImageWithProcedural || adoptsGroundedComposite) {
              storedElement.transform.scaleX = element.transform.scaleX;
              storedElement.transform.scaleY = element.transform.scaleY;
              storedElement.depth = element.depth;
              storedElement.locked = element.locked;
            }
          } else if (element.frameAssetIds?.length) {
            // Frame sequences are a shipped capability upgrade. Preserve the
            // reader's transform and interaction edits while ensuring older
            // browser-local sample forks receive the compatible frame assets.
            storedElement.assetId = element.assetId;
            storedElement.frameAssetIds = clone(element.frameAssetIds);
          }
        });
        storedSpread.textureUrl = spread.textureUrl;
        storedSpread.artwork = clone(spread.artwork);
        if (removedLegacyModel) {
          storedSpread.title = spread.title;
          storedSpread.body = spread.body;
          storedSpread.kicker = spread.kicker;
        }
      });
      storedSample.spreads.forEach((spread, order) => { spread.order = order; });
    });
    const sampleOrder = new Map(sampleBooks.map((sample, index) => [sample.id, index]));
    documents.sort((left, right) => {
      const leftOrder = sampleOrder.get(left.id);
      const rightOrder = sampleOrder.get(right.id);
      if (typeof leftOrder === "number" && typeof rightOrder === "number") return leftOrder - rightOrder;
      if (typeof leftOrder === "number") return -1;
      if (typeof rightOrder === "number") return 1;
      return 0;
    });
    const activeBookId = documents.some((book) => book.id === parsed.activeBookId) ? parsed.activeBookId : documents[0]?.id;
    if (!activeBookId) return defaultLibrary();
    const documentIds = new Set(documents.map((document) => document.id));
    const authoringQuality: Record<string, AuthoringQualityLifecycle> = {};
    Object.entries(parsed.authoringQuality ?? {}).forEach(([documentId, lifecycle]) => {
      if (documentIds.has(documentId) && validQualityLifecycle(lifecycle)) {
        authoringQuality[documentId] = normalizeQualityLifecycle(lifecycle);
      }
    });
    return { activeBookId, documents, sampleSourceVersion: SAMPLE_SOURCE_VERSION, authoringQuality };
  } catch {
    return defaultLibrary();
  }
}

/**
 * Reads the durable library used as the precondition for a lifecycle change.
 * Unlike loadLibrary(), malformed storage never falls back to samples: a
 * create/remove transaction must stop instead of overwriting uncertain data.
 */
function readLibraryForLifecycleMutation(current: StoredLibrary): StoredLibrary | null {
  try {
    let raw = localStorage.getItem(BOOK_LIBRARY_STORAGE_KEY);
    if (!raw) {
      const initial = JSON.stringify(current);
      localStorage.setItem(BOOK_LIBRARY_STORAGE_KEY, initial);
      raw = localStorage.getItem(BOOK_LIBRARY_STORAGE_KEY);
      if (raw !== initial) return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const candidate = parsed as Partial<StoredLibrary>;
    if (
      typeof candidate.activeBookId !== "string"
      || !Array.isArray(candidate.documents)
      || !candidate.documents.every(validDocument)
      || new Set(candidate.documents.map((document) => document.id)).size !== candidate.documents.length
      || !candidate.documents.some((document) => document.id === candidate.activeBookId)
      || (
        typeof candidate.authoringQuality !== "undefined"
        && (!candidate.authoringQuality || typeof candidate.authoringQuality !== "object" || Array.isArray(candidate.authoringQuality))
      )
    ) return null;
    const normalized = loadLibrary();
    return localStorage.getItem(BOOK_LIBRARY_STORAGE_KEY) === raw ? normalized : null;
  } catch {
    return null;
  }
}

function findElement(documentState: DocumentState, elementId: string) {
  for (let spreadIndex = 0; spreadIndex < documentState.spreads.length; spreadIndex += 1) {
    const elementIndex = documentState.spreads[spreadIndex].elements.findIndex((item) => item.id === elementId);
    if (elementIndex >= 0) return { spreadIndex, elementIndex };
  }
  return null;
}

function equalField(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * `element.motion` is the authoritative motion field, but legacy stored books
 * can keep their only animation in `interaction.motion`, which
 * `resolveInteraction` falls back to. Strip that mirror whenever motion is
 * written explicitly: a cleared motion must not resurrect through the
 * fallback, and a replaced motion must not leave a stale shadow behind.
 */
function stripLegacyInteractionMotion(interaction: InteractionSpec | undefined) {
  if (!interaction?.motion) return interaction;
  return {
    hover: interaction.hover,
    focus: interaction.focus,
    reveal: interaction.reveal,
    hint: interaction.hint,
  };
}

export class BookEngine {
  private libraryState = loadLibrary();
  private documentState = clone(this.libraryState.documents.find((book) => book.id === this.libraryState.activeBookId) ?? initialDocument);
  private sessionState = clone(initialSession);
  private lastAction: VisibleAction | null = null;
  private listeners = new Set<() => void>();
  private requestResults = new BoundedMap<string, DocumentResult>(REQUEST_RESULT_LIMIT);
  private undoRecords = new BoundedMap<string, UndoRecord>(UNDO_RECORD_LIMIT);
  private snapshot: BookSnapshot = this.makeSnapshot();
  private storageWarningPending = false;

  private qualityLifecycles() {
    this.libraryState.authoringQuality ??= {};
    return this.libraryState.authoringQuality;
  }

  private qualityLifecycle(documentId = this.documentState.id) {
    return this.libraryState.authoringQuality?.[documentId] ?? null;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  getQualityGate(): QualityGateState {
    return qualityGateState(this.documentState, this.qualityLifecycle());
  }

  getQualityLifecycle() {
    const lifecycle = this.qualityLifecycle();
    return lifecycle ? clone(lifecycle) : null;
  }

  private async coordinateLibraryMutation<T>(
    work: () => T,
    signal?: AbortSignal,
    expectedDocumentId?: string,
  ): Promise<T | null> {
    const lockManager = bookLifecycleLockManager();
    if (!lockManager) return null;
    const options: LockOptions = { mode: "exclusive", ...(signal ? { signal } : {}) };
    return await lockManager.request(BOOK_LIBRARY_MUTATION_LOCK_NAME, options, () => {
      if (signal?.aborted) throw new DOMException("Tool execution was canceled.", "AbortError");
      if (!this.adoptDurableLibraryBaseline()) return null;
      if (expectedDocumentId && this.documentState.id !== expectedDocumentId) return null;
      return work();
    });
  }

  async adoptCreationBriefCoordinated(
    creationBrief: CreationBriefPayload,
    validatedSourceAssetIds: string[],
    expectedDocumentId: string,
    expectedRevision: number,
    assetRoleIssues: readonly string[],
    signal?: AbortSignal,
  ) {
    return await this.coordinateLibraryMutation(
      () => this.adoptCreationBrief(creationBrief, validatedSourceAssetIds, expectedRevision, assetRoleIssues),
      signal,
      expectedDocumentId,
    ) ?? {
      ok: false as const,
      code: "revision_conflict" as const,
      currentRevision: this.documentState.revision,
      summary: "The saved library changed in another tab; reopen the book before attaching its creation brief.",
    };
  }

  async beginQualityReviewCoordinated(expectedDocumentId: string, expectedRevision: number, signal?: AbortSignal) {
    return await this.coordinateLibraryMutation(
      () => this.beginQualityReview(expectedRevision),
      signal,
      expectedDocumentId,
    ) ?? {
      ok: false as const,
      code: "revision_conflict" as const,
      currentRevision: this.documentState.revision,
      summary: "The saved library changed in another tab; reopen the book before starting quality review.",
      qualityGate: this.getQualityGate(),
    };
  }

  async recordQualityReviewCoordinated(
    submission: QualityVisualReviewSubmission,
    expectedDocumentId: string,
    expectedRevision: number,
    signal?: AbortSignal,
  ) {
    return await this.coordinateLibraryMutation(
      () => this.recordQualityReview(submission, expectedRevision),
      signal,
      expectedDocumentId,
    ) ?? {
      ok: false as const,
      code: "revision_conflict" as const,
      currentRevision: this.documentState.revision,
      summary: "The saved library changed in another tab; reopen the book before recording critique.",
      qualityGate: this.getQualityGate(),
    };
  }

  async recordRenderEvidenceCoordinated(
    input: Omit<QualityRenderEvidence, "renderedAt">,
    signal?: AbortSignal,
  ) {
    return await this.coordinateLibraryMutation(() => this.recordRenderEvidence(input), signal) ?? false;
  }

  async openBookCoordinated(
    documentId: string,
    source: CommandSource = "human",
    signal?: AbortSignal,
    expected?: { documentId: string; revision: number },
  ): Promise<CoordinatedOpenResult> {
    const lockManager = bookLifecycleLockManager();
    if (!lockManager) {
      return {
        ok: false,
        code: "coordination_unavailable",
        summary: "Cross-tab book coordination is unavailable in this browser.",
      };
    }
    const options: LockOptions = { mode: "exclusive", ...(signal ? { signal } : {}) };
    return await lockManager.request(BOOK_LIBRARY_MUTATION_LOCK_NAME, options, () => {
      if (signal?.aborted) throw new DOMException("Tool execution was canceled.", "AbortError");
      if (expected && (
        this.documentState.id !== expected.documentId
        || this.documentState.revision !== expected.revision
      )) {
        return {
          ok: false as const,
          code: "revision_conflict" as const,
          currentRevision: this.documentState.revision,
          summary: `Expected ${expected.documentId} at revision ${expected.revision}; refresh context before opening another book.`,
        };
      }
      const durableLibrary = readLibraryForLifecycleMutation(this.libraryState);
      if (!durableLibrary) {
        return {
          ok: false as const,
          code: "coordination_unavailable" as const,
          summary: "The saved library could not be read safely; reopen the library before navigating.",
        };
      }
      if (expected) {
        const durableSource = durableLibrary.documents.find((book) => book.id === expected.documentId);
        if (!durableSource || durableSource.revision !== expected.revision) {
          return {
            ok: false as const,
            code: "revision_conflict" as const,
            currentRevision: durableSource?.revision ?? this.documentState.revision,
            summary: `Expected ${expected.documentId} at revision ${expected.revision}; the saved library changed in another tab.`,
          };
        }
      }
      const target = durableLibrary.documents.find((book) => book.id === documentId);
      if (!target) {
        return {
          ok: false as const,
          code: "not_found" as const,
          summary: "The requested book is not present in the saved library.",
        };
      }

      const beforeLibrary = clone(this.libraryState);
      const beforeDocument = clone(this.documentState);
      const beforeSession = clone(this.sessionState);
      const sameDocument = target.id === this.documentState.id;
      this.libraryState = durableLibrary;
      this.documentState = clone(target);
      this.libraryState.activeBookId = target.id;
      if (!sameDocument) {
        this.sessionState = { ...this.sessionState, currentSpreadIndex: 0, selectionId: null, preview: false };
      }
      if (!this.persist(true)) {
        this.libraryState = beforeLibrary;
        this.documentState = beforeDocument;
        this.sessionState = beforeSession;
        return {
          ok: false as const,
          code: "coordination_unavailable" as const,
          summary: "The saved library changed before navigation could be committed; reopen the library and retry.",
        };
      }
      if (sameDocument) this.emit();
      else this.showAction(source, "success", `${source === "agent" ? "Codex opened" : "Opened"} ${target.title}`);
      return { ok: true as const };
    });
  }

  /**
   * Permanently removes one personal book from the browser-local library.
   *
   * The per-book lifecycle lock is shared with publishing, so the publication
   * precondition cannot change between checking it and committing the library
   * removal. The global library lock preserves creations and edits from other
   * tabs. Curated samples and books with a saved publication capability fail
   * closed instead of leaving an orphaned share.
   */
  async removeBookCoordinated(
    documentId: string,
    source: CommandSource = "human",
    signal?: AbortSignal,
  ): Promise<CoordinatedRemoveResult> {
    const lockManager = bookLifecycleLockManager();
    if (!lockManager) {
      const summary = "This browser cannot safely coordinate deleting saved books across tabs.";
      this.showAction(source, "error", summary);
      return { ok: false, code: "coordination_unavailable", summary };
    }
    const options: LockOptions = { mode: "exclusive", ...(signal ? { signal } : {}) };
    const fail = (
      code: Exclude<CoordinatedRemoveResult, { ok: true }>["code"],
      summary: string,
    ): CoordinatedRemoveResult => {
      this.showAction(source, "error", summary);
      return { ok: false, code, summary };
    };

    return await lockManager.request(bookLifecycleLockName(documentId), options, () => (
      lockManager.request(BOOK_LIBRARY_MUTATION_LOCK_NAME, options, () => {
        if (signal?.aborted) throw new DOMException("Book deletion was canceled.", "AbortError");
        const durableLibrary = readLibraryForLifecycleMutation(this.libraryState);
        if (!durableLibrary) {
          return fail("coordination_unavailable", "The saved library could not be read safely; reopen Your books and retry.");
        }
        const target = durableLibrary.documents.find((book) => book.id === documentId);
        if (!target) return fail("not_found", "That book is no longer in Your books.");
        if (this.isSampleDocument(documentId)) {
          return fail("sample_book", "Curated Apertale books stay in Explore and cannot be deleted.");
        }
        if (getPublicationRecord(documentId)) {
          return fail("publication_exists", "Revoke this book's link from Share book before removing its local copy.");
        }

        const nextDocument = durableLibrary.documents.find((book) => book.id !== documentId && book.id === this.documentState.id)
          ?? durableLibrary.documents.find((book) => book.id === "apertale-field-guide")
          ?? durableLibrary.documents.find((book) => book.id !== documentId);
        if (!nextDocument) {
          return fail("coordination_unavailable", "Apertale could not find a safe book to keep open after deletion.");
        }

        // Roll back to the durable baseline we just read, never to a possibly
        // stale in-memory copy from before this tab acquired the library lock.
        const beforeLibrary = clone(durableLibrary);
        const beforeDocument = clone(
          durableLibrary.documents.find((book) => book.id === this.documentState.id)
            ?? this.documentState,
        );
        const beforeSession = clone(this.sessionState);
        this.libraryState = durableLibrary;
        this.libraryState.documents = this.libraryState.documents.filter((book) => book.id !== documentId);
        delete this.qualityLifecycles()[documentId];
        this.documentState = clone(nextDocument);
        this.libraryState.activeBookId = nextDocument.id;
        if (beforeDocument.id === documentId) {
          this.sessionState = { ...this.sessionState, currentSpreadIndex: 0, selectionId: null, preview: false };
        }

        if (!this.persist(true)) {
          this.libraryState = beforeLibrary;
          this.documentState = beforeDocument;
          this.sessionState = beforeSession;
          return fail("coordination_unavailable", "Apertale did not delete this book because the browser could not save the library.");
        }
        const committed = readLibraryForLifecycleMutation(this.libraryState);
        if (!committed || committed.documents.some((book) => book.id === documentId)) {
          this.libraryState = beforeLibrary;
          this.documentState = beforeDocument;
          this.sessionState = beforeSession;
          this.persist(true);
          return fail("coordination_unavailable", "Apertale could not verify the saved book deletion, so it restored the book.");
        }

        const summary = `${source === "agent" ? "Codex deleted" : "Deleted"} ${target.title} from Your books`;
        this.showAction(source, "success", summary);
        return { ok: true as const, nextBookId: nextDocument.id, summary };
      })
    ));
  }

  async resetCoordinated() {
    return await this.coordinateLibraryMutation(() => {
      this.reset();
      return true;
    }) ?? false;
  }

  private isSampleDocument(documentId = this.documentState.id) {
    return sampleBooks.some((sample) => sample.id === documentId);
  }

  /** Persists a lifecycle decision that moved the store; a surfaced action replaces the plain emit. */
  private commitLifecycle<Outcome extends { changed: boolean; action?: string; result: unknown }>(outcome: Outcome): Outcome["result"] {
    if (outcome.changed) {
      this.persist();
      if (outcome.action) this.showAction("agent", "success", outcome.action);
      else this.emit();
    }
    return outcome.result;
  }

  adoptCreationBrief(
    creationBrief: CreationBriefPayload,
    validatedSourceAssetIds: string[],
    expectedRevision: number,
    assetRoleIssues: readonly string[],
  ) {
    return this.commitLifecycle(adoptCreationBriefLifecycle(
      this.qualityLifecycles(),
      this.documentState,
      this.isSampleDocument(),
      creationBrief,
      validatedSourceAssetIds,
      expectedRevision,
      assetRoleIssues,
    ));
  }

  beginQualityReview(expectedRevision?: number) {
    return this.commitLifecycle(beginQualityReviewLifecycle(this.qualityLifecycles(), this.documentState, expectedRevision));
  }

  recordRenderEvidence(input: Omit<QualityRenderEvidence, "renderedAt">) {
    const documentState = input.documentId === this.documentState.id
      ? this.documentState
      : this.libraryState.documents.find((document) => document.id === input.documentId);
    if (!documentState || this.isSampleDocument(documentState.id)) return false;
    const changed = recordRenderEvidenceLifecycle(this.qualityLifecycles(), documentState, input);
    return this.commitLifecycle({ changed, result: changed });
  }

  recordQualityReview(submission: QualityVisualReviewSubmission, expectedRevision?: number) {
    return this.commitLifecycle(recordQualityReviewLifecycle(this.qualityLifecycles(), this.documentState, submission, expectedRevision));
  }

  private makeSnapshot(): BookSnapshot {
    return {
      document: this.documentState,
      session: this.sessionState,
      lastAction: this.lastAction,
    };
  }

  private emit() {
    this.snapshot = this.makeSnapshot();
    this.listeners.forEach((listener) => listener());
  }

  private persist(suppressWarning = false) {
    const quality = this.qualityLifecycle();
    if (
      quality?.report?.status === "ready"
      && quality.report.reviewedRevision !== this.documentState.revision
    ) {
      // A post-approval edit starts a fresh bounded review cycle. Blocked
      // cycles retain their count so patching cannot manufacture a third try.
      quality.reviewRounds = 0;
      quality.reviewStatus = "needs-review";
      quality.renderEvidence = [];
      delete quality.report;
    }
    try {
      const documentIndex = this.libraryState.documents.findIndex((book) => book.id === this.documentState.id);
      if (documentIndex >= 0) this.libraryState.documents[documentIndex] = clone(this.documentState);
      else this.libraryState.documents.push(clone(this.documentState));
      this.libraryState.activeBookId = this.documentState.id;
      localStorage.setItem(BOOK_LIBRARY_STORAGE_KEY, JSON.stringify(this.libraryState));
      return true;
    } catch (error) {
      recordDiagnostic("storage:persist-failed", {
        error: error instanceof Error ? error.name : "UnknownError",
      });
      if (!suppressWarning && typeof localStorage !== "undefined" && !this.storageWarningPending) {
        this.storageWarningPending = true;
        queueMicrotask(() => {
          this.storageWarningPending = false;
          this.showAction("human", "error", "Change is live, but this browser could not save it");
        });
      }
      return false;
    }
  }

  /** Records a failed command result and surfaces it in one step. */
  private failCommand(
    requestId: string,
    source: CommandSource,
    code: "revision_conflict" | "undo_conflict" | "not_found" | "locked" | "invalid",
    summary: string,
    elementId?: string,
  ): DocumentResult {
    const result = this.conflict(code, summary);
    this.requestResults.set(requestId, result);
    this.showAction(source, "error", result.summary, elementId);
    return result;
  }

  private conflict(code: "revision_conflict" | "undo_conflict" | "not_found" | "locked" | "invalid", summary: string): DocumentResult {
    return { ok: false, code, currentRevision: this.documentState.revision, summary };
  }

  private showAction(source: CommandSource, phase: VisibleAction["phase"], summary: string, elementId?: string, undoToken?: string) {
    const actionId = freshRequestId();
    this.lastAction = { id: actionId, source, phase, summary, elementId, undoToken };
    recordDiagnostic(`command:${phase}`, {
      source,
      elementId: elementId ?? null,
      revision: this.documentState.revision,
      hasUndo: Boolean(undoToken),
    });
    this.emit();
    if (phase !== "pending") {
      globalThis.setTimeout(() => {
        if (this.lastAction?.id === actionId) {
          this.lastAction = null;
          this.emit();
        }
      }, 3200);
    }
  }

  getContext(includeSelectedReveal = false) {
    const spread = this.documentState.spreads[this.sessionState.currentSpreadIndex];
    const selected = this.sessionState.selectionId
      ? spread.elements.find((element) => element.id === this.sessionState.selectionId) ?? null
      : null;
    return {
      book: {
        id: this.documentState.id,
        title: this.documentState.title,
        revision: this.documentState.revision,
        coverAssetId: this.documentState.coverAssetId ?? null,
      },
      library: {
        activeBookId: this.documentState.id,
        books: this.libraryState.documents.map((book) => ({ id: book.id, title: book.title, spreadCount: book.spreads.length })),
      },
      outline: this.documentState.spreads.map((item) => ({
        id: item.id,
        title: item.title,
        order: item.order + 1,
        elementCount: item.elements.length,
      })),
      currentSpread: {
        id: spread.id,
        title: spread.title,
        order: spread.order + 1,
        artwork: spread.artwork
          ? {
              cleanPlateAssetId: spread.artwork.cleanPlateAssetId,
              sourceAssetId: spread.artwork.sourceAssetId ?? null,
              ...(spread.artwork.personalSourceAssetId
                ? { personalSourceAssetId: spread.artwork.personalSourceAssetId }
                : {}),
              foregroundLayerCount: spread.elements.filter((element) => !isProceduralElement(element)).length,
            }
          : null,
        elements: spread.elements.map((element) => ({
          id: element.id,
          label: element.label,
          kind: element.kind,
          assetId: element.assetId,
          frameAssetIds: element.frameAssetIds ?? null,
          locked: element.locked,
        })),
      },
      selection: selected
        ? {
            id: selected.id,
            label: selected.label,
            kind: selected.kind,
            assetId: selected.assetId,
            frameAssetIds: selected.frameAssetIds ?? null,
            locked: selected.locked,
            transform: selected.transform,
            motion: selected.motion ?? null,
            interaction: (() => {
              const spec = resolveInteraction(selected);
              return {
                hover: spec.hover,
                focus: spec.focus,
                reveal: includeSelectedReveal ? clone(spec.reveal) : spec.reveal.kind,
              };
            })(),
          }
        : null,
      theme: this.sessionState.sceneThemeId,
      capabilities: ["create-book", "set-book-cover", "compose-spread", "full-spread-illustration-stage", "clean-plate-background", "layered-image-interaction", "browser-image-optimization", "presentation", "undo"],
    };
  }

  getLibrary() {
    return {
      activeBookId: this.documentState.id,
      books: this.libraryState.documents.map((book) => ({
        id: book.id,
        title: book.title,
        revision: book.revision,
        spreadCount: book.spreads.length,
        coverAssetId: book.coverAssetId,
        coverTextureUrl: book.coverTextureUrl ?? book.spreads[0]?.textureUrl ?? "/assets/generated/day-background.png",
        firstSpreadTitle: book.spreads[0]?.title ?? "Untitled spread",
        sample: this.isSampleDocument(book.id),
      })),
    };
  }

  /**
   * Read-only media descriptor for the spread a reader will see first.
   *
   * Used purely to prewarm the renderer chunk and that one spread's artwork
   * once a reader shows intent. It mutates nothing and never widens the
   * current/adjacent loading scope.
   */
  getPrewarmMedia(documentId: string) {
    const isActive = documentId === this.documentState.id;
    const book = isActive ? this.documentState : this.libraryState.documents.find((candidate) => candidate.id === documentId);
    if (!book) return null;
    const spread = book.spreads[isActive ? this.sessionState.currentSpreadIndex : 0] ?? book.spreads[0];
    if (!spread) return null;
    return {
      spreadId: spread.id,
      mediaRef: spreadBaseAssetId(spread) ?? null,
    };
  }

  openBook(documentId: string, source: CommandSource = "human") {
    if (documentId === this.documentState.id) return true;
    const nextDocument = this.libraryState.documents.find((book) => book.id === documentId);
    if (!nextDocument) return false;
    this.persist();
    this.documentState = clone(nextDocument);
    this.libraryState.activeBookId = documentId;
    this.sessionState = { ...this.sessionState, currentSpreadIndex: 0, selectionId: null, preview: false };
    this.persist();
    this.showAction(source, "success", `${source === "agent" ? "Codex opened" : "Opened"} ${nextDocument.title}`);
    return true;
  }

  setSelection(elementId: string | null) {
    this.sessionState = { ...this.sessionState, selectionId: elementId };
    this.emit();
  }

  setSpread(index: number, source?: CommandSource) {
    const next = Math.max(0, Math.min(this.documentState.spreads.length - 1, index));
    this.sessionState = { ...this.sessionState, currentSpreadIndex: next, selectionId: null };
    // A human turn is its own evidence; an agent turn happens off-screen for the reader.
    if (source === "agent") this.narrate(source, `Codex turned to ${this.documentState.spreads[next]?.title || `spread ${next + 1}`}`);
    else this.emit();
  }

  /** Surface a presentation-only agent step that changes no document state. */
  narrate(source: CommandSource, summary: string) {
    this.showAction(source, "success", summary);
  }

  setTheme(theme: ThemeId, source: CommandSource = "human") {
    this.sessionState = { ...this.sessionState, sceneThemeId: theme };
    this.showAction(source, "success", `${source === "agent" ? "Codex switched" : "Switched"} to ${theme === "paper-atelier" ? "Day" : "Night"}`);
  }

  setQuality(quality: QualityTier) {
    if (this.sessionState.quality === quality) return;
    this.sessionState = { ...this.sessionState, quality };
    this.emit();
  }

  setPreview(preview: boolean, source?: CommandSource) {
    this.sessionState = { ...this.sessionState, preview, selectionId: preview ? null : this.sessionState.selectionId };
    if (source) this.showAction(source, "success", `${source === "agent" ? "Codex " : ""}${preview ? "entered" : "exited"} Preview`);
    else this.emit();
  }

  reset() {
    const sample = sampleBooks.find((book) => book.id === this.documentState.id) ?? initialDocument;
    this.documentState = clone(sample);
    this.sessionState = clone(initialSession);
    this.requestResults.clear();
    this.undoRecords.clear();
    this.persist();
    this.showAction("human", "success", "Sample book restored");
  }

  /**
   * Preview is the reader's view of a finished book, so direct manipulation
   * has to stop at the model and not merely at the controls. The panels and
   * the element rail already hide themselves, but the canvas keeps its
   * pointer handlers, and a drag there used to write a real transform into a
   * document the reader believed they were only looking at.
   *
   * Only direct manipulation is refused, and only when a person issues it.
   * `DIRECT_MANIPULATION` in types.ts is what decides that, so the set cannot
   * fall out of date with the command union.
   */
  private refusedByPreview(command: DocumentCommand, source: CommandSource) {
    if (source !== "human" || !this.sessionState.preview) return null;
    if (!DIRECT_MANIPULATION[command.type]) return null;
    return this.conflict("invalid", "Preview is read-only. Exit Preview to change this book.");
  }

  dispatch(command: DocumentCommand, source: CommandSource): DocumentResult {
    const prior = this.requestResults.get(command.requestId);
    if (prior) return prior;

    if (command.expectedDocumentId !== this.documentState.id) {
      const result = this.conflict(
        "revision_conflict",
        `Expected document ${command.expectedDocumentId}; current document is ${this.documentState.id}.`,
      );
      this.requestResults.set(command.requestId, result);
      return result;
    }

    const refused = this.refusedByPreview(command, source);
    if (refused) {
      this.requestResults.set(command.requestId, refused);
      this.showAction(source, "error", refused.summary, "elementId" in command ? command.elementId : undefined);
      return refused;
    }

    if (command.expectedRevision !== this.documentState.revision) {
      const result = this.conflict("revision_conflict", `Expected revision ${command.expectedRevision}; current revision is ${this.documentState.revision}.`);
      this.requestResults.set(command.requestId, result);
      return result;
    }

    this.showAction(source, "pending", `${source === "agent" ? "Codex is working" : "Applying change"}…`, "elementId" in command ? command.elementId : undefined);

    if (command.type === "undo") return this.applyUndo(command, source);

    if (command.type === "create-book") return this.applyCreateBook(command, source);

    if (command.type === "set-book-cover") return this.applySetBookCover(command, source);

    if (command.type === "compose-spread") return this.applyComposeSpread(command, source);

    if (command.type === "scene-patch") return this.applyScenePatch(command, source);

    const location = findElement(this.documentState, command.elementId);
    if (!location) {
      return this.failCommand(command.requestId, source, "not_found", `Element ${command.elementId} was not found.`);
    }

    const currentElement = this.documentState.spreads[location.spreadIndex].elements[location.elementIndex];
    if (currentElement.locked && command.type !== "edit") {
      return this.failCommand(command.requestId, source, "locked", `${currentElement.label} is locked.`, currentElement.id);
    }

    const before = clone(currentElement);
    let nextElement = clone(currentElement);
    let fields: ElementField[] = [];
    let verb = "updated";

    if (command.type === "lift") {
      nextElement = { ...nextElement, kind: "lifted", depth: 0.18, provenance: source };
      fields = ["kind", "depth"];
      verb = "lifted";
    } else if (command.type === "interact") {
      nextElement = { ...nextElement, interaction: this.applyInteraction(nextElement, command), provenance: source };
      fields = ["interaction"];
      verb = "retuned";
    } else if (command.type === "animate") {
      // An explicit animate write owns motion: drop the legacy
      // `interaction.motion` mirror too, or a cleared motion would resurrect
      // through the resolveInteraction fallback.
      const hadLegacyMotion = Boolean(nextElement.interaction?.motion);
      nextElement = {
        ...nextElement,
        motion: command.motion ?? undefined,
        ...(hadLegacyMotion ? { interaction: stripLegacyInteractionMotion(nextElement.interaction) } : {}),
        provenance: source,
      };
      fields = hadLegacyMotion ? ["motion", "interaction"] : ["motion"];
      verb = command.motion ? "animated" : "stilled";
    } else {
      nextElement = this.applyEdit(nextElement, command, source);
      fields = [
        ...(command.transform ? (["transform"] as ElementField[]) : []),
        ...(typeof command.depth === "number" ? (["depth"] as ElementField[]) : []),
        ...(typeof command.locked === "boolean" ? (["locked"] as ElementField[]) : []),
      ];
      verb = command.locked === true ? "locked" : command.locked === false ? "unlocked" : "edited";
    }

    const nextDocument = clone(this.documentState);
    nextDocument.spreads[location.spreadIndex].elements[location.elementIndex] = nextElement;
    nextDocument.revision += 1;
    this.documentState = nextDocument;

    const undoToken = crypto.randomUUID();
    this.undoRecords.set(undoToken, {
      operation: "update",
      token: undoToken,
      documentId: nextDocument.id,
      elementId: nextElement.id,
      fields,
      before: Object.fromEntries(fields.map((field) => [field, clone(before[field])])) as Partial<BookElement>,
      after: Object.fromEntries(fields.map((field) => [field, clone(nextElement[field])])) as Partial<BookElement>,
    });

    const summary = `${source === "agent" ? "Codex" : "You"} ${verb} ${nextElement.label}`;
    const result: MutationResult = { ok: true, revision: nextDocument.revision, changedIds: [nextElement.id], undoToken, summary };
    this.requestResults.set(command.requestId, result);
    this.persist();
    this.showAction(source, "success", summary, nextElement.id, undoToken);
    return result;
  }

  private adoptDurableLibraryBaseline() {
    const durableLibrary = readLibraryForLifecycleMutation(this.libraryState);
    const durableDocument = durableLibrary?.documents.find((book) => book.id === this.documentState.id);
    if (!durableLibrary || !durableDocument || !equalField(durableDocument, this.documentState)) return false;
    this.libraryState = durableLibrary;
    return true;
  }

  /**
   * Production entry point for saved document commands. Every library write
   * takes the short global storage lock; create/creation-history commands also
   * take the per-book lifecycle lock shared with publication.
   */
  async dispatchCoordinated(
    command: DocumentCommand,
    source: CommandSource,
    signal?: AbortSignal,
  ): Promise<DocumentResult> {
    const prior = this.requestResults.get(command.requestId);
    if (prior) return prior;
    const createRecord = command.type === "undo" ? this.undoRecords.get(command.undoToken) : null;
    const lifecycleDocumentId = command.type === "create-book"
      ? command.documentId
      : createRecord?.operation === "create-book"
        ? createRecord.created.id
        : null;
    const lockManager = bookLifecycleLockManager();
    if (!lockManager) {
      return this.failCommand(command.requestId, source, "invalid", "This browser cannot safely coordinate saved book changes across tabs.");
    }
    const lockOptions: LockOptions = { mode: "exclusive", ...(signal ? { signal } : {}) };
    const throwIfCanceled = () => {
      if (signal?.aborted) throw new DOMException("Tool execution was canceled.", "AbortError");
    };
    const commit = () => {
      throwIfCanceled();
      if (!lifecycleDocumentId && !this.adoptDurableLibraryBaseline()) {
        return this.failCommand(command.requestId, source, "revision_conflict", "The saved library changed in another tab; reopen the book before editing it.");
      }
      return this.dispatch(command, source);
    };
    const withLibraryLock = () => lockManager.request(
      BOOK_LIBRARY_MUTATION_LOCK_NAME,
      lockOptions,
      commit,
    );
    return await (lifecycleDocumentId
      ? lockManager.request(
          bookLifecycleLockName(lifecycleDocumentId),
          lockOptions,
          withLibraryLock,
        )
      : withLibraryLock());
  }

  private applyCreateBook(command: CreateBookCommand, source: CommandSource): DocumentResult {
    const readiness = assessCreationReadiness(command.creationBrief, {
      expectedSpreadCount: command.spreads.length,
      validatedSourceAssetIds: command.validatedSourceAssetIds,
    });
    if (!readiness.ready) {
      const result = {
        ok: false as const,
        code: "creation_not_ready" as const,
        currentRevision: this.documentState.revision,
        summary: "This creation brief needs a little more information before Apertale can create the book.",
        readiness,
      };
      this.requestResults.set(command.requestId, result);
      this.showAction(source, "error", result.summary);
      return result;
    }
    const title = command.title.trim();
    const validSpreads = command.spreads.length >= 1
      && command.spreads.length <= MAX_BOOK_SPREADS
      && new Set(command.spreads.map((spread) => spread.id)).size === command.spreads.length
      && command.spreads.every((spread) => (
        /^[a-z0-9][a-z0-9-]{0,63}$/.test(spread.id)
        && spread.title.trim().length >= 1
        && spread.title.trim().length <= 100
        && spread.body.trim().length <= 800
        && (typeof spread.kicker === "undefined" || spread.kicker.trim().length <= 100)
      ));
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(command.documentId) || title.length < 1 || title.length > 100 || !validSpreads) {
      return this.failCommand(command.requestId, source, "invalid", "Book title, id, or spread plan is outside the supported authoring limits.");
    }
    const before = clone(this.documentState);
    let beforeLibrary = clone(this.libraryState);
    const beforeSession = clone(this.sessionState);
    const beforeUndoRecords = new BoundedMap(
      UNDO_RECORD_LIMIT,
      [...this.undoRecords].map(([token, undoRecord]) => [token, clone(undoRecord)] as const),
    );
    let previousQuality = this.qualityLifecycle(before.id);
    const validatedLocalAssetIds = new Set(command.validatedLocalAssetIds ?? []);
    const validLocalAssetId = (assetId: string) => isStoredAssetId(assetId) && validatedLocalAssetIds.has(assetId);
    const artifactIssues: string[] = [];
    const interactionTarget = interactionLayerTarget(command.creationBrief.interactionDensity);
    if (!command.coverAssetId || !validLocalAssetId(command.coverAssetId)) {
      artifactIssues.push("The dedicated cover must be a verified browser-local image asset.");
    }
    const nextDocument: DocumentState = {
      id: command.documentId,
      revision: before.revision + 1,
      title,
      ...(command.coverAssetId ? { coverAssetId: command.coverAssetId } : {}),
      spreads: command.spreads.map((spread, order) => ({
        id: spread.id,
        order,
        title: spread.title.trim(),
        body: spread.body.trim(),
        kicker: spread.kicker?.trim() || undefined,
        ...(spread.background
          ? {
              artwork: {
                cleanPlateAssetId: spread.background.cleanPlateAssetId,
                sourceAssetId: spread.background.sourceAssetId,
                personalSourceAssetId: spread.background.personalSourceAssetId,
                separation: spread.background.separation ?? "inpainted-clean-plate",
              },
            }
          : {}),
        elements: (spread.layers ?? []).flatMap((layer) => {
          const element = materializeBookLayer(layer, source, validLocalAssetId);
          return element ? [element] : [];
        }),
      })),
    };

    const bookLayerIds = command.spreads.flatMap((spread) => (spread.layers ?? []).map((layer) => layer.id));
    if (new Set(bookLayerIds).size !== bookLayerIds.length) {
      artifactIssues.push("Foreground layer ids must be unique across the whole book.");
    }

    command.spreads.forEach((spread, index) => {
      const spreadNumber = index + 1;
      const background = spread.background;
      if (!background) {
        artifactIssues.push(`Spread ${spreadNumber} has no prepared full-spread background.`);
      } else {
        const backgroundAssets = [background.cleanPlateAssetId, background.sourceAssetId, background.personalSourceAssetId]
          .filter((assetId): assetId is string => Boolean(assetId));
        if (backgroundAssets.some((assetId) => !validLocalAssetId(assetId))) {
          artifactIssues.push(`Spread ${spreadNumber} references an unverified background or provenance asset.`);
        }
      }
      const layers = spread.layers ?? [];
      if (layers.length < interactionTarget.minimum || layers.length > interactionTarget.maximum) {
        artifactIssues.push(`Spread ${spreadNumber} needs ${interactionTarget.count} prepared interactive layers for ${interactionTarget.label.toLowerCase()} density; found ${layers.length}.`);
      }
      if (new Set(layers.map((layer) => layer.id)).size !== layers.length) {
        artifactIssues.push(`Spread ${spreadNumber} foreground layer ids must be unique.`);
      }
      if (nextDocument.spreads[index].elements.length !== layers.length) {
        artifactIssues.push(`Spread ${spreadNumber} contains an invalid or unverified foreground layer.`);
      }
      if (interactionTarget.minimum > 0 && !layers.some(hasAuthoredInteraction)) {
        artifactIssues.push(`Spread ${spreadNumber} needs at least one explicit story-relevant interaction.`);
      }
    });
    artifactIssues.push(...creationArtifactIssues(nextDocument, command.creationBrief));
    const uniqueArtifactIssues = [...new Set(artifactIssues)];
    if (uniqueArtifactIssues.length > 0) {
      const result = {
        ok: false as const,
        code: "creation_artifact_incomplete" as const,
        currentRevision: this.documentState.revision,
        summary: "Apertale did not create the book because its complete prepared artwork is not ready.",
        issues: uniqueArtifactIssues,
      };
      this.requestResults.set(command.requestId, result);
      this.showAction(source, "error", result.summary);
      return result;
    }

    const durableLibrary = readLibraryForLifecycleMutation(this.libraryState);
    if (!durableLibrary) {
      return this.failCommand(command.requestId, source, "invalid", "Apertale did not create the book because its saved library could not be read safely.");
    }
    const durableBefore = durableLibrary.documents.find((book) => book.id === before.id);
    if (!durableBefore || !equalField(durableBefore, before)) {
      return this.failCommand(command.requestId, source, "revision_conflict", "The saved library changed in another tab; reopen it before creating this book.");
    }
    if (durableLibrary.documents.some((book) => book.id === command.documentId)) {
      return this.failCommand(command.requestId, source, "invalid", `Book ${command.documentId} already exists. Open it or choose a new id.`);
    }
    this.libraryState = durableLibrary;
    beforeLibrary = clone(durableLibrary);
    previousQuality = this.qualityLifecycle(before.id);

    this.documentState = nextDocument;
    const quality: AuthoringQualityLifecycle = {
      creationBrief: clone(command.creationBrief),
      reviewRounds: 0,
      reviewStatus: "needs-review",
      renderEvidence: [],
    };
    this.qualityLifecycles()[nextDocument.id] = quality;
    this.sessionState = { ...this.sessionState, currentSpreadIndex: 0, selectionId: null };
    const undoToken = crypto.randomUUID();
    this.undoRecords.set(undoToken, {
      operation: "create-book",
      token: undoToken,
      documentId: nextDocument.id,
      direction: "undo",
      previous: before,
      created: clone(nextDocument),
      previousQuality: previousQuality ? clone(previousQuality) : undefined,
      createdQuality: clone(quality),
    });
    const summary = `${source === "agent" ? "Codex" : "You"} created ${title}`;
    const result: MutationResult = {
      ok: true,
      revision: nextDocument.revision,
      changedIds: nextDocument.spreads.map((spread) => spread.id),
      undoToken,
      summary,
      documentId: nextDocument.id,
    };
    if (!this.persist(true)) {
      this.documentState = before;
      this.libraryState = beforeLibrary;
      this.sessionState = beforeSession;
      this.undoRecords = beforeUndoRecords;
      return this.failCommand(command.requestId, source, "invalid", "Apertale did not create the book because this browser could not save it.");
    }
    this.requestResults.set(command.requestId, result);
    this.showAction(source, "success", summary, undefined, undoToken);
    return result;
  }

  private applySetBookCover(command: SetBookCoverCommand, source: CommandSource): DocumentResult {
    const validAssetId = isStoredAssetId(command.assetId)
      && command.validatedLocalAssetIds.includes(command.assetId);
    if (!validAssetId) {
      return this.failCommand(command.requestId, source, "invalid", "Book covers require a validated browser-local image asset.");
    }

    const before = this.documentState.coverAssetId;
    const existingReferenceIssues = new Set(
      bookAssetReferenceFindings(bookAssetReferenceManifest(this.documentState)).map(bookAssetReferenceIssueKey),
    );
    const nextDocument = clone(this.documentState);
    nextDocument.coverAssetId = command.assetId;
    nextDocument.revision += 1;
    const newReferenceIssue = bookAssetReferenceFindings(bookAssetReferenceManifest(nextDocument))
      .find((issue) => !existingReferenceIssues.has(bookAssetReferenceIssueKey(issue)));
    if (newReferenceIssue) {
      return this.failCommand(command.requestId, source, "invalid", formatBookAssetReferenceIssue(newReferenceIssue));
    }
    const creationBrief = this.qualityLifecycle()?.creationBrief;
    if (creationBrief?.bookType) {
      const policyIssue = creationAssetPolicyIssues(nextDocument, creationBrief)[0];
      if (policyIssue) {
        return this.failCommand(command.requestId, source, "invalid", policyIssue);
      }
    }
    const localAssetCount = listStoredPublishedAssetIds(nextDocument).length;
    if (localAssetCount > MAX_BOOK_PUBLISHABLE_ASSETS) {
      return this.failCommand(command.requestId, source, "invalid", `The cover would raise this book to ${localAssetCount} local images, above the publishable limit of ${MAX_BOOK_PUBLISHABLE_ASSETS}.`);
    }
    this.documentState = nextDocument;

    const undoToken = crypto.randomUUID();
    this.undoRecords.set(undoToken, {
      operation: "set-cover",
      token: undoToken,
      documentId: nextDocument.id,
      before,
      after: command.assetId,
    });
    const summary = `${source === "agent" ? "Codex" : "You"} set the cover for ${nextDocument.title}`;
    const result: MutationResult = {
      ok: true,
      revision: nextDocument.revision,
      changedIds: [nextDocument.id],
      undoToken,
      summary,
    };
    this.requestResults.set(command.requestId, result);
    this.persist();
    this.showAction(source, "success", summary, undefined, undoToken);
    return result;
  }

  private applyComposeSpread(command: ComposeSpreadCommand, source: CommandSource): DocumentResult {
    const spreadIndex = this.documentState.spreads.findIndex((spread) => spread.id === command.spreadId);
    if (spreadIndex < 0) {
      return this.failCommand(command.requestId, source, "not_found", `Spread ${command.spreadId} was not found.`);
    }
    const hasChange = [command.title, command.body, command.kicker].some((value) => typeof value !== "undefined");
    const valid = hasChange
      && (typeof command.title === "undefined" || (command.title.trim().length >= 1 && command.title.trim().length <= 100))
      && (typeof command.body === "undefined" || command.body.trim().length <= 800)
      && (typeof command.kicker === "undefined" || command.kicker.trim().length <= 100);
    if (!valid) {
      return this.failCommand(command.requestId, source, "invalid", "Compose spread requires at least one bounded text field.");
    }

    const currentSpread = this.documentState.spreads[spreadIndex];
    const fields: SpreadField[] = [
      ...(typeof command.title !== "undefined" ? (["title"] as SpreadField[]) : []),
      ...(typeof command.body !== "undefined" ? (["body"] as SpreadField[]) : []),
      ...(typeof command.kicker !== "undefined" ? (["kicker"] as SpreadField[]) : []),
    ];
    const before = Object.fromEntries(fields.map((field) => [field, clone(currentSpread[field])])) as Partial<Pick<Spread, SpreadField>>;
    const nextDocument = clone(this.documentState);
    const spread = nextDocument.spreads[spreadIndex];
    if (typeof command.title !== "undefined") spread.title = command.title.trim();
    if (typeof command.body !== "undefined") spread.body = command.body.trim();
    if (typeof command.kicker !== "undefined") spread.kicker = command.kicker.trim() || undefined;
    nextDocument.revision += 1;
    this.documentState = nextDocument;
    const undoToken = crypto.randomUUID();
    const after = Object.fromEntries(fields.map((field) => [field, clone(spread[field])])) as Partial<Pick<Spread, SpreadField>>;
    this.undoRecords.set(undoToken, {
      operation: "compose",
      token: undoToken,
      documentId: nextDocument.id,
      spreadId: spread.id,
      fields,
      before,
      after,
    });
    const summary = `${source === "agent" ? "Codex" : "You"} composed ${spread.title}`;
    const result: MutationResult = { ok: true, revision: nextDocument.revision, changedIds: [spread.id], undoToken, summary };
    this.requestResults.set(command.requestId, result);
    this.persist();
    this.showAction(source, "success", summary, undefined, undoToken);
    return result;
  }

  private applyScenePatch(command: ScenePatchCommand, source: CommandSource): DocumentResult {
    const spreadIndex = this.documentState.spreads.findIndex((spread) => spread.id === command.spreadId);
    const visibleSpread = this.documentState.spreads[this.sessionState.currentSpreadIndex];
    if (spreadIndex < 0 || visibleSpread.id !== command.spreadId || command.operations.length < 1 || command.operations.length > 24) {
      return this.failCommand(command.requestId, source, "invalid", "Scene patches require 1–24 operations on the visible spread.");
    }

    const before = clone(this.documentState);
    const nextDocument = clone(this.documentState);
    const spread = nextDocument.spreads[spreadIndex];
    const elements = spread.elements;
    const knownBackgroundAssetIds = new Set<string>();
    const knownForegroundAssetIds = new Set<string>();
    const knownPersonalSourceAssetIds = new Set<string>();
    this.libraryState.documents.forEach((document) => {
      listProjectAssetReferences(document).forEach((reference) => {
        if (reference.location.kind === "element") knownForegroundAssetIds.add(reference.assetId);
        else if (reference.location.kind === "spread" && reference.location.field === "personalSourceAssetId") {
          knownPersonalSourceAssetIds.add(reference.assetId);
        } else if (reference.location.kind === "spread") {
          knownBackgroundAssetIds.add(reference.assetId);
        }
      });
    });
    const validatedLocalAssetIds = new Set(command.validatedLocalAssetIds ?? []);
    const validLocalAssetId = (assetId: string) => isStoredAssetId(assetId) && validatedLocalAssetIds.has(assetId);
    const validBackgroundAssetId = (assetId: string) => !assetId.startsWith("model:")
      && (knownBackgroundAssetIds.has(assetId) || validLocalAssetId(assetId));
    const validForegroundAssetId = (assetId: string) => !assetId.startsWith("model:")
      && (knownForegroundAssetIds.has(assetId) || validLocalAssetId(assetId));
    const validPersonalSourceAssetId = (assetId: string) => !assetId.startsWith("model:")
      && (knownPersonalSourceAssetIds.has(assetId) || validLocalAssetId(assetId));
    const validFrameAssets = (assetIds: string[] | null | undefined) => typeof assetIds === "undefined"
      || assetIds === null
      || (assetIds.length >= 2
        && assetIds.length <= 6
        && assetIds.every((assetId) => validForegroundAssetId(assetId) && !isProceduralAssetId(assetId)));
    const existingReferenceIssues = new Set(
      bookAssetReferenceFindings(bookAssetReferenceManifest(before)).map(bookAssetReferenceIssueKey),
    );
    const changedIds: string[] = [];
    const fail = (summary: string) => {
      return this.failCommand(command.requestId, source, "invalid", summary);
    };
    for (const operation of command.operations) {
      if (operation.op === "set-background") {
        if (
          !validBackgroundAssetId(operation.cleanPlateAssetId)
          || !operation.sourceAssetId
          || !validBackgroundAssetId(operation.sourceAssetId)
          || (operation.personalSourceAssetId && !validPersonalSourceAssetId(operation.personalSourceAssetId))
        ) {
          return fail("The clean plate, original composite, and any personal source must be known image assets.");
        }
        spread.artwork = {
          cleanPlateAssetId: operation.cleanPlateAssetId,
          sourceAssetId: operation.sourceAssetId,
          personalSourceAssetId: operation.personalSourceAssetId,
          separation: operation.separation ?? "inpainted-clean-plate",
        };
        changedIds.push(`${spread.id}:background`);
        continue;
      }
      if (operation.op === "add") {
        if (
          !validForegroundAssetId(operation.assetId)
          || (operation.frameAssetIds?.length && isProceduralAssetId(operation.assetId))
          || operation.frameAssetIds?.some((assetId) => !validForegroundAssetId(assetId))
        ) {
          return fail(`Layer ${operation.id || "element"} requires assets trusted for the foreground role.`);
        }
        const nextElement = materializeBookLayer(operation, source, validForegroundAssetId);
        if (
          elements.length >= 24
          || findElement(nextDocument, operation.id)
          || !nextElement
        ) return fail(`Add operation for ${operation.id || "element"} is outside the scene limits.`);
        elements.push(nextElement);
        knownForegroundAssetIds.add(operation.assetId);
        operation.frameAssetIds?.forEach((assetId) => knownForegroundAssetIds.add(assetId));
        changedIds.push(operation.id);
        continue;
      }

      const elementIndex = elements.findIndex((element) => element.id === operation.elementId);
      if (elementIndex < 0) return fail(`Element ${operation.elementId} was not found on the visible spread.`);
      const element = elements[elementIndex];
      if (element.locked && !(operation.op === "update" && operation.locked === false)) return fail(`${element.label} is locked.`);

      if (operation.op === "remove") elements.splice(elementIndex, 1);
      else if (operation.op === "reorder") {
        if (!Number.isInteger(operation.index) || operation.index < 0 || operation.index >= elements.length) return fail("Reorder index is outside the visible element list.");
        const [moved] = elements.splice(elementIndex, 1);
        elements.splice(operation.index, 0, moved);
      } else {
        if (
          !validTransform(operation.transform)
          || (operation.kind && !["embedded", "lifted", "decoration"].includes(operation.kind))
          || (typeof operation.depth === "number" && (operation.depth < 0 || operation.depth > 0.5))
          || !validMotion(operation.motion)
          || !validFrameAssets(operation.frameAssetIds)
          || (operation.frameAssetIds?.length && isProceduralElement(element))
          || (operation.frameAssetIds?.length && operation.frameAssetIds[0] !== element.assetId)
          || (operation.hover && !HOVER_RESPONSES.includes(operation.hover))
          || (operation.focus && !FOCUS_RESPONSES.includes(operation.focus))
          || !validReveal(operation.reveal)
        ) return fail(`Update operation for ${element.label} is outside the scene limits.`);
        if (operation.kind) element.kind = operation.kind;
        if (operation.transform) element.transform = { ...element.transform, ...operation.transform };
        if (typeof operation.depth === "number") element.depth = operation.depth;
        if (typeof operation.locked === "boolean") element.locked = operation.locked;
        if (typeof operation.motion !== "undefined") {
          // An explicit motion write owns animation: drop the legacy
          // `interaction.motion` mirror so cleared motion cannot resurrect
          // and a replaced motion leaves no stale shadow.
          element.motion = operation.motion ?? undefined;
          element.interaction = stripLegacyInteractionMotion(element.interaction);
        }
        if (typeof operation.frameAssetIds !== "undefined") element.frameAssetIds = operation.frameAssetIds ?? undefined;
        if (operation.hover || operation.focus || operation.reveal) {
          const interaction = resolveInteraction(element);
          // Preserve a legacy `interaction.motion` fallback (some stored books
          // keep their only animation there), but never copy the resolved read
          // back: `element.motion` owns motion, and duplicating it here would
          // persist a stale copy that resurrects after the authoritative field
          // is cleared.
          const legacyMotion = element.interaction?.motion;
          element.interaction = {
            hover: operation.hover ?? interaction.hover,
            focus: operation.focus ?? interaction.focus,
            reveal: operation.reveal ? normalizeReveal(operation.reveal) : interaction.reveal,
            hint: interaction.hint,
            ...(legacyMotion ? { motion: legacyMotion } : {}),
          };
        }
        element.provenance = source;
      }
      changedIds.push(operation.elementId);
    }

    if (
      command.operations.some((operation) => operation.op === "set-background")
      && elements.filter((element) => !isProceduralElement(element)).length < 2
    ) {
      return fail("A clean background requires at least two extracted foreground image layers in the same finished scene.");
    }

    const newReferenceIssue = bookAssetReferenceFindings(bookAssetReferenceManifest(nextDocument))
      .find((issue) => !existingReferenceIssues.has(bookAssetReferenceIssueKey(issue)));
    if (newReferenceIssue) return fail(formatBookAssetReferenceIssue(newReferenceIssue));

    const creationBrief = this.qualityLifecycle()?.creationBrief;
    if (creationBrief?.bookType) {
      const policyIssues = creationAssetPolicyIssues(nextDocument, creationBrief);
      if (policyIssues.length > 0) return fail(policyIssues[0]);
    }
    const localAssetCount = listStoredPublishedAssetIds(nextDocument).length;
    if (localAssetCount > MAX_BOOK_PUBLISHABLE_ASSETS) {
      return fail(`This patch would raise the book to ${localAssetCount} local images, above the publishable limit of ${MAX_BOOK_PUBLISHABLE_ASSETS}.`);
    }

    nextDocument.revision += 1;
    this.documentState = nextDocument;
    if (this.sessionState.selectionId && !findElement(nextDocument, this.sessionState.selectionId)) {
      this.sessionState = { ...this.sessionState, selectionId: null };
    }
    const undoToken = crypto.randomUUID();
    const beforeElements = before.spreads[spreadIndex].elements;
    const afterElements = nextDocument.spreads[spreadIndex].elements;
    const beforeArtwork = before.spreads[spreadIndex].artwork;
    const afterArtwork = nextDocument.spreads[spreadIndex].artwork;
    const beforeById = new Map(beforeElements.map((element) => [element.id, element]));
    const afterById = new Map(afterElements.map((element) => [element.id, element]));
    // Provenance describes the latest operator, so a later non-overlapping
    // human edit must remain visible when an earlier Agent patch is undone.
    const mutableFields: ElementField[] = [
      "label",
      "kind",
      "assetId",
      "frameAssetIds",
      "page",
      "depth",
      "locked",
      "motion",
      "transform",
      "interaction",
    ];
    const elementDiffs = [...new Set([...beforeById.keys(), ...afterById.keys()])].flatMap((elementId): ScenePatchElementUndo[] => {
      const beforeElement = beforeById.get(elementId) ?? null;
      const afterElement = afterById.get(elementId) ?? null;
      if (!beforeElement || !afterElement) return [{ elementId, fields: [], before: clone(beforeElement), after: clone(afterElement) }];
      const fields = mutableFields.filter((field) => !equalField(beforeElement[field], afterElement[field]));
      return fields.length ? [{ elementId, fields, before: clone(beforeElement), after: clone(afterElement) }] : [];
    });
    this.undoRecords.set(undoToken, {
      operation: "scene-patch",
      token: undoToken,
      documentId: nextDocument.id,
      spreadId: command.spreadId,
      beforeOrder: beforeElements.map((element) => element.id),
      afterOrder: afterElements.map((element) => element.id),
      elements: elementDiffs,
      artwork: equalField(beforeArtwork, afterArtwork)
        ? undefined
        : { before: clone(beforeArtwork), after: clone(afterArtwork) },
    });
    const uniqueChangedIds = [...new Set(changedIds)];
    const summary = `${source === "agent" ? "Codex" : "You"} patched ${uniqueChangedIds.length} scene ${uniqueChangedIds.length === 1 ? "element" : "elements"}`;
    const result: MutationResult = { ok: true, revision: nextDocument.revision, changedIds: uniqueChangedIds, undoToken, summary };
    this.requestResults.set(command.requestId, result);
    this.persist();
    this.showAction(source, "success", summary, uniqueChangedIds.length === 1 ? uniqueChangedIds[0] : undefined, undoToken);
    return result;
  }

  private applyInteraction(element: BookElement, command: InteractCommand) {
    const current = element.interaction ?? defaultInteraction;
    return {
      ...current,
      hover: command.interaction.hover ?? current.hover,
      focus: command.interaction.focus ?? current.focus,
      reveal: command.interaction.revealKind
        ? { ...current.reveal, kind: command.interaction.revealKind }
        : current.reveal,
    };
  }

  private applyEdit(element: BookElement, command: EditCommand, source: CommandSource) {
    const nextTransform: Transform2D = command.transform
      ? { ...element.transform, ...command.transform }
      : element.transform;
    return {
      ...element,
      transform: nextTransform,
      depth: typeof command.depth === "number" ? Math.max(0, Math.min(0.5, command.depth)) : element.depth,
      locked: typeof command.locked === "boolean" ? command.locked : element.locked,
      provenance: source,
    };
  }

  private restoredDocumentIssue(candidate: DocumentState) {
    const elementIdCounts = (document: DocumentState) => document.spreads
      .flatMap((spread) => spread.elements.map((element) => element.id))
      .reduce((counts, elementId) => counts.set(elementId, (counts.get(elementId) ?? 0) + 1), new Map<string, number>());
    const currentElementIdCounts = elementIdCounts(this.documentState);
    const worsenedDuplicate = [...elementIdCounts(candidate)].some(([elementId, count]) => (
      count > 1 && count > (currentElementIdCounts.get(elementId) ?? 0)
    ));
    if (worsenedDuplicate) {
      return "Undo would duplicate a foreground layer id across the book.";
    }
    const currentReferenceIssues = new Set(
      bookAssetReferenceFindings(bookAssetReferenceManifest(this.documentState)).map(bookAssetReferenceIssueKey),
    );
    const newReferenceIssue = bookAssetReferenceFindings(bookAssetReferenceManifest(candidate))
      .find((issue) => !currentReferenceIssues.has(bookAssetReferenceIssueKey(issue)));
    if (newReferenceIssue) return formatBookAssetReferenceIssue(newReferenceIssue);
    const creationBrief = this.qualityLifecycle(candidate.id)?.creationBrief;
    if (creationBrief?.bookType) {
      const policyIssue = creationAssetPolicyIssues(candidate, creationBrief)[0];
      if (policyIssue) return policyIssue;
    }
    const localAssetCount = listStoredPublishedAssetIds(candidate).length;
    if (localAssetCount > MAX_BOOK_PUBLISHABLE_ASSETS) {
      return `Undo would raise this book to ${localAssetCount} local images, above the publishable limit of ${MAX_BOOK_PUBLISHABLE_ASSETS}.`;
    }
    return null;
  }

  private applyUndo(command: Extract<DocumentCommand, { type: "undo" }>, source: CommandSource): DocumentResult {
    const record = this.undoRecords.get(command.undoToken);
    if (!record) {
      return this.failCommand(command.requestId, source, "not_found", "That undo token is no longer available.");
    }
    if (record.documentId !== this.documentState.id) {
      return this.failCommand(command.requestId, source, "undo_conflict", "That undo belongs to another book; the active book was not changed.");
    }
    if (record.operation === "create-book") return this.applyCreateBookUndo(command, record, source);
    if (record.operation === "set-cover") return this.applyBookCoverUndo(command, record, source);
    if (record.operation === "scene-patch") return this.applyScenePatchUndo(command, record, source);
    if (record.operation === "compose") return this.applyComposeSpreadUndo(command, record, source);
    const location = findElement(this.documentState, record.elementId);
    if (!location) return this.conflict("not_found", `Element ${record.elementId} was not found.`);
    const current = this.documentState.spreads[location.spreadIndex].elements[location.elementIndex];
    const conflictField = record.fields.find((field) => !equalField(current[field], record.after[field]));
    if (conflictField) {
      return this.failCommand(command.requestId, source, "undo_conflict", `${current.label} changed again in ${conflictField}; undo did not overwrite the newer edit.`, current.id);
    }
    const restored = clone(current);
    record.fields.forEach((field) => {
      (restored as unknown as Record<string, unknown>)[field] = clone(record.before[field]);
    });
    const nextDocument = clone(this.documentState);
    nextDocument.spreads[location.spreadIndex].elements[location.elementIndex] = restored;
    nextDocument.revision += 1;
    this.documentState = nextDocument;
    this.undoRecords.delete(command.undoToken);
    const token = crypto.randomUUID();
    this.undoRecords.set(token, {
      operation: "update",
      token,
      documentId: nextDocument.id,
      elementId: restored.id,
      fields: record.fields,
      before: Object.fromEntries(record.fields.map((field) => [field, clone(current[field])])) as Partial<BookElement>,
      after: Object.fromEntries(record.fields.map((field) => [field, clone(restored[field])])) as Partial<BookElement>,
    });
    const summary = `${source === "agent" ? "Codex" : "You"} undid a change to ${restored.label}`;
    const result: MutationResult = { ok: true, revision: nextDocument.revision, changedIds: [restored.id], undoToken: token, summary };
    this.requestResults.set(command.requestId, result);
    this.persist();
    this.showAction(source, "success", summary, restored.id, token);
    return result;
  }

  private applyScenePatchUndo(
    command: Extract<DocumentCommand, { type: "undo" }>,
    record: ScenePatchUndoRecord,
    source: CommandSource,
  ): DocumentResult {
    const spreadIndex = this.documentState.spreads.findIndex((spread) => spread.id === record.spreadId);
    if (spreadIndex < 0) return this.conflict("not_found", `Spread ${record.spreadId} was not found.`);
    const currentElements = this.documentState.spreads[spreadIndex].elements;
    const currentArtwork = this.documentState.spreads[spreadIndex].artwork;
    const currentById = new Map(currentElements.map((element) => [element.id, element]));
    const structureChanged = !equalField(record.beforeOrder, record.afterOrder)
      || record.elements.some((change) => !change.before || !change.after);
    if (structureChanged && !equalField(currentElements.map((element) => element.id), record.afterOrder)) {
      return this.failCommand(command.requestId, source, "undo_conflict", "The scene structure changed again; undo did not overwrite newer work.");
    }
    if (record.artwork && !equalField(currentArtwork, record.artwork.after)) {
      return this.failCommand(command.requestId, source, "undo_conflict", "The clean background changed again; undo preserved the newer artwork.");
    }

    for (const change of record.elements) {
      const current = currentById.get(change.elementId) ?? null;
      if (!change.before) {
        if (!current || !equalField(current, change.after)) {
          return this.failCommand(command.requestId, source, "undo_conflict", `Added element ${change.elementId} changed again; undo did not remove it.`, change.elementId);
        }
      } else if (!change.after) {
        if (current) {
          return this.failCommand(command.requestId, source, "undo_conflict", `Removed element ${change.elementId} was recreated; undo did not replace it.`, change.elementId);
        }
      } else {
        if (!current) return this.conflict("not_found", `Element ${change.elementId} was not found.`);
        const conflictField = change.fields.find((field) => !equalField(current[field], change.after?.[field]));
        if (conflictField) {
          return this.failCommand(command.requestId, source, "undo_conflict", `${current.label} changed again in ${conflictField}; undo preserved the newer edit.`, current.id);
        }
      }
    }

    const nextDocument = clone(this.documentState);
    const nextSpread = nextDocument.spreads[spreadIndex];
    const nextById = new Map(nextSpread.elements.map((element) => [element.id, element]));
    record.elements.forEach((change) => {
      if (!change.before) nextById.delete(change.elementId);
      else if (!change.after) nextById.set(change.elementId, clone(change.before));
      else {
        const target = nextById.get(change.elementId)!;
        change.fields.forEach((field) => {
          (target as unknown as Record<string, unknown>)[field] = clone(change.before?.[field]);
        });
      }
    });
    if (structureChanged) nextSpread.elements = record.beforeOrder.map((id) => nextById.get(id)).filter((element): element is BookElement => Boolean(element));
    else nextSpread.elements = nextSpread.elements.map((element) => nextById.get(element.id) ?? element);
    if (record.artwork?.before) nextSpread.artwork = clone(record.artwork.before);
    else if (record.artwork) delete nextSpread.artwork;
    const contractIssue = this.restoredDocumentIssue(nextDocument);
    if (contractIssue) {
      return this.failCommand(command.requestId, source, "undo_conflict", contractIssue);
    }
    nextDocument.revision += 1;
    this.documentState = nextDocument;
    if (this.sessionState.selectionId && !findElement(nextDocument, this.sessionState.selectionId)) this.sessionState = { ...this.sessionState, selectionId: null };
    this.undoRecords.delete(record.token);
    const token = crypto.randomUUID();
    this.undoRecords.set(token, {
      operation: "scene-patch",
      token,
      documentId: nextDocument.id,
      spreadId: record.spreadId,
      beforeOrder: record.afterOrder,
      afterOrder: record.beforeOrder,
      elements: record.elements.map((change) => ({
        elementId: change.elementId,
        fields: change.fields,
        before: clone(change.after),
        after: clone(change.before),
      })),
      artwork: record.artwork
        ? { before: clone(record.artwork.after), after: clone(record.artwork.before) }
        : undefined,
    });
    const changedIds = [
      ...record.elements.map((change) => change.elementId),
      ...(record.artwork ? [`${record.spreadId}:background`] : []),
    ];
    const summary = `${source === "agent" ? "Codex" : "You"} undid a scene patch`;
    const result: MutationResult = { ok: true, revision: nextDocument.revision, changedIds, undoToken: token, summary };
    this.requestResults.set(command.requestId, result);
    this.persist();
    this.showAction(source, "success", summary, changedIds.length === 1 ? changedIds[0] : undefined, token);
    return result;
  }

  private applyBookCoverUndo(
    command: Extract<DocumentCommand, { type: "undo" }>,
    record: BookCoverUndoRecord,
    source: CommandSource,
  ): DocumentResult {
    if (this.documentState.coverAssetId !== record.after) {
      return this.failCommand(command.requestId, source, "undo_conflict", "The book cover changed again; undo preserved the newer cover.");
    }

    const nextDocument = clone(this.documentState);
    if (record.before) nextDocument.coverAssetId = record.before;
    else delete nextDocument.coverAssetId;
    const contractIssue = this.restoredDocumentIssue(nextDocument);
    if (contractIssue) {
      return this.failCommand(command.requestId, source, "undo_conflict", contractIssue);
    }
    nextDocument.revision += 1;
    this.documentState = nextDocument;
    this.undoRecords.delete(record.token);

    const token = crypto.randomUUID();
    this.undoRecords.set(token, {
      operation: "set-cover",
      token,
      documentId: nextDocument.id,
      before: record.after,
      after: record.before,
    });
    const summary = `${source === "agent" ? "Codex" : "You"} restored the previous cover for ${nextDocument.title}`;
    const result: MutationResult = {
      ok: true,
      revision: nextDocument.revision,
      changedIds: [nextDocument.id],
      undoToken: token,
      summary,
    };
    this.requestResults.set(command.requestId, result);
    this.persist();
    this.showAction(source, "success", summary, undefined, token);
    return result;
  }

  private applyCreateBookUndo(
    command: Extract<DocumentCommand, { type: "undo" }>,
    record: CreateBookUndoRecord,
    source: CommandSource,
  ): DocumentResult {
    const expected = record.direction === "undo" ? record.created : record.previous;
    if (!equalField(this.documentState, expected)) {
      return this.failCommand(command.requestId, source, "undo_conflict", "The active book changed again; undo did not replace newer work.");
    }

    let previousForReverse = clone(record.previous);
    let createdIndexForUndo = -1;
    let next: DocumentState;
    const reject = (code: "undo_conflict" | "invalid", summary: string) =>
      this.failCommand(command.requestId, source, code, summary);

    const durableLibrary = readLibraryForLifecycleMutation(this.libraryState);
    if (!durableLibrary) {
      return reject("invalid", "Apertale did not change book creation because its saved library could not be read safely.");
    }
    if (record.direction === "undo") {
      const currentCreated = durableLibrary.documents.find((book) => book.id === record.created.id);
      if (!currentCreated || !equalField(currentCreated, record.created)) {
        return reject("undo_conflict", "The created library book changed again; undo did not remove newer work.");
      }
      const currentPrevious = durableLibrary.documents.find((book) => book.id === record.previous.id);
      if (!currentPrevious) {
        return reject("undo_conflict", "The previous book is no longer in the library; creation undo preserved the current book.");
      }
      if (getPublicationRecord(record.created.id)) {
        return reject("undo_conflict", "Remove this book's publication record before undoing its creation.");
      }
      createdIndexForUndo = durableLibrary.documents.findIndex((book) => book.id === record.created.id);
      previousForReverse = clone(currentPrevious);
      next = clone(currentPrevious);
    } else {
      if (durableLibrary.documents.some((book) => book.id === record.created.id)) {
        return reject("undo_conflict", `Book ${record.created.id} already exists; redo did not replace it.`);
      }
      const durableCurrent = durableLibrary.documents.find((book) => book.id === this.documentState.id);
      if (!durableCurrent || !equalField(durableCurrent, this.documentState)) {
        return reject("undo_conflict", "The saved library changed in another tab; redo preserved the newer work.");
      }
      next = clone(record.created);
    }
    this.libraryState = durableLibrary;
    const beforeDocument = clone(this.documentState);
    const beforeLibrary = clone(this.libraryState);
    const beforeSession = clone(this.sessionState);
    const beforeUndoRecords = new BoundedMap(
      UNDO_RECORD_LIMIT,
      [...this.undoRecords].map(([token, undoRecord]) => [token, clone(undoRecord)] as const),
    );
    const beforeRequestResults = new BoundedMap(REQUEST_RESULT_LIMIT, [...this.requestResults]);
    const rollback = () => {
      this.documentState = beforeDocument;
      this.libraryState = beforeLibrary;
      this.sessionState = beforeSession;
      this.undoRecords = beforeUndoRecords;
      this.requestResults = beforeRequestResults;
    };
    const previousQuality = this.qualityLifecycle(record.previous.id);
    const createdQuality = this.qualityLifecycle(record.created.id);

    if (record.direction === "undo") {
      this.libraryState.documents.splice(createdIndexForUndo, 1);
      delete this.qualityLifecycles()[record.created.id];
      if (!previousQuality && record.previousQuality) {
        this.qualityLifecycles()[record.previous.id] = clone(record.previousQuality);
      }
    } else {
      this.qualityLifecycles()[record.created.id] = clone(record.createdQuality);
    }

    this.documentState = next;
    this.sessionState = { ...this.sessionState, currentSpreadIndex: 0, selectionId: null };
    this.undoRecords.delete(record.token);
    const token = crypto.randomUUID();
    this.undoRecords.set(token, {
      operation: "create-book",
      token,
      documentId: next.id,
      direction: record.direction === "undo" ? "redo" : "undo",
      previous: previousForReverse,
      created: clone(record.created),
      previousQuality: previousQuality ? clone(previousQuality) : record.previousQuality ? clone(record.previousQuality) : undefined,
      createdQuality: createdQuality ? clone(createdQuality) : clone(record.createdQuality),
    });
    const verb = record.direction === "undo" ? "removed the new book and restored" : "recreated";
    const summary = `${source === "agent" ? "Codex" : "You"} ${verb} ${next.title}`;
    const result: MutationResult = {
      ok: true,
      revision: next.revision,
      changedIds: next.spreads.map((spread) => spread.id),
      undoToken: token,
      summary,
    };
    if (
      record.direction === "undo"
      && getPublicationRecord(record.created.id)
    ) {
      rollback();
      return reject("undo_conflict", "Publishing began; creation undo preserved the book.");
    }
    if (!this.persist(true)) {
      rollback();
      const attemptedAction = record.direction === "undo" ? "undo book creation" : "redo book creation";
      return this.failCommand(command.requestId, source, "invalid", `Apertale did not ${attemptedAction} because this browser could not save it.`);
    }
    if (
      record.direction === "undo"
      && getPublicationRecord(record.created.id)
    ) {
      rollback();
      const restored = this.persist(true);
      return this.failCommand(command.requestId, source, "undo_conflict", restored
        ? "Publishing began in another tab; creation undo restored the book instead of orphaning its share."
        : "Publishing began in another tab, and this browser could not safely restore the book.");
    }
    const committedLibrary = readLibraryForLifecycleMutation(this.libraryState);
    const committed = record.direction === "undo"
      ? Boolean(
          committedLibrary
          && !committedLibrary.documents.some((book) => book.id === record.created.id)
          && equalField(committedLibrary.documents.find((book) => book.id === next.id), next),
        )
      : Boolean(
          committedLibrary
          && equalField(committedLibrary.documents.find((book) => book.id === record.created.id), next),
        );
    if (!committed) {
      rollback();
      return this.failCommand(command.requestId, source, "invalid", "Apertale could not verify the saved book lifecycle change.");
    }
    this.requestResults.set(command.requestId, result);
    this.showAction(source, "success", summary, undefined, token);
    return result;
  }

  private applyComposeSpreadUndo(
    command: Extract<DocumentCommand, { type: "undo" }>,
    record: ComposeSpreadUndoRecord,
    source: CommandSource,
  ): DocumentResult {
    const spreadIndex = this.documentState.spreads.findIndex((spread) => spread.id === record.spreadId);
    if (spreadIndex < 0) return this.conflict("not_found", `Spread ${record.spreadId} was not found.`);
    const currentSpread = this.documentState.spreads[spreadIndex];
    const conflictField = record.fields.find((field) => !equalField(currentSpread[field], record.after[field]));
    if (conflictField) {
      return this.failCommand(command.requestId, source, "undo_conflict", `${currentSpread.title} changed again in ${conflictField}; undo preserved the newer edit.`);
    }

    const nextDocument = clone(this.documentState);
    const restoredSpread = nextDocument.spreads[spreadIndex];
    record.fields.forEach((field) => {
      (restoredSpread as unknown as Record<string, unknown>)[field] = clone(record.before[field]);
    });
    nextDocument.revision += 1;
    this.documentState = nextDocument;
    this.undoRecords.delete(record.token);
    const token = crypto.randomUUID();
    this.undoRecords.set(token, {
      operation: "compose",
      token,
      documentId: nextDocument.id,
      spreadId: record.spreadId,
      fields: record.fields,
      before: Object.fromEntries(record.fields.map((field) => [field, clone(currentSpread[field])])) as Partial<Pick<Spread, SpreadField>>,
      after: Object.fromEntries(record.fields.map((field) => [field, clone(restoredSpread[field])])) as Partial<Pick<Spread, SpreadField>>,
    });
    const summary = `${source === "agent" ? "Codex" : "You"} undid composition on ${restoredSpread.title}`;
    const result: MutationResult = {
      ok: true,
      revision: nextDocument.revision,
      changedIds: [restoredSpread.id],
      undoToken: token,
      summary,
    };
    this.requestResults.set(command.requestId, result);
    this.persist();
    this.showAction(source, "success", summary, undefined, token);
    return result;
  }

}

export const bookEngine = new BookEngine();

export function humanEdit(elementId: string, transform: Partial<Transform2D>) {
  const snapshot = bookEngine.getSnapshot();
  return bookEngine.dispatchCoordinated({ type: "edit", requestId: freshRequestId(), expectedDocumentId: snapshot.document.id, expectedRevision: snapshot.document.revision, elementId, transform }, "human");
}

export function humanAnimate(elementId: string, motion: AnimateCommand["motion"]) {
  const snapshot = bookEngine.getSnapshot();
  return bookEngine.dispatchCoordinated({ type: "animate", requestId: freshRequestId(), expectedDocumentId: snapshot.document.id, expectedRevision: snapshot.document.revision, elementId, motion }, "human");
}

export function humanInteract(elementId: string, interaction: InteractCommand["interaction"]) {
  const snapshot = bookEngine.getSnapshot();
  return bookEngine.dispatchCoordinated({ type: "interact", requestId: freshRequestId(), expectedDocumentId: snapshot.document.id, expectedRevision: snapshot.document.revision, elementId, interaction }, "human");
}
