// Deliberate type-only edge: erased at compile time, so it is not a runtime cycle.
// The two command-result types below need these; moving them here instead would make the edge real.
import type { CreationBriefPayload, CreationReadinessAssessment } from "./authoringContract";

export const THEME_IDS = ["paper-atelier", "midnight-desk"] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export type QualityTier = "balanced" | "reduced";
/** Authoring bound shared by persistence validation, create, readiness, and the WebMCP schema. */
export const MAX_BOOK_SPREADS = 12 as const;
/** One ImageGen request renders this sheet; spread counts step by its tile count so no sheet is half used. */
export const IMAGEGEN_SHEET = { columns: 2, rows: 2, tiles: 4 } as const;
/** Browser-local image capacity shared by readiness, quality review, and publishing. */
export const MAX_BOOK_PUBLISHABLE_ASSETS = 50 as const;
/** Authoring bound on one spread's foreground/procedural layer list. */
export const MAX_SPREAD_ELEMENTS = 24 as const;
export const BOOK_ELEMENT_KINDS = ["embedded", "lifted", "decoration"] as const;
export const BOOK_PAGES = ["left", "right"] as const;
export const BOOK_PROVENANCE = ["sample", "human", "agent"] as const;
export const BOOK_ELEMENT_ID_PATTERN_SOURCE = "^[a-z0-9][a-z0-9-]{0,63}$" as const;
export const BOOK_ELEMENT_ID_PATTERN = new RegExp(BOOK_ELEMENT_ID_PATTERN_SOURCE);
export const MOTION_PRESETS = ["gentle-float", "fly-across", "water-bob", "soft-pulse", "slow-orbit"] as const;
export type MotionPreset = (typeof MOTION_PRESETS)[number];
export type CommandSource = "human" | "agent";

export type Transform2D = {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
};

export type MotionSpec = {
  preset: MotionPreset;
  durationMs: number;
  loop: boolean;
};

/**
 * Structured interaction schema.
 *
 * Every scene element declares how it answers a pointer, how it behaves once it
 * holds focus, what knowledge it reveals, and which named motion it plays. The
 * renderer only knows these vocabularies, never a specific element, so the
 * authoring Agent (or a human) can compose behaviour purely as data.
 */
export type HoverResponse = "none" | "lift-glow" | "tilt-toward-pointer" | "warm-rim";
export type FocusResponse = "none" | "spotlight" | "rise-and-center" | "orbit-inspect";
export type RevealKind = "none" | "caption" | "fact-card";

type RevealFact = {
  label: string;
  value: string;
};

export type RevealSpec = {
  kind: RevealKind;
  title: string;
  summary: string;
  facts: RevealFact[];
  source?: string;
};

export type InteractionSpec = {
  hover: HoverResponse;
  focus: FocusResponse;
  reveal: RevealSpec;
  motion?: MotionSpec;
  hint?: string;
};

export type BookElement = {
  id: string;
  label: string;
  kind: (typeof BOOK_ELEMENT_KINDS)[number];
  assetId: string;
  /** Optional 2–6 frame image sequence; the first frame is the resting image. */
  frameAssetIds?: string[];
  page: (typeof BOOK_PAGES)[number];
  transform: Transform2D;
  depth: number;
  locked: boolean;
  motion?: MotionSpec;
  interaction?: InteractionSpec;
  provenance: (typeof BOOK_PROVENANCE)[number];
};

export const PROCEDURAL_ASSET_PREFIX = "procedural:";
/**
 * The publish boundary matches procedural markers exactly; this side only
 * classifies by prefix so an unknown tone still renders (see
 * `bookGeometry.ts`, which falls back to amber) instead of being rejected as a
 * malformed image asset.
 */
export const PROCEDURAL_ASSET_ID_PATTERN_SOURCE = "^procedural:hotspot:(amber|aqua|jade|rose)$" as const;

export function isProceduralAssetId(assetId: string) {
  return assetId.startsWith(PROCEDURAL_ASSET_PREFIX);
}

/** Procedural markers carry knowledge details without an image asset; every other element is an image foreground layer. */
export function isProceduralElement(element: Pick<BookElement, "assetId">) {
  return isProceduralAssetId(element.assetId);
}

