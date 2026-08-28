import { FOCUS_RESPONSES, HOVER_RESPONSES, REVEAL_KINDS } from "./interaction";
import { MOTION_PRESETS } from "./types";

export const SITE_TOOL_NAMES = [
  "get_project_context",
  "manage_book",
  "compose_spread",
  "apply_scene_patch",
  "set_presentation",
  "undo_project_change",
] as const;

export const PROJECT_CONTEXT_DETAILS = ["compact", "selected-reveal", "assets", "authoring-guide"] as const;
export type ProjectContextDetail = (typeof PROJECT_CONTEXT_DETAILS)[number];

export const AUTHORING_GUIDE_DETAIL = "authoring-guide" as const;
export const AUTHORING_GUIDE_ID = "apertale-authoring-guide" as const;
export const AUTHORING_GUIDE_VERSION = 1 as const;
export const AUTHORING_GUIDE_SKILL_MIRROR = "apertale-authoring" as const;

export const GENERATED_COVER_COUNT = 1 as const;
export const AUTHORING_GUIDE_FULL_SPREAD_COUNT = "exactly the agreed spread count" as const;
export const AUTHORING_GUIDE_PROVENANCE_COUNT = "1 cover + one per spread" as const;

export const REQUIRED_GATE_IDS = ["inspect", "story", "plan", "art", "photo-truth", "layout", "evidence"] as const;
export type RequiredGateId = (typeof REQUIRED_GATE_IDS)[number];

export const AUTHORING_HARD_GATE_IDS = [
  "inspect",
  "story",
  "plan-art",
  "imagegen-before-create",
  "photo-truth",
  "handoff-before-refer",
  "layout",
  "interaction",
  "cutouts",
  "provenance-revision",
  "verify",
] as const;
export type AuthoringHardGateId = (typeof AUTHORING_HARD_GATE_IDS)[number];

export const PHOTO_TRUTH_REQUIREMENT =
  "Use source photos as references and story truth. Do not use a raw uploaded photo as finished interior or right-page artwork unless the user explicitly requested a literal photo album.";

export const AUTHORING_LAYOUT_SEQUENCE = ["handoff", "create", "set-cover", "patch", "verify"] as const;

export type CreationCompletionGate = {
  id: RequiredGateId;
  token: `[GATE:${RequiredGateId}]`;
  requirement: string;
};

export type AuthoringCountSpec = {
  generatedCoverCount: number | string;
  generatedFullSpreadCount: number | string;
  provenanceEntryCount: number | string;
};

export type AuthoringHardGate = {
  id: AuthoringHardGateId;
  rule: string;
};

export type AuthoringGuide = {
  id: typeof AUTHORING_GUIDE_ID;
  version: typeof AUTHORING_GUIDE_VERSION;
  skillMirror: typeof AUTHORING_GUIDE_SKILL_MIRROR;
  contract: "two-phase";
  tools: typeof SITE_TOOL_NAMES;
  phases: readonly [
    {
      id: "plan-and-generate";
      mutationAllowed: false;
      steps: readonly ["inspect", "story", "plan", "imagegen"];
    },
    {
      id: "layout";
      mutationAllowed: true;
      requiresCompleteArtSet: true;
      sequence: typeof AUTHORING_LAYOUT_SEQUENCE;
    },
  ];
  requiredCounts: {
    generatedCoverCount: typeof GENERATED_COVER_COUNT;
    generatedFullSpreadCount: typeof AUTHORING_GUIDE_FULL_SPREAD_COUNT;
    provenanceEntryCount: typeof AUTHORING_GUIDE_PROVENANCE_COUNT;
  };
  gates: CreationCompletionGate[];
  hardGates: AuthoringHardGate[];
  interaction: {
    required: string;
    hover: readonly string[];
    focus: readonly string[];
    reveal: readonly string[];
    motion: readonly string[];
  };
  cutouts: {
    nativeAlpha: true;
    oneSubjectPerRequest: true;
    reject: readonly string[];
  };
  provenance: string;
  revisions: string;
  verify: readonly string[];
  report: string[];
};

export function creationCompletionGates(input: AuthoringCountSpec): CreationCompletionGate[] {
  return [
    {
      id: "inspect",
      token: "[GATE:inspect]",
      requirement: "Inspect the sources and user prompt in this conversation. Never invent unseen photo content.",
    },
    {
      id: "story",
      token: "[GATE:story]",
      requirement: "State the audience or the assumption used, then a complete story arc with beginning, development, turn, and ending.",
    },
    {
      id: "plan",
      token: "[GATE:plan]",
      requirement: `Plan the title, dedicated generated portrait cover, every spread, and ordered provenance before any Site Tool mutation. Required counts: generated cover ${input.generatedCoverCount}, original full-spread artwork ${input.generatedFullSpreadCount}, provenance entries ${input.provenanceEntryCount}.`,
    },
    {
      id: "art",
      token: "[GATE:art]",
      requirement: "Use the host ImageGen/image editing capability to make one dedicated portrait cover and one purpose-built full-spread artwork for every spread.",
    },
    {
      id: "photo-truth",
      token: "[GATE:photo-truth]",
      requirement: PHOTO_TRUTH_REQUIREMENT,
    },
    {
      id: "layout",
      token: "[GATE:layout]",
      requirement: "Only after the complete asset plan and generated art set exist, create the book through the six Site Tools, import exact assets through supported transfer or explicit Image handoff, set the cover, apply full-spread backgrounds, add meaningful interactions, and verify all spreads.",
    },
    {
      id: "evidence",
      token: "[GATE:evidence]",
      requirement: "Never claim generation or import succeeded without evidence: returned asset ids, tool results, or an explicit pending-handoff report.",
    },
  ];
}

