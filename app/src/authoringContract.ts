import { FOCUS_RESPONSES, HOVER_RESPONSES, REVEAL_KINDS } from "./interaction";
import { MOTION_PRESETS } from "./types";
import siteManifest from "../site-manifest.json";

export const SITE_TOOL = Object.freeze(siteManifest.webMcp.tools);
const manifestToolNames = Object.values(SITE_TOOL);
if (manifestToolNames.length !== 7 || new Set(manifestToolNames).size !== manifestToolNames.length) {
  throw new TypeError("Invalid Apertale manifest: exactly seven unique WebMCP tools are required.");
}
export const SITE_TOOL_NAMES = Object.freeze(manifestToolNames) as readonly [string, string, string, string, string, string, string];

export const PROJECT_CONTEXT_DETAILS = ["compact", "selected-reveal", "assets", "authoring-guide", "creation-readiness", "quality-review"] as const;

export const AUTHORING_GUIDE_DETAIL = "authoring-guide" as const;
export const AUTHORING_GUIDE_ID = "apertale-authoring-guide" as const;
export const AUTHORING_GUIDE_VERSION = 2 as const;
export const AUTHORING_GUIDE_SKILL_MIRROR = "apertale-authoring" as const;

export const CREATION_READINESS_VERSION = 2 as const;
export const CREATION_BOOK_TYPES = ["illustrated-storybook", "photo-led-keepsake", "preserved-photo-album"] as const;
export type CreationBookType = (typeof CREATION_BOOK_TYPES)[number];

export const PHOTO_SOURCE_USES = ["reference-and-compose", "preserve-original-layout"] as const;
export type PhotoSourceUse = (typeof PHOTO_SOURCE_USES)[number];

export type CreationSourceAsset = {
  id: string;
  name: string;
};

export type CreationPhotoPolicy = {
  sourceUse?: PhotoSourceUse;
  preserveIdentity?: boolean;
  allowFaceChanges?: boolean;
  allowCrop?: boolean;
  allowColorCorrection?: boolean;
};

export type CreationBriefPayload = {
  contractVersion?: number;
  bookType?: CreationBookType;
  premise?: string;
  audience?: string;
  spreadCount?: number;
  visualDirection?: string;
  sourceAssets?: readonly CreationSourceAsset[];
  photoPolicy?: CreationPhotoPolicy;
};

export type CreationReadinessBlocker = {
  field: string;
  reason: string;
};

export type CreationReadinessAssessment = {
  contractVersion: typeof CREATION_READINESS_VERSION;
  ready: boolean;
  bookType: CreationBookType | null;
  effectiveSpreadCount: number | null;
  blockingMissingFields: CreationReadinessBlocker[];
  recommendations: string[];
  questions: string[];
  recommended: {
    spreadCount: { minimum: number; suggested: number; maximum: number };
    style: string;
    assetNeeds: string[];
  };
  photoBoundaries: {
    sourceUse: PhotoSourceUse | null;
    preserveIdentity: boolean | null;
    allowed: string[];
    prohibited: string[];
  };
};

type CreationReadinessOptions = {
  expectedSpreadCount?: number;
  validatedSourceAssetIds?: readonly string[];
};

const briefString = (value: unknown) => typeof value === "string" ? value.trim() : "";

function supportedBookType(value: unknown): value is CreationBookType {
  return typeof value === "string" && (CREATION_BOOK_TYPES as readonly string[]).includes(value);
}

function supportedSourceUse(value: unknown): value is PhotoSourceUse {
  return typeof value === "string" && (PHOTO_SOURCE_USES as readonly string[]).includes(value);
}

function briefAssets(input: CreationBriefPayload | undefined): CreationSourceAsset[] {
  if (!Array.isArray(input?.sourceAssets)) return [];
  return input.sourceAssets.filter((asset): asset is CreationSourceAsset => Boolean(
    asset
    && typeof asset === "object"
    && briefString(asset.id)
    && briefString(asset.name),
  )).map((asset) => ({ id: asset.id.trim(), name: asset.name.trim() }));
}

export function creationBriefSourceAssetIds(input: CreationBriefPayload | undefined): string[] {
  return briefAssets(input).map((asset) => asset.id);
}

/**
 * Single readiness oracle used by the workshop prompt, Site Tools adapter, and
 * shared command engine. Recommendations may supply low-risk defaults, while
 * identity, source-photo treatment, premise, and audience always fail closed.
 */
