export type CreationNavigationPhase =
  | "idle"
  | "covering-source"
  | "revealing-workspace"
  | "covering-workspace"
  | "revealing-source";

type CreationNavigationState = {
  phase: CreationNavigationPhase;
  workspaceOpen: boolean;
};

type CreationNavigationAction =
  | { type: "request-open" }
  | { type: "request-close" }
  | { type: "animation-complete" }
  | { type: "show-immediately" }
  | { type: "hide-immediately" };

export const INITIAL_CREATION_NAVIGATION: CreationNavigationState = {
  phase: "idle",
  workspaceOpen: false,
};

/**
 * The opaque paper portal changes the mounted scene only while it covers the
 * whole viewport. Repeated requests are ignored instead of being queued, and
 * a close during the opening cover cancels back to the source immediately.
 */
export function reduceCreationNavigation(
  state: CreationNavigationState,
  action: CreationNavigationAction,
): CreationNavigationState {
  if (action.type === "show-immediately") return { phase: "idle", workspaceOpen: true };
  if (action.type === "hide-immediately") return INITIAL_CREATION_NAVIGATION;
  if (action.type === "request-open") {
    if (state.workspaceOpen || state.phase !== "idle") return state;
    return { phase: "covering-source", workspaceOpen: false };
  }
  if (action.type === "request-close") {
    if (state.phase === "covering-source") return INITIAL_CREATION_NAVIGATION;
    if (!state.workspaceOpen || state.phase === "covering-workspace" || state.phase === "revealing-source") return state;
    return { phase: "covering-workspace", workspaceOpen: true };
  }
  switch (state.phase) {
    case "covering-source":
      return { phase: "revealing-workspace", workspaceOpen: true };
    case "revealing-workspace":
      return { phase: "idle", workspaceOpen: true };
    case "covering-workspace":
      return { phase: "revealing-source", workspaceOpen: false };
    case "revealing-source":
      return INITIAL_CREATION_NAVIGATION;
    default:
      return state;
  }
}

export type WorkspaceMotionOrigin = {
  x: number;
  y: number;
  radius: number;
};

type RectLike = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type ViewportLike = {
  width: number;
  height: number;
};

/** Finds the control centre and the radius required to cover every corner. */
export function workspaceMotionOrigin(rect: RectLike | null, viewport: ViewportLike): WorkspaceMotionOrigin {
  const fallback = { left: viewport.width / 2, top: viewport.height * 0.88, width: 0, height: 0 };
  const source = rect && rect.width > 0 && rect.height > 0 ? rect : fallback;
  const x = Math.max(0, Math.min(viewport.width, source.left + source.width / 2));
  const y = Math.max(0, Math.min(viewport.height, source.top + source.height / 2));
  const radius = Math.max(
    Math.hypot(x, y),
    Math.hypot(viewport.width - x, y),
    Math.hypot(x, viewport.height - y),
    Math.hypot(viewport.width - x, viewport.height - y),
  ) + 32;
  return { x, y, radius };
}
