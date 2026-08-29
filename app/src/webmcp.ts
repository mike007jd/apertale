import { bookEngine } from "./bookEngine";
import { getAssetMetadata, listAssetMetadata } from "./assetStore";
import { abortImageHandoff, requestImageHandoff } from "./imageHandoff";
import { recordDiagnostic } from "./diagnostics";
import { FOCUS_RESPONSES, HOVER_RESPONSES, REVEAL_KINDS } from "./interaction";
import { MOTION_PRESETS, MAX_BOOK_SPREADS } from "./types";
import type { FocusResponse, HoverResponse, MotionPreset, MotionSpec, RevealKind, RevealSpec, ScenePatchOperation, ThemeId, Transform2D } from "./types";
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
  PHOTO_SOURCE_USES,
  PROJECT_CONTEXT_DETAILS,
  SITE_TOOL,
  assessCreationReadiness,
  buildAuthoringGuide,
  creationBriefSourceAssetIds,
  type CreationBriefPayload,
} from "./authoringContract";
const compact = (value: unknown) => JSON.stringify(value);

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

async function runTool(name: string, signal: AbortSignal, operation: () => unknown) {
  recordDiagnostic("webmcp:tool-start", { name });
  try {
    canceled(signal);
    const result = await operation();
    canceled(signal);
    recordDiagnostic("webmcp:tool-success", { name });
    return compact(result);
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
  requestId: { type: "string", description: "Unique idempotency key for this change." },
  expectedRevision: { type: "integer", minimum: 1, description: "Document revision returned by get_project_context." },
};

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

export function registerWebMcpTools(onStatus: (available: boolean) => void) {
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
  const sessionResults = new Map<string, unknown>();
  let authoringGuideRead = false;

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
        execute: (input, options) => runTool(SITE_TOOL.context, options?.signal ?? uncancelledToolSignal, async () => {
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
                    validatedSourceAssetIds: validatedSourceAssets.map((asset) => asset.id),
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
                      ? "Call manage_book action begin-critique, use set_presentation(spreadId) and the host browser screenshot capability to inspect the cover and every spread, then record every visual criterion with action record-critique. Schema evidence is not an aesthetic judgment."
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
        description: "Open, create, attach a readiness-passed brief to one legacy personal book, set a cover, or record critique. Create and adopt-creation-brief reuse the exact brief that passed creation-readiness; if blocked, do not mutate. Prepare generated art or preserved-photo-album layouts. After real rendering, begin critique, inspect every frame, record every criterion, patch and re-check at most twice, and never publish with blockers.",
        inputSchema: {
          type: "object",
          properties: {
            ...requiredMutation,
            action: { type: "string", enum: ["open", "create", "adopt-creation-brief", "set-cover", "begin-critique", "record-critique"] },
            bookId: { type: "string", description: "Stable id from library.books when action is open." },
            coverAssetId: { type: "string", description: "Browser-local portrait image id returned by get_project_context(detail: assets)." },
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
                },
                required: ["title", "body"],
                additionalProperties: false,
              },
            },
            creationBrief: creationBriefSchema,
            qualityReview: qualityReviewSchema,
          },
          // Every manage action consumes the inspected revision, including
          // navigation that changes the active document context.
          required: ["requestId", "expectedRevision", "action"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input, options) => runTool(SITE_TOOL.manageBook, options?.signal ?? uncancelledToolSignal, async () => {
          assertOnly(input, ["requestId", "expectedRevision", "action", "bookId", "coverAssetId", "title", "spreads", "creationBrief", "qualityReview"]);
          const requestId = requiredString(input, "requestId");
          const prior = sessionResults.get(requestId);
          if (prior) return prior;
          const action = requiredString(input, "action");
          if (action === "open") {
            const expectedRevision = requiredRevision(input);
            const currentRevision = bookEngine.getSnapshot().document.revision;
            if (expectedRevision !== currentRevision) {
              const result = {
                ok: false,
                code: "revision_conflict",
                currentRevision,
                summary: `Expected revision ${expectedRevision}; refresh context before opening another book.`,
              };
              sessionResults.set(requestId, result);
              return result;
            }
            const bookId = requiredString(input, "bookId");
            if (!bookEngine.openBook(bookId, "agent")) invalid("bookId is not present in the current library.");
            const result = { ok: true, bookId, summary: `Opened ${bookEngine.getSnapshot().document.title}.` };
            sessionResults.set(requestId, result);
            return result;
          }
          if (action === "set-cover") {
            const coverAssetId = requiredString(input, "coverAssetId");
            const validatedAssets = await getAssetMetadata([coverAssetId]);
            canceled(options?.signal ?? uncancelledToolSignal);
            const result = bookEngine.dispatch({
              type: "set-book-cover",
              requestId,
              expectedRevision: requiredRevision(input),
              assetId: coverAssetId,
              validatedLocalAssetIds: validatedAssets.map((asset) => asset.id),
            }, "agent");
            sessionResults.set(requestId, result);
            return result;
          }
          if (action === "begin-critique") {
            // The engine owns the expectedRevision check so every critique
            // entry point reports the same conflict and keeps requestId
            // idempotency.
            const result = bookEngine.beginQualityReview(requiredRevision(input));
            sessionResults.set(requestId, result);
            return result;
          }
          if (action === "record-critique") {
            const result = bookEngine.recordQualityReview(
              input.qualityReview as QualityVisualReviewSubmission,
              requiredRevision(input),
            );
            sessionResults.set(requestId, result);
            return result;
          }
          if (action === "adopt-creation-brief") {
            if (!authoringGuideRead) invalid("read get_project_context with detail authoring-guide before attaching a creation brief.");
            const creationBrief = input.creationBrief as CreationBriefPayload | undefined;
            const sourceAssetIds = creationBriefSourceAssetIds(creationBrief);
            const validatedSourceAssets = await getAssetMetadata(sourceAssetIds);
            canceled(options?.signal ?? uncancelledToolSignal);
            const result = bookEngine.adoptCreationBrief(
              creationBrief ?? {},
              validatedSourceAssets.map((asset) => asset.id),
              requiredRevision(input),
            );
            sessionResults.set(requestId, result);
            return result;
          }
          if (action !== "create") invalid("action must be open, create, adopt-creation-brief, set-cover, begin-critique, or record-critique.");
          if (!authoringGuideRead) {
            invalid("read get_project_context with detail authoring-guide before creating a book.");
          }
          const creationBrief = input.creationBrief as CreationBriefPayload | undefined;
          const sourceAssetIds = creationBriefSourceAssetIds(creationBrief);
          const validatedSourceAssets = await getAssetMetadata(sourceAssetIds);
          const title = boundedString(input, "title", 100);
          if (!Array.isArray(input.spreads) || input.spreads.length < 1 || input.spreads.length > MAX_BOOK_SPREADS) invalid(`spreads must contain 1–${MAX_BOOK_SPREADS} spread drafts.`);
          const spreads = input.spreads.map((raw, index) => {
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid(`spreads[${index}] must be an object.`);
            const draft = raw as ToolInput;
            assertOnly(draft, ["title", "body", "kicker"]);
            const spreadTitle = boundedString(draft, "title", 100);
            return {
              id: `${index + 1}-${slug(spreadTitle)}`,
              title: spreadTitle,
              body: boundedString(draft, "body", 800),
              kicker: boundedString(draft, "kicker", 100, true),
            };
          });
          const result = bookEngine.dispatch({
            type: "create-book",
            requestId,
            expectedRevision: requiredRevision(input),
            documentId: `book-${slug(title)}-${crypto.randomUUID().slice(0, 8)}`,
            title,
            spreads,
            creationBrief: creationBrief ?? {},
            validatedSourceAssetIds: validatedSourceAssets.map((asset) => asset.id),
          }, "agent");
          sessionResults.set(requestId, result);
          return result;
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
          required: ["requestId", "expectedRevision", "spreadId"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input, options) => runTool(SITE_TOOL.composeSpread, options?.signal ?? uncancelledToolSignal, () => {
          assertOnly(input, ["requestId", "expectedRevision", "spreadId", "title", "body", "kicker"]);
          return bookEngine.dispatch({
            type: "compose-spread",
            requestId: requiredString(input, "requestId"),
            expectedRevision: requiredRevision(input),
            spreadId: requiredString(input, "spreadId"),
            title: boundedString(input, "title", 100, true),
            body: boundedString(input, "body", 800, true),
            kicker: boundedString(input, "kicker", 100, true),
          }, "agent");
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
                  cleanPlateAssetId: { type: "string", description: "Final 2:1 base: repaired clean plate or approved source-true photo layout." },
                  sourceAssetId: { type: "string", description: "Original full-spread composite reference used to derive the clean plate. Required for every image-led spread." },
                  personalSourceAssetId: { type: "string", description: "Declared personal source-photo provenance. Required when the creation brief contains source photos; never use this field for generated composites." },
                  separation: { type: "string", enum: ["inpainted-clean-plate", "preserved-photo-layout"], description: "Use preserved-photo-layout only for an approved original-photo album." },
                  id: { type: "string" },
                  elementId: { type: "string" },
                  label: { type: "string", maxLength: 64 },
                  assetId: { type: "string", description: "Existing browser-local image asset id returned by get_project_context(detail: assets)." },
                  frameAssetIds: { type: ["array", "null"], minItems: 2, maxItems: 6, items: { type: "string" }, description: "Optional 2–6 browser-local image frames." },
                  page: { type: "string", enum: ["left", "right"] },
                  kind: { type: "string", enum: ["embedded", "lifted", "decoration"] },
                  transform: {
                    type: "object",
                    properties: {
                      x: { type: "number", minimum: 0, maximum: 1 },
                      y: { type: "number", minimum: 0, maximum: 1 },
                      scaleX: { type: "number", minimum: 0.3, maximum: 1.8 },
                      scaleY: { type: "number", minimum: 0.3, maximum: 1.8 },
                      rotationDeg: { type: "number", minimum: -180, maximum: 180 },
                    },
                    additionalProperties: false,
                  },
                  depth: { type: "number", minimum: 0, maximum: 0.5 },
                  locked: { type: "boolean" },
                  motion: {
                    type: ["object", "null"],
                    properties: {
                      preset: { type: "string", enum: [...MOTION_PRESETS] },
                      durationMs: { type: "integer", minimum: 400, maximum: 20000 },
                      loop: { type: "boolean" },
                    },
                    required: ["preset", "durationMs", "loop"],
                    additionalProperties: false,
                  },
                  hover: { type: "string", enum: HOVER_RESPONSES },
                  focus: { type: "string", enum: FOCUS_RESPONSES },
                  reveal: revealSchema,
                  index: { type: "integer", minimum: 0, maximum: 23 },
                },
                required: ["op"],
                additionalProperties: false,
              },
            },
          },
          required: ["requestId", "expectedRevision", "spreadId", "operations"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input, options) => runTool(SITE_TOOL.applyScenePatch, options?.signal ?? uncancelledToolSignal, async () => {
          assertOnly(input, ["requestId", "expectedRevision", "spreadId", "operations"]);
          if (!Array.isArray(input.operations) || input.operations.length < 1 || input.operations.length > 24) invalid("operations must contain 1–24 scene operations.");
          const parseTransform = (raw: unknown) => {
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
          };
          const pick = <T extends string>(value: unknown, name: string, allowed: readonly T[]) => {
            if (typeof value === "undefined") return undefined;
            if (typeof value !== "string" || !allowed.includes(value as T)) invalid(`${name} is not supported.`);
            return value as T;
          };
          const parseReveal = (raw: unknown): RevealSpec | undefined => {
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
          };
          const parseMotion = (raw: unknown): MotionSpec | null | undefined => {
            if (typeof raw === "undefined" || raw === null) return raw;
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid("motion must be an object or null.");
            const value = raw as ToolInput;
            assertOnly(value, ["preset", "durationMs", "loop"]);
            const preset = pick<MotionPreset>(value.preset, "motion.preset", [...MOTION_PRESETS]);
            const durationMs = optionalBoundedNumber(value, "durationMs", 400, 20000);
            if (!preset || !Number.isInteger(durationMs) || typeof value.loop !== "boolean") invalid("motion requires preset, integer durationMs, and loop.");
            return { preset, durationMs: Number(durationMs), loop: value.loop };
          };
          const parseFrames = (raw: unknown): string[] | null | undefined => {
            if (typeof raw === "undefined" || raw === null) return raw;
            if (!Array.isArray(raw) || raw.length < 2 || raw.length > 6 || raw.some((item) => typeof item !== "string" || item.trim().length === 0)) {
              invalid("frameAssetIds must contain 2–6 asset ids.");
            }
            return raw.map((item) => String(item));
          };
          const operations = input.operations.map((raw, index): ScenePatchOperation => {
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid(`operations[${index}] must be an object.`);
            const value = raw as ToolInput;
            const op = requiredString(value, "op");
            const common = ["op", "cleanPlateAssetId", "sourceAssetId", "personalSourceAssetId", "separation", "id", "elementId", "label", "assetId", "frameAssetIds", "page", "kind", "transform", "depth", "locked", "motion", "hover", "focus", "reveal", "index"];
            assertOnly(value, common);
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
            if (op === "add") {
              const page = pick(value.page, "page", ["left", "right"] as const);
              if (!page) invalid("add requires page.");
              return {
                op,
                id: requiredString(value, "id"),
                label: boundedString(value, "label", 64),
                assetId: requiredString(value, "assetId"),
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
          });
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
          return bookEngine.dispatch({
            type: "scene-patch",
            requestId: requiredString(input, "requestId"),
            expectedRevision: requiredRevision(input),
            spreadId: requiredString(input, "spreadId"),
            operations,
            validatedLocalAssetIds: validatedLocalAssets.map((asset) => asset.id),
          }, "agent");
        }),
      },
      { signal: controller.signal },
    ),
    register(
      {
        name: SITE_TOOL.setPresentation,
        title: "Set presentation",
        description: "Switch Day/Night or Preview, or open one spread for rendered screenshot evidence, without changing document revision.",
        inputSchema: {
          type: "object",
          properties: {
            requestId: { type: "string", description: "Unique idempotency key for this session action." },
            theme: { type: "string", enum: ["paper-atelier", "midnight-desk"] },
            preview: { type: "boolean" },
            spreadId: { type: "string", maxLength: 128 },
          },
          required: ["requestId"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input, options) => runTool(SITE_TOOL.setPresentation, options?.signal ?? uncancelledToolSignal, () => {
          assertOnly(input, ["requestId", "theme", "preview", "spreadId"]);
          const requestId = requiredString(input, "requestId");
          const prior = sessionResults.get(requestId);
          if (prior) return prior;
          let theme = bookEngine.getSnapshot().session.sceneThemeId;
          if (typeof input.theme !== "undefined") {
            const requestedTheme = requiredString(input, "theme");
            if (requestedTheme !== "paper-atelier" && requestedTheme !== "midnight-desk") invalid("theme is not supported.");
            theme = requestedTheme as ThemeId;
          }
          if (typeof input.preview !== "undefined" && typeof input.preview !== "boolean") invalid("preview must be boolean.");
          let spreadId = bookEngine.getSnapshot().document.spreads[bookEngine.getSnapshot().session.currentSpreadIndex]?.id;
          if (typeof input.spreadId !== "undefined") {
            spreadId = requiredString(input, "spreadId");
            const spreadIndex = bookEngine.getSnapshot().document.spreads.findIndex((spread) => spread.id === spreadId);
            if (spreadIndex < 0) invalid("spreadId is not present in the current book.");
            bookEngine.setSpread(spreadIndex);
          }
          if (typeof input.theme === "undefined" && typeof input.preview === "undefined" && typeof input.spreadId === "undefined") invalid("set_presentation requires theme, preview, or spreadId.");
          if (typeof input.theme !== "undefined") bookEngine.setTheme(theme, "agent");
          if (typeof input.preview === "boolean") bookEngine.setPreview(input.preview, "agent");
          const result = { ok: true, theme, preview: bookEngine.getSnapshot().session.preview, spreadId, summary: "Presentation updated." };
          sessionResults.set(requestId, result);
          return result;
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
          required: ["requestId", "expectedRevision", "undoToken"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input, options) => runTool(SITE_TOOL.undoProjectChange, options?.signal ?? uncancelledToolSignal, () => {
          assertOnly(input, ["requestId", "expectedRevision", "undoToken"]);
          return bookEngine.dispatch({
            type: "undo",
            requestId: requiredString(input, "requestId"),
            expectedRevision: requiredRevision(input),
            undoToken: requiredString(input, "undoToken"),
          }, "agent");
        }),
      },
      { signal: controller.signal },
    ),
    register(
      {
        name: SITE_TOOL.requestImageHandoff,
        title: "Request an image handoff",
        description:
          "Ask the reader for one or more photos. Opens the photo drawer in the page with your reason shown to them, and resolves with the browser-local asset ids once they have chosen — so you can reference the ids immediately instead of waiting to be told the upload finished. You cannot send image bytes through a tool call and the browser requires the reader's own click to open a file picker, so this asks rather than uploads.",
        inputSchema: {
          type: "object",
          properties: {
            requestId: { type: "string", description: "Caller-supplied id for this request." },
            reason: { type: "string", description: "Plain-language reason shown to the reader, in your own words. For example: the fifth spread needs a photo of your grandmother.", maxLength: 220 },
          },
          required: ["requestId", "reason"],
          additionalProperties: false,
        },
        // Mutating, and its result carries ids derived from a file the reader
        // chose, so it takes the same hint every other mutating tool carries.
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input, options) => runTool(SITE_TOOL.requestImageHandoff, options?.signal ?? uncancelledToolSignal, async () => {
          assertOnly(input, ["requestId", "reason"]);
          const requestId = requiredString(input, "requestId");
          const prior = sessionResults.get(requestId);
          if (prior) return prior;
          const reason = boundedString(input, "reason", 220);
          const signal = options?.signal ?? uncancelledToolSignal;
          // Agent-side cancellation has to reach the drawer, or a cancelled
          // request would leave it open with nothing listening.
          const onAbort = () => abortImageHandoff();
          signal.addEventListener("abort", onAbort, { once: true });
          try {
            const outcome = await requestImageHandoff({ requestId, reason });
            const result = outcome.status === "provided"
              ? { status: "provided", assetIds: outcome.assetIds, note: "Refresh get_project_context(detail: \"assets\") before referencing these ids." }
              : { status: "dismissed", reason: outcome.reason };
            sessionResults.set(requestId, result);
            return result;
          } finally {
            signal.removeEventListener("abort", onAbort);
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
    controller.abort();
    sessionResults.clear();
    recordDiagnostic("webmcp:registration-failed", {
      registered: registeredCount,
      error: error instanceof Error ? error.name : "UnknownError",
    });
    onStatus(false);
  });
  return () => {
    if (controller.signal.aborted) return;
    controller.abort();
    sessionResults.clear();
    recordDiagnostic("webmcp:removed", { count: registeredCount });
  };
}
