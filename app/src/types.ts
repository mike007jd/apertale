import type { CreationBriefPayload, CreationReadinessAssessment } from "./authoringContract";

export const THEME_IDS = ["paper-atelier", "midnight-desk"] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export type QualityTier = "balanced" | "reduced";
/** Authoring bound shared by persistence validation, create, readiness, and the WebMCP schema. */
export const MAX_BOOK_SPREADS = 12 as const;
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
  kind: "embedded" | "lifted" | "decoration";
  assetId: string;
  /** Optional 2–6 frame image sequence; the first frame is the resting image. */
  frameAssetIds?: string[];
  page: "left" | "right";
  transform: Transform2D;
  depth: number;
  locked: boolean;
  motion?: MotionSpec;
  interaction?: InteractionSpec;
  provenance: "sample" | "human" | "agent";
};

export const PROCEDURAL_ASSET_PREFIX = "procedural:";

/** Procedural markers carry knowledge details without an image asset; every other element is an image foreground layer. */
export function isProceduralElement(element: Pick<BookElement, "assetId">) {
  return element.assetId.startsWith(PROCEDURAL_ASSET_PREFIX);
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
};

type ConflictResult = {
  ok: false;
  code: "revision_conflict" | "undo_conflict" | "not_found" | "locked" | "invalid";
  currentRevision: number;
  summary: string;
};

export type CreationNotReadyResult = {
  ok: false;
  code: "creation_not_ready";
  currentRevision: number;
  summary: string;
  readiness: CreationReadinessAssessment;
};

export type DocumentResult = MutationResult | ConflictResult | CreationNotReadyResult;

type LiftCommand = {
  type: "lift";
  requestId: string;
  expectedRevision: number;
  elementId: string;
};

export type CreateBookCommand = {
  type: "create-book";
  requestId: string;
  expectedRevision: number;
  documentId: string;
  title: string;
  spreads: Array<Pick<Spread, "id" | "title" | "body" | "kicker">>;
  creationBrief: CreationBriefPayload;
  validatedSourceAssetIds: string[];
};

export type SetBookCoverCommand = {
  type: "set-book-cover";
  requestId: string;
  expectedRevision: number;
  assetId: string;
  /** Asset ids independently resolved by the trusted IndexedDB adapter. */
  validatedLocalAssetIds: string[];
};

export type ComposeSpreadCommand = {
  type: "compose-spread";
  requestId: string;
  expectedRevision: number;
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
      page: "left" | "right";
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

export type ScenePatchCommand = {
  type: "scene-patch";
  requestId: string;
  expectedRevision: number;
  spreadId: string;
  operations: ScenePatchOperation[];
  /** Local assets independently resolved by the trusted IndexedDB adapter. */
  validatedLocalAssetIds?: string[];
};

export type EditCommand = {
  type: "edit";
  requestId: string;
  expectedRevision: number;
  elementId: string;
  transform?: Partial<Transform2D>;
  depth?: number;
  locked?: boolean;
};

export type InteractCommand = {
  type: "interact";
  requestId: string;
  expectedRevision: number;
  elementId: string;
  interaction: Partial<Pick<InteractionSpec, "hover" | "focus">> & { revealKind?: RevealKind };
};

export type AnimateCommand = {
  type: "animate";
  requestId: string;
  expectedRevision: number;
  elementId: string;
  motion: MotionSpec | null;
};

type UndoCommand = {
  type: "undo";
  requestId: string;
  expectedRevision: number;
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
