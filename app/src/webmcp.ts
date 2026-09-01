import { bookEngine } from "./bookEngine";
import { BoundedMap } from "./boundedMap";
import { getAssetMetadata, listAssetMetadata } from "./assetStore";
import {
  backgroundAssetUseIssues,
  backgroundPairAssetRoleIssues,
  coverAssetRoleIssues,
  documentAssetRoleIssues,
  foregroundAssetRoleIssues,
  frameSequenceAssetRoleIssues,
  fullSpreadAssetRoleIssues,
  preparedBookAssetIssues,
  sourcePhotoAssetRoleIssues,
} from "./bookAssetContract";
import { isStoredAssetId } from "./assetId";
import { IMAGE_HANDOFF_ASSET_USES, dismissImageHandoff, requestImageHandoff } from "./imageHandoff";
import type { AuthoringSurfaceRequest } from "./authoringSurface";
import { recordDiagnostic } from "./diagnostics";
import { FOCUS_RESPONSES, HOVER_RESPONSES, REVEAL_KINDS } from "./interaction";
import { listProjectAssetReferences } from "./projectArtifact";
import { BOOK_ELEMENT_ID_PATTERN, BOOK_ELEMENT_ID_PATTERN_SOURCE, MOTION_PRESETS, MAX_BOOK_SPREADS, isProceduralAssetId } from "./types";
import type { FocusResponse, HoverResponse, MotionPreset, MotionSpec, PreparedBookBackground, PreparedBookLayer, RevealKind, RevealSpec, ScenePatchOperation, ThemeId, Transform2D } from "./types";
import {
  QUALITY_CONTRACT_VERSION,
  QUALITY_REVIEW_MAX_ROUNDS,
  QUALITY_RUBRIC,
  QUALITY_VISUAL_CRITERION_IDS,
  buildQualityRenderManifest,
  evaluateDeterministicQuality,
  type QualityVisualReviewSubmission,
} from "./qualityContract";
import {
  AUTHORING_GUIDE_DETAIL,
  CREATION_BOOK_TYPES,
  CREATION_READINESS_VERSION,
  MAX_BOOK_PUBLISHABLE_ASSETS,
  PHOTO_SOURCE_USES,
  PROJECT_CONTEXT_DETAILS,
  SITE_TOOL,
  assessCreationReadiness,
  buildAuthoringGuide,
  creationBriefSourceAssetIds,
  type CreationBriefPayload,
} from "./authoringContract";

type ToolInput = Record<string, unknown>;
const uncancelledToolSignal = new AbortController().signal;

function invalid(message: string): never {
  throw new TypeError(`Invalid WebMCP input: ${message}`);
}

function assertOnly(input: ToolInput, allowed: string[]) {
  const unexpected = Object.keys(input).find((key) => !allowed.includes(key));
  if (unexpected) invalid(`unexpected property ${unexpected}.`);
}

function requiredString(input: ToolInput, key: string) {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) invalid(`${key} must be a non-empty string.`);
  return value;
}

function requiredRevision(input: ToolInput) {
  const value = input.expectedRevision;
  if (!Number.isInteger(value) || Number(value) < 1) invalid("expectedRevision must be an integer greater than zero.");
  return Number(value);
}

function requiredDocumentId(input: ToolInput) {
  return requiredString(input, "expectedDocumentId");
}

function documentPreconditionConflict(expectedDocumentId: string, expectedRevision: number) {
  const currentDocument = bookEngine.getSnapshot().document;
  if (expectedDocumentId === currentDocument.id && expectedRevision === currentDocument.revision) return null;
  return {
    ok: false as const,
    code: "revision_conflict" as const,
    currentRevision: currentDocument.revision,
    summary: `Expected ${expectedDocumentId} at revision ${expectedRevision}; refresh context before changing this book.`,
  };
}

function boundedString(input: ToolInput, key: string, maximum: number): string;
function boundedString(input: ToolInput, key: string, maximum: number, optional: true): string | undefined;
function boundedString(input: ToolInput, key: string, maximum: number, optional = false): string | undefined {
  const value = input[key];
  if (typeof value === "undefined" && optional) return undefined;
  if (typeof value !== "string" || (!optional && value.trim().length === 0) || value.trim().length > maximum) {
    invalid(`${key} must be ${optional ? "a" : "a non-empty"} string no longer than ${maximum} characters.`);
  }
  return value.trim();
}

function slug(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "spread";
}