export function assessCreationReadiness(
  input: CreationBriefPayload | undefined,
  options: CreationReadinessOptions = {},
): CreationReadinessAssessment {
  const blockers: CreationReadinessBlocker[] = [];
  const questions: string[] = [];
  const recommendations: string[] = [];
  const addBlocker = (field: string, reason: string, question?: string) => {
    if (!blockers.some((item) => item.field === field)) blockers.push({ field, reason });
    if (question && !questions.includes(question)) questions.push(question);
  };

  if (input?.contractVersion !== CREATION_READINESS_VERSION) {
    addBlocker("contractVersion", `Use creation brief contract version ${CREATION_READINESS_VERSION}.`);
  }

  const bookType = supportedBookType(input?.bookType) ? input.bookType : null;
  if (!bookType) {
    addBlocker(
      "bookType",
      "Choose an illustrated storybook, a photo-led keepsake, or an album that preserves the original photo layout.",
      "Should this become an illustrated storybook, a photo-led keepsake, or an album that keeps the original photos as they are?",
    );
  }

  if (!briefString(input?.premise)) {
    addBlocker("premise", "The book needs a clear story, occasion, or promise.", "What is the book about, and what should the reader feel or remember?");
  }
  if (!briefString(input?.audience)) {
    addBlocker("audience", "Audience materially changes the writing, pacing, and image direction.", "Who is this book for?");
  }
  if (!briefString(input?.visualDirection)) {
    addBlocker("visualDirection", "A visual direction is required before generating a coherent asset set.", "What visual style should the book use?");
  }

  const requestedSpreadCount = Number.isInteger(input?.spreadCount) ? Number(input?.spreadCount) : null;
  const expectedSpreadCount = Number.isInteger(options.expectedSpreadCount) ? Number(options.expectedSpreadCount) : null;
  const effectiveSpreadCount = requestedSpreadCount ?? expectedSpreadCount;
  if (effectiveSpreadCount === null || effectiveSpreadCount < 1 || effectiveSpreadCount > 12) {
    addBlocker("spreadCount", "The book needs 1–12 planned spreads.", "Is six spreads a good length, or would you like a different count from 1 to 12?");
  } else if (requestedSpreadCount !== null && expectedSpreadCount !== null && requestedSpreadCount !== expectedSpreadCount) {
    addBlocker("spreadCount", `The brief requests ${requestedSpreadCount} spreads but create contains ${expectedSpreadCount}.`, `Should I use ${requestedSpreadCount} spreads from the brief or the ${expectedSpreadCount}-spread plan?`);
  } else if (requestedSpreadCount === null && expectedSpreadCount !== null) {
    recommendations.push(`Using the explicit ${expectedSpreadCount}-spread create plan as the brief length.`);
  }

  const assets = briefAssets(input);
  const rawAssetCount = Array.isArray(input?.sourceAssets) ? input.sourceAssets.length : 0;
  if (rawAssetCount !== assets.length) {
    addBlocker("sourceAssets", "Each source photo needs a stable id and a user-visible name.", "Could you re-add the source photos that did not import cleanly?");
  }
  const duplicateAsset = assets.find((asset, index) => assets.findIndex((candidate) => candidate.id === asset.id) !== index);
  if (duplicateAsset) {
    addBlocker("sourceAssets", "Source photo ids must be unique and remain in the user's intended order.", "Which copy of the repeated photo should I keep?");
  }
  const invalidAsset = assets.find((asset) => !/^asset:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(asset.id));
  if (invalidAsset) {
    addBlocker("sourceAssets", `${invalidAsset.name} does not have a verified browser-local asset id.`, "Call request_image_handoff so the page can open the photo drawer for this source.");
  }

  const isPhotoBook = bookType === "photo-led-keepsake" || bookType === "preserved-photo-album";
  const usesSourcePhotos = isPhotoBook || assets.length > 0;
  if (isPhotoBook && assets.length === 0) {
    addBlocker("sourceAssets", "Photo-led books need at least one inspected source photo.", "Please add the photos you want this book to use.");
  }
  if (assets.length > 0) {
    const validated = new Set(options.validatedSourceAssetIds ?? []);
    const missing = assets.filter((asset) => !validated.has(asset.id));
    if (missing.length > 0) {
      addBlocker("sourceAssets", `The browser has not verified ${missing.map((asset) => asset.name).join(", ")}.`, "Call request_image_handoff for the missing photos, then check readiness again.");
    }
  }

  const sourceUse = supportedSourceUse(input?.photoPolicy?.sourceUse) ? input.photoPolicy.sourceUse : null;
  if (usesSourcePhotos && !sourceUse) {
    addBlocker("photoPolicy.sourceUse", "Photo treatment changes the finished book and cannot be inferred safely.", "May I reinterpret the photos inside new compositions, or should I preserve each original photo layout?");
  }
  if (bookType === "photo-led-keepsake" && sourceUse && sourceUse !== "reference-and-compose") {
    addBlocker("photoPolicy.sourceUse", "A photo-led keepsake uses photos as identity-faithful references inside new compositions.", "Would you like an illustrated keepsake, or should I switch this to an original-photo album?");
  }
  if (bookType === "preserved-photo-album" && sourceUse && sourceUse !== "preserve-original-layout") {
    addBlocker("photoPolicy.sourceUse", "A preserved-photo album keeps the original photo layout rather than reinterpreting it.", "Should I preserve the original photo layouts without reillustrating them?");
  }
  if (bookType === "illustrated-storybook" && assets.length > 0 && sourceUse === "preserve-original-layout") {
    addBlocker("bookType", "A book that preserves original photo layouts must use the preserved-photo-album type.", "Should I switch this to an original-photo album?");
  }
  if (usesSourcePhotos && input?.photoPolicy?.preserveIdentity !== true) {
    addBlocker("photoPolicy.preserveIdentity", "People must remain recognisable and source-true.", "Should I preserve every person's identity and defining features exactly?");
  }
  if (usesSourcePhotos && input?.photoPolicy?.allowFaceChanges !== false) {
    addBlocker("photoPolicy.allowFaceChanges", "Face changes must be explicitly disabled for personal-photo work.", "May I keep faces unchanged, with no identity-altering edits?");
  }
  if (bookType === "preserved-photo-album" && typeof input?.photoPolicy?.allowCrop !== "boolean") {
    addBlocker("photoPolicy.allowCrop", "Cropping original photos is a material album decision.", "May I crop the original photos, or should every frame remain intact?");
  }
  if (bookType === "preserved-photo-album" && typeof input?.photoPolicy?.allowColorCorrection !== "boolean") {
    addBlocker("photoPolicy.allowColorCorrection", "Colour correction needs an explicit boundary for preserved originals.", "May I make gentle colour and exposure corrections, or leave the photos untouched?");
  }

  const suggestedSpreadCount = isPhotoBook
    ? Math.max(4, Math.min(8, assets.length || 6))
    : 6;
  const recommendedSourceCount = Math.max(1, assets.length);
  if (effectiveSpreadCount && effectiveSpreadCount > 8) recommendations.push("A 4–8 spread first edition usually keeps the story tighter; keep the longer plan only when every beat is distinct.");
  if (bookType === "photo-led-keepsake") recommendations.push("Use source photos as identity-faithful references, then build new full-spread scenes around them.");
  if (bookType === "preserved-photo-album") recommendations.push("Keep original photo geometry primary; use restrained framing, captions, and interactive overlays instead of reillustrating faces.");

  return {
    contractVersion: CREATION_READINESS_VERSION,
    ready: blockers.length === 0,
    bookType,
    effectiveSpreadCount: effectiveSpreadCount && effectiveSpreadCount >= 1 && effectiveSpreadCount <= 12 ? effectiveSpreadCount : null,
    blockingMissingFields: blockers,
    recommendations,
    questions,
    recommended: {
      spreadCount: { minimum: 4, suggested: suggestedSpreadCount, maximum: 8 },
      style: briefString(input?.visualDirection) || (isPhotoBook ? "Warm editorial keepsake" : "Tactile illustrated storybook"),
      assetNeeds: [
        "1 dedicated portrait cover",
        bookType === "preserved-photo-album"
          ? "1 source-true 2:1 preserved-photo layout per spread; 0 generated interiors"
          : "1 complete generated 2:1 clean plate per spread",
        "2–4 native-alpha foreground or interactive subjects per spread",
        ...(isPhotoBook ? [`${recommendedSourceCount} ordered source photo${recommendedSourceCount === 1 ? "" : "s"} with identity preserved`] : []),
      ],
    },
    photoBoundaries: {
      sourceUse,
      preserveIdentity: typeof input?.photoPolicy?.preserveIdentity === "boolean" ? input.photoPolicy.preserveIdentity : null,
      allowed: bookType === "preserved-photo-album"
        ? ["authorised crop only", "authorised colour correction only", "captions and non-destructive overlays"]
        : isPhotoBook
          ? ["identity-faithful extension", "new environmental composition", "non-facial stylisation"]
          : ["original illustration"],
      prohibited: usesSourcePhotos
        ? ["identity or face changes", "unstated people or events", "distorted body proportions", "unapproved crop of a preserved original"]
        : ["unlicensed or unseen personal-photo invention"],
    },
  };
}

