import { bookEngine } from "./bookEngine";
import { recordDiagnostic } from "./diagnostics";
import type { MotionPreset, ThemeId, Transform2D } from "./types";

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

function requiredElementId(input: ToolInput) {
  const value = requiredString(input, "elementId");
  if (value !== "bird" && value !== "fox") invalid("elementId must be bird or fox.");
  return value;
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
  expectedRevision: { type: "integer", minimum: 1, description: "Document revision returned by get_book_context." },
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
  const register = document.modelContext.registerTool.bind(document.modelContext);
  const sessionResults = new Map<string, unknown>();

  const registrations = [
    register(
      {
        name: "get_book_context",
        title: "Get book context",
        description: "Inspect the open LivingBook, current spread, selected paper element, presentation theme, capabilities, and document revision before making an edit.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input, { signal }) => runTool("get_book_context", input, signal, () => {
          assertOnly(input, []);
          return bookEngine.getContext();
        }),
      },
      { signal: controller.signal },
    ),
    register(
      {
        name: "lift_element",
        title: "Lift paper element",
        description: "Lift one prepared structured paper element from the current page into an independent movable cutout. Use only element ids returned by get_book_context.",
        inputSchema: {
          type: "object",
          properties: { ...requiredMutation, elementId: { type: "string", enum: ["bird", "fox"], description: "Stable structured element id." } },
          required: ["requestId", "expectedRevision", "elementId"],
          additionalProperties: false,
        },
        annotations: { untrustedContentHint: true },
        execute: (input, { signal }) => runTool("lift_element", input, signal, () => {
          assertOnly(input, ["requestId", "expectedRevision", "elementId"]);
          return bookEngine.dispatch({
            type: "lift",
            requestId: requiredString(input, "requestId"),
            expectedRevision: requiredRevision(input),
            elementId: requiredElementId(input),
          }, "agent");
        }),
      },
      { signal: controller.signal },
    ),
    register(
      {
        name: "edit_element",
        title: "Edit paper element",
        description: "Move, scale, rotate, change depth, or lock one structured LivingBook element. Read the current revision first and send only the fields that should change.",
        inputSchema: {
          type: "object",
          properties: {
            ...requiredMutation,
            elementId: { type: "string", enum: ["bird", "fox"] },
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
          },
          required: ["requestId", "expectedRevision", "elementId"],
          additionalProperties: false,
        },
        annotations: { untrustedContentHint: true },
        execute: (input, { signal }) => runTool("edit_element", input, signal, () => {
          assertOnly(input, ["requestId", "expectedRevision", "elementId", "transform", "depth", "locked"]);
          let transform: Partial<Transform2D> | undefined;
          if (typeof input.transform !== "undefined") {
            if (!input.transform || typeof input.transform !== "object" || Array.isArray(input.transform)) invalid("transform must be an object.");
            const rawTransform = input.transform as ToolInput;
            assertOnly(rawTransform, ["x", "y", "scaleX", "scaleY", "rotationDeg"]);
            transform = {
              x: optionalBoundedNumber(rawTransform, "x", 0, 1),
              y: optionalBoundedNumber(rawTransform, "y", 0, 1),
              scaleX: optionalBoundedNumber(rawTransform, "scaleX", 0.3, 1.8),
              scaleY: optionalBoundedNumber(rawTransform, "scaleY", 0.3, 1.8),
              rotationDeg: optionalBoundedNumber(rawTransform, "rotationDeg", -180, 180),
            };
            Object.keys(transform).forEach((key) => typeof transform?.[key as keyof Transform2D] === "undefined" && delete transform?.[key as keyof Transform2D]);
            if (Object.keys(transform).length === 0) invalid("transform must include at least one field.");
          }
          const depth = optionalBoundedNumber(input, "depth", 0, 0.5);
          if (typeof input.locked !== "undefined" && typeof input.locked !== "boolean") invalid("locked must be boolean.");
          if (!transform && typeof depth === "undefined" && typeof input.locked === "undefined") invalid("edit_element requires transform, depth, or locked.");
          return bookEngine.dispatch({
            type: "edit",
            requestId: requiredString(input, "requestId"),
            expectedRevision: requiredRevision(input),
            elementId: requiredElementId(input),
            transform,
            depth,
            locked: input.locked as boolean | undefined,
          }, "agent");
        }),
      },
      { signal: controller.signal },
    ),
    register(
      {
        name: "animate_element",
        title: "Animate paper element",
        description: "Apply or remove one safe named motion preset on a lifted paper element. Use fly-across for the Challenge bird demo.",
        inputSchema: {
          type: "object",
          properties: {
            ...requiredMutation,
            elementId: { type: "string", enum: ["bird", "fox"] },
            preset: { type: "string", enum: ["gentle-float", "fly-across", "soft-pulse", "none"] },
            durationMs: { type: "integer", minimum: 800, maximum: 12000 },
            loop: { type: "boolean" },
          },
          required: ["requestId", "expectedRevision", "elementId", "preset"],
          additionalProperties: false,
        },
        annotations: { untrustedContentHint: true },
        execute: (input, { signal }) => runTool("animate_element", input, signal, () => {
          assertOnly(input, ["requestId", "expectedRevision", "elementId", "preset", "durationMs", "loop"]);
          const preset = requiredString(input, "preset");
          if (!["gentle-float", "fly-across", "soft-pulse", "none"].includes(preset)) invalid("preset is not supported.");
          const durationMs = typeof input.durationMs === "undefined" ? 4200 : optionalBoundedNumber(input, "durationMs", 800, 12000);
          if (typeof durationMs !== "number" || !Number.isInteger(durationMs)) invalid("durationMs must be an integer.");
          if (typeof input.loop !== "undefined" && typeof input.loop !== "boolean") invalid("loop must be boolean.");
          const motion = preset === "none" ? null : { preset: preset as MotionPreset, durationMs, loop: input.loop as boolean | undefined ?? true };
          return bookEngine.dispatch({
            type: "animate",
            requestId: requiredString(input, "requestId"),
            expectedRevision: requiredRevision(input),
            elementId: requiredElementId(input),
            motion,
          }, "agent");
        }),
      },
      { signal: controller.signal },
    ),
    register(
      {
        name: "set_scene_theme",
        title: "Set scene theme",
        description: "Switch the shared LivingBook presentation between the bright Paper Atelier and cinematic Midnight Desk without changing document content or revision.",
        inputSchema: {
          type: "object",
          properties: {
            requestId: { type: "string", description: "Unique idempotency key for this session action." },
            theme: { type: "string", enum: ["paper-atelier", "midnight-desk"] },
          },
          required: ["requestId", "theme"],
          additionalProperties: false,
        },
        execute: (input, { signal }) => runTool("set_scene_theme", input, signal, () => {
          assertOnly(input, ["requestId", "theme"]);
          const requestId = requiredString(input, "requestId");
          const prior = sessionResults.get(requestId);
          if (prior) return prior;
          const theme = requiredString(input, "theme");
          if (theme !== "paper-atelier" && theme !== "midnight-desk") invalid("theme is not supported.");
          const result = bookEngine.setTheme(theme as ThemeId, "agent");
          sessionResults.set(requestId, result);
          return result;
        }),
      },
      { signal: controller.signal },
    ),
    register(
      {
        name: "undo_book_change",
        title: "Undo book change",
        description: "Undo the exact reversible LivingBook document change represented by an undo token while preserving non-overlapping later edits.",
        inputSchema: {
          type: "object",
          properties: { ...requiredMutation, undoToken: { type: "string", description: "Token returned by the mutation to undo." } },
          required: ["requestId", "expectedRevision", "undoToken"],
          additionalProperties: false,
        },
        annotations: { untrustedContentHint: true },
        execute: (input, { signal }) => runTool("undo_book_change", input, signal, () => {
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

  Promise.allSettled(registrations).then((results) => {
    const available = results.every((result) => result.status === "fulfilled");
    recordDiagnostic(available ? "webmcp:registered" : "webmcp:registration-failed", {
      registered: results.filter((result) => result.status === "fulfilled").length,
    });
    onStatus(available);
  });
  return () => {
    controller.abort();
    sessionResults.clear();
    recordDiagnostic("webmcp:removed", { count: registrations.length });
  };
}
