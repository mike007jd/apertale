import { FOCUS_RESPONSES, HOVER_RESPONSES, REVEAL_KINDS } from "./interaction";
import { isStoredAssetId } from "./assetId";
import { IMAGEGEN_SHEET, MAX_BOOK_PUBLISHABLE_ASSETS, MOTION_PRESETS } from "./types";
import siteManifest from "../site-manifest.json";

export const SITE_TOOL = Object.freeze(siteManifest.webMcp.tools);
export const SITE_TOOL_NAMES: readonly string[] = Object.freeze(Object.values(SITE_TOOL));

export const PROJECT_CONTEXT_DETAILS = ["compact", "selected-reveal", "assets", "authoring-guide", "creation-readiness", "quality-review", "storyboard"] as const;

export const AUTHORING_GUIDE_DETAIL = "authoring-guide" as const;

export const CREATION_READINESS_VERSION = 2 as const;
export const CREATION_BOOK_TYPES = ["illustrated-storybook", "photo-led-keepsake", "preserved-photo-album"] as const;
export type CreationBookType = (typeof CREATION_BOOK_TYPES)[number];

export const INTERACTION_DENSITIES = [
  { id: "none", label: "None", count: "0", minimum: 0, maximum: 0 },
  { id: "low", label: "Low", count: "1", minimum: 1, maximum: 1 },
  { id: "balanced", label: "Balanced", count: "2–3", minimum: 2, maximum: 3 },
  { id: "rich", label: "Rich", count: "3–6", minimum: 3, maximum: 6 },
] as const;
export type InteractionDensity = (typeof INTERACTION_DENSITIES)[number]["id"];

const LEGACY_INTERACTION_TARGET = { id: "legacy", label: "Standard", count: "2–4", minimum: 2, maximum: 4 } as const;

/** Missing values belong to existing books created under the original 2–4 layer contract. */
export function interactionLayerTarget(value: unknown) {
  return INTERACTION_DENSITIES.find((target) => target.id === value) ?? LEGACY_INTERACTION_TARGET;
}

export const PHOTO_SOURCE_USES = ["reference-and-compose", "preserve-original-layout"] as const;
type PhotoSourceUse = (typeof PHOTO_SOURCE_USES)[number];

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
  interactionDensity?: InteractionDensity;
  sourceAssets?: readonly CreationSourceAsset[];
  photoPolicy?: CreationPhotoPolicy;
};

