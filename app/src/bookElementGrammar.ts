import { FOCUS_RESPONSES, HOVER_RESPONSES, REVEAL_KINDS } from "./interaction";
import {
  BOOK_ELEMENT_ID_PATTERN_SOURCE,
  BOOK_ELEMENT_KINDS,
  BOOK_PAGES,
  BOOK_PROVENANCE,
  MAX_BOOK_SPREADS,
  MAX_SPREAD_ELEMENTS,
  MOTION_PRESETS,
  PROCEDURAL_ASSET_ID_PATTERN_SOURCE,
  PROCEDURAL_ASSET_PREFIX,
} from "./types";
import type { MotionSpec, RevealSpec, Transform2D } from "./types";

/**
 * Book element grammar: the single source of truth for every field bound and
 * closed vocabulary a book element may carry. The WebMCP tool catalog derives
 * its parsers and JSON Schema from it, the command engine validates against it,
 * and `worker/bookElementGrammar.json` is generated from it (see
 * `scripts/sync-book-element-grammar.mjs`) so the publish boundary keeps its own
 * validators while sharing these constants.
 */
export const BOOK_ELEMENT_GRAMMAR = {
  label: { max: 64 },
  elementKinds: BOOK_ELEMENT_KINDS,
  pages: BOOK_PAGES,
  provenance: BOOK_PROVENANCE,
  spreads: { min: 1, max: MAX_BOOK_SPREADS },
  elementsPerSpread: { max: MAX_SPREAD_ELEMENTS },
  transform: {
    x: { min: 0, max: 1 },
    y: { min: 0, max: 1 },
    scaleX: { min: 0.3, max: 1.8 },
    scaleY: { min: 0.3, max: 1.8 },
    rotationDeg: { min: -180, max: 180 },
  },
  depth: { min: 0, max: 0.5 },
  frameAssetIds: { min: 2, max: 6 },
  motion: { presets: MOTION_PRESETS, durationMs: { min: 400, max: 20_000 } },
  reveal: {
    kinds: REVEAL_KINDS,
    title: { max: 100 },
    summary: { max: 500 },
    source: { max: 200 },
    facts: { max: 8 },
    factLabel: { max: 64 },
    factValue: { max: 160 },
  },
  hoverResponses: HOVER_RESPONSES,
  focusResponses: FOCUS_RESPONSES,
  elementIdPatternSource: BOOK_ELEMENT_ID_PATTERN_SOURCE,
  proceduralAsset: {
    prefix: PROCEDURAL_ASSET_PREFIX,
    idPatternSource: PROCEDURAL_ASSET_ID_PATTERN_SOURCE,
  },
  tokenPatternSource: "^[A-Za-z0-9_-]{43}$",
  bookIdPatternSource: "^[0-9a-f]{8}-[0-9a-f-]{27,35}$",
  imageTypes: ["image/png", "image/jpeg", "image/webp"],
} as const;

const G = BOOK_ELEMENT_GRAMMAR;

export const PUBLICATION_TOKEN_PATTERN = new RegExp(G.tokenPatternSource);
export const PUBLICATION_BOOK_ID_PATTERN = new RegExp(G.bookIdPatternSource, "i");
export const SUPPORTED_IMAGE_TYPES: ReadonlySet<string> = new Set(G.imageTypes);

const range = (value: unknown, bound: { min: number; max: number }) =>
  typeof value === "number" && Number.isFinite(value) && value >= bound.min && value <= bound.max;

const trimmedWithin = (value: unknown, max: number, required = false) =>
  typeof value === "string" && value.trim().length <= max && (!required || value.trim().length >= 1);

/** Names the offending field, so callers can surface it verbatim. */
export function transformIssue(transform: Partial<Transform2D> | undefined): string | undefined {
  if (!transform) return undefined;
  for (const [field, value] of Object.entries(transform)) {
    const bound = G.transform[field as keyof Transform2D];
    if (!bound) return `transform.${field} is not supported.`;
    if (!range(value, bound)) return `transform.${field} must be between ${bound.min} and ${bound.max}.`;
  }
  return undefined;
}

