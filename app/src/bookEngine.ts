import { initialDocument, initialSession, sampleBooks } from "./sampleBook";
import { recordDiagnostic } from "./diagnostics";
import { defaultInteraction, FOCUS_RESPONSES, HOVER_RESPONSES, REVEAL_KINDS, resolveInteraction } from "./interaction";
import type {
  AnimateCommand,
  AddElementCommand,
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
  MotionSpec,
  MutationResult,
  QualityTier,
  RevealSpec,
  ScenePatchCommand,
  SessionState,
  Spread,
  ThemeId,
  Transform2D,
  VisibleAction,
} from "./types";

const STORAGE_KEY = "apertale.library.v4";

type ElementField = "kind" | "depth" | "locked" | "motion" | "transform" | "interaction" | "provenance";

type ElementUndoRecord = {
  operation: "update";
  token: string;
  elementId: string;
  fields: ElementField[];
  before: Partial<BookElement>;
  after: Partial<BookElement>;
};

type AddUndoRecord = {
  operation: "add";
  token: string;
  spreadId: string;
  elementId: string;
  after: BookElement;
};

type RemoveUndoRecord = {
  operation: "remove";
  token: string;
  spreadId: string;
  elementId: string;
  before: BookElement;
  index: number;
};

type SpreadField = "title" | "body" | "kicker";

type ComposeSpreadUndoRecord = {
  operation: "compose";
  token: string;
  spreadId: string;
  fields: SpreadField[];
  before: Partial<Pick<Spread, SpreadField>>;
  after: Partial<Pick<Spread, SpreadField>>;
};

type CreateBookUndoRecord = {
  operation: "create-book";
  token: string;
  direction: "undo" | "redo";
  previous: DocumentState;
  created: DocumentState;
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
  spreadId: string;
  beforeOrder: string[];
  afterOrder: string[];
  elements: ScenePatchElementUndo[];
};

type UndoRecord = ElementUndoRecord | AddUndoRecord | RemoveUndoRecord | ComposeSpreadUndoRecord | CreateBookUndoRecord | ScenePatchUndoRecord;

const clone = <T,>(value: T): T => structuredClone(value);

const freshRequestId = () => crypto.randomUUID();

type StoredLibrary = {
  activeBookId: string;
  documents: DocumentState[];
};

function validDocument(parsed: DocumentState) {
  return typeof parsed.id === "string"
    && typeof parsed.title === "string"
    && Number.isInteger(parsed.revision)
    && parsed.revision >= 1
    && Array.isArray(parsed.spreads)
    && parsed.spreads.length >= 1
    && parsed.spreads.length <= 12
    && parsed.spreads.every((spread, order) => (
      typeof spread.id === "string"
      && typeof spread.title === "string"
      && typeof spread.body === "string"
      && spread.order === order
      && Array.isArray(spread.elements)
    ));
}

function defaultLibrary(): StoredLibrary {
  return { activeBookId: initialDocument.id, documents: clone(sampleBooks) };
}