type CreationReadinessBlocker = {
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

export function supportedBookType(value: unknown): value is CreationBookType {
  return typeof value === "string" && (CREATION_BOOK_TYPES as readonly string[]).includes(value);
}

function supportedSourceUse(value: unknown): value is PhotoSourceUse {
  return typeof value === "string" && (PHOTO_SOURCE_USES as readonly string[]).includes(value);
}

type SourceAssetRejection = "shape" | "id" | "name";

/**
 * Shared shape rule for one brief source asset. The caller decides what a
 * rejection means: `buildCreationBrief` throws, readiness collects a blocker.
 */
export function checkSourceAsset(
  value: unknown,
): { ok: true; asset: CreationSourceAsset } | { ok: false; reason: SourceAssetRejection } {
  if (!value || typeof value !== "object") return { ok: false, reason: "shape" };
  const { id, name } = value as Partial<CreationSourceAsset>;
  const trimmedId = briefString(id);
  if (!trimmedId) return { ok: false, reason: "id" };
  const trimmedName = briefString(name);
  if (!trimmedName) return { ok: false, reason: "name" };
  return { ok: true, asset: { id: trimmedId, name: trimmedName } };
}

function briefAssets(input: CreationBriefPayload | undefined): CreationSourceAsset[] {
  if (!Array.isArray(input?.sourceAssets)) return [];
  return input.sourceAssets.flatMap((asset) => {
    const checked = checkSourceAsset(asset);
    return checked.ok ? [checked.asset] : [];
  });
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
  if (input?.interactionDensity !== undefined && !INTERACTION_DENSITIES.some((target) => target.id === input.interactionDensity)) {
    addBlocker("interactionDensity", "Choose none, low, balanced, or rich interaction density.");
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
  const invalidAsset = assets.find((asset) => !isStoredAssetId(asset.id));
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

  const interactionTarget = interactionLayerTarget(input?.interactionDensity);
  // One or two sheets' worth of spreads; more photos than one sheet holds earn the second.
  const suggestedSpreadCount = isPhotoBook && assets.length > IMAGEGEN_SHEET.tiles ? 2 * IMAGEGEN_SHEET.tiles : IMAGEGEN_SHEET.tiles;
  const recommendedSourceCount = Math.max(1, assets.length);
  if (effectiveSpreadCount && effectiveSpreadCount > 8) recommendations.push("A 4–8 spread first edition usually keeps the story tighter; keep the longer plan only when every beat is distinct.");
  if (effectiveSpreadCount && effectiveSpreadCount % IMAGEGEN_SHEET.tiles !== 0) recommendations.push(`Use a multiple of ${IMAGEGEN_SHEET.tiles} spreads: each ImageGen sheet renders ${IMAGEGEN_SHEET.tiles} spreads, so other counts leave part of a sheet unused.`);
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
          ? "1 source-true layout composed for the approximately 1.62:1 stage per spread; 0 generated interiors"
          : "1 complete generated clean plate composed for the approximately 1.62:1 stage per spread",
        `${interactionTarget.count} native-alpha interactive ${interactionTarget.maximum === 1 ? "subject" : "subjects"} per spread`,
        `at most ${MAX_BOOK_PUBLISHABLE_ASSETS} distinct browser-local reader-visible cover, final-base, layer, and frame assets across the book; author-only source provenance is private and excluded unless it is also rendered`,
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

export const REQUIRED_GATE_IDS = ["story", "art", "layout", "evidence"] as const;
type RequiredGateId = (typeof REQUIRED_GATE_IDS)[number];

const AUTHORING_HARD_GATE_IDS = ["story", "storyboard", "art", "photo-truth", "handoff-create", "interaction", "present"] as const;
type AuthoringHardGateId = (typeof AUTHORING_HARD_GATE_IDS)[number];

const PHOTO_TRUTH_REQUIREMENT =
  "Use source photos as references and story truth. Do not use a raw uploaded photo as finished interior or right-page artwork unless the user explicitly requested a literal photo album.";

export type CreationCompletionGate = {
  id: RequiredGateId;
  token: `[GATE:${RequiredGateId}]`;
  requirement: string;
};

type AuthoringCountSpec = {
  generatedCoverCount: number | string;
  generatedFullSpreadCount: number | string;
  preservedPhotoSpreadCount?: number | string;
  provenanceEntryCount: number | string;
};

type AuthoringHardGate = {
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


export function creationCompletionGates(input: AuthoringCountSpec): CreationCompletionGate[] {
  const mode = spreadAssetMode(input);
  const spreadAssetPlan = mode === "preserved"
    ? `generated interior artwork ${input.generatedFullSpreadCount}, preserved original-photo layouts ${input.preservedPhotoSpreadCount}`
    : mode === "generated"
      ? `original generated full-spread artwork ${input.generatedFullSpreadCount}`
      : `generated full-spread artwork ${input.generatedFullSpreadCount}; preserved original-photo layouts ${input.preservedPhotoSpreadCount}`;
  return [
    {
      id: "story",
      token: "[GATE:story]",
      requirement: `Inspect the sources and user prompt, state the audience or the assumption used, then a complete story arc with beginning, development, turn, and ending, a title, and a plan for the dedicated portrait cover and every spread. Required counts: generated cover ${input.generatedCoverCount}, ${spreadAssetPlan}, provenance entries ${input.provenanceEntryCount}. Never invent unseen photo content.`,
    },
    {
      id: "art",
      token: "[GATE:art]",
      requirement: mode === "preserved"
        ? "Use ImageGen for the dedicated portrait cover. Prepare one source-true layout per spread for the approximately 1.62:1 stage from the original photos, preserving their geometry and applying only authorised crop or colour correction."
        : mode === "generated"
          ? "Use the host ImageGen/image editing capability to make one dedicated portrait cover and one purpose-built full-spread artwork for every spread, all before the first page call of the layout phase."
          : "Use ImageGen for the dedicated portrait cover. For illustrated-storybook and photo-led-keepsake, prepare one purpose-built generated full-spread artwork per spread. For preserved-photo-album, prepare one source-true original-photo layout per spread without reillustrating people or changing photo geometry beyond the authorised policy.",
    },
    {
      id: "layout",
      token: "[GATE:layout]",
      requirement: `One inline request_image_handoff for every final, then one manage_book create with the verified cover, every spread's background, and the foreground-layer count selected in creationBrief.interactionDensity (none 0, low 1, balanced 2–3, rich 3–6), at or below ${MAX_BOOK_PUBLISHABLE_ASSETS} reader-visible assets. Source-photo provenance stays private unless selected for rendering. Never create a text-only shell.`,
    },
    {
      id: "evidence",
      token: "[GATE:evidence]",
      requirement: "Never claim generation or import succeeded without evidence: returned asset ids and tool results. Present the cover and every spread after create; quality critique is advisory and never blocks sharing.",
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
  return [
    "book title, exact spread count, active revision, and the undo token of the create",
    `generated cover count ${input.generatedCoverCount} with the cover asset id`,
    spreadAssetReport,
    "ordered source-asset ids and user-visible names with their role (reference or preserved layout), and anything pending or unsupported, with no success claim",
  ];
}

function authoringHardGates(): AuthoringHardGate[] {
  return [
    {
      id: "story",
      rule: "Inspect source assets and the user prompt before planning, never invent unseen photo content, and write a coherent complete story arc with beginning, development, turn, and ending plus one written character bible reused verbatim in every image request. Check get_project_context(detail: creation-readiness) with the structured brief and ask every returned blocking question together in one turn; manage_book create reruns the same gate. A legacy personal book without a stored brief uses manage_book adopt-creation-brief once.",
    },
    {
      id: "storyboard",
      rule: "Plan one dedicated portrait cover and one distinct composition for the approximately 1.62:1 stage per spread; 1.45–2.10 is only the compatible input range. Before final art, call sketch_storyboard action replace so the complete rough book appears on the blank 3D pages: per spread a caption plus 14–24 marks listed back to front that read as an illustrator's thumbnail, at most 6 of them labelled (character bodies, key props, the text rect, the action arrow; never horizon, contours, heads, limbs, motion lines, or background masses): horizon and contour lines, background masses, props, each character as head and body ellipses with limb lines, motion lines, one labelled action arrow, and a rect labelled text holding one title label, all in spread coordinates. Main characters are foreground subjects: each body ellipse spans at least 0.3 of the spread height, and the final art keeps that scale. When the reader supplied source photos, give the rect that will hold each photo its assetId so the pencil plan shows the photo ghosted in place. After the replace call, end the turn and ask the reader to circle changes in red on the pencil book or say continue. Next turn, read their marks from compact project context (page, loop-or-stroke, bounds, touched labels) and update only marked spreads, clearing applied marks through resolvedAnnotations with the storyboard revision you read; what a mark adds belongs to that spread alone, never to the character bible, cover or other spreads unless the reader says so. Preserve source-photo geometry for preserved-photo-album.",
    },
    {
      id: "art",
      rule: "Once the reader says continue, generate every final before any page call, in two concurrent ImageGen rounds: first the portrait cover together with one 2×2 sheet per four consecutive spreads (each quadrant a complete 1.62:1 composition, no gutters or borders) from the character bible; then, both referencing the spread sheet, the matching 2×2 clean-plate sheet and one 2×2 cutout sheet with up to four subjects on a flat solid magenta backdrop (#FF00FF, no shadow or glow), each complete and centred in its own quadrant with clear padding. Never ask ImageGen for transparency. Any generator size is accepted: tiles are cropped to the stage and upscaled to at least 1024×632 at import, so ask for composition and never resize, reformat, or inspect pixels locally. Do not reillustrate preserved-photo-album originals.",
    },
    {
      id: "photo-truth",
      rule: PHOTO_TRUTH_REQUIREMENT,
    },
    {
      id: "handoff-create",
      rule: `Send every final in one request_image_handoff with assetUse book-art (reader references use assetUse source-photo): WebP under 3 MB each as base64 data URLs, split: true on every sheet and key: true on the cutout sheet, so the page stores the tiles in reading order, keys the backdrop into alpha, and returns each id with width, height, hasMeaningfulAlpha, and heightAtScale1; call manage_book create next without any other read. Create once with coverAssetId, every spread's background (sourceAssetId composite, cleanPlateAssetId base, personalSourceAssetId when declared), and the layer count from creationBrief.interactionDensity, at or below ${MAX_BOOK_PUBLISHABLE_ASSETS} reader-visible assets. Place each layer once from the storyboard: cutouts are trimmed to their subject, so page = left when the body ellipse centre cx < 0.5 else right, transform.x = (cx − pageOffset) × 2, transform.y = cy, scaleX = scaleY = the ellipse height ÷ the asset's heightAtScale1 (at most 1.8); do not iterate placement with patches and screenshots. Bind every mutation to the expectedDocumentId and expectedRevision you last read; reuse a requestId only for an exact retry or a successful mutation with presentation pending, and after any ok:false correction use a fresh one. Never create a text-only shell or overwrite a curated sample; set-cover and patch are later fixes only.`,
    },
    {
      id: "interaction",
      rule: "Honor creationBrief.interactionDensity: none uses no floating layers, low uses 1, balanced uses 2–3, and rich lets Codex choose 3–6. Every included layer needs a story-relevant, spread-specific hover/focus/click interaction; none is exempt.",
    },
    {
      id: "present",
      rule: "After create, present the cover with set_presentation(surface: \"shelf\") and every spread with set_presentation(surface: \"reader\", spreadId), then report the title, asset ids, revision, and undo token. Quality critique is optional: get_project_context(detail: quality-review), manage_book begin-critique, then record-critique with real render evidence, at most two rounds; never delay or block a user-requested share.",
    },
  ];
}

export function buildAuthoringGuide() {
  const requiredCounts = {
    generatedCoverCount: GENERATED_COVER_COUNT,
    generatedFullSpreadCount: "one per spread for illustrated storybook or photo-led keepsake; 0 for preserved-photo-album",
    preservedPhotoSpreadCount: "exactly the agreed spread count for preserved-photo-album",
    provenanceEntryCount: "1 cover + one per spread",
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
    id: "apertale-authoring-guide",
    version: 5,
    skillMirror: "apertale-authoring",
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
        sequence: ["handoff", "create", "verify"],
      },
    ],
    requiredCounts,
    gates,
    hardGates,
    interaction: {
      required: "Follow creationBrief.interactionDensity; every included layer needs a spread-specific hover/focus/click response, while none is exempt.",
      hover: HOVER_RESPONSES,
      focus: FOCUS_RESPONSES,
      reveal: REVEAL_KINDS,
      motion: MOTION_PRESETS,
    },
    cutouts: {
      nativeAlpha: true,
      sheet: "2x2 sheet on a flat magenta backdrop, up to four subjects per ImageGen request, split and keyed at handoff",
      oneSubjectPerAsset: true,
      reject: ["opaque canvas", "baked checkerboard", "empty subject", "backing rectangle", "detached crop fragments", "baked glow"],
    },
    verify: [
      "content: title, agreed spread count, and complete story arc",
      "asset counts: generated cover 1 plus one generated illustration or preserved original-photo layout per spread, according to book type",
      "presentation: the cover shown with set_presentation(surface: \"shelf\") and every spread with set_presentation(surface: \"reader\", spreadId); report the revision and undo token",
    ],
    report: creationReportRequirements(requiredCounts),
  };
}