/** Assets the renderer actually draws, with assetId serving as the resting frame. */
export function renderedElementAssetIds(element: Pick<BookElement, "assetId" | "frameAssetIds">) {
  if (
    isProceduralAssetId(element.assetId)
    || element.frameAssetIds?.some(isProceduralAssetId)
  ) return [element.assetId];
  return element.frameAssetIds?.length ? element.frameAssetIds : [element.assetId];
}

/**
 * A full-spread illustration prepared for layered interaction.
 *
 * `sourceAssetId` keeps the original full-spread composite reference used to
 * derive the clean plate. `personalSourceAssetId` separately records a
 * declared user photo when identity/source-use rules apply.
 * `cleanPlateAssetId` is either the generated background after extracted
 * subjects were removed, or an approved source-true photo layout that must not
 * be reillustrated. Generated work without a declared photo source omits it.
 * Foreground subjects live in `Spread.elements`.
 */
export type LayeredArtwork = {
  cleanPlateAssetId: string;
  sourceAssetId?: string;
  personalSourceAssetId?: string;
  separation: "inpainted-clean-plate" | "preserved-photo-layout";
};

export type Spread = {
  id: string;
  order: number;
  textureUrl?: string;
  artwork?: LayeredArtwork;
  title: string;
  body: string;
  kicker?: string;
  elements: BookElement[];
};

/** Resolve the asset actually painted behind a spread's interactive elements. */
export function spreadBaseAssetId(spread: Pick<Spread, "textureUrl" | "artwork" | "elements">) {
  const usesGroundedComposite = spread.textureUrl
    && spread.textureUrl === spread.artwork?.sourceAssetId
    && spread.elements.every(isProceduralElement);
  if (usesGroundedComposite) return spread.textureUrl;
  return spread.artwork?.cleanPlateAssetId ?? spread.textureUrl;
}

/** Preserve source-true layouts in full; generated compositions may fill the stage. */
export function spreadArtworkFit(spread: Pick<Spread, "artwork">): "cover" | "contain" {
  return spread.artwork?.separation === "preserved-photo-layout" ? "contain" : "cover";
}

export type DocumentState = {
  id: string;
  revision: number;
  title: string;
  /** Browser-local image selected as this book's dedicated portrait cover. */
  coverAssetId?: string;
  coverTextureUrl?: string;
  spreads: Spread[];
};

export type SessionState = {
  currentSpreadIndex: number;
  selectionId: string | null;
  sceneThemeId: ThemeId;
  preview: boolean;
  quality: QualityTier;
};

export type BookSnapshot = {
  document: DocumentState;
  session: SessionState;
  lastAction: VisibleAction | null;
};

export type VisibleAction = {
  id: string;
  source: CommandSource;
  phase: "pending" | "success" | "error";
  summary: string;
  elementId?: string;
  undoToken?: string;
};

export type MutationResult = {
  ok: true;
  revision: number;
  changedIds: string[];
  undoToken: string;
  summary: string;
  /** Present only when the mutation creates a new document. */
  documentId?: string;
};

type ConflictResult = {
  ok: false;
  code: "revision_conflict" | "undo_conflict" | "not_found" | "locked" | "invalid";
  currentRevision: number;
  summary: string;
};

type CreationNotReadyResult = {
  ok: false;
  code: "creation_not_ready";
  currentRevision: number;
  summary: string;
  readiness: CreationReadinessAssessment;
};

type CreationArtifactIncompleteResult = {
  ok: false;
  code: "creation_artifact_incomplete";
  currentRevision: number;
  summary: string;
  issues: string[];
};

export type DocumentResult = MutationResult | ConflictResult | CreationNotReadyResult | CreationArtifactIncompleteResult;

type DocumentMutationPrecondition = {
  requestId: string;
  expectedDocumentId: string;
  expectedRevision: number;
};

type LiftCommand = DocumentMutationPrecondition & {
  type: "lift";
  elementId: string;
};

export type CreateBookCommand = DocumentMutationPrecondition & {
  type: "create-book";
  documentId: string;
  title: string;
  coverAssetId: string;
  spreads: Array<Pick<Spread, "id" | "title" | "body" | "kicker"> & {
    background: PreparedBookBackground;
    layers: PreparedBookLayer[];
  }>;
  creationBrief: CreationBriefPayload;
  validatedSourceAssetIds: string[];
  validatedLocalAssetIds: string[];
};

