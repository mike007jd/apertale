import {
  GENERATED_COVER_COUNT,
  REQUIRED_GATE_IDS,
  creationCompletionGates,
  creationReportRequirements,
  type CreationCompletionGate,
} from "./authoringContract";

export { creationCompletionGates, REQUIRED_GATE_IDS };

export const AUTHORING_MODES = ["idea", "photos", "both"] as const;
export type AuthoringMode = (typeof AUTHORING_MODES)[number];

const CREATION_SPREAD_COUNT_MIN = 1;
const CREATION_SPREAD_COUNT_MAX = 12;
const CREATION_SOURCE_ASSET_LIMIT = 24;

type CreationSourceAsset = {
  id: string;
  name: string;
};

export type CreationBriefInput = {
  mode: AuthoringMode;
  spreadCount: number;
  visualDirection: string;
  sourceAssets: readonly CreationSourceAsset[];
};

export type CreationBrief = {
  mode: AuthoringMode;
  spreadCount: number;
  visualDirection: string;
  sourceAssets: CreationSourceAsset[];
  generatedCoverCount: typeof GENERATED_COVER_COUNT;
  generatedFullSpreadCount: number;
  provenanceEntryCount: number;
  gates: CreationCompletionGate[];
  reportRequirements: string[];
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
  const generatedCoverCount = GENERATED_COVER_COUNT;
  const generatedFullSpreadCount = input.spreadCount;
  const provenanceEntryCount = generatedCoverCount + generatedFullSpreadCount;
  const gates = creationCompletionGates({
    generatedCoverCount,
    generatedFullSpreadCount,
    provenanceEntryCount,
  });
  if (REQUIRED_GATE_IDS.some((id, index) => gates[index]?.id !== id)) invalid("completion gates are incomplete.");
  const reportRequirements = creationReportRequirements({
    generatedCoverCount,
    generatedFullSpreadCount,
  });
  const photoLed = input.mode === "photos" || input.mode === "both";
  const prompt = [
    "Work on the Apertale page that is open beside this conversation. It is a WebMCP-enabled living-book canvas.",
    "Follow this two-phase host-side full-book creation contract in the current Codex conversation. Do not skip planning or generated art and jump to layout.",
    `Authoring mode: ${input.mode}.`,
    `Use exactly ${input.spreadCount} spreads and the visual direction: ${visualDirection}.`,
    photoLed
      ? "Photo-led creation is a planned illustrated book. It cannot be represented as simply placing uploaded source photos on the right page."
      : "Idea-led creation still requires a dedicated generated portrait cover and original full-spread artwork for every spread.",
    ...(input.mode === "both"
      ? ["Honor both the written idea and the selected photos: the idea sets the promise; the photos supply story truth and visual reference."]
      : []),
    "Ask at most one concise question when audience, length, or source use is still material. Otherwise state the assumption and continue.",
    "Do not ask me to repeat this brief inside Apertale.",
    "",
    "Phase 1 — inspect, plan, and generate art before any book mutation:",
    "- Inspect the sources and user prompt.",
    "- Define audience or assumption and a complete story arc.",
    "- Plan the title, dedicated generated portrait cover, every spread, and ordered provenance.",
    "- Use the host ImageGen/image editing capability to make a dedicated portrait cover and purpose-built full-spread artwork for every spread.",
    "- Use source photos as references and story truth, not as a lazy final right-page placement unless the user explicitly chose a literal photo-album treatment.",
    `Required generated-art counts: generated cover count ${generatedCoverCount}; generated full-spread count ${generatedFullSpreadCount}; provenance entries ${provenanceEntryCount}.`,
    "",
    renderSourceAssets(sourceAssets),
    "",
    "Phase 2 — only after the complete asset plan and art set exist, lay the book out through Site Tools:",
    "- First call get_project_context. Create a new independent book; never overwrite a curated sample.",
    "- Create the book through the six Site Tools.",
    "- Import exact assets through supported host transfer or the workshop Image handoff, then refresh get_project_context(detail: \"assets\").",
    "- Set the dedicated portrait cover.",
    "- Apply full-spread backgrounds and meaningful hover/focus/click interactions.",
    "- Verify all spreads against the completion gates.",
    "If the current host cannot transfer an attached or generated image through WebMCP, ask me to use the small Image handoff control in Apertale. Do not pretend a media transfer succeeded.",
    "",
    "Completion gates:",
    renderGates(gates),
    "",
    "Final report must include:",
    renderReportRequirements(reportRequirements),
  ].join("\n");

  return {
    mode: input.mode,
    spreadCount: input.spreadCount,
    visualDirection,
    sourceAssets,
    generatedCoverCount,
    generatedFullSpreadCount,
    provenanceEntryCount,
    gates,
    reportRequirements,
    prompt,
  };
}