function loadLibrary(): StoredLibrary {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLibrary();
    const parsed = JSON.parse(raw) as StoredLibrary;
    if (!Array.isArray(parsed.documents) || !parsed.documents.every(validDocument)) return defaultLibrary();
    const documents = clone(parsed.documents);
    sampleBooks.forEach((sample) => {
      const storedSample = documents.find((book) => book.id === sample.id);
      if (!storedSample) {
        documents.push(clone(sample));
        return;
      }
      storedSample.coverTextureUrl = sample.coverTextureUrl;
      sample.spreads.forEach((spread) => {
        if (!storedSample.spreads.some((storedSpread) => storedSpread.id === spread.id)) storedSample.spreads.push(clone(spread));
      });
      storedSample.spreads.forEach((spread, order) => { spread.order = order; });
    });
    const activeBookId = documents.some((book) => book.id === parsed.activeBookId) ? parsed.activeBookId : documents[0]?.id;
    if (!activeBookId) return defaultLibrary();
    return { activeBookId, documents };
  } catch {
    return defaultLibrary();
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

export class BookEngine {
  private libraryState = loadLibrary();
  private documentState = clone(this.libraryState.documents.find((book) => book.id === this.libraryState.activeBookId) ?? initialDocument);
  private sessionState = clone(initialSession);
  private lastAction: VisibleAction | null = null;
  private listeners = new Set<() => void>();
  private requestResults = new Map<string, DocumentResult>();
  private undoRecords = new Map<string, UndoRecord>();
  private snapshot: BookSnapshot = this.makeSnapshot();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

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

  private persist() {
    try {
      const documentIndex = this.libraryState.documents.findIndex((book) => book.id === this.documentState.id);
      if (documentIndex >= 0) this.libraryState.documents[documentIndex] = clone(this.documentState);
      else this.libraryState.documents.push(clone(this.documentState));
      this.libraryState.activeBookId = this.documentState.id;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.libraryState));
    } catch {
      // Storage is a progressive enhancement; the live document remains usable.
    }
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
      book: { id: this.documentState.id, title: this.documentState.title, revision: this.documentState.revision },
      library: {
        activeBookId: this.documentState.id,
        books: this.libraryState.documents.map((book) => ({ id: book.id, title: book.title, spreadCount: book.spreads.length })),
      },
      outline: this.documentState.spreads.map((item) => ({
        id: item.id,
        title: item.title,
        order: item.order + 1,
        elementIds: item.elements.map((element) => element.id),
      })),
      currentSpread: {
        id: spread.id,
        title: spread.title,
        order: spread.order + 1,
        elements: spread.elements.map((element) => ({
          id: element.id,
          label: element.label,
          kind: element.kind,
          assetId: element.assetId,
          locked: element.locked,
        })),
      },
      selection: selected
        ? {
            id: selected.id,
            label: selected.label,
            kind: selected.kind,
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
      capabilities: ["create-book", "compose-spread", "cross-book-local-assets", "lift-structured-element", "edit-transform", "named-motion", "structured-reveal", "set-interaction", "theme", "undo"],
    };
  }

  getLibrary() {
    return {
      activeBookId: this.documentState.id,
      books: this.libraryState.documents.map((book) => ({
        id: book.id,
        title: book.title,
        spreadCount: book.spreads.length,
        coverTextureUrl: book.coverTextureUrl ?? book.spreads[0]?.textureUrl ?? "/assets/generated/day-background.png",
        firstSpreadTitle: book.spreads[0]?.title ?? "Untitled spread",
        sample: sampleBooks.some((sample) => sample.id === book.id),
      })),
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
    this.requestResults.clear();
    this.undoRecords.clear();
    this.persist();
    this.showAction(source, "success", `${source === "agent" ? "ChatGPT opened" : "Opened"} ${nextDocument.title}`);
    return true;
  }

  setSelection(elementId: string | null) {
    this.sessionState = { ...this.sessionState, selectionId: elementId };
    this.emit();
  }

  setSpread(index: number) {
    const next = Math.max(0, Math.min(this.documentState.spreads.length - 1, index));
    this.sessionState = { ...this.sessionState, currentSpreadIndex: next, selectionId: null };
    this.emit();
  }

  setTheme(theme: ThemeId, source: CommandSource = "human") {
    this.sessionState = { ...this.sessionState, sceneThemeId: theme };
    this.showAction(source, "success", `${source === "agent" ? "ChatGPT switched" : "Switched"} to ${theme === "paper-atelier" ? "Day" : "Night"}`);
    return { ok: true as const, theme, summary: `Scene theme is now ${theme}.` };
  }

  setQuality(quality: QualityTier) {
    if (this.sessionState.quality === quality) return;
    this.sessionState = { ...this.sessionState, quality };
    this.emit();
  }

  setPreview(preview: boolean, source?: CommandSource) {
    this.sessionState = { ...this.sessionState, preview, selectionId: preview ? null : this.sessionState.selectionId };
    if (source) this.showAction(source, "success", `${source === "agent" ? "ChatGPT " : ""}${preview ? "entered" : "exited"} Preview`);
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

  dispatch(command: DocumentCommand, source: CommandSource): DocumentResult {
    const prior = this.requestResults.get(command.requestId);
    if (prior) return prior;

    if (command.expectedRevision !== this.documentState.revision) {
      const result = this.conflict("revision_conflict", `Expected revision ${command.expectedRevision}; current revision is ${this.documentState.revision}.`);
      this.requestResults.set(command.requestId, result);
      return result;
    }

    this.showAction(source, "pending", `${source === "agent" ? "ChatGPT is working" : "Applying change"}…`, "elementId" in command ? command.elementId : undefined);

    if (command.type === "undo") return this.applyUndo(command, source);

    if (command.type === "create-book") return this.applyCreateBook(command, source);

    if (command.type === "compose-spread") return this.applyComposeSpread(command, source);

    if (command.type === "scene-patch") return this.applyScenePatch(command, source);

    if (command.type === "add") return this.applyAdd(command, source);

    const location = findElement(this.documentState, command.elementId);
    if (!location) {
      const result = this.conflict("not_found", `Element ${command.elementId} was not found.`);
      this.requestResults.set(command.requestId, result);
      this.showAction(source, "error", result.summary);
      return result;
    }

    const currentElement = this.documentState.spreads[location.spreadIndex].elements[location.elementIndex];
    if (currentElement.locked && command.type !== "edit") {
      const result = this.conflict("locked", `${currentElement.label} is locked.`);
      this.requestResults.set(command.requestId, result);
      this.showAction(source, "error", result.summary, currentElement.id);
      return result;
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
      nextElement = { ...nextElement, motion: command.motion ?? undefined, provenance: source };
      fields = ["motion"];
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
      elementId: nextElement.id,
      fields,
      before: Object.fromEntries(fields.map((field) => [field, clone(before[field])])) as Partial<BookElement>,
      after: Object.fromEntries(fields.map((field) => [field, clone(nextElement[field])])) as Partial<BookElement>,
    });

    const summary = `${source === "agent" ? "ChatGPT" : "You"} ${verb} ${nextElement.label}`;
    const result: MutationResult = { ok: true, revision: nextDocument.revision, changedIds: [nextElement.id], undoToken, summary };
    this.requestResults.set(command.requestId, result);
    this.persist();
    this.showAction(source, "success", summary, nextElement.id, undoToken);
    return result;
  }

  private applyAdd(command: AddElementCommand, source: CommandSource): DocumentResult {
    const spreadIndex = this.documentState.spreads.findIndex((spread) => spread.id === command.spreadId);
    const currentSpread = this.documentState.spreads[this.sessionState.currentSpreadIndex];
    if (spreadIndex < 0 || currentSpread.id !== command.spreadId) {
      const result = this.conflict("invalid", "New elements can only be added to the visible spread.");
      this.requestResults.set(command.requestId, result);
      this.showAction(source, "error", result.summary);
      return result;
    }
    if (findElement(this.documentState, command.element.id)) {
      const result = this.conflict("invalid", `Element ${command.element.id} already exists.`);
      this.requestResults.set(command.requestId, result);
      this.showAction(source, "error", result.summary);
      return result;
    }
    const validLocalAsset = /^asset:[0-9a-f-]{36}$/.test(command.element.assetId);
    const validLegacyDataAsset = command.element.assetId.startsWith("data:image/") && command.element.assetId.length <= 2_100_000;
    if (!validLocalAsset && !validLegacyDataAsset) {
      const result = this.conflict("invalid", "Imported elements require a validated local image asset.");
      this.requestResults.set(command.requestId, result);
      this.showAction(source, "error", result.summary);
      return result;
    }

    const element = clone(command.element);
    const nextDocument = clone(this.documentState);
    nextDocument.spreads[spreadIndex].elements.push(element);
    nextDocument.revision += 1;
    this.documentState = nextDocument;

    const undoToken = crypto.randomUUID();
    this.undoRecords.set(undoToken, {
      operation: "add",
      token: undoToken,
      spreadId: command.spreadId,
      elementId: element.id,
      after: clone(element),
    });
    const summary = `${source === "agent" ? "ChatGPT" : "You"} added ${element.label}`;
    const result: MutationResult = { ok: true, revision: nextDocument.revision, changedIds: [element.id], undoToken, summary };
    this.requestResults.set(command.requestId, result);
    this.sessionState = { ...this.sessionState, selectionId: element.id };
    this.persist();
    this.showAction(source, "success", summary, element.id, undoToken);
    return result;
  }

  private applyCreateBook(command: CreateBookCommand, source: CommandSource): DocumentResult {
    const title = command.title.trim();
    const validSpreads = command.spreads.length >= 1
      && command.spreads.length <= 12
      && new Set(command.spreads.map((spread) => spread.id)).size === command.spreads.length
      && command.spreads.every((spread) => (
        /^[a-z0-9][a-z0-9-]{0,63}$/.test(spread.id)
        && spread.title.trim().length >= 1
        && spread.title.trim().length <= 100
        && spread.body.trim().length <= 800
        && (typeof spread.kicker === "undefined" || spread.kicker.trim().length <= 100)
      ));
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(command.documentId) || title.length < 1 || title.length > 100 || !validSpreads) {
      const result = this.conflict("invalid", "Book title, id, or spread plan is outside the supported authoring limits.");
      this.requestResults.set(command.requestId, result);
      this.showAction(source, "error", result.summary);
      return result;
    }
    if (this.libraryState.documents.some((book) => book.id === command.documentId)) {
      const result = this.conflict("invalid", `Book ${command.documentId} already exists. Open it or choose a new id.`);
      this.requestResults.set(command.requestId, result);
      this.showAction(source, "error", result.summary);
      return result;
    }

    const before = clone(this.documentState);
    const nextDocument: DocumentState = {
      id: command.documentId,
      revision: before.revision + 1,
      title,
      spreads: command.spreads.map((spread, order) => ({
        id: spread.id,
        order,
        title: spread.title.trim(),
        body: spread.body.trim(),
        kicker: spread.kicker?.trim() || undefined,
        elements: [],
      })),
    };
    this.documentState = nextDocument;
    this.sessionState = { ...this.sessionState, currentSpreadIndex: 0, selectionId: null };
    const undoToken = crypto.randomUUID();
    this.undoRecords.set(undoToken, {
      operation: "create-book",
      token: undoToken,
      direction: "undo",
      previous: before,
      created: clone(nextDocument),
    });
    const summary = `${source === "agent" ? "ChatGPT" : "You"} created ${title}`;
    const result: MutationResult = {
      ok: true,
      revision: nextDocument.revision,
      changedIds: nextDocument.spreads.map((spread) => spread.id),
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
      const result = this.conflict("not_found", `Spread ${command.spreadId} was not found.`);
      this.requestResults.set(command.requestId, result);
      this.showAction(source, "error", result.summary);
      return result;
    }
    const hasChange = [command.title, command.body, command.kicker].some((value) => typeof value !== "undefined");
    const valid = hasChange
      && (typeof command.title === "undefined" || (command.title.trim().length >= 1 && command.title.trim().length <= 100))
      && (typeof command.body === "undefined" || command.body.trim().length <= 800)
      && (typeof command.kicker === "undefined" || command.kicker.trim().length <= 100);
    if (!valid) {
      const result = this.conflict("invalid", "Compose spread requires at least one bounded text field.");
      this.requestResults.set(command.requestId, result);
      this.showAction(source, "error", result.summary);
      return result;
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
    this.undoRecords.set(undoToken, { operation: "compose", token: undoToken, spreadId: spread.id, fields, before, after });
    const summary = `${source === "agent" ? "ChatGPT" : "You"} composed ${spread.title}`;
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
      const result = this.conflict("invalid", "Scene patches require 1–24 operations on the visible spread.");
      this.requestResults.set(command.requestId, result);
      this.showAction(source, "error", result.summary);
      return result;
    }

    const before = clone(this.documentState);
    const nextDocument = clone(this.documentState);
    const elements = nextDocument.spreads[spreadIndex].elements;
    const knownAssetIds = new Set(this.documentState.spreads.flatMap((spread) => spread.elements.map((element) => element.assetId)));
    const validatedLocalAssetIds = new Set(command.validatedLocalAssetIds ?? []);
    const changedIds: string[] = [];
    const fail = (summary: string) => {
      const result = this.conflict("invalid", summary);
      this.requestResults.set(command.requestId, result);
      this.showAction(source, "error", result.summary);
      return result;
    };
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
      || (["gentle-float", "fly-across", "soft-pulse", "slow-orbit"].includes(motion.preset)
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

    for (const operation of command.operations) {
      if (operation.op === "add") {
        const validModelIds = ["flavian-amphitheatre", "great-pyramid", "volcano-cross-section"];
        const validModel = Boolean(operation.modelId)
          && validModelIds.includes(operation.modelId ?? "")
          && operation.assetId === `model:${operation.modelId}`;
        const validStoredAsset = /^asset:[0-9a-f-]{36}$/.test(operation.assetId) && validatedLocalAssetIds.has(operation.assetId);
        const validAsset = operation.assetId.startsWith("model:") || operation.modelId
          ? validModel
          : knownAssetIds.has(operation.assetId) || validStoredAsset;
        if (
          elements.length >= 24
          || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(operation.id)
          || operation.label.trim().length < 1
          || operation.label.trim().length > 64
          || elements.some((element) => element.id === operation.id)
          || !["left", "right"].includes(operation.page)
          || (operation.kind && !["embedded", "lifted", "decoration"].includes(operation.kind))
          || !validAsset
          || !validTransform(operation.transform)
          || (typeof operation.depth === "number" && (operation.depth < 0 || operation.depth > 0.5))
          || !validMotion(operation.motion)
          || (operation.hover && !HOVER_RESPONSES.includes(operation.hover))
          || (operation.focus && !FOCUS_RESPONSES.includes(operation.focus))
          || !validReveal(operation.reveal)
        ) return fail(`Add operation for ${operation.id || "element"} is outside the scene limits.`);
        const transform = { x: 0.5, y: 0.5, scaleX: 0.72, scaleY: 0.72, rotationDeg: 0, ...operation.transform };
        elements.push({
          id: operation.id,
          label: operation.label.trim(),
          assetId: operation.assetId,
          modelId: operation.modelId,
          page: operation.page,
          kind: operation.kind ?? "lifted",
          transform,
          depth: operation.depth ?? 0.1,
          locked: operation.locked ?? false,
          motion: operation.motion,
          interaction: {
            hover: operation.hover ?? defaultInteraction.hover,
            focus: operation.focus ?? defaultInteraction.focus,
            reveal: operation.reveal
              ? normalizeReveal(operation.reveal)
              : { kind: "caption", title: operation.label.trim(), summary: "", facts: [] },
            hint: `Explore ${operation.label.trim()}`,
          },
          provenance: source,
        });
        knownAssetIds.add(operation.assetId);
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
          || (operation.hover && !HOVER_RESPONSES.includes(operation.hover))
          || (operation.focus && !FOCUS_RESPONSES.includes(operation.focus))
          || !validReveal(operation.reveal)
        ) return fail(`Update operation for ${element.label} is outside the scene limits.`);
        if (operation.kind) element.kind = operation.kind;
        if (operation.transform) element.transform = { ...element.transform, ...operation.transform };
        if (typeof operation.depth === "number") element.depth = operation.depth;
        if (typeof operation.locked === "boolean") element.locked = operation.locked;
        if (typeof operation.motion !== "undefined") element.motion = operation.motion ?? undefined;
        if (operation.hover || operation.focus || operation.reveal) {
          const interaction = resolveInteraction(element);
          element.interaction = {
            ...interaction,
            hover: operation.hover ?? interaction.hover,
            focus: operation.focus ?? interaction.focus,
            reveal: operation.reveal ? normalizeReveal(operation.reveal) : interaction.reveal,
          };
        }
        element.provenance = source;
      }
      changedIds.push(operation.elementId);
    }

    nextDocument.revision += 1;
    this.documentState = nextDocument;
    if (this.sessionState.selectionId && !findElement(nextDocument, this.sessionState.selectionId)) {
      this.sessionState = { ...this.sessionState, selectionId: null };
    }
    const undoToken = crypto.randomUUID();
    const beforeElements = before.spreads[spreadIndex].elements;
    const afterElements = nextDocument.spreads[spreadIndex].elements;
    const beforeById = new Map(beforeElements.map((element) => [element.id, element]));
    const afterById = new Map(afterElements.map((element) => [element.id, element]));
    // Provenance describes the latest operator, so a later non-overlapping
    // human edit must remain visible when an earlier Agent patch is undone.
    const mutableFields: ElementField[] = ["kind", "depth", "locked", "motion", "transform", "interaction"];
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
      spreadId: command.spreadId,
      beforeOrder: beforeElements.map((element) => element.id),
      afterOrder: afterElements.map((element) => element.id),
      elements: elementDiffs,
    });
    const uniqueChangedIds = [...new Set(changedIds)];
    const summary = `${source === "agent" ? "ChatGPT" : "You"} patched ${uniqueChangedIds.length} scene ${uniqueChangedIds.length === 1 ? "element" : "elements"}`;
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

  private applyUndo(command: Extract<DocumentCommand, { type: "undo" }>, source: CommandSource): DocumentResult {
    const record = this.undoRecords.get(command.undoToken);
    if (!record) {
      const result = this.conflict("not_found", "That undo token is no longer available.");
      this.requestResults.set(command.requestId, result);
      this.showAction(source, "error", result.summary);
      return result;
    }
    if (record.operation === "create-book") return this.applyCreateBookUndo(command, record, source);
    if (record.operation === "scene-patch") return this.applyScenePatchUndo(command, record, source);
    if (record.operation === "compose") return this.applyComposeSpreadUndo(command, record, source);
    if (record.operation !== "update") return this.applyStructuralUndo(command, record, source);

    const location = findElement(this.documentState, record.elementId);
    if (!location) return this.conflict("not_found", `Element ${record.elementId} was not found.`);
    const current = this.documentState.spreads[location.spreadIndex].elements[location.elementIndex];
    const conflictField = record.fields.find((field) => !equalField(current[field], record.after[field]));
    if (conflictField) {
      const result = this.conflict("undo_conflict", `${current.label} changed again in ${conflictField}; undo did not overwrite the newer edit.`);
      this.requestResults.set(command.requestId, result);
      this.showAction(source, "error", result.summary, current.id);
      return result;
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
      elementId: restored.id,
      fields: record.fields,
      before: Object.fromEntries(record.fields.map((field) => [field, clone(current[field])])) as Partial<BookElement>,
      after: Object.fromEntries(record.fields.map((field) => [field, clone(restored[field])])) as Partial<BookElement>,
    });
    const summary = `${source === "agent" ? "ChatGPT" : "You"} undid a change to ${restored.label}`;
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
    const currentById = new Map(currentElements.map((element) => [element.id, element]));
    const structureChanged = !equalField(record.beforeOrder, record.afterOrder)
      || record.elements.some((change) => !change.before || !change.after);
    if (structureChanged && !equalField(currentElements.map((element) => element.id), record.afterOrder)) {
      const result = this.conflict("undo_conflict", "The scene structure changed again; undo did not overwrite newer work.");
      this.requestResults.set(command.requestId, result);
      this.showAction(source, "error", result.summary);
      return result;
    }

    for (const change of record.elements) {
      const current = currentById.get(change.elementId) ?? null;
      if (!change.before) {
        if (!current || !equalField(current, change.after)) {
          const result = this.conflict("undo_conflict", `Added element ${change.elementId} changed again; undo did not remove it.`);
          this.requestResults.set(command.requestId, result);
          this.showAction(source, "error", result.summary, change.elementId);
          return result;
        }
      } else if (!change.after) {
        if (current) {
          const result = this.conflict("undo_conflict", `Removed element ${change.elementId} was recreated; undo did not replace it.`);
          this.requestResults.set(command.requestId, result);
          this.showAction(source, "error", result.summary, change.elementId);
          return result;
        }
      } else {
        if (!current) return this.conflict("not_found", `Element ${change.elementId} was not found.`);
        const conflictField = change.fields.find((field) => !equalField(current[field], change.after?.[field]));
        if (conflictField) {
          const result = this.conflict("undo_conflict", `${current.label} changed again in ${conflictField}; undo preserved the newer edit.`);
          this.requestResults.set(command.requestId, result);
          this.showAction(source, "error", result.summary, current.id);
          return result;
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
    nextDocument.revision += 1;
    this.documentState = nextDocument;
    if (this.sessionState.selectionId && !findElement(nextDocument, this.sessionState.selectionId)) this.sessionState = { ...this.sessionState, selectionId: null };
    this.undoRecords.delete(record.token);
    const token = crypto.randomUUID();
    this.undoRecords.set(token, {
      operation: "scene-patch",
      token,
      spreadId: record.spreadId,
      beforeOrder: record.afterOrder,
      afterOrder: record.beforeOrder,
      elements: record.elements.map((change) => ({
        elementId: change.elementId,
        fields: change.fields,
        before: clone(change.after),
        after: clone(change.before),
      })),
    });
    const changedIds = record.elements.map((change) => change.elementId);
    const summary = `${source === "agent" ? "ChatGPT" : "You"} undid a scene patch`;
    const result: MutationResult = { ok: true, revision: nextDocument.revision, changedIds, undoToken: token, summary };
    this.requestResults.set(command.requestId, result);
    this.persist();
    this.showAction(source, "success", summary, changedIds.length === 1 ? changedIds[0] : undefined, token);
    return result;
  }

  private applyCreateBookUndo(
    command: Extract<DocumentCommand, { type: "undo" }>,
    record: CreateBookUndoRecord,
    source: CommandSource,
  ): DocumentResult {
    const expected = record.direction === "undo" ? record.created : record.previous;
    if (!equalField(this.documentState, expected)) {
      const result = this.conflict("undo_conflict", "The active book changed again; undo did not replace newer work.");
      this.requestResults.set(command.requestId, result);
      this.showAction(source, "error", result.summary);
      return result;
    }

    const current = clone(this.documentState);
    const next = clone(record.direction === "undo" ? record.previous : record.created);
    next.revision = current.revision + 1;

    if (record.direction === "undo") {
      const createdIndex = this.libraryState.documents.findIndex((book) => book.id === record.created.id);
      if (createdIndex < 0 || !equalField(this.libraryState.documents[createdIndex], record.created)) {
        const result = this.conflict("undo_conflict", "The created shelf book changed again; undo did not remove it.");
        this.requestResults.set(command.requestId, result);
        this.showAction(source, "error", result.summary);
        return result;
      }
      this.libraryState.documents.splice(createdIndex, 1);
    } else if (this.libraryState.documents.some((book) => book.id === record.created.id)) {
      const result = this.conflict("undo_conflict", `Book ${record.created.id} already exists; redo did not replace it.`);
      this.requestResults.set(command.requestId, result);
      this.showAction(source, "error", result.summary);
      return result;
    }

    this.documentState = next;
    this.sessionState = { ...this.sessionState, currentSpreadIndex: 0, selectionId: null };
    this.undoRecords.delete(record.token);
    const token = crypto.randomUUID();
    this.undoRecords.set(token, {
      operation: "create-book",
      token,
      direction: record.direction === "undo" ? "redo" : "undo",
      previous: record.direction === "undo" ? clone(next) : clone(record.previous),
      created: record.direction === "redo" ? clone(next) : clone(record.created),
    });
    const verb = record.direction === "undo" ? "removed the new book and restored" : "recreated";
    const summary = `${source === "agent" ? "ChatGPT" : "You"} ${verb} ${next.title}`;
    const result: MutationResult = {
      ok: true,
      revision: next.revision,
      changedIds: next.spreads.map((spread) => spread.id),
      undoToken: token,
      summary,
    };
    this.requestResults.set(command.requestId, result);
    this.persist();
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
      const result = this.conflict("undo_conflict", `${currentSpread.title} changed again in ${conflictField}; undo preserved the newer edit.`);
      this.requestResults.set(command.requestId, result);
      this.showAction(source, "error", result.summary);
      return result;
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
      spreadId: record.spreadId,
      fields: record.fields,
      before: Object.fromEntries(record.fields.map((field) => [field, clone(currentSpread[field])])) as Partial<Pick<Spread, SpreadField>>,
      after: Object.fromEntries(record.fields.map((field) => [field, clone(restoredSpread[field])])) as Partial<Pick<Spread, SpreadField>>,
    });
    const summary = `${source === "agent" ? "ChatGPT" : "You"} undid composition on ${restoredSpread.title}`;
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

  private applyStructuralUndo(
    command: Extract<DocumentCommand, { type: "undo" }>,
    record: AddUndoRecord | RemoveUndoRecord,
    source: CommandSource,
  ): DocumentResult {
    const spreadIndex = this.documentState.spreads.findIndex((spread) => spread.id === record.spreadId);
    if (spreadIndex < 0) return this.conflict("not_found", `Spread ${record.spreadId} was not found.`);
    const nextDocument = clone(this.documentState);
    const elements = nextDocument.spreads[spreadIndex].elements;
    const currentIndex = elements.findIndex((element) => element.id === record.elementId);

    if (record.operation === "add") {
      if (currentIndex < 0 || !equalField(elements[currentIndex], record.after)) {
        const result = this.conflict("undo_conflict", `${record.after.label} changed after import; undo did not remove the newer state.`);
        this.requestResults.set(command.requestId, result);
        this.showAction(source, "error", result.summary, record.elementId);
        return result;
      }
      const [removed] = elements.splice(currentIndex, 1);
      const token = crypto.randomUUID();
      this.undoRecords.delete(record.token);
      this.undoRecords.set(token, {
        operation: "remove",
        token,
        spreadId: record.spreadId,
        elementId: record.elementId,
        before: clone(removed),
        index: currentIndex,
      });
      nextDocument.revision += 1;
      this.documentState = nextDocument;
      this.sessionState = { ...this.sessionState, selectionId: null };
      const summary = `${source === "agent" ? "ChatGPT" : "You"} removed ${removed.label}`;
      const result: MutationResult = { ok: true, revision: nextDocument.revision, changedIds: [removed.id], undoToken: token, summary };
      this.requestResults.set(command.requestId, result);
      this.persist();
      this.showAction(source, "success", summary, removed.id, token);
      return result;
    }

    if (currentIndex >= 0) {
      const result = this.conflict("undo_conflict", `${record.before.label} already exists; undo did not replace it.`);
      this.requestResults.set(command.requestId, result);
      this.showAction(source, "error", result.summary, record.elementId);
      return result;
    }
    elements.splice(Math.min(record.index, elements.length), 0, clone(record.before));
    const token = crypto.randomUUID();
    this.undoRecords.delete(record.token);
    this.undoRecords.set(token, {
      operation: "add",
      token,
      spreadId: record.spreadId,
      elementId: record.elementId,
      after: clone(record.before),
    });
    nextDocument.revision += 1;
    this.documentState = nextDocument;
    this.sessionState = { ...this.sessionState, selectionId: record.elementId };
    const summary = `${source === "agent" ? "ChatGPT" : "You"} restored ${record.before.label}`;
    const result: MutationResult = { ok: true, revision: nextDocument.revision, changedIds: [record.elementId], undoToken: token, summary };
    this.requestResults.set(command.requestId, result);
    this.persist();
    this.showAction(source, "success", summary, record.elementId, token);
    return result;
  }
}