export type SetBookCoverCommand = DocumentMutationPrecondition & {
  type: "set-book-cover";
  assetId: string;
  /** Asset ids independently resolved by the trusted IndexedDB adapter. */
  validatedLocalAssetIds: string[];
};

export type ComposeSpreadCommand = DocumentMutationPrecondition & {
  type: "compose-spread";
  spreadId: string;
  title?: string;
  body?: string;
  kicker?: string;
};

export type ScenePatchOperation =
  | {
      op: "set-background";
      cleanPlateAssetId: string;
      sourceAssetId: string;
      personalSourceAssetId?: string;
      separation?: LayeredArtwork["separation"];
    }
  | {
      op: "add";
      id: string;
      label: string;
      assetId: string;
      frameAssetIds?: string[];
      page: (typeof BOOK_PAGES)[number];
      kind?: BookElement["kind"];
      transform?: Partial<Transform2D>;
      depth?: number;
      locked?: boolean;
      motion?: MotionSpec;
      hover?: HoverResponse;
      focus?: FocusResponse;
      reveal?: RevealSpec;
    }
  | {
      op: "update";
      elementId: string;
      kind?: BookElement["kind"];
      transform?: Partial<Transform2D>;
      depth?: number;
      locked?: boolean;
      motion?: MotionSpec | null;
      frameAssetIds?: string[] | null;
      hover?: HoverResponse;
      focus?: FocusResponse;
      reveal?: RevealSpec;
    }
  | { op: "remove"; elementId: string }
  | { op: "reorder"; elementId: string; index: number };

export type PreparedBookBackground = Omit<Extract<ScenePatchOperation, { op: "set-background" }>, "op" | "separation"> & {
  separation: LayeredArtwork["separation"];
};
export type PreparedBookLayer = Omit<Extract<ScenePatchOperation, { op: "add" }>, "op">;

export type ScenePatchCommand = DocumentMutationPrecondition & {
  type: "scene-patch";
  spreadId: string;
  operations: ScenePatchOperation[];
  /** Local assets independently resolved by the trusted IndexedDB adapter. */
  validatedLocalAssetIds?: string[];
};

export type EditCommand = DocumentMutationPrecondition & {
  type: "edit";
  elementId: string;
  transform?: Partial<Transform2D>;
  depth?: number;
  locked?: boolean;
};

export type InteractCommand = DocumentMutationPrecondition & {
  type: "interact";
  elementId: string;
  interaction: Partial<Pick<InteractionSpec, "hover" | "focus">> & { revealKind?: RevealKind };
};

export type AnimateCommand = DocumentMutationPrecondition & {
  type: "animate";
  elementId: string;
  motion: MotionSpec | null;
};

type UndoCommand = DocumentMutationPrecondition & {
  type: "undo";
  undoToken: string;
};

/**
 * Which commands are a person's hands on the open book.
 *
 * Preview refuses these and only these. Written as a total record rather than
 * a chain of `type === ...` tests so the classification is exhaustive by
 * construction: a tenth command variant fails to compile until it declares
 * which side it is on. The enumeration it replaces excluded the other five by
 * omission, so a future "change cover" button dispatched as `human` would have
 * written into a document the reader was told is read-only, with nothing
 * failing.
 */
export const DIRECT_MANIPULATION: Record<DocumentCommand["type"], boolean> = {
  lift: true,
  edit: true,
  animate: true,
  interact: true,
  // Authoring and meta commands. Codex keeps working during a preview - the
  // reader watching their book change is the point of that mode - and Undo
  // stays available so a change they dislike can be taken back without first
  // leaving preview.
  "create-book": false,
  "set-book-cover": false,
  "compose-spread": false,
  "scene-patch": false,
  undo: false,
};

export type DocumentCommand =
  | CreateBookCommand
  | SetBookCoverCommand
  | ComposeSpreadCommand
  | ScenePatchCommand
  | LiftCommand
  | EditCommand
  | AnimateCommand
  | InteractCommand
  | UndoCommand;

export type TurnState = {
  direction: "forward" | "backward";
  progress: number;
} | null;
