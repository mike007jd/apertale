export type ThemeId = "paper-atelier" | "midnight-desk";
export type QualityTier = "balanced" | "reduced";
export type MotionPreset = "gentle-float" | "fly-across" | "soft-pulse" | "slow-orbit";
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

export type RevealFact = {
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

/** Procedural Three.js centrepieces owned by the repository, keyed by id. */
export type SceneModelId = "flavian-amphitheatre" | "great-pyramid" | "volcano-cross-section";

export type BookElement = {
  id: string;
  label: string;
  kind: "embedded" | "lifted" | "decoration";
  assetId: string;
  modelId?: SceneModelId;
  page: "left" | "right";
  transform: Transform2D;
  depth: number;
  locked: boolean;
  motion?: MotionSpec;
  interaction?: InteractionSpec;
  provenance: "sample" | "human" | "agent";
};

export type Spread = {
  id: string;
  order: number;
  /** Omitted on typographic plate spreads whose hero is a real 3D centrepiece. */
  textureUrl?: string;
  title: string;
  body: string;
  kicker?: string;
  elements: BookElement[];
};

export type DocumentState = {
  id: string;
  revision: number;
  title: string;
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

export type ConflictResult = {
  ok: false;
  code: "revision_conflict" | "undo_conflict" | "not_found" | "locked" | "invalid";
  currentRevision: number;
  summary: string;
};

export type DocumentResult = MutationResult | ConflictResult;

export type LiftCommand = {
  type: "lift";
  requestId: string;
  expectedRevision: number;
  elementId: string;
};

export type AddElementCommand = {
  type: "add";
  requestId: string;
  expectedRevision: number;
  spreadId: string;
  element: BookElement;
};

export type CreateBookCommand = {
  type: "create-book";
  requestId: string;
  expectedRevision: number;
  documentId: string;
  title: string;
  spreads: Array<Pick<Spread, "id" | "title" | "body" | "kicker">>;
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
      op: "add";
      id: string;
      label: string;
      assetId: string;
      modelId?: SceneModelId;
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

export type UndoCommand = {
  type: "undo";
  requestId: string;
  expectedRevision: number;
  undoToken: string;
};

export type DocumentCommand =
  | AddElementCommand
  | CreateBookCommand
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
