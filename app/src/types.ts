export type ThemeId = "paper-atelier" | "midnight-desk";
export type QualityTier = "balanced" | "reduced";
export type MotionPreset = "gentle-float" | "fly-across" | "soft-pulse";
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

export type BookElement = {
  id: string;
  label: string;
  kind: "embedded" | "lifted" | "decoration";
  assetId: string;
  page: "left" | "right";
  transform: Transform2D;
  depth: number;
  locked: boolean;
  motion?: MotionSpec;
  provenance: "sample" | "human" | "agent";
};

export type Spread = {
  id: string;
  order: number;
  textureUrl: string;
  title: string;
  body: string;
  elements: BookElement[];
};

export type DocumentState = {
  id: string;
  revision: number;
  title: string;
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

export type EditCommand = {
  type: "edit";
  requestId: string;
  expectedRevision: number;
  elementId: string;
  transform?: Partial<Transform2D>;
  depth?: number;
  locked?: boolean;
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

export type DocumentCommand = LiftCommand | EditCommand | AnimateCommand | UndoCommand;

export type TurnState = {
  direction: "forward" | "backward";
  progress: number;
} | null;