export const bookEngine = new BookEngine();

export function humanEdit(elementId: string, transform: Partial<Transform2D>) {
  const snapshot = bookEngine.getSnapshot();
  return bookEngine.dispatch({ type: "edit", requestId: freshRequestId(), expectedRevision: snapshot.document.revision, elementId, transform }, "human");
}

export function humanAnimate(elementId: string, motion: AnimateCommand["motion"]) {
  const snapshot = bookEngine.getSnapshot();
  return bookEngine.dispatch({ type: "animate", requestId: freshRequestId(), expectedRevision: snapshot.document.revision, elementId, motion }, "human");
}

export function humanInteract(elementId: string, interaction: InteractCommand["interaction"]) {
  const snapshot = bookEngine.getSnapshot();
  return bookEngine.dispatch({ type: "interact", requestId: freshRequestId(), expectedRevision: snapshot.document.revision, elementId, interaction }, "human");
}

export function humanAddImage(spreadId: string, label: string, assetId: string) {
  const snapshot = bookEngine.getSnapshot();
  const elementId = `photo-${crypto.randomUUID()}`;
  return bookEngine.dispatch({
    type: "add",
    requestId: freshRequestId(),
    expectedRevision: snapshot.document.revision,
    spreadId,
    element: {
      id: elementId,
      label,
      kind: "lifted",
      assetId,
      page: "right",
      transform: { x: 0.23, y: 0.28, scaleX: 0.52, scaleY: 0.52, rotationDeg: -3 },
      depth: 0.12,
      locked: false,
      interaction: {
        hover: "lift-glow",
        focus: "spotlight",
        reveal: { kind: "caption", title: label, summary: "A locally imported image, ready for the Agent to compose.", facts: [] },
        hint: `Explore ${label}`,
      },
      provenance: "human",
    },
  }, "human");
}