export const GENERATED_COVER_COUNT = 1 as const;
export const AUTHORING_GUIDE_FULL_SPREAD_COUNT = "one per spread for illustrated storybook or photo-led keepsake; 0 for preserved-photo-album" as const;
export const AUTHORING_GUIDE_PRESERVED_SPREAD_COUNT = "exactly the agreed spread count for preserved-photo-album" as const;
export const AUTHORING_GUIDE_PROVENANCE_COUNT = "1 cover + one per spread" as const;

export const REQUIRED_GATE_IDS = ["inspect", "story", "plan", "art", "photo-truth", "layout", "evidence"] as const;
type RequiredGateId = (typeof REQUIRED_GATE_IDS)[number];

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
type AuthoringHardGateId = (typeof AUTHORING_HARD_GATE_IDS)[number];

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
  preservedPhotoSpreadCount?: number | string;
  provenanceEntryCount: number | string;
};

export type AuthoringHardGate = {
  id: AuthoringHardGateId;
  rule: string;
};

type SpreadAssetMode = "generated" | "preserved" | "book-type-dependent";

function spreadAssetMode(input: Pick<AuthoringCountSpec, "preservedPhotoSpreadCount">): SpreadAssetMode {
  if (typeof input.preservedPhotoSpreadCount === "string") return "book-type-dependent";
  return typeof input.preservedPhotoSpreadCount === "number" && input.preservedPhotoSpreadCount > 0
    ? "preserved"
    : "generated";
}