function optionalBoundedNumber(input: ToolInput, key: string, minimum: number, maximum: number) {
  const value = input[key];
  if (typeof value === "undefined") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    invalid(`${key} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function pick<T extends string>(value: unknown, name: string, allowed: readonly T[]) {
  if (typeof value === "undefined") return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) invalid(`${name} is not supported.`);
  return value as T;
}

function parseTransform(raw: unknown) {
  if (typeof raw === "undefined") return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid("transform must be an object.");
  const value = raw as ToolInput;
  assertOnly(value, ["x", "y", "scaleX", "scaleY", "rotationDeg"]);
  const transform: Partial<Transform2D> = {
    x: optionalBoundedNumber(value, "x", 0, 1),
    y: optionalBoundedNumber(value, "y", 0, 1),
    scaleX: optionalBoundedNumber(value, "scaleX", 0.3, 1.8),
    scaleY: optionalBoundedNumber(value, "scaleY", 0.3, 1.8),
    rotationDeg: optionalBoundedNumber(value, "rotationDeg", -180, 180),
  };
  Object.keys(transform).forEach((key) => typeof transform[key as keyof Transform2D] === "undefined" && delete transform[key as keyof Transform2D]);
  if (Object.keys(transform).length === 0) invalid("transform must include at least one field.");
  return transform;
}

function parseReveal(raw: unknown): RevealSpec | undefined {
  if (typeof raw === "undefined") return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid("reveal must be an object.");
  const value = raw as ToolInput;
  assertOnly(value, ["kind", "title", "summary", "facts", "source"]);
  const kind = pick<RevealKind>(value.kind, "reveal.kind", REVEAL_KINDS);
  if (!kind) invalid("reveal.kind is required.");
  const title = boundedString(value, "title", 100, true) ?? "";
  const summary = boundedString(value, "summary", 500, true) ?? "";
  if (kind !== "none" && title.length === 0) invalid("reveal.title is required for a visible reveal.");
  const facts = typeof value.facts === "undefined" ? [] : value.facts;
  if (!Array.isArray(facts) || facts.length > 8) invalid("reveal.facts must contain at most 8 facts.");
  return {
    kind,
    title,
    summary,
    facts: facts.map((rawFact, factIndex) => {
      if (!rawFact || typeof rawFact !== "object" || Array.isArray(rawFact)) invalid(`reveal.facts[${factIndex}] must be an object.`);
      const fact = rawFact as ToolInput;
      assertOnly(fact, ["label", "value"]);
      return { label: boundedString(fact, "label", 64), value: boundedString(fact, "value", 160) };
    }),
    source: boundedString(value, "source", 200, true),
  };
}

function parseMotion(raw: unknown): MotionSpec | null | undefined {
  if (typeof raw === "undefined" || raw === null) return raw;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid("motion must be an object or null.");
  const value = raw as ToolInput;
  assertOnly(value, ["preset", "durationMs", "loop"]);
  const preset = pick<MotionPreset>(value.preset, "motion.preset", [...MOTION_PRESETS]);
  const durationMs = optionalBoundedNumber(value, "durationMs", 400, 20000);
  if (!preset || !Number.isInteger(durationMs) || typeof value.loop !== "boolean") invalid("motion requires preset, integer durationMs, and loop.");
  return { preset, durationMs: Number(durationMs), loop: value.loop };
}

function parseFrames(raw: unknown): string[] | null | undefined {
  if (typeof raw === "undefined" || raw === null) return raw;
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 6 || raw.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    invalid("frameAssetIds must contain 2–6 asset ids.");
  }
  return raw.map((item) => String(item));
}

function stableElementId(value: ToolInput, field: string) {
  const id = boundedString(value, field, 64);
  if (!BOOK_ELEMENT_ID_PATTERN.test(id)) {
    invalid(`${field} must start with a lowercase letter or digit and contain only lowercase letters, digits, and hyphens.`);
  }
  return id;
}

const sceneOperationKeys = ["op", "cleanPlateAssetId", "sourceAssetId", "personalSourceAssetId", "separation", "id", "elementId", "label", "assetId", "frameAssetIds", "page", "kind", "transform", "depth", "locked", "motion", "hover", "focus", "reveal", "index"];

function parseSceneOperation(raw: unknown, index: number): ScenePatchOperation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid(`operations[${index}] must be an object.`);
  const value = raw as ToolInput;
  const op = requiredString(value, "op");
  assertOnly(value, sceneOperationKeys);
  if (op === "set-background") {
    return {
      op,
      cleanPlateAssetId: requiredString(value, "cleanPlateAssetId"),
      sourceAssetId: boundedString(value, "sourceAssetId", 200),
      personalSourceAssetId: boundedString(value, "personalSourceAssetId", 200, true),
      separation: pick(value.separation, "separation", ["inpainted-clean-plate", "preserved-photo-layout"] as const),
    };
  }
  if (op === "remove") return { op, elementId: requiredString(value, "elementId") };
  if (op === "reorder") {
    const order = optionalBoundedNumber(value, "index", 0, 23);
    if (!Number.isInteger(order)) invalid("reorder index must be an integer.");
    return { op, elementId: requiredString(value, "elementId"), index: Number(order) };
  }
  const transform = parseTransform(value.transform);
  const hover = pick<HoverResponse>(value.hover, "hover", HOVER_RESPONSES);
  const focus = pick<FocusResponse>(value.focus, "focus", FOCUS_RESPONSES);
  const reveal = parseReveal(value.reveal);
  const depth = optionalBoundedNumber(value, "depth", 0, 0.5);
  if (typeof value.locked !== "undefined" && typeof value.locked !== "boolean") invalid("locked must be boolean.");
  const motion = parseMotion(value.motion);
  const frameAssetIds = parseFrames(value.frameAssetIds);
  if (frameAssetIds?.some(isProceduralAssetId)) {
    invalid(`operations[${index}].frameAssetIds must contain image assets, not procedural markers.`);
  }
  if (op === "add") {
    const page = pick(value.page, "page", ["left", "right"] as const);
    if (!page) invalid("add requires page.");
    const id = stableElementId(value, "id");
    const assetId = requiredString(value, "assetId");
    if (frameAssetIds?.length && frameAssetIds[0] !== assetId) {
      invalid(`operations[${index}].frameAssetIds[0] must equal assetId so the resting frame is stable.`);
    }
    return {
      op,
      id,
      label: boundedString(value, "label", 64),
      assetId,
      frameAssetIds: frameAssetIds ?? undefined,
      page,
      kind: pick(value.kind, "kind", ["embedded", "lifted", "decoration"] as const),
      transform,
      depth,
      locked: value.locked as boolean | undefined,
      motion: motion ?? undefined,
      hover,
      focus,
      reveal,
    };
  }
  if (op !== "update") invalid("op must be set-background, add, update, remove, or reorder.");
  const kind = pick(value.kind, "kind", ["embedded", "lifted", "decoration"] as const);
  if (!kind && !transform && typeof depth === "undefined" && typeof value.locked === "undefined" && typeof motion === "undefined" && typeof frameAssetIds === "undefined" && !hover && !focus && !reveal) {
    invalid("update requires at least one change.");
  }
  return { op, elementId: requiredString(value, "elementId"), kind, transform, depth, locked: value.locked as boolean | undefined, motion, frameAssetIds, hover, focus, reveal };
}

async function runTool(name: string, signal: AbortSignal, operation: () => unknown) {
  recordDiagnostic("webmcp:tool-start", { name });
  try {
    canceled(signal);
    const result = await operation();
    canceled(signal);
    recordDiagnostic("webmcp:tool-success", { name });
    return JSON.stringify(result);
  } catch (error) {
    const aborted = signal.aborted || (error instanceof DOMException && error.name === "AbortError");
    recordDiagnostic(aborted ? "webmcp:tool-canceled" : "webmcp:tool-failure", {
      name,
      error: error instanceof Error ? error.name : "UnknownError",
    });
    throw error;
  }
}

const requiredMutation = {
  requestId: { type: "string", description: "Reuse for an exact unchanged request or successful presentation-pending resume; after ok:false correction or payload or asset changes, use a fresh id." },
  expectedDocumentId: { type: "string", description: "Document id returned by get_project_context together with expectedRevision." },
  expectedRevision: { type: "integer", minimum: 1, description: "Document revision returned by get_project_context." },
};

const requiredMutationFields = ["requestId", "expectedDocumentId", "expectedRevision"];

const revealSchema = {
  type: "object",
  description: "Safe visible knowledge shown when the reader selects this element.",
  properties: {
    kind: { type: "string", enum: REVEAL_KINDS },
    title: { type: "string", maxLength: 100 },
    summary: { type: "string", maxLength: 500 },
    facts: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          label: { type: "string", minLength: 1, maxLength: 64 },
          value: { type: "string", minLength: 1, maxLength: 160 },
        },
        required: ["label", "value"],
        additionalProperties: false,
      },
    },
    source: { type: "string", maxLength: 200 },
  },
  required: ["kind", "title", "summary"],
  additionalProperties: false,
};

const transformSchema = {
  type: "object",
  properties: {
    x: { type: "number", minimum: 0, maximum: 1 },
    y: { type: "number", minimum: 0, maximum: 1 },
    scaleX: { type: "number", minimum: 0.3, maximum: 1.8 },
    scaleY: { type: "number", minimum: 0.3, maximum: 1.8 },
    rotationDeg: { type: "number", minimum: -180, maximum: 180 },
  },
  additionalProperties: false,
};

const motionSchema = {
  type: "object",
  properties: {
    preset: { type: "string", enum: [...MOTION_PRESETS] },
    durationMs: { type: "integer", minimum: 400, maximum: 20000 },
    loop: { type: "boolean" },
  },
  required: ["preset", "durationMs", "loop"],
  additionalProperties: false,
};

const preparedBackgroundSchema = {
  type: "object",
  description: "Prepared full-spread composite, final base, and optional personal-photo provenance.",
  properties: {
    cleanPlateAssetId: { type: "string", description: "Verified final base composed for the approximately 1.62:1 stage." },
    sourceAssetId: { type: "string", description: "Verified original full-spread composite asset." },
    personalSourceAssetId: { type: "string", description: "Declared source photo when the brief uses personal photos." },
    separation: { type: "string", enum: ["inpainted-clean-plate", "preserved-photo-layout"] },
  },
  required: ["cleanPlateAssetId", "sourceAssetId", "separation"],
  additionalProperties: false,
};

const preparedLayerSchema = {
  type: "object",
  description: "Prepared native-alpha foreground layer with an authored interaction.",
  properties: {
    id: { type: "string", minLength: 1, maxLength: 64, pattern: BOOK_ELEMENT_ID_PATTERN_SOURCE, description: "Stable lowercase id using only letters, digits, and hyphens." },
    label: { type: "string", minLength: 1, maxLength: 64 },
    assetId: { type: "string", description: "Verified browser-local cutout asset." },
    frameAssetIds: { type: "array", minItems: 2, maxItems: 6, items: { type: "string" }, description: "Optional animation frames; the first item must equal assetId and is the resting frame." },
    page: { type: "string", enum: ["left", "right"] },
    kind: { type: "string", enum: ["embedded", "lifted", "decoration"] },
    transform: transformSchema,
    depth: { type: "number", minimum: 0, maximum: 0.5 },
    locked: { type: "boolean" },
    motion: motionSchema,
    hover: { type: "string", enum: HOVER_RESPONSES },
    focus: { type: "string", enum: FOCUS_RESPONSES },
    reveal: revealSchema,
  },
  required: ["id", "label", "assetId", "page"],
  additionalProperties: false,
};

const creationBriefSchema = {
  type: "object",
  description: "Versioned brief used by creation-readiness and reused unchanged by manage_book create after every blocker is resolved.",
  properties: {
    contractVersion: { type: "integer", enum: [CREATION_READINESS_VERSION] },
    bookType: { type: "string", enum: [...CREATION_BOOK_TYPES] },
    premise: { type: "string", maxLength: 500 },
    audience: { type: "string", maxLength: 160 },
    spreadCount: { type: "integer", minimum: 1, maximum: 12 },
    visualDirection: { type: "string", maxLength: 160 },
    sourceAssets: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        properties: {
          id: { type: "string", maxLength: 128 },
          name: { type: "string", maxLength: 128 },
        },
        required: ["id", "name"],
        additionalProperties: false,
      },
    },
    photoPolicy: {
      type: "object",
      properties: {
        sourceUse: { type: "string", enum: [...PHOTO_SOURCE_USES] },
        preserveIdentity: { type: "boolean" },
        allowFaceChanges: { type: "boolean" },
        allowCrop: { type: "boolean" },
        allowColorCorrection: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

const qualityEvidenceSchema = {
  type: "object",
  properties: {
    scope: { type: "string", enum: ["book", "cover", "spread"] },
    spreadId: { type: "string", maxLength: 128 },
    locator: { type: "string", minLength: 1, maxLength: 200 },
    description: { type: "string", minLength: 1, maxLength: 300 },
  },
  required: ["scope", "locator", "description"],
  additionalProperties: false,
};

const qualityReviewSchema = {
  type: "object",
  description: "Visual critique for the current rendered revision. Include every visual rubric criterion once.",
  properties: {
    contractVersion: { type: "integer", enum: [QUALITY_CONTRACT_VERSION] },
    reviewedRevision: { type: "integer", minimum: 1 },
    expectedRound: { type: "integer", minimum: 1, maximum: QUALITY_REVIEW_MAX_ROUNDS },
    sampleReady: { type: "boolean" },
    summary: { type: "string", minLength: 1, maxLength: 800 },
    checks: {
      type: "array",
      minItems: QUALITY_VISUAL_CRITERION_IDS.length,
      maxItems: QUALITY_VISUAL_CRITERION_IDS.length,
      items: {
        type: "object",
        properties: {
          criterionId: { type: "string", enum: [...QUALITY_VISUAL_CRITERION_IDS] },
          outcome: { type: "string", enum: ["pass", "blocker", "warn", "note"] },
          message: { type: "string", minLength: 1, maxLength: 800 },
          evidence: { type: "array", minItems: 1, maxItems: 24, items: qualityEvidenceSchema },
          suggestedPatch: { type: "string", maxLength: 800 },
        },
        required: ["criterionId", "outcome", "message", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["contractVersion", "reviewedRevision", "expectedRound", "sampleReady", "summary", "checks"],
  additionalProperties: false,
};

function canceled(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Tool execution was canceled.", "AbortError");
}

async function inspectCurrentDocumentAssetRoles(
  creationBrief: CreationBriefPayload | undefined,
  signal: AbortSignal,
) {
  const snapshot = bookEngine.getSnapshot();
  const declaredSourceAssetIds = creationBriefSourceAssetIds(creationBrief);
  const localAssetIds = [...new Set([
    ...listProjectAssetReferences(snapshot.document).map((reference) => reference.assetId),
    ...declaredSourceAssetIds,
  ].filter(isStoredAssetId))];
  const metadata = await getAssetMetadata(localAssetIds);
  canceled(signal);
  return {
    validatedSourceAssetIds: metadata
      .filter((asset) => asset.assetUse === "source-photo" && declaredSourceAssetIds.includes(asset.id))
      .map((asset) => asset.id),
    issues: documentAssetRoleIssues(snapshot.document, metadata, declaredSourceAssetIds),
  };
}

function assetRoleFailure(issues: readonly string[]) {
  return {
    ok: false as const,
    code: "creation_artifact_incomplete" as const,
    currentRevision: bookEngine.getSnapshot().document.revision,
    summary: "This book contains assets whose stored roles do not match their reader-facing use.",
    issues: [...issues],
  };
}

export function registerWebMcpTools(
  onStatus: (available: boolean) => void,
  presentAuthoringSurface: (request: AuthoringSurfaceRequest, signal: AbortSignal) => void | Promise<void> = () => undefined,
  onToolStart: () => void = () => undefined,
) {
  if (!document.modelContext?.registerTool) {
    recordDiagnostic("webmcp:unavailable");
    onStatus(false);
    return () => undefined;
  }

  const controller = new AbortController();
  const registerTool = document.modelContext.registerTool.bind(document.modelContext);
  let registeredCount = 0;
  const register: typeof registerTool = (tool, options) => registerTool(tool, options).then(() => {
    registeredCount += 1;
  });
  const runRegisteredTool = (name: string, signal: AbortSignal, operation: () => unknown) => {
    onToolStart();
    return runTool(name, signal, operation);
  };
  const sessionResults = new BoundedMap<string, unknown>(128);
  const remember = <Result>(requestId: string, result: Result): Result => {
    sessionResults.set(requestId, result);
    return result;
  };
  type PendingPresentation = {
    result: unknown;
    target: {
      documentId: string;
      revision: number;
      surface: "reader" | "shelf";
      spreadId?: string;
      theme: ThemeId;
      preview: boolean;
    };
  };
  const pendingPresentations = new BoundedMap<string, PendingPresentation>(16);
  const activeImageHandoffs = new Map<string, ReturnType<typeof requestImageHandoff>>();
  const CANCELLED_HANDOFF_REASON = "The request was cancelled before the reader chose.";
  const cancelActiveImageHandoffs = () => {
    activeImageHandoffs.forEach((_, requestId) => dismissImageHandoff(requestId, CANCELLED_HANDOFF_REASON));
    activeImageHandoffs.clear();
  };
  let authoringGuideRead = false;
  const resumePresentation = async (requestId: string, signal: AbortSignal) => {
    const pending = pendingPresentations.get(requestId);
    if (!pending) return undefined;
    if (bookEngine.getSnapshot().document.id !== pending.target.documentId) {
      const openResult = await bookEngine.openBookCoordinated(pending.target.documentId, "agent", signal);
      if (!openResult.ok) {
        invalid("The book targeted by this presentation is no longer present in the library.");
      }
    }
    let presented = bookEngine.getSnapshot();
    if (presented.document.revision !== pending.target.revision) {
      invalid("The book revision targeted by this presentation is no longer current; use a new requestId.");
    }
    if (pending.target.theme && presented.session.sceneThemeId !== pending.target.theme) {
      bookEngine.setTheme(pending.target.theme, "agent");
    }
    if (typeof pending.target.preview === "boolean" && presented.session.preview !== pending.target.preview) {
      bookEngine.setPreview(pending.target.preview, "agent");
    }
    if (pending.target.spreadId) {
      const spreadIndex = presented.document.spreads.findIndex((spread) => spread.id === pending.target.spreadId);
      if (spreadIndex < 0) invalid("The spread targeted by this presentation is no longer present in the book.");
      if (spreadIndex !== presented.session.currentSpreadIndex) bookEngine.setSpread(spreadIndex);
    }
    presented = bookEngine.getSnapshot();
    try {
      await presentAuthoringSurface({
        requestId,
        surface: pending.target.surface,
        documentId: pending.target.documentId,
        revision: pending.target.revision,
        spreadId: pending.target.surface === "reader" ? pending.target.spreadId : undefined,
        theme: pending.target.theme,
        preview: pending.target.preview,
      }, signal);
    } catch (reason) {
      recordDiagnostic("webmcp:presentation-pending", {
        requestId,
        documentId: pending.target.documentId,
        error: reason instanceof Error ? reason.name : "UnknownError",
      });
      return {
        ...(pending.result && typeof pending.result === "object" ? pending.result : { result: pending.result }),
        presentation: {
          status: "pending",
          summary: "The project change succeeded, but the exact visible frame was not confirmed. Retry the same requestId to resume presentation without repeating the mutation.",
        },
      };
    }
    pendingPresentations.delete(requestId);
    sessionResults.set(requestId, pending.result);
    return pending.result;
  };

  const registrations = [
    register(
      {
        name: SITE_TOOL.context,
        title: "Get project context",
        description: "Inspect Apertale. Create flow: authoring-guide → creation-readiness → ask every returned blocking question → create with the same brief. After rendering, read quality-review, inspect real frames, record critique, patch at most twice, then publish only when allowed.",
        inputSchema: {
          type: "object",
          properties: {
            detail: {
              type: "string",
              enum: [...PROJECT_CONTEXT_DETAILS],
              description: "Use creation-readiness before create and quality-review after real rendering; assets lists imports.",
            },
            creationBrief: creationBriefSchema,
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input, options) => runRegisteredTool(SITE_TOOL.context, options?.signal ?? uncancelledToolSignal, async () => {
          assertOnly(input, ["detail", "creationBrief"]);
          const detail = typeof input.detail === "undefined" ? "compact" : requiredString(input, "detail");
          if (!(PROJECT_CONTEXT_DETAILS as readonly string[]).includes(detail)) invalid("detail is not supported.");
          const context = bookEngine.getContext(detail === "selected-reveal");
          const snapshot = bookEngine.getSnapshot();
          const currentSpread = snapshot.document.spreads[snapshot.session.currentSpreadIndex];
          const creationBrief = input.creationBrief as CreationBriefPayload | undefined;
          const sourceAssetIds = creationBriefSourceAssetIds(creationBrief);
          const validatedSourceAssets = detail === "creation-readiness" && sourceAssetIds.length > 0
            ? await getAssetMetadata(sourceAssetIds)
            : [];
          const validatedSourceAssetIds = validatedSourceAssets
            .filter((asset) => asset.assetUse === "source-photo")
            .map((asset) => asset.id);
          const qualityLifecycle = detail === "quality-review" ? bookEngine.getQualityLifecycle() : null;
          const result = {
            ...context,
            assets: detail === "assets"
              ? await listAssetMetadata()
              : await getAssetMetadata(currentSpread.elements.map((element) => element.assetId)),
            ...(detail === AUTHORING_GUIDE_DETAIL ? { authoringGuide: buildAuthoringGuide() } : {}),
            ...(detail === "creation-readiness"
              ? {
                  creationReadiness: assessCreationReadiness(creationBrief, {
                    validatedSourceAssetIds,
                  }),
                }
              : {}),
            ...(detail === "quality-review"
              ? {
                  qualityReview: {
                    rubric: QUALITY_RUBRIC,
                    review: bookEngine.getQualityGate(),
                    deterministicChecks: evaluateDeterministicQuality(snapshot.document, qualityLifecycle?.renderEvidence ?? [], qualityLifecycle?.creationBrief),
                    renderManifest: buildQualityRenderManifest(snapshot.document, globalThis.location?.href ?? ""),
                    renderEvidence: qualityLifecycle?.renderEvidence ?? [],
                    creationBrief: qualityLifecycle?.creationBrief ?? null,
                    instructions: qualityLifecycle?.creationBrief?.bookType
                      ? "Call manage_book action begin-critique. Use set_presentation(surface: \"shelf\") for the cover and set_presentation(surface: \"reader\", spreadId) for every spread, then inspect each frame with the host screenshot capability. Normal navigation and screenshots are observation only and do not record revision-bound evidence. Record every visual criterion with action record-critique. When no spread declares artwork.personalSourceAssetId, record photo-fidelity-integration with outcome: \"note\" and one evidence item with scope: \"book\" and locator: \"creationBrief.sourceAssets\", explaining that no personal source material exists; when any spread declares one, record per-spread evidence. Schema evidence is not an aesthetic judgment."
                      : "No creation brief is attached. Curated samples keep shipped provenance; for a legacy personal book, pass a complete brief through creation-readiness and call manage_book action adopt-creation-brief at this revision before critique.",
                  },
                }
              : {}),
          };
          if (detail === AUTHORING_GUIDE_DETAIL) authoringGuideRead = true;
          return result;
        }),
      },
      { signal: controller.signal },
    ),
    register(
      {
        name: SITE_TOOL.manageBook,
        title: "Manage book",
        description: "Open, atomically create a complete prepared book from the exact brief, adopt-creation-brief for one legacy book, set a cover, begin critique, or record critique. Create requires a verified cover and every spread's final base plus 2–4 layers, including preserved-photo-album layouts. If assets are incomplete, do not mutate or enter the shelf or reader. Render and inspect every frame; never publish with blockers.",
        inputSchema: {
          type: "object",
          properties: {
            ...requiredMutation,
            action: { type: "string", enum: ["open", "create", "adopt-creation-brief", "set-cover", "begin-critique", "record-critique"] },
            bookId: { type: "string", description: "Stable id from library.books when action is open." },
            coverAssetId: { type: "string", description: "Verified browser-local portrait cover id. Required for create and set-cover." },
            title: { type: "string", minLength: 1, maxLength: 100 },
            spreads: {
              type: "array",
              minItems: 1,
              maxItems: MAX_BOOK_SPREADS,
              items: {
                type: "object",
                properties: {
                  title: { type: "string", minLength: 1, maxLength: 100 },
                  body: { type: "string", minLength: 1, maxLength: 800 },
                  kicker: { type: "string", maxLength: 100 },
                  background: preparedBackgroundSchema,
                  layers: {
                    type: "array",
                    minItems: 2,
                    maxItems: 4,
                    items: preparedLayerSchema,
                    description: "Two to four native-alpha foreground layers; at least one needs an authored interaction.",
                  },
                },
                required: ["title", "body", "background", "layers"],
                additionalProperties: false,
              },
            },
            creationBrief: creationBriefSchema,
            qualityReview: qualityReviewSchema,
          },
          // Every manage action consumes the inspected revision, including
          // navigation that changes the active document context.
          required: [...requiredMutationFields, "action"],
          oneOf: [
            { properties: { action: { const: "open" } }, required: ["bookId"] },
            {
              properties: { action: { const: "create" } },
              required: ["title", "coverAssetId", "spreads", "creationBrief"],
            },
            { properties: { action: { const: "adopt-creation-brief" } }, required: ["creationBrief"] },
            { properties: { action: { const: "set-cover" } }, required: ["coverAssetId"] },
            { properties: { action: { const: "begin-critique" } } },
            { properties: { action: { const: "record-critique" } }, required: ["qualityReview"] },
          ],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input, options) => runRegisteredTool(SITE_TOOL.manageBook, options?.signal ?? uncancelledToolSignal, async () => {
          assertOnly(input, [...requiredMutationFields, "action", "bookId", "coverAssetId", "title", "spreads", "creationBrief", "qualityReview"]);
          const requestId = requiredString(input, "requestId");
          if (pendingPresentations.has(requestId)) {
            return resumePresentation(requestId, options?.signal ?? uncancelledToolSignal);
          }
          const prior = sessionResults.get(requestId);
          if (prior) return prior;
          const action = requiredString(input, "action");
          const expectedDocumentId = requiredDocumentId(input);
          const expectedRevision = requiredRevision(input);
          const preconditionConflict = documentPreconditionConflict(expectedDocumentId, expectedRevision);
          if (preconditionConflict) {
            return remember(requestId, preconditionConflict);
          }
          if (action === "open") {
            const bookId = requiredString(input, "bookId");
            const openResult = await bookEngine.openBookCoordinated(bookId, "agent", options?.signal, {
              documentId: expectedDocumentId,
              revision: expectedRevision,
            });
            if (!openResult.ok) {
              if (openResult.code === "revision_conflict") {
                return remember(requestId, openResult);
              }
              invalid(openResult.summary);
            }
            const opened = bookEngine.getSnapshot();
            const result = { ok: true, bookId, summary: `Opened ${opened.document.title}.` };
            pendingPresentations.set(requestId, {
              result,
              target: {
                documentId: bookId,
                revision: opened.document.revision,
                surface: "reader",
                spreadId: opened.document.spreads[opened.session.currentSpreadIndex]?.id,
                theme: opened.session.sceneThemeId,
                preview: opened.session.preview,
              },
            });
            return resumePresentation(requestId, options?.signal ?? uncancelledToolSignal);
          }
          if (action === "set-cover") {
            const coverAssetId = requiredString(input, "coverAssetId");
            const validatedAssets = await getAssetMetadata([coverAssetId]);
            canceled(options?.signal ?? uncancelledToolSignal);
            const conflict = documentPreconditionConflict(expectedDocumentId, expectedRevision);
            if (conflict) {
              return remember(requestId, conflict);
            }
            const roleIssues = coverAssetRoleIssues(coverAssetId, validatedAssets);
            if (roleIssues.length > 0) {
              const result = {
                ok: false as const,
                code: "invalid" as const,
                currentRevision: bookEngine.getSnapshot().document.revision,
                summary: roleIssues[0],
              };
              return remember(requestId, result);
            }
            const result = await bookEngine.dispatchCoordinated({
              type: "set-book-cover",
              requestId,
              expectedDocumentId,
              expectedRevision,
              assetId: coverAssetId,
              validatedLocalAssetIds: validatedAssets.map((asset) => asset.id),
            }, "agent", options?.signal);
            return remember(requestId, result);
          }
          if (action === "begin-critique" || action === "record-critique") {
            const creationBrief = bookEngine.getQualityLifecycle()?.creationBrief;
            if (creationBrief) {
              const validation = await inspectCurrentDocumentAssetRoles(
                creationBrief,
                options?.signal ?? uncancelledToolSignal,
              );
              const conflict = documentPreconditionConflict(expectedDocumentId, expectedRevision);
              if (conflict) {
                return remember(requestId, conflict);
              }
              if (validation.issues.length > 0) {
                return remember(requestId, assetRoleFailure(validation.issues));
              }
            }
            const result = action === "begin-critique"
              ? await bookEngine.beginQualityReviewCoordinated(
                expectedDocumentId,
                expectedRevision,
                options?.signal,
              )
              : await bookEngine.recordQualityReviewCoordinated(
                input.qualityReview as QualityVisualReviewSubmission,
                expectedDocumentId,
                expectedRevision,
                options?.signal,
              );
            return remember(requestId, result);
          }
          if (action === "adopt-creation-brief") {
            if (!authoringGuideRead) invalid("read get_project_context with detail authoring-guide before attaching a creation brief.");
            const creationBrief = input.creationBrief as CreationBriefPayload | undefined;
            const validation = await inspectCurrentDocumentAssetRoles(
              creationBrief,
              options?.signal ?? uncancelledToolSignal,
            );
            const conflict = documentPreconditionConflict(expectedDocumentId, expectedRevision);
            if (conflict) {
              return remember(requestId, conflict);
            }
            const result = await bookEngine.adoptCreationBriefCoordinated(
              creationBrief ?? {},
              validation.validatedSourceAssetIds,
              expectedDocumentId,
              expectedRevision,
              validation.issues,
              options?.signal,
            );
            return remember(requestId, result);
          }
          if (action !== "create") invalid("action must be open, create, adopt-creation-brief, set-cover, begin-critique, or record-critique.");
          if (!authoringGuideRead) {
            invalid("read get_project_context with detail authoring-guide before creating a book.");
          }
          const creationBrief = input.creationBrief as CreationBriefPayload | undefined;
          const sourceAssetIds = creationBriefSourceAssetIds(creationBrief);
          const validatedSourceAssets = await getAssetMetadata(sourceAssetIds);
          canceled(options?.signal ?? uncancelledToolSignal);
          const sourceValidationConflict = documentPreconditionConflict(expectedDocumentId, expectedRevision);
          if (sourceValidationConflict) {
            return remember(requestId, sourceValidationConflict);
          }
          const validatedSourceAssetIds = validatedSourceAssets
            .filter((asset) => asset.assetUse === "source-photo")
            .map((asset) => asset.id);
          const title = boundedString(input, "title", 100);
          if (!Array.isArray(input.spreads) || input.spreads.length < 1 || input.spreads.length > MAX_BOOK_SPREADS) invalid(`spreads must contain 1–${MAX_BOOK_SPREADS} spread drafts.`);
          const readiness = assessCreationReadiness(creationBrief, {
            expectedSpreadCount: input.spreads.length,
            validatedSourceAssetIds,
          });
          if (!readiness.ready) {
            const result = {
              ok: false as const,
              code: "creation_not_ready" as const,
              currentRevision: bookEngine.getSnapshot().document.revision,
              summary: "This creation brief needs a little more information before Apertale can create the book.",
              readiness,
            };
            return remember(requestId, result);
          }
          const coverAssetId = requiredString(input, "coverAssetId");
          const spreads = input.spreads.map((raw, index) => {
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid(`spreads[${index}] must be an object.`);
            const draft = raw as ToolInput;
            assertOnly(draft, ["title", "body", "kicker", "background", "layers"]);
            const spreadTitle = boundedString(draft, "title", 100);
            if (!draft.background || typeof draft.background !== "object" || Array.isArray(draft.background)) {
              invalid(`spreads[${index}].background must be a prepared asset object.`);
            }
            const backgroundInput = draft.background as ToolInput;
            assertOnly(backgroundInput, ["cleanPlateAssetId", "sourceAssetId", "personalSourceAssetId", "separation"]);
            const backgroundOperation = parseSceneOperation({ ...backgroundInput, op: "set-background" }, index);
            if (backgroundOperation.op !== "set-background" || !backgroundOperation.separation) {
              invalid(`spreads[${index}].background requires a supported separation.`);
            }
            const { op: _backgroundOp, ...background } = backgroundOperation;
            if (!Array.isArray(draft.layers) || draft.layers.length < 2 || draft.layers.length > 4) {
              invalid(`spreads[${index}].layers must contain 2–4 prepared foreground layers.`);
            }
            const layers = draft.layers.map((layer, layerIndex): PreparedBookLayer => {
              if (!layer || typeof layer !== "object" || Array.isArray(layer)) invalid(`spreads[${index}].layers[${layerIndex}] must be an object.`);
              const layerInput = layer as ToolInput;
              assertOnly(layerInput, ["id", "label", "assetId", "frameAssetIds", "page", "kind", "transform", "depth", "locked", "motion", "hover", "focus", "reveal"]);
              const operation = parseSceneOperation({ ...layerInput, op: "add" }, layerIndex);
              if (operation.op !== "add") invalid(`spreads[${index}].layers[${layerIndex}] must describe a foreground layer.`);
              const { op: _layerOp, ...preparedLayer } = operation;
              return preparedLayer;
            });
            return {
              id: `${index + 1}-${slug(spreadTitle)}`,
              title: spreadTitle,
              body: boundedString(draft, "body", 800),
              kicker: boundedString(draft, "kicker", 100, true),
              background: background as PreparedBookBackground,
              layers,
            };
          });
          const requestedAssetIds = [...new Set([
            coverAssetId,
            ...spreads.flatMap((spread) => [
              spread.background.cleanPlateAssetId,
              spread.background.sourceAssetId,
              spread.background.personalSourceAssetId,
              ...spread.layers.flatMap((layer) => [layer.assetId, ...(layer.frameAssetIds ?? [])]),
            ].filter((assetId): assetId is string => Boolean(assetId))),
          ])];
          const publishableAssetIds = new Set([
            coverAssetId,
            ...spreads.flatMap((spread) => [
              spread.background.cleanPlateAssetId,
              ...spread.layers.flatMap((layer) => layer.frameAssetIds?.length ? layer.frameAssetIds : [layer.assetId]),
            ]),
          ]);
          if (publishableAssetIds.size > MAX_BOOK_PUBLISHABLE_ASSETS) {
            const result = {
              ok: false as const,
              code: "creation_artifact_incomplete" as const,
              currentRevision: bookEngine.getSnapshot().document.revision,
              summary: "Apertale did not create the book because it cannot fit the publishing asset limit.",
              issues: [`The finished book renders ${publishableAssetIds.size} local images, above the publishable limit of ${MAX_BOOK_PUBLISHABLE_ASSETS}.`],
            };
            return remember(requestId, result);
          }
          const validatedLocalAssets = await getAssetMetadata(requestedAssetIds);
          if (validatedLocalAssets.length !== requestedAssetIds.length) {
            const validatedIds = new Set(validatedLocalAssets.map((asset) => asset.id));
            const missingCount = requestedAssetIds.filter((assetId) => !validatedIds.has(assetId)).length;
            const result = {
              ok: false as const,
              code: "creation_artifact_incomplete" as const,
              currentRevision: bookEngine.getSnapshot().document.revision,
              summary: "Apertale did not create the book because its complete prepared asset set is no longer available in this browser.",
              issues: [`The complete prepared book is missing ${missingCount} browser-local image${missingCount === 1 ? "" : "s"}.`],
            };
            return remember(requestId, result);
          }
          canceled(options?.signal ?? uncancelledToolSignal);
          const assetValidationConflict = documentPreconditionConflict(expectedDocumentId, expectedRevision);
          if (assetValidationConflict) {
            return remember(requestId, assetValidationConflict);
          }
          const roleIssues = preparedBookAssetIssues(
            { coverAssetId, spreads },
            validatedLocalAssets,
            sourceAssetIds,
          );
          if (roleIssues.length > 0) {
            const result = {
              ok: false as const,
              code: "creation_artifact_incomplete" as const,
              currentRevision: bookEngine.getSnapshot().document.revision,
              summary: "Apertale did not create the book because one or more image assets do not fit their required role.",
              issues: roleIssues,
            };
            return remember(requestId, result);
          }
          const result = await bookEngine.dispatchCoordinated({
            type: "create-book",
            requestId,
            expectedDocumentId,
            expectedRevision,
            documentId: `book-${slug(title)}-${crypto.randomUUID().slice(0, 8)}`,
            title,
            coverAssetId,
            spreads,
            creationBrief: creationBrief ?? {},
            validatedSourceAssetIds,
            validatedLocalAssetIds: validatedLocalAssets.map((asset) => asset.id),
          }, "agent", options?.signal);
          if (result.ok) {
            if (!result.documentId || !result.changedIds[0]) invalid("create did not return its stable presentation target.");
            const session = bookEngine.getSnapshot().session;
            pendingPresentations.set(requestId, {
              result,
              target: {
                documentId: result.documentId,
                revision: result.revision,
                surface: "reader",
                spreadId: result.changedIds[0],
                theme: session.sceneThemeId,
                preview: session.preview,
              },
            });
            return resumePresentation(requestId, options?.signal ?? uncancelledToolSignal);
          }
          return remember(requestId, result);
        }),
      },
      { signal: controller.signal },
    ),
    register(
      {
        name: SITE_TOOL.composeSpread,
        title: "Compose spread text",
        description: "Rewrite the title, body, or kicker of one existing spread while preserving its imported assets and interactions. Use a spread id returned by get_project_context.",
        inputSchema: {
          type: "object",
          properties: {
            ...requiredMutation,
            spreadId: { type: "string", description: "Stable spread id from get_project_context." },
            title: { type: "string", minLength: 1, maxLength: 100 },
            body: { type: "string", maxLength: 800 },
            kicker: { type: "string", maxLength: 100 },
          },
          required: [...requiredMutationFields, "spreadId"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input, options) => runRegisteredTool(SITE_TOOL.composeSpread, options?.signal ?? uncancelledToolSignal, async () => {
          assertOnly(input, [...requiredMutationFields, "spreadId", "title", "body", "kicker"]);
          return bookEngine.dispatchCoordinated({
            type: "compose-spread",
            requestId: requiredString(input, "requestId"),
            expectedDocumentId: requiredDocumentId(input),
            expectedRevision: requiredRevision(input),
            spreadId: requiredString(input, "spreadId"),
            title: boundedString(input, "title", 100, true),
            body: boundedString(input, "body", 800, true),
            kicker: boundedString(input, "kicker", 100, true),
          }, "agent", options?.signal);
        }),
      },
      { signal: controller.signal },
    ),
    register(
      {
        name: SITE_TOOL.applyScenePatch,
        title: "Apply atomic scene patch",
        description: "Atomically set a full-spread original composite reference, its purpose-built clean plate or approved preserved-photo layout, and add, update, remove, or reorder up to 24 foreground layers. Keep personal photo provenance in personalSourceAssetId, separate from sourceAssetId. The stored ready brief fixes which treatment is allowed. Use validated assets only; arbitrary URLs and executable content are rejected.",
        inputSchema: {
          type: "object",
          properties: {
            ...requiredMutation,
            spreadId: { type: "string", description: "Visible spread id from get_project_context." },
            operations: {
              type: "array",
              minItems: 1,
              maxItems: 24,
              items: {
                type: "object",
                properties: {
                  op: { type: "string", enum: ["set-background", "add", "update", "remove", "reorder"] },
                  ...preparedBackgroundSchema.properties,
                  ...preparedLayerSchema.properties,
                  elementId: { type: "string" },
                  frameAssetIds: { type: ["array", "null"], minItems: 2, maxItems: 6, items: { type: "string" }, description: "Optional 2–6 browser-local image frames. For add, and for update of an existing layer, the first item must equal that layer's assetId." },
                  motion: { ...motionSchema, type: ["object", "null"] },
                  index: { type: "integer", minimum: 0, maximum: 23 },
                },
                required: ["op"],
                additionalProperties: false,
              },
            },
          },
          required: [...requiredMutationFields, "spreadId", "operations"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input, options) => runRegisteredTool(SITE_TOOL.applyScenePatch, options?.signal ?? uncancelledToolSignal, async () => {
          assertOnly(input, [...requiredMutationFields, "spreadId", "operations"]);
          const requestId = requiredString(input, "requestId");
          const expectedDocumentId = requiredDocumentId(input);
          const expectedRevision = requiredRevision(input);
          const spreadId = requiredString(input, "spreadId");
          if (!Array.isArray(input.operations) || input.operations.length < 1 || input.operations.length > 24) invalid("operations must contain 1–24 scene operations.");
          const operations = input.operations.map(parseSceneOperation);
          const requestedLocalAssetIds = [...new Set(operations.flatMap((operation) => {
            const ids = operation.op === "set-background"
              ? [operation.cleanPlateAssetId, operation.sourceAssetId, operation.personalSourceAssetId].filter((assetId): assetId is string => Boolean(assetId))
              : operation.op === "add"
                ? [operation.assetId, ...(operation.frameAssetIds ?? [])]
                : operation.op === "update" ? (operation.frameAssetIds ?? []) : [];
            return ids.filter((assetId) => assetId.startsWith("asset:"));
          }))];
          const validatedLocalAssets = await getAssetMetadata(requestedLocalAssetIds);
          if (validatedLocalAssets.length !== requestedLocalAssetIds.length) invalid("one or more local asset ids do not exist in this browser.");
          canceled(options?.signal ?? uncancelledToolSignal);
          const command = {
            type: "scene-patch" as const,
            requestId,
            expectedDocumentId,
            expectedRevision,
            spreadId,
            operations,
            validatedLocalAssetIds: validatedLocalAssets.map((asset) => asset.id),
          };
          if (documentPreconditionConflict(expectedDocumentId, expectedRevision)) {
            return bookEngine.dispatchCoordinated(command, "agent", options?.signal);
          }
          const declaredSourceAssetIds = creationBriefSourceAssetIds(bookEngine.getQualityLifecycle()?.creationBrief);
          const roleIssues = operations.flatMap((operation, operationIndex) => {
            const local = (assetIds: readonly string[]) => assetIds.filter((assetId) => assetId.startsWith("asset:"));
            if (operation.op === "set-background") {
              const localBackgroundIds = local([operation.sourceAssetId, operation.cleanPlateAssetId]);
              return [
                ...fullSpreadAssetRoleIssues(
                  localBackgroundIds,
                  validatedLocalAssets,
                  `Background operation ${operationIndex + 1}`,
                ),
                ...backgroundAssetUseIssues(
                  localBackgroundIds,
                  validatedLocalAssets,
                  operation.separation ?? "inpainted-clean-plate",
                  declaredSourceAssetIds,
                  `Background operation ${operationIndex + 1}`,
                ),
                ...(operation.personalSourceAssetId?.startsWith("asset:")
                  ? [
                      ...sourcePhotoAssetRoleIssues(
                        [operation.personalSourceAssetId],
                        validatedLocalAssets,
                        `Background operation ${operationIndex + 1} personal source`,
                      ),
                      ...(!declaredSourceAssetIds.includes(operation.personalSourceAssetId)
                        ? [`Background operation ${operationIndex + 1} personal source is not declared by the ready creation brief.`]
                        : []),
                    ]
                  : []),
                ...(localBackgroundIds.length === 2
                  ? backgroundPairAssetRoleIssues(
                      operation.sourceAssetId,
                      operation.cleanPlateAssetId,
                      validatedLocalAssets,
                      `Background operation ${operationIndex + 1} original composite and final base`,
                    )
                  : []),
              ];
            }
            if (operation.op === "add") {
              const sequence = local([operation.assetId, ...(operation.frameAssetIds ?? [])]);
              return operation.frameAssetIds?.length
                ? frameSequenceAssetRoleIssues(sequence, validatedLocalAssets, `Layer ${operation.id}`)
                : foregroundAssetRoleIssues(sequence, validatedLocalAssets, `Layer ${operation.id}`);
            }
            if (operation.op === "update" && operation.frameAssetIds?.length) {
              return frameSequenceAssetRoleIssues(
                local(operation.frameAssetIds),
                validatedLocalAssets,
                `Update ${operation.elementId} animation`,
              );
            }
            return [];
          });
          if (roleIssues.length > 0) invalid(roleIssues[0]);
          return bookEngine.dispatchCoordinated(command, "agent", options?.signal);
        }),
      },
      { signal: controller.signal },
    ),
    register(
      {
        name: SITE_TOOL.setPresentation,
        title: "Set presentation",
        description: "Switch Day/Night or Preview, or show the current shelf cover or one reader spread for rendered screenshot evidence, without changing document revision.",
        inputSchema: {
          type: "object",
          properties: {
            ...requiredMutation,
            theme: { type: "string", enum: ["paper-atelier", "midnight-desk"] },
            preview: { type: "boolean" },
            spreadId: { type: "string", maxLength: 128 },
            surface: { type: "string", enum: ["reader", "shelf"], description: "Visible surface to show. Use shelf for cover evidence and reader for a spread." },
          },
          required: requiredMutationFields,
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input, options) => runRegisteredTool(SITE_TOOL.setPresentation, options?.signal ?? uncancelledToolSignal, async () => {
          assertOnly(input, [...requiredMutationFields, "theme", "preview", "spreadId", "surface"]);
          const requestId = requiredString(input, "requestId");
          if (pendingPresentations.has(requestId)) {
            return resumePresentation(requestId, options?.signal ?? uncancelledToolSignal);
          }
          const prior = sessionResults.get(requestId);
          if (prior) return prior;
          const expectedDocumentId = requiredDocumentId(input);
          const expectedRevision = requiredRevision(input);
          const preconditionConflict = documentPreconditionConflict(expectedDocumentId, expectedRevision);
          if (preconditionConflict) {
            return remember(requestId, preconditionConflict);
          }
          let theme = bookEngine.getSnapshot().session.sceneThemeId;
          if (typeof input.theme !== "undefined") {
            const requestedTheme = requiredString(input, "theme");
            if (requestedTheme !== "paper-atelier" && requestedTheme !== "midnight-desk") invalid("theme is not supported.");
            theme = requestedTheme as ThemeId;
          }
          if (typeof input.preview !== "undefined" && typeof input.preview !== "boolean") invalid("preview must be boolean.");
          const surface = typeof input.surface === "undefined" ? undefined : requiredString(input, "surface");
          if (surface !== undefined && surface !== "reader" && surface !== "shelf") invalid("surface is not supported.");
          if (surface === "shelf" && typeof input.spreadId !== "undefined") invalid("surface shelf cannot be combined with spreadId.");
          if (surface === "shelf" && input.preview === true) invalid("surface shelf cannot be combined with preview true.");
          let spreadId = bookEngine.getSnapshot().document.spreads[bookEngine.getSnapshot().session.currentSpreadIndex]?.id;
          if (typeof input.spreadId !== "undefined") {
            spreadId = requiredString(input, "spreadId");
            const spreadIndex = bookEngine.getSnapshot().document.spreads.findIndex((spread) => spread.id === spreadId);
            if (spreadIndex < 0) invalid("spreadId is not present in the current book.");
            bookEngine.setSpread(spreadIndex);
          }
          if (typeof input.theme === "undefined" && typeof input.preview === "undefined" && typeof input.spreadId === "undefined" && surface === undefined) invalid("set_presentation requires theme, preview, spreadId, or surface.");
          if (typeof input.theme !== "undefined") bookEngine.setTheme(theme, "agent");
          if (typeof input.preview === "boolean") bookEngine.setPreview(input.preview, "agent");
          const visibleSurface = surface ?? (
            typeof input.theme !== "undefined"
              || typeof input.spreadId !== "undefined"
              || typeof input.preview !== "undefined"
              ? "reader"
              : undefined
          );
          if (visibleSurface === "shelf" && bookEngine.getSnapshot().session.preview) {
            bookEngine.setPreview(false, "agent");
          }
          if (visibleSurface) {
            const presented = bookEngine.getSnapshot();
            const presentedSpreadId = visibleSurface === "reader"
              ? presented.document.spreads[presented.session.currentSpreadIndex]?.id
              : undefined;
            const result = { ok: true, theme, preview: presented.session.preview, spreadId, surface: visibleSurface, summary: "Presentation updated." };
            pendingPresentations.set(requestId, {
              result,
              target: {
                documentId: presented.document.id,
                revision: presented.document.revision,
                surface: visibleSurface,
                spreadId: presentedSpreadId,
                theme,
                preview: presented.session.preview,
              },
            });
            return resumePresentation(requestId, options?.signal ?? uncancelledToolSignal);
          }
          const result = { ok: true, theme, preview: bookEngine.getSnapshot().session.preview, spreadId, surface: visibleSurface, summary: "Presentation updated." };
          return remember(requestId, result);
        }),
      },
      { signal: controller.signal },
    ),
    register(
      {
        name: SITE_TOOL.undoProjectChange,
        title: "Undo project change",
        description: "Undo the exact reversible Apertale document change represented by an undo token while preserving non-overlapping later edits.",
        inputSchema: {
          type: "object",
          properties: { ...requiredMutation, undoToken: { type: "string", description: "Token returned by the mutation to undo." } },
          required: [...requiredMutationFields, "undoToken"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input, options) => runRegisteredTool(SITE_TOOL.undoProjectChange, options?.signal ?? uncancelledToolSignal, async () => {
          assertOnly(input, [...requiredMutationFields, "undoToken"]);
          return bookEngine.dispatchCoordinated({
            type: "undo",
            requestId: requiredString(input, "requestId"),
            expectedDocumentId: requiredDocumentId(input),
            expectedRevision: requiredRevision(input),
            undoToken: requiredString(input, "undoToken"),
          }, "agent", options?.signal);
        }),
      },
      { signal: controller.signal },
    ),
    register(
      {
        name: SITE_TOOL.requestImageHandoff,
        title: "Request an image handoff",
        description:
          "Ask the reader to hand off source photos or finished book artwork. Opens the matching image drawer with your reason, then resolves with browser-local asset ids and accepted/rejected/failed counts. A mixed batch returns partial and leaves the drawer open for replacements. Source photos join the next creation brief; book art only joins the reusable asset registry. The browser requires the reader's own click to choose files.",
        inputSchema: {
          type: "object",
          properties: {
            requestId: { type: "string", description: "Caller-supplied id for this request." },
            assetUse: { type: "string", enum: [...IMAGE_HANDOFF_ASSET_USES], description: "Use source-photo for reader references; use book-art for generated cover, spread, clean-plate, or cutout finals." },
            reason: { type: "string", description: "Plain-language reason shown to the reader, including what and how many files are needed.", maxLength: 220 },
          },
          required: ["requestId", "assetUse", "reason"],
          additionalProperties: false,
        },
        // Mutating, and its result carries ids derived from a file the reader
        // chose, so it takes the same hint every other mutating tool carries.
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input, options) => runRegisteredTool(SITE_TOOL.requestImageHandoff, options?.signal ?? uncancelledToolSignal, async () => {
          assertOnly(input, ["requestId", "assetUse", "reason"]);
          const requestId = requiredString(input, "requestId");
          const prior = sessionResults.get(requestId);
          if (prior) return prior;
          const assetUse = requiredString(input, "assetUse");
          if (!IMAGE_HANDOFF_ASSET_USES.includes(assetUse as (typeof IMAGE_HANDOFF_ASSET_USES)[number])) invalid("assetUse is not supported.");
          const reason = boundedString(input, "reason", 220);
          const signal = options?.signal ?? uncancelledToolSignal;
          let pendingOutcome = activeImageHandoffs.get(requestId);
          if (!pendingOutcome) {
            pendingOutcome = requestImageHandoff({ requestId, assetUse: assetUse as (typeof IMAGE_HANDOFF_ASSET_USES)[number], reason });
            activeImageHandoffs.set(requestId, pendingOutcome);
          }
          // Agent-side cancellation has to reach the drawer, or a cancelled
          // request would leave it open with nothing listening.
          const onAbort = () => dismissImageHandoff(requestId, CANCELLED_HANDOFF_REASON);
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) onAbort();
          try {
            const outcome = await pendingOutcome;
            const result = outcome.status === "dismissed"
              ? { status: "dismissed", reason: outcome.reason }
              : {
                  status: outcome.status,
                  assetIds: outcome.assetIds,
                  counts: outcome.counts,
                  ...(outcome.status === "partial" ? { reason: outcome.reason } : {}),
                  note: outcome.status === "partial"
                    ? "Only the returned ids were accepted. The image drawer remains open for replacements; refresh get_project_context(detail: \"assets\") before referencing any ids."
                    : "Refresh get_project_context(detail: \"assets\") before referencing these ids.",
                };
            return remember(requestId, result);
          } finally {
            signal.removeEventListener("abort", onAbort);
            if (activeImageHandoffs.get(requestId) === pendingOutcome) activeImageHandoffs.delete(requestId);
          }
        }),
      },
      { signal: controller.signal },
    ),
  ];

  void Promise.all(registrations).then(() => {
    if (controller.signal.aborted) return;
    recordDiagnostic("webmcp:registered", { registered: registeredCount });
    onStatus(true);
  }).catch((error) => {
    if (controller.signal.aborted) return;
    cancelActiveImageHandoffs();
    controller.abort();
    sessionResults.clear();
    pendingPresentations.clear();
    recordDiagnostic("webmcp:registration-failed", {
      registered: registeredCount,
      error: error instanceof Error ? error.name : "UnknownError",
    });
    onStatus(false);
  });
  return () => {
    if (controller.signal.aborted) return;
    cancelActiveImageHandoffs();
    controller.abort();
    sessionResults.clear();
    pendingPresentations.clear();
    recordDiagnostic("webmcp:removed", { count: registeredCount });
  };
}
