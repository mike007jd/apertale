import {
  CREATION_BOOK_TYPES,
  CREATION_READINESS_VERSION,
  GENERATED_COVER_COUNT,
  MAX_BOOK_PUBLISHABLE_ASSETS,
  REQUIRED_GATE_IDS,
  assessCreationReadiness,
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
    "Follow the readiness plus two-phase host-side full-book creation contract in the current Codex conversation. Do not skip planning or final asset preparation and jump to layout.",
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
    "Phase 1 — inspect, plan, and prepare final assets before any book mutation:",
    "- Inspect the sources and user prompt.",
    "- Define audience or assumption and a complete story arc.",
    "- Plan the title, dedicated generated portrait cover, every spread, and ordered provenance.",
    ...(bookType === "preserved-photo-album"
      ? ["- Use ImageGen for the dedicated portrait cover. Prepare one source-true original-photo layout per spread for the approximately 1.62:1 stage without reillustrating people or changing photo geometry beyond the authorised policy."]
      : ["- Use the host ImageGen/image editing capability to make a dedicated portrait cover and purpose-built full-spread artwork for every spread."]),
    "- Compose full-spread artwork for the approximately 1.62:1 stage. The 1.45–2.10 input range is compatibility tolerance, not an art-direction target.",
    "- Before handoff or create, normalize each spread's source composite and clean plate so their original pixel width and height are identical.",
    "- Use source photos as references and story truth, not as a lazy final right-page placement unless the user explicitly chose a literal photo-album treatment.",
    ...(bookType === "preserved-photo-album"
      ? [`Required asset counts: generated cover count ${generatedCoverCount}; generated full-spread count 0; preserved original-photo layout count ${preservedPhotoSpreadCount}; provenance entries ${provenanceEntryCount}.`]
      : [`Required generated-art counts: generated cover count ${generatedCoverCount}; generated full-spread count ${generatedFullSpreadCount}; provenance entries ${provenanceEntryCount}.`]),
    "",
    renderSourceAssets(sourceAssets),
    "",
    "Phase 2 — only after the complete asset plan and final asset set exist, lay the book out through Site Tools:",
    "- Call get_project_context(detail: \"creation-readiness\") again with the completed brief. Continue only when ready is true.",
    "- Need a reference photo from me? Call request_image_handoff with assetUse source-photo and a plain-language reason.",
    "- Need to transfer generated cover, spread, clean-plate, or cutout finals? Call request_image_handoff with assetUse book-art. Those assets stay out of the next source-photo brief.",
    "- Refresh get_project_context(detail: \"assets\") and continue only when every cover, background, composite, cutout, and frame id in the plan exists in the browser registry.",
    `- Deduplicate the browser-local reader-visible cover, resolved final base per spread, rendered layers, and frame ids. At most ${MAX_BOOK_PUBLISHABLE_ASSETS} may be uploaded. Author-only source and personal-photo provenance stays private and is excluded unless it is also selected for rendering.`,
    "- Create one new independent book with a single manage_book create call; never overwrite a curated sample. Pass the same creationBrief, coverAssetId, and every complete spread manifest.",
    interactionTarget.maximum === 0
      ? "- Each spread manifest must use an empty layers array. Do not invent floating cutouts or interactions when interactionDensity is none."
      : `- Each spread manifest must include background.sourceAssetId, background.cleanPlateAssetId, the book-type separation, personalSourceAssetId when declared, and ${interactionTarget.count} native-alpha interactive ${interactionTarget.maximum === 1 ? "layer" : "layers"}. Use only story-relevant subjects; do not pad the count with guessed decoration.`,
    "- A text-only shell is not a book. If any prepared asset is missing, do not create; finish or hand off the asset set first. Use set-cover and apply_scene_patch only for later critique fixes.",
    "- Use the same requestId only for an exact unchanged request. If a successful mutation returns presentation status pending, retry the same requestId to confirm the frame. After any ok:false correction or payload or asset change, use a fresh requestId.",
    "- Present the cover with set_presentation(surface: \"shelf\") and every spread with set_presentation(surface: \"reader\", spreadId). Normal navigation and screenshots are observation only and do not record revision-bound evidence.",
    "- Optional polish: read get_project_context(detail: \"quality-review\"), call manage_book(action: \"begin-critique\"), inspect the actual frames, and record visual criteria with action record-critique.",
    "- If running quality review and no spread declares artwork.personalSourceAssetId, record photo-fidelity-integration with outcome: \"note\" and one evidence item with scope: \"book\" and locator: \"creationBrief.sourceAssets\", explaining that no personal source material exists. When any spread declares one, record per-spread evidence.",
    "- Quality review is optional and advisory. Apply useful patches at most once; never delay or block a user-requested share.",
    "- Verify all spreads against the completion gates.",
    "You cannot send image bytes through a JSON tool argument. Call request_image_handoff with the correct assetUse; it opens the matching drawer and drop target, then returns immediately. Inspect your current tool inventory: if Computer Use or a browser file chooser is available, select the local files yourself. Otherwise open the actual asset directory in my file manager (generated book art is normally in work/final-assets) and ask me to drag its files onto the visible target once. Then refresh get_project_context(detail: \"assets\"). Do not pretend a media transfer succeeded.",
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
