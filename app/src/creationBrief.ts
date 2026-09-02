import {
  CREATION_BOOK_TYPES,
  CREATION_READINESS_VERSION,
  GENERATED_COVER_COUNT,
  REQUIRED_GATE_IDS,
  assessCreationReadiness,
  checkSourceAsset,
  creationCompletionGates,
  supportedBookType,
  creationReportRequirements,
  interactionLayerTarget,
  type CreationBookType,
  type CreationCompletionGate,
  type InteractionDensity,
  type CreationPhotoPolicy,
  type CreationReadinessAssessment,
  type CreationSourceAsset,
} from "./authoringContract";
import { MAX_BOOK_PUBLISHABLE_ASSETS, MAX_BOOK_SPREADS } from "./types";

export const AUTHORING_MODES = ["idea", "photos", "both"] as const;
export type AuthoringMode = (typeof AUTHORING_MODES)[number];

const CREATION_SPREAD_COUNT_MIN = 1;
const CREATION_SPREAD_COUNT_MAX = MAX_BOOK_SPREADS;
export const CREATION_SOURCE_ASSET_LIMIT = 24;

export type CreationBriefInput = {
  mode: AuthoringMode;
  spreadCount: number;
  visualDirection: string;
  interactionDensity?: InteractionDensity;
  sourceAssets: readonly CreationSourceAsset[];
  /** Decided by the caller (see `workshopBookContract`); this module never infers one. */
  bookType?: CreationBookType;
  premise?: string;
  audience?: string;
  photoPolicy?: CreationPhotoPolicy;
  /** Ids the trusted asset adapter already proved to exist, e.g. photos stored by the creation workshop. */
  validatedSourceAssetIds?: readonly string[];
};

export type CreationBrief = {
  sourceAssets: CreationSourceAsset[];
  readiness: CreationReadinessAssessment;
  prompt: string;
};

function invalid(message: string): never {
  throw new TypeError(`Invalid creation brief: ${message}`);
}

function isAuthoringMode(value: string): value is AuthoringMode {
  return (AUTHORING_MODES as readonly string[]).includes(value);
}

