import type {
  BookElement,
  FocusResponse,
  HoverResponse,
  InteractionSpec,
  MotionSpec,
  RevealKind,
  RevealSpec,
} from "./types";

/**
 * Closed vocabularies for the structured interaction schema. Authoring surfaces
 * (human panel, WebMCP tools) pick from these lists; the renderer resolves them
 * into concrete motion through `hoverTraits` / `focusTraits` below.
 */
export const HOVER_RESPONSES: HoverResponse[] = ["none", "lift-glow", "tilt-toward-pointer", "warm-rim"];
export const FOCUS_RESPONSES: FocusResponse[] = ["none", "spotlight", "rise-and-center", "orbit-inspect"];
export const REVEAL_KINDS: RevealKind[] = ["none", "caption", "fact-card"];

export const HOVER_LABELS: Record<HoverResponse, string> = {
  none: "No response",
  "lift-glow": "Lift and glow",
  "tilt-toward-pointer": "Tilt toward pointer",
  "warm-rim": "Warm rim light",
};

export const FOCUS_LABELS: Record<FocusResponse, string> = {
  none: "Stay in place",
  spotlight: "Spotlight",
  "rise-and-center": "Rise and center",
  "orbit-inspect": "Orbit to inspect",
};

const EMPTY_REVEAL: RevealSpec = { kind: "none", title: "", summary: "", facts: [] };

export const defaultInteraction: InteractionSpec = {
  hover: "lift-glow",
  focus: "spotlight",
  reveal: EMPTY_REVEAL,
};

/** Elements without an authored interaction still behave predictably. */
export function resolveInteraction(element: Pick<BookElement, "interaction" | "motion" | "label">): InteractionSpec {
  const authored = element.interaction;
  if (!authored) {
    return {
      ...defaultInteraction,
      reveal: { ...EMPTY_REVEAL, kind: "caption", title: element.label, summary: "" },
      motion: element.motion,
      hint: `Explore ${element.label}`,
    };
  }
  return {
    hover: authored.hover,
    focus: authored.focus,
    reveal: authored.reveal ?? EMPTY_REVEAL,
    motion: element.motion ?? authored.motion,
    hint: authored.hint ?? `Explore ${element.label}`,
  };
}

export type HoverTraits = {
  /** Extra world-space rise while hovered. */
  rise: number;
  /** Multiplier applied to the resolved element scale. */
  scale: number;
  /** Emissive strength blended into the element materials. */
  emissive: number;
  /** How strongly the element leans toward the pointer, in radians. */
  tilt: number;
};

export type FocusTraits = {
  rise: number;
  scale: number;
  /** Slide toward the spine, in world units, to clear the reveal card. */
  shift: number;
  /** Intensity of the dedicated focus spotlight. */
  spotlight: number;
  /** Continuous yaw applied while focused, radians per second. */
  spin: number;
};

export function hoverTraits(response: HoverResponse): HoverTraits {
  switch (response) {
    case "lift-glow":
      return { rise: 0.09, scale: 1.035, emissive: 0.34, tilt: 0 };
    case "tilt-toward-pointer":
      return { rise: 0.05, scale: 1.015, emissive: 0.16, tilt: 0.13 };
    case "warm-rim":
      return { rise: 0.02, scale: 1, emissive: 0.5, tilt: 0 };
    default:
      return { rise: 0, scale: 1, emissive: 0, tilt: 0 };
  }
}

export function focusTraits(response: FocusResponse): FocusTraits {
  switch (response) {
    case "spotlight":
      return { rise: 0.06, scale: 1.02, shift: 0, spotlight: 3.2, spin: 0 };
    case "rise-and-center":
      return { rise: 0.34, scale: 1.06, shift: 1.15, spotlight: 4.4, spin: 0 };
    case "orbit-inspect":
      return { rise: 0.22, scale: 1.05, shift: 1.15, spotlight: 4.1, spin: 0.28 };
    default:
      return { rise: 0, scale: 1, shift: 0, spotlight: 0, spin: 0 };
  }
}

export type MotionTraits = {
  x: number;
  y: number;
  scale: number;
  progress: number;
};

/** Resolve every advertised motion preset, including one-shot motions. */
export function motionTraits(motion: MotionSpec, elapsedMs: number): MotionTraits {
  const durationMs = Math.max(1, motion.durationMs);
  const elapsed = Math.max(0, elapsedMs);
  const progress = motion.loop ? (elapsed % durationMs) / durationMs : Math.min(1, elapsed / durationMs);
  const angle = progress * Math.PI * 2;

  if (motion.preset === "gentle-float") return { x: 0, y: Math.sin(angle) * 0.12, scale: 1, progress };
  if (motion.preset === "fly-across") return { x: (progress - 0.5) * 1.25, y: Math.sin(angle) * 0.2, scale: 1, progress };
  if (motion.preset === "soft-pulse") return { x: 0, y: 0, scale: 1 + Math.sin(angle) * 0.06, progress };
  return { x: (Math.cos(angle) - 1) * 0.16, y: Math.sin(angle) * 0.1, scale: 1, progress };
}

export function hasReveal(spec: InteractionSpec) {
  return spec.reveal.kind !== "none" && Boolean(spec.reveal.title);
}