export type AuthoringGuide = {
  id: typeof AUTHORING_GUIDE_ID;
  version: typeof AUTHORING_GUIDE_VERSION;
  skillMirror: typeof AUTHORING_GUIDE_SKILL_MIRROR;
  contract: "two-phase";
  tools: typeof SITE_TOOL_NAMES;
  phases: readonly [
    {
      id: "plan-and-prepare";
      mutationAllowed: false;
      steps: readonly ["inspect", "story", "plan", "prepare-assets"];
    },
    {
      id: "layout";
      mutationAllowed: true;
      requiresCompleteAssetSet: true;
      sequence: typeof AUTHORING_LAYOUT_SEQUENCE;
    },
  ];
  requiredCounts: {
    generatedCoverCount: typeof GENERATED_COVER_COUNT;
    generatedFullSpreadCount: typeof AUTHORING_GUIDE_FULL_SPREAD_COUNT;
    preservedPhotoSpreadCount: typeof AUTHORING_GUIDE_PRESERVED_SPREAD_COUNT;
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
  const mode = spreadAssetMode(input);
  const spreadAssetPlan = mode === "preserved"
    ? `generated interior artwork ${input.generatedFullSpreadCount}, preserved original-photo layouts ${input.preservedPhotoSpreadCount}`
    : mode === "generated"
      ? `original generated full-spread artwork ${input.generatedFullSpreadCount}`
      : `generated full-spread artwork ${input.generatedFullSpreadCount}; preserved original-photo layouts ${input.preservedPhotoSpreadCount}`;
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
      requirement: `Plan the title, dedicated generated portrait cover, every spread, and ordered provenance before any Site Tool mutation. Required counts: generated cover ${input.generatedCoverCount}, ${spreadAssetPlan}, provenance entries ${input.provenanceEntryCount}.`,
    },
    {
      id: "art",
      token: "[GATE:art]",
      requirement: mode === "preserved"
        ? "Use ImageGen for the dedicated portrait cover. Prepare one source-true 2:1 layout per spread from the original photos, preserving their geometry and applying only authorised crop or colour correction."
        : mode === "generated"
          ? "Use the host ImageGen/image editing capability to make one dedicated portrait cover and one purpose-built full-spread artwork for every spread."
          : "Use ImageGen for the dedicated portrait cover. For illustrated-storybook and photo-led-keepsake, prepare one purpose-built generated full-spread artwork per spread. For preserved-photo-album, prepare one source-true original-photo layout per spread without reillustrating people or changing photo geometry beyond the authorised policy.",
    },
    {
      id: "photo-truth",
      token: "[GATE:photo-truth]",
      requirement: PHOTO_TRUTH_REQUIREMENT,
    },
    {
      id: "layout",
      token: "[GATE:layout]",
      requirement: "Only after the complete asset plan and final cover/spread asset set exist, create the book through the Site Tools, import exact assets through supported transfer or by calling request_image_handoff, set the cover, apply full-spread backgrounds, add meaningful interactions, and verify all spreads.",
    },
    {
      id: "evidence",
      token: "[GATE:evidence]",
      requirement: "Never claim generation or import succeeded without evidence: returned asset ids, tool results, or an explicit pending-handoff report. Render the cover and every spread, then complete an evidence-backed deterministic plus visual critique before publish.",
    },
  ];
}

