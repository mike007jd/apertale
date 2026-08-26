import { bookEngine } from "./bookEngine";
import { getAssetMetadata, listAssetMetadata } from "./assetStore";
import { recordDiagnostic } from "./diagnostics";
import { FOCUS_RESPONSES, HOVER_RESPONSES, REVEAL_KINDS } from "./interaction";
import type { FocusResponse, HoverResponse, MotionPreset, RevealKind, RevealSpec, SceneModelId, ScenePatchOperation, ThemeId, Transform2D } from "./types";

const MOTION_PRESETS: string[] = ["gentle-float", "fly-across", "soft-pulse", "slow-orbit", "none"];
const SCENE_MODEL_IDS: SceneModelId[] = ["flavian-amphitheatre", "great-pyramid", "volcano-cross-section"];

const compact = (value: unknown) => JSON.stringify(value);

type ToolInput = Record<string, unknown>;

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

async function runTool(name: string, input: ToolInput, signal: AbortSignal, operation: () => unknown) {
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

  const registrations = [
    register(
      {
        name: "get_project_context",
        title: "Get project context",
        description: "Inspect the open Apertale project, current spread, selected element, presentation theme, capabilities, and document revision before making an edit.",
        inputSchema: {
          type: "object",
          properties: {
            detail: {
              type: "string",
              enum: ["compact", "selected-reveal", "assets"],
              description: "Optional focused detail. assets lists reusable local imports; selected-reveal returns the selected knowledge card.",
            },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input, { signal }) => runTool("get_project_context", input, signal, async () => {
          assertOnly(input, ["detail"]);
          const detail = typeof input.detail === "undefined" ? "compact" : requiredString(input, "detail");
          if (!["compact", "selected-reveal", "assets"].includes(detail)) invalid("detail is not supported.");
          const context = bookEngine.getContext(detail === "selected-reveal");
          return {
            ...context,
            assets: detail === "assets"
              ? await listAssetMetadata()
              : await getAssetMetadata(context.currentSpread.elements.map((element) => element.assetId)),
          };
        }),
      },
      { signal: controller.signal },
    ),
    register(
      {
        name: "manage_book",
        title: "Open or create book",
        description: "Open one existing shelf book or create a new independent Apertale book with 1–12 text spreads. Inspect get_project_context first.",
        inputSchema: {
          type: "object",
          properties: {
            ...requiredMutation,
            action: { type: "string", enum: ["open", "create"] },
            bookId: { type: "string", description: "Stable id from library.books when action is open." },
            title: { type: "string", minLength: 1, maxLength: 100 },
            spreads: {
              type: "array",
              minItems: 1,
              maxItems: 12,
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
          },
          required: ["requestId", "action"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input, { signal }) => runTool("manage_book", input, signal, () => {
          assertOnly(input, ["requestId", "expectedRevision", "action", "bookId", "title", "spreads"]);
          const requestId = requiredString(input, "requestId");
          const prior = sessionResults.get(requestId);
          if (prior) return prior;
          const action = requiredString(input, "action");
          if (action === "open") {
            const bookId = requiredString(input, "bookId");
            if (!bookEngine.openBook(bookId, "agent")) invalid("bookId is not present in the current library.");
            const result = { ok: true, bookId, summary: `Opened ${bookEngine.getSnapshot().document.title}.` };
            sessionResults.set(requestId, result);
            return result;
          }
          if (action !== "create") invalid("action must be open or create.");
          const title = boundedString(input, "title", 100);
          if (!Array.isArray(input.spreads) || input.spreads.length < 1 || input.spreads.length > 12) invalid("spreads must contain 1–12 spread drafts.");
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
          }, "agent");
          sessionResults.set(requestId, result);
          return result;
        }),
      },
      { signal: controller.signal },
    ),
    register(
      {
        name: "compose_spread",
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
        execute: (input, { signal }) => runTool("compose_spread", input, signal, () => {
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
        name: "apply_scene_patch",
        title: "Apply atomic scene patch",
        description: "Atomically add, update, remove, or reorder up to 24 elements on the visible spread. Use assets and element ids returned by get_project_context; arbitrary URLs and executable content are rejected.",
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
                  op: { type: "string", enum: ["add", "update", "remove", "reorder"] },
                  id: { type: "string" },
                  elementId: { type: "string" },
                  label: { type: "string", maxLength: 64 },
                  assetId: { type: "string", description: "Existing local asset id, or model:<modelId> when adding a built-in model." },
                  modelId: { type: "string", enum: SCENE_MODEL_IDS, description: "Built-in 3D model. assetId must be the matching model:<modelId>." },
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
                      preset: { type: "string", enum: MOTION_PRESETS.filter((preset) => preset !== "none") },
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
        execute: (input, { signal }) => runTool("apply_scene_patch", input, signal, async () => {
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
          const operations = input.operations.map((raw, index): ScenePatchOperation => {
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid(`operations[${index}] must be an object.`);
            const value = raw as ToolInput;
            const op = requiredString(value, "op");
            const common = ["op", "id", "elementId", "label", "assetId", "modelId", "page", "kind", "transform", "depth", "locked", "motion", "hover", "focus", "reveal", "index"];
            assertOnly(value, common);
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
            if (op === "add") {
              const page = pick(value.page, "page", ["left", "right"] as const);
              if (!page) invalid("add requires page.");
              return {
                op,
                id: requiredString(value, "id"),
                label: boundedString(value, "label", 64),
                assetId: requiredString(value, "assetId"),
                modelId: pick<SceneModelId>(value.modelId, "modelId", SCENE_MODEL_IDS),
                page,
                kind: pick(value.kind, "kind", ["embedded", "lifted", "decoration"] as const),
                transform,
                depth,
                hover,
                focus,
                reveal,
              };
            }
            if (op !== "update") invalid("op must be add, update, remove, or reorder.");
            if (typeof value.locked !== "undefined" && typeof value.locked !== "boolean") invalid("locked must be boolean.");
            let motion;
            if (value.motion === null) motion = null;
            else if (typeof value.motion !== "undefined") {
              if (!value.motion || typeof value.motion !== "object" || Array.isArray(value.motion)) invalid("motion must be an object or null.");
              const rawMotion = value.motion as ToolInput;
              assertOnly(rawMotion, ["preset", "durationMs", "loop"]);
              const preset = pick<MotionPreset>(rawMotion.preset, "motion.preset", MOTION_PRESETS.filter((item): item is MotionPreset => item !== "none"));
              const durationMs = optionalBoundedNumber(rawMotion, "durationMs", 400, 20000);
              if (!preset || !Number.isInteger(durationMs) || typeof rawMotion.loop !== "boolean") invalid("motion requires preset, integer durationMs, and loop.");
              motion = { preset, durationMs: Number(durationMs), loop: rawMotion.loop };
            }
            const kind = pick(value.kind, "kind", ["embedded", "lifted", "decoration"] as const);
            if (!kind && !transform && typeof depth === "undefined" && typeof value.locked === "undefined" && typeof motion === "undefined" && !hover && !focus && !reveal) {
              invalid("update requires at least one change.");
            }
            return { op, elementId: requiredString(value, "elementId"), kind, transform, depth, locked: value.locked as boolean | undefined, motion, hover, focus, reveal };
          });
          const requestedLocalAssetIds = [...new Set(operations.flatMap((operation) => (
            operation.op === "add" && operation.assetId.startsWith("asset:") ? [operation.assetId] : []
          )))];
          const validatedLocalAssets = await getAssetMetadata(requestedLocalAssetIds);
          if (validatedLocalAssets.length !== requestedLocalAssetIds.length) invalid("one or more local asset ids do not exist in this browser.");
          canceled(signal);
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
        name: "set_presentation",
        title: "Set presentation",
        description: "Switch the shared Apertale Day/Night presentation or Preview mode without changing book content or document revision.",
        inputSchema: {
          type: "object",
          properties: {
            requestId: { type: "string", description: "Unique idempotency key for this session action." },
            theme: { type: "string", enum: ["paper-atelier", "midnight-desk"] },
            preview: { type: "boolean" },
          },
          required: ["requestId"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input, { signal }) => runTool("set_presentation", input, signal, () => {
          assertOnly(input, ["requestId", "theme", "preview"]);
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
          if (typeof input.theme === "undefined" && typeof input.preview === "undefined") invalid("set_presentation requires theme or preview.");
          if (typeof input.theme !== "undefined") bookEngine.setTheme(theme, "agent");
          if (typeof input.preview === "boolean") bookEngine.setPreview(input.preview, "agent");
          const result = { ok: true, theme, preview: bookEngine.getSnapshot().session.preview, summary: "Presentation updated." };
          sessionResults.set(requestId, result);
          return result;
        }),
      },
      { signal: controller.signal },
    ),
    register(
      {
        name: "undo_project_change",
        title: "Undo project change",
        description: "Undo the exact reversible Apertale document change represented by an undo token while preserving non-overlapping later edits.",
        inputSchema: {
          type: "object",
          properties: { ...requiredMutation, undoToken: { type: "string", description: "Token returned by the mutation to undo." } },
          required: ["requestId", "expectedRevision", "undoToken"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input, { signal }) => runTool("undo_project_change", input, signal, () => {
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