export function motionIssue(motion: MotionSpec | null | undefined): string | undefined {
  if (typeof motion === "undefined" || motion === null) return undefined;
  if (!G.motion.presets.includes(motion.preset)) return "motion.preset is not supported.";
  if (!range(motion.durationMs, G.motion.durationMs)) {
    return `motion.durationMs must be between ${G.motion.durationMs.min} and ${G.motion.durationMs.max}.`;
  }
  if (typeof motion.loop !== "boolean") return "motion.loop must be boolean.";
  return undefined;
}

export function revealIssue(reveal: RevealSpec | undefined): string | undefined {
  if (!reveal) return undefined;
  if (!G.reveal.kinds.includes(reveal.kind)) return "reveal.kind is not supported.";
  if (!trimmedWithin(reveal.title, G.reveal.title.max, reveal.kind !== "none")) {
    return `reveal.title must be a string no longer than ${G.reveal.title.max} characters.`;
  }
  if (!trimmedWithin(reveal.summary, G.reveal.summary.max)) {
    return `reveal.summary must be a string no longer than ${G.reveal.summary.max} characters.`;
  }
  if (!Array.isArray(reveal.facts) || reveal.facts.length > G.reveal.facts.max) {
    return `reveal.facts must contain at most ${G.reveal.facts.max} facts.`;
  }
  if (!reveal.facts.every((fact) => trimmedWithin(fact?.label, G.reveal.factLabel.max, true) && trimmedWithin(fact?.value, G.reveal.factValue.max, true))) {
    return "reveal.facts entries require a label and a value.";
  }
  if (typeof reveal.source !== "undefined" && !trimmedWithin(reveal.source, G.reveal.source.max)) {
    return `reveal.source must be a string no longer than ${G.reveal.source.max} characters.`;
  }
  return undefined;
}

export function frameCountIssue(frameAssetIds: readonly unknown[]): string | undefined {
  const { min, max } = G.frameAssetIds;
  if (frameAssetIds.length < min || frameAssetIds.length > max || frameAssetIds.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    return `frameAssetIds must contain ${min}–${max} asset ids.`;
  }
  return undefined;
}

const numberSchema = (bound: { min: number; max: number }) => ({ type: "number", minimum: bound.min, maximum: bound.max });

/** JSON Schema fragments for the WebMCP tool catalog, derived from the same bounds. */
export const transformSchema = {
  type: "object",
  properties: {
    x: numberSchema(G.transform.x),
    y: numberSchema(G.transform.y),
    scaleX: numberSchema(G.transform.scaleX),
    scaleY: numberSchema(G.transform.scaleY),
    rotationDeg: numberSchema(G.transform.rotationDeg),
  },
  additionalProperties: false,
};

export const motionSchema = {
  type: "object",
  properties: {
    preset: { type: "string", enum: [...G.motion.presets] },
    durationMs: { type: "integer", minimum: G.motion.durationMs.min, maximum: G.motion.durationMs.max },
    loop: { type: "boolean" },
  },
  required: ["preset", "durationMs", "loop"],
  additionalProperties: false,
};

export const revealSchema = {
  type: "object",
  description: "Safe visible knowledge shown when the reader selects this element.",
  properties: {
    kind: { type: "string", enum: [...G.reveal.kinds] },
    title: { type: "string", maxLength: G.reveal.title.max },
    summary: { type: "string", maxLength: G.reveal.summary.max },
    facts: {
      type: "array",
      maxItems: G.reveal.facts.max,
      items: {
        type: "object",
        properties: {
          label: { type: "string", minLength: 1, maxLength: G.reveal.factLabel.max },
          value: { type: "string", minLength: 1, maxLength: G.reveal.factValue.max },
        },
        required: ["label", "value"],
        additionalProperties: false,
      },
    },
    source: { type: "string", maxLength: G.reveal.source.max },
  },
  required: ["kind", "title", "summary"],
  additionalProperties: false,
};