export function creationReportRequirements(input: Pick<AuthoringCountSpec, "generatedCoverCount" | "generatedFullSpreadCount" | "preservedPhotoSpreadCount">): string[] {
  const mode = spreadAssetMode(input);
  const spreadAssetReport = mode === "preserved"
    ? `preserved original-photo layout count ${input.preservedPhotoSpreadCount} with one source-true layout asset id per spread`
    : mode === "generated"
      ? `generated full-spread count ${input.generatedFullSpreadCount} with one original artwork asset id per spread`
      : `spread assets by book type: generated full-spread count ${input.generatedFullSpreadCount}; preserved original-photo layout count ${input.preservedPhotoSpreadCount}`;
  const sourceAssetReport = mode === "preserved"
    ? "ordered source-photo ids and user-visible names, mapped to preserved spread layouts without reillustration"
    : mode === "generated"
      ? "ordered source-asset ids and user-visible names, mapped as references rather than finished right-page placements"
      : "ordered source-asset ids and user-visible names, used as references for illustrated books or as source-true layouts for preserved-photo-album";
  return [
    "book title and exact spread count",
    `generated cover count ${input.generatedCoverCount} with the cover asset id or a pending-handoff note`,
    spreadAssetReport,
    sourceAssetReport,
    "ordered provenance for cover and every spread, distinguishing user photo, generated art, and curated sample",
    "interactions, illustrated layers, and short frame sequences added",
    "unsupported or pending media handoff, with no success claim",
    "active revision and undo tokens for the last reversible changes",
    "quality-review round, blocker/warning/note counts, actual render evidence inspected, sample-readiness, and publishAllowed",
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
      rule: "Plan one dedicated portrait cover and one distinct 2:1 spread composition per spread. Generate illustrated compositions; preserve source-photo geometry for preserved-photo-album.",
    },
    {
      id: "imagegen-before-create",
      rule: "Finish every final cover and spread asset before manage_book create. Use host ImageGen for generated art; do not reillustrate preserved-photo-album originals.",
    },
    {
      id: "photo-truth",
      rule: PHOTO_TRUTH_REQUIREMENT,
    },
    {
      id: "handoff-before-refer",
      rule: "Hand off reader references with request_image_handoff assetUse source-photo and generated finals with assetUse book-art, then refresh get_project_context(detail: assets) before referring to those ids.",
    },
    {
      id: "layout",
      rule: "Then create, set-cover, and patch through the Site Tools. Never overwrite a curated sample.",
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
      rule: "Preserve ordered provenance and requestId/expectedRevision. For every image-led spread, keep the original composite in sourceAssetId, the final base in cleanPlateAssetId, and any declared personal photo in personalSourceAssetId. Refresh context after every mutation. On conflict, refresh and re-plan.",
    },
    {
      id: "verify",
      rule: "Verify content, book-type-specific asset counts, spread-specific interaction, real render evidence, deterministic checks, AI visual critique, and undo evidence before claiming completion. Patch and re-check at most twice; publish only when allowed.",
    },
  ];
}

export function buildAuthoringGuide(): AuthoringGuide {
  const requiredCounts = {
    generatedCoverCount: GENERATED_COVER_COUNT,
    generatedFullSpreadCount: AUTHORING_GUIDE_FULL_SPREAD_COUNT,
    preservedPhotoSpreadCount: AUTHORING_GUIDE_PRESERVED_SPREAD_COUNT,
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
        id: "plan-and-prepare",
        mutationAllowed: false,
        steps: ["inspect", "story", "plan", "prepare-assets"],
      },
      {
        id: "layout",
        mutationAllowed: true,
        requiresCompleteAssetSet: true,
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
      "asset counts: generated cover 1 plus one generated illustration or preserved original-photo layout per spread, according to book type",
      "interaction: spread-specific hover/focus/click on every non-guide spread",
      "undo evidence: active revision plus undo tokens for the last reversible changes",
      "quality: actual cover/spread frames inspected, no blocker, at most two critique rounds, and publishAllowed true",
    ],
    report: creationReportRequirements(requiredCounts),
  };
}
