import { initialDocument, initialSession } from "./sampleBook";
import { recordDiagnostic } from "./diagnostics";
import type {
  AnimateCommand,
  BookElement,
  BookSnapshot,
  CommandSource,
  DocumentCommand,
  DocumentResult,
  DocumentState,
  EditCommand,
  MutationResult,
  SessionState,
  ThemeId,
  Transform2D,
  VisibleAction,
} from "./types";

const STORAGE_KEY = "livingbook.challenge.final-1.1";

type ElementField = "kind" | "depth" | "locked" | "motion" | "transform" | "provenance";

type UndoRecord = {
  token: string;
  elementId: string;
  fields: ElementField[];
  before: Partial<BookElement>;
  after: Partial<BookElement>;
};

const clone = <T,>(value: T): T => structuredClone(value);

const freshRequestId = () => crypto.randomUUID();

function loadDocument(): DocumentState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(initialDocument);
    const parsed = JSON.parse(raw) as DocumentState;
    if (parsed.id !== initialDocument.id || !Array.isArray(parsed.spreads)) return clone(initialDocument);
    return parsed;
  } catch {
    return clone(initialDocument);
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
  private documentState = loadDocument();
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.documentState));
    } catch {
      // Storage is a progressive enhancement; the live document remains usable.
    }
  }

  private conflict(code: "revision_conflict" | "undo_conflict" | "not_found" | "locked" | "invalid", summary: string): DocumentResult {
    return { ok: false, code, currentRevision: this.documentState.revision, summary };
  }

  private showAction(source: CommandSource, phase: VisibleAction["phase"], summary: string, elementId?: string, undoToken?: string) {
    this.lastAction = { id: freshRequestId(), source, phase, summary, elementId, undoToken };
    recordDiagnostic(`command:${phase}`, {
      source,
      elementId: elementId ?? null,
      revision: this.documentState.revision,
      hasUndo: Boolean(undoToken),
    });
    this.emit();
    if (phase !== "pending") {
      globalThis.setTimeout(() => {
        if (this.lastAction?.summary === summary) {
          this.lastAction = null;
          this.emit();
        }
      }, 3200);
    }
  }

  getContext() {
    const spread = this.documentState.spreads[this.sessionState.currentSpreadIndex];
    const selected = this.sessionState.selectionId
      ? spread.elements.find((element) => element.id === this.sessionState.selectionId) ?? null
      : null;
    return {
      book: { id: this.documentState.id, title: this.documentState.title, revision: this.documentState.revision },
      currentSpread: { id: spread.id, title: spread.title, order: spread.order + 1 },
      selection: selected
        ? { id: selected.id, label: selected.label, kind: selected.kind, locked: selected.locked, transform: selected.transform, motion: selected.motion ?? null }
        : null,
      theme: this.sessionState.sceneThemeId,
      capabilities: ["lift-structured-element", "edit-transform", "named-motion", "theme", "undo"],
    };
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

  setPreview(preview: boolean) {
    this.sessionState = { ...this.sessionState, preview, selectionId: preview ? null : this.sessionState.selectionId };
    this.emit();
  }

  reset() {
    this.documentState = clone(initialDocument);
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
