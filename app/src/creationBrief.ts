import {
  CREATION_READINESS_VERSION,
  GENERATED_COVER_COUNT,
  REQUIRED_GATE_IDS,
  assessCreationReadiness,
  creationCompletionGates,
  creationReportRequirements,
  type CreationBookType,
  type CreationCompletionGate,
  type CreationPhotoPolicy,
  type CreationReadinessAssessment,
  type CreationSourceAsset,
} from "./authoringContract";
import { MAX_BOOK_SPREADS } from "./types";

export const AUTHORING_MODES = ["idea", "photos", "both"] as const;
export type AuthoringMode = (typeof AUTHORING_MODES)[number];

const CREATION_SPREAD_COUNT_MIN = 1;
const CREATION_SPREAD_COUNT_MAX = MAX_BOOK_SPREADS;
const CREATION_SOURCE_ASSET_LIMIT = 24;

export type CreationBriefInput = {
  mode: AuthoringMode;
  spreadCount: number;
  visualDirection: string;
  sourceAssets: readonly CreationSourceAsset[];
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
    if (!asset || typeof asset !== "object") invalid(`sourceAssets[${index}] must be an object.`);
    const id = typeof asset.id === "string" ? asset.id.trim() : "";
    const name = typeof asset.name === "string" ? asset.name.trim() : "";
    if (!id) invalid(`sourceAssets[${index}].id must be a non-empty stable asset id.`);
    if (!name) invalid(`sourceAssets[${index}].name must be a non-empty user-visible name.`);
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
  const sourceAssets = normalizeSourceAssets(input.sourceAssets);
  const bookType = input.bookType ?? (input.mode === "idea" ? "illustrated-storybook" : undefined);
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
    sourceAssets,
    photoPolicy: input.photoPolicy,
  }, {
    validatedSourceAssetIds: input.validatedSourceAssetIds,
  });
  const prompt = [
    "Work on the Apertale page that is open beside this conversation. It is a WebMCP-enabled living-book canvas.",
    `Use creation brief contract version ${CREATION_READINESS_VERSION}. Start with get_project_context(detail: \"creation-readiness\") and pass the structured brief you derive from this conversation.`,
    "Follow the readiness plus two-phase host-side full-book creation contract in the current Codex conversation. Do not skip planning or final asset preparation and jump to layout.",
    `Authoring mode: ${input.mode}.`,
    `Book type: ${bookType ?? "not chosen yet"}.`,
    `Use exactly ${input.spreadCount} spreads and the visual direction: ${visualDirection}.`,
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
    "Phase 1 — inspect, plan, and prepare final assets before any book mutation:",
    "- Inspect the sources and user prompt.",
    "- Define audience or assumption and a complete story arc.",
    "- Plan the title, dedicated generated portrait cover, every spread, and ordered provenance.",
    ...(bookType === "preserved-photo-album"
      ? ["- Use ImageGen for the dedicated portrait cover. Prepare one source-true 2:1 original-photo layout per spread without reillustrating people or changing photo geometry beyond the authorised policy."]
      : ["- Use the host ImageGen/image editing capability to make a dedicated portrait cover and purpose-built full-spread artwork for every spread."]),
    "- Use source photos as references and story truth, not as a lazy final right-page placement unless the user explicitly chose a literal photo-album treatment.",
    ...(bookType === "preserved-photo-album"
      ? [`Required asset counts: generated cover count ${generatedCoverCount}; generated full-spread count 0; preserved original-photo layout count ${preservedPhotoSpreadCount}; provenance entries ${provenanceEntryCount}.`]
      : [`Required generated-art counts: generated cover count ${generatedCoverCount}; generated full-spread count ${generatedFullSpreadCount}; provenance entries ${provenanceEntryCount}.`]),
    "",
    renderSourceAssets(sourceAssets),
    "",
    "Phase 2 — only after the complete asset plan and final asset set exist, lay the book out through Site Tools:",
    "- Call get_project_context(detail: \"creation-readiness\") again with the completed brief. Continue only when ready is true.",
    "- Create a new independent book; never overwrite a curated sample. Pass the same completed creationBrief to manage_book create.",
    "- Create the book through the Site Tools.",
    "- Need a photo from me? Call request_image_handoff with a plain-language reason; it opens the photo drawer in the page and returns the asset ids once I have chosen.",
    "- Set the dedicated portrait cover.",
    "- Apply each spread with sourceAssetId as its original composite, cleanPlateAssetId as its final base, and personalSourceAssetId only for a declared user photo; then add meaningful hover/focus/click interactions.",
    "- Visit the shelf cover and every spread so the current revision has real render evidence.",
    "- Read get_project_context(detail: \"quality-review\"), call manage_book(action: \"begin-critique\"), inspect the actual frames, and record every visual criterion with action record-critique.",
    "- Apply suggested patches and re-check once when needed. Stop after two rounds for missing material or a user decision; publish only when publishAllowed is true.",
    "- Verify all spreads against the completion gates.",
    "You cannot send image bytes through a tool call, and I have to click the file picker myself. Call request_image_handoff and the page will open the drawer with your reason printed in it. Do not pretend a media transfer succeeded.",
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