export function creationReportRequirements(input: Pick<AuthoringCountSpec, "generatedCoverCount" | "generatedFullSpreadCount">): string[] {
  return [
    "book title and exact spread count",
    `generated cover count ${input.generatedCoverCount} with the cover asset id or a pending-handoff note`,
    `generated full-spread count ${input.generatedFullSpreadCount} with one original artwork asset id per spread`,
    "ordered source-asset ids and user-visible names, mapped as references rather than finished right-page placements",
    "ordered provenance for cover and every spread, distinguishing user photo, generated art, and curated sample",
    "interactions, illustrated layers, and short frame sequences added",
    "unsupported or pending media handoff, with no success claim",
    "active revision and undo tokens for the last reversible changes",
  ];
}

export function authoringHardGates(): AuthoringHardGate[] {
  return [
    {
      id: "inspect",
      rule: "Inspect source assets and the user prompt before planning. Never invent unseen photo content.",
    },
    {
      id: "story",
      rule: "Write a coherent complete story arc with beginning, development, turn, and ending.",
    },
    {
      id: "plan-art",
      rule: "Plan one dedicated portrait cover and one distinct full-spread illustration per spread.",
    },
    {
      id: "imagegen-before-create",
      rule: "Generate all final art with host ImageGen before manage_book create.",
    },
    {
      id: "photo-truth",
      rule: PHOTO_TRUTH_REQUIREMENT,
    },
    {
      id: "handoff-before-refer",
      rule: "Hand off each generated asset through supported transfer or Image handoff, then refresh get_project_context(detail: assets), before referring to that asset id.",
    },
    {
      id: "layout",
      rule: "Then create, set-cover, and patch through the six Site Tools. Never overwrite a curated sample.",
    },
    {
      id: "interaction",
      rule: "Every non-guide spread requires a spread-specific hover/focus/click interaction.",
    },
    {
      id: "cutouts",
      rule: "Foreground subjects must be native transparent cutouts with a real alpha channel. One ImageGen request produces exactly one subject.",
    },
    {
      id: "provenance-revision",
      rule: "Preserve ordered provenance and requestId/expectedRevision. Refresh context after every mutation. On conflict, refresh and re-plan.",
    },
    {
      id: "verify",
      rule: "Verify content, generated-art counts, spread-specific interaction, and undo evidence before claiming completion.",
    },
  ];
}

export function buildAuthoringGuide(): AuthoringGuide {
  const requiredCounts = {
    generatedCoverCount: GENERATED_COVER_COUNT,
    generatedFullSpreadCount: AUTHORING_GUIDE_FULL_SPREAD_COUNT,
    provenanceEntryCount: AUTHORING_GUIDE_PROVENANCE_COUNT,
  } as const;
  const gates = creationCompletionGates(requiredCounts);
  if (REQUIRED_GATE_IDS.some((id, index) => gates[index]?.id !== id)) {
    throw new TypeError("Invalid authoring guide: completion gates are incomplete.");
  }
  const hardGates = authoringHardGates();
  if (AUTHORING_HARD_GATE_IDS.some((id, index) => hardGates[index]?.id !== id)) {
    throw new TypeError("Invalid authoring guide: hard gates are incomplete.");
  }
  return {
    id: AUTHORING_GUIDE_ID,
    version: AUTHORING_GUIDE_VERSION,
    skillMirror: AUTHORING_GUIDE_SKILL_MIRROR,
    contract: "two-phase",
    tools: SITE_TOOL_NAMES,
    phases: [
      {
        id: "plan-and-generate",
        mutationAllowed: false,
        steps: ["inspect", "story", "plan", "imagegen"],
      },
      {
        id: "layout",
        mutationAllowed: true,
        requiresCompleteArtSet: true,
        sequence: AUTHORING_LAYOUT_SEQUENCE,
      },
    ],
    requiredCounts,
    gates,
    hardGates,
    interaction: {
      required: "Every non-guide spread needs a spread-specific hover/focus/click response.",
      hover: HOVER_RESPONSES,
      focus: FOCUS_RESPONSES,
      reveal: REVEAL_KINDS,
      motion: MOTION_PRESETS,
    },
    cutouts: {
      nativeAlpha: true,
      oneSubjectPerRequest: true,
      reject: [
        "opaque canvas",
        "baked checkerboard",
        "empty subject",
        "backing rectangle",
        "chroma spill",
        "detached crop fragments",
        "baked glow",
        "atlas, contact sheet, sprite sheet, or multi-object grid",
      ],
    },
    provenance: "Ordered provenance for the cover and every spread, distinguishing user photo, generated art, and curated sample.",
    revisions: "Use unique requestId values and the current expectedRevision. Refresh get_project_context after every mutation and retain undo tokens.",
    verify: [
      "content: title, agreed spread count, and complete story arc",
      "art counts: generated cover 1 and one original full-spread per spread",
      "interaction: spread-specific hover/focus/click on every non-guide spread",
      "undo evidence: active revision plus undo tokens for the last reversible changes",
    ],
    report: creationReportRequirements(requiredCounts),
  };
}