function normalizeSourceAssets(raw: CreationBriefInput["sourceAssets"]): CreationSourceAsset[] {
  if (!Array.isArray(raw)) invalid("sourceAssets must be an array.");
  if (raw.length > CREATION_SOURCE_ASSET_LIMIT) invalid(`sourceAssets must contain at most ${CREATION_SOURCE_ASSET_LIMIT} items.`);
  const seen = new Set<string>();
  return raw.map((asset, index) => {
    const checked = checkSourceAsset(asset);
    if (!checked.ok) {
      if (checked.reason === "shape") invalid(`sourceAssets[${index}] must be an object.`);
      if (checked.reason === "id") invalid(`sourceAssets[${index}].id must be a non-empty stable asset id.`);
      invalid(`sourceAssets[${index}].name must be a non-empty user-visible name.`);
    }
    const { id, name } = checked.asset;
    if (/^https?:\/\//i.test(id) || /^https?:\/\//i.test(name)) invalid(`sourceAssets[${index}] must not use a remote URL.`);
    if (seen.has(id)) invalid(`sourceAssets[${index}].id must be unique.`);
    seen.add(id);
    return { id, name };
  });
}

function renderSourceAssets(sourceAssets: readonly CreationSourceAsset[]): string {
  if (sourceAssets.length === 0) {
    return "Selected source assets in order: none yet. Inspect any photos attached in this conversation; do not invent ids.";
  }
  const lines = sourceAssets.map((asset, index) => `${index + 1}. ${asset.id} — ${asset.name}`);
  return `Selected source assets in order:\n${lines.join("\n")}`;
}

function renderGates(gates: readonly CreationCompletionGate[]): string {
  return gates.map((gate) => `${gate.token} ${gate.requirement}`).join("\n");
}

function renderReportRequirements(requirements: readonly string[]): string {
  return requirements.map((requirement, index) => `${index + 1}. ${requirement}`).join("\n");
}

export function buildCreationBrief(input: CreationBriefInput): CreationBrief {
  if (!input || typeof input !== "object") invalid("input must be an object.");
  if (typeof input.mode !== "string" || !isAuthoringMode(input.mode)) invalid("mode must be idea, photos, or both.");
  if (!Number.isInteger(input.spreadCount) || input.spreadCount < CREATION_SPREAD_COUNT_MIN || input.spreadCount > CREATION_SPREAD_COUNT_MAX) {
    invalid(`spreadCount must be an integer from ${CREATION_SPREAD_COUNT_MIN} to ${CREATION_SPREAD_COUNT_MAX}.`);
  }
  const visualDirection = typeof input.visualDirection === "string" ? input.visualDirection.trim() : "";
  if (!visualDirection || visualDirection.length > 120) invalid("visualDirection must be a non-empty string no longer than 120 characters.");
  const interactionDensity = input.interactionDensity ?? "balanced";
  const interactionTarget = interactionLayerTarget(interactionDensity);
  if (interactionTarget.id === "legacy") invalid("interactionDensity must be none, low, balanced, or rich.");
  const sourceAssets = normalizeSourceAssets(input.sourceAssets);
  // The caller decides the book type; this module only validates and renders it.
  // Re-inferring one here would let a brief that never answered the photo
  // question look decided in the prompt while readiness still blocks on it.
  const bookType = input.bookType;
  if (bookType !== undefined && !supportedBookType(bookType)) invalid(`bookType must be one of ${CREATION_BOOK_TYPES.join(", ")}.`);
  const generatedCoverCount = GENERATED_COVER_COUNT;
  const preservedPhotoSpreadCount = bookType === "preserved-photo-album" ? input.spreadCount : 0;
  const generatedFullSpreadCount = preservedPhotoSpreadCount > 0 ? 0 : input.spreadCount;
  const provenanceEntryCount = generatedCoverCount + input.spreadCount;
  const gates = creationCompletionGates({
    generatedCoverCount,
    generatedFullSpreadCount,
    preservedPhotoSpreadCount,
    provenanceEntryCount,
  });
  if (REQUIRED_GATE_IDS.some((id, index) => gates[index]?.id !== id)) invalid("completion gates are incomplete.");
  const reportRequirements = creationReportRequirements({
    generatedCoverCount,
    generatedFullSpreadCount,
    preservedPhotoSpreadCount,
  });
  const photoLed = input.mode === "photos" || input.mode === "both";
  const readiness = assessCreationReadiness({
    contractVersion: CREATION_READINESS_VERSION,
    bookType,
    premise: input.premise,
    audience: input.audience,
    spreadCount: input.spreadCount,
    visualDirection,
    interactionDensity,
    sourceAssets,
    photoPolicy: input.photoPolicy,
  }, {
    validatedSourceAssetIds: input.validatedSourceAssetIds,
  });
  const prompt = [
    "Work on the Apertale page that is open beside this conversation. It is a WebMCP-enabled living-book canvas.",
    `Use creation brief contract version ${CREATION_READINESS_VERSION}. First read get_project_context(detail: \"authoring-guide\"), then call get_project_context(detail: \"creation-readiness\") with the structured brief you derive from this conversation.`,
    "Follow the two-phase host-side full-book creation contract in the current Codex conversation: plan on the page first, generate everything, then lay out through Site Tools.",
    `Authoring mode: ${input.mode}.`,
    `Book type: ${bookType ?? "not chosen yet"}.`,
    `Use exactly ${input.spreadCount} spreads and the visual direction: ${visualDirection}.`,
    `Interactive layer density: ${interactionDensity} (${interactionTarget.count} per spread). Pass interactionDensity: "${interactionDensity}" unchanged in every structured creation brief.`,
    bookType === "preserved-photo-album"
      ? "Preserve each original photo's layout and identity. Use only authorised crop or colour correction, with restrained captions and overlays."
      : photoLed
        ? "Photo-led keepsake creation is a planned illustrated book. It cannot be represented as simply placing uploaded source photos on the right page."
        : "Idea-led creation still requires a dedicated generated portrait cover and original full-spread artwork for every spread.",
    ...(input.mode === "both"
      ? ["Honor both the written idea and the selected photos: the idea sets the promise; the photos supply story truth and visual reference."]
      : []),
    ...(readiness.ready
      ? ["Readiness: ready. Confirm the machine-readable assessment, then continue."]
      : [
          "Readiness: not ready. Ask the following short questions before creating anything:",
          ...readiness.questions.map((question) => `- ${question}`),
        ]),
    "Ask the returned blocking questions together in one concise turn. Do not replace a material photo or identity choice with a default.",
    "Do not ask me to repeat this brief inside Apertale.",
    "",
    "Phase 1 — plan on the page, no image generation yet:",
    "- Inspect the sources and prompt, settle the audience, then write the complete story arc, the title, a dedicated portrait cover plan, and one character bible you will reuse verbatim in every image request.",
    "- Sketch the whole rough book with sketch_storyboard(action: \"replace\"), then end your turn and ask me to circle changes in red on the book or say continue.",
    ...(bookType === "preserved-photo-album"
      ? ["- Use ImageGen for the dedicated portrait cover only. Prepare one source-true original-photo layout per spread for the approximately 1.62:1 stage without reillustrating people or changing photo geometry beyond the authorised policy."]
      : photoLed
        ? ["- Use source photos as references and story truth. Do not use a raw uploaded photo as finished interior or right-page artwork unless the user explicitly requested a literal photo album."]
        : []),
    ...(bookType === "preserved-photo-album"
      ? [`Required asset counts: generated cover count ${generatedCoverCount}; generated full-spread count 0; preserved original-photo layout count ${preservedPhotoSpreadCount}; provenance entries ${provenanceEntryCount}.`]
      : [`Required generated-art counts: generated cover count ${generatedCoverCount}; generated full-spread count ${generatedFullSpreadCount}; provenance entries ${provenanceEntryCount}.`]),
    "",
    renderSourceAssets(sourceAssets),
    "",
    "Phase 2 — after I say continue, generate everything, then lay the book out in two page calls:",
    "- Do not call the page until every image exists. Generate in two concurrent ImageGen rounds: the portrait cover together with one 2×2 sheet per four spreads, then the matching 2×2 clean-plate sheet together with the 2×2 cutout sheet on a flat solid magenta backdrop. Compose every quadrant for the approximately 1.62:1 stage as purpose-built full-spread artwork; the page crops, splits, and upscales the tiles, so never resize, reformat, or inspect pixels locally.",
    `- Transfer every final in one request_image_handoff(assetUse: \"book-art\") with an images array of base64 data URLs (WebP, quality about 85, under 3 MB each; split: true on every sheet, key: true on the cutout sheet; call timeout about 180 s). The result carries every asset id, size, hasMeaningfulAlpha, and heightAtScale1, so go straight to create. Only if inline bytes are impossible, call without images, open work/final-assets in my file manager, ask me to drag its files onto the visible drop target once, then refresh get_project_context(detail: \"assets\").`,
    interactionTarget.maximum === 0
      ? "- Then a single manage_book create call with the same creationBrief, coverAssetId, and every spread's background.sourceAssetId, background.cleanPlateAssetId, the book-type separation, and personalSourceAssetId when declared; each spread manifest must use an empty layers array. Never overwrite a curated sample; a text-only shell is not a book."
      : `- Then a single manage_book create call with the same creationBrief, coverAssetId, and every spread's background.sourceAssetId, background.cleanPlateAssetId, the book-type separation, personalSourceAssetId when declared, and ${interactionTarget.count} native-alpha interactive ${interactionTarget.maximum === 1 ? "layer" : "layers"} placed from the storyboard (story-relevant subjects only). At most ${MAX_BOOK_PUBLISHABLE_ASSETS} reader-visible assets. Never overwrite a curated sample; a text-only shell is not a book.`,
    "- Present the cover with set_presentation(surface: \"shelf\") and every spread with set_presentation(surface: \"reader\", spreadId), then report. Use the same requestId only for an exact retry or a successful mutation with presentation status pending; after any ok:false correction use a fresh requestId.",
    "- Optional polish: get_project_context(detail: \"quality-review\"), manage_book(action: \"begin-critique\"), inspect the actual frames, record-critique; at most two rounds, never block a share.",
    "",
    "Completion gates:",
    renderGates(gates),
    "",
    "Final report must include:",
    renderReportRequirements(reportRequirements),
  ].join("\n");

  return {
    sourceAssets,
    readiness,
    prompt,
  };
}
