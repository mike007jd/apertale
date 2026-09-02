/**
 * The living storyboard: Codex's rough pencil plan on the blank book and the
 * reader's red corrections on top of it.
 *
 * Coordinates are one normalized spread: x runs 0 → 1 from the left page's
 * outer edge, through the gutter at 0.5, to the right page's outer edge; y
 * runs 0 → 1 top to bottom. Codex draws with a small vocabulary of marks
 * (boxes, ellipses, arrows, text labels, freehand lines) because a language
 * model plans in labelled regions, not in raw polylines. The reader answers
 * with freehand red strokes, which come back to Codex already interpreted:
 * which page, what they enclose, which labelled mark they sit on.
 */
export type StoryboardPoint = { x: number; y: number };
export type StoryboardStroke = { points: StoryboardPoint[] };
type StoryboardBox = { x: number; y: number; w: number; h: number };

export type StoryboardMark =
  | { kind: "line"; points: StoryboardPoint[]; label?: string }
  /** assetId names a reader source photo; the page ghosts it inside the box so the plan shows the photo in place. */
  | { kind: "rect"; x: number; y: number; w: number; h: number; label?: string; assetId?: string }
  | { kind: "ellipse"; x: number; y: number; w: number; h: number; label?: string }
  | { kind: "arrow"; from: StoryboardPoint; to: StoryboardPoint; label?: string }
  | { kind: "label"; x: number; y: number; text: string; size?: "s" | "m" | "l" };

export type StoryboardSpread = {
  index: number;
  caption: string;
  sketchRevision: number;
  marks: StoryboardMark[];
  annotations: StoryboardStroke[];
};

type StoryboardSnapshot = {
  revision: number;
  spreads: StoryboardSpread[];
  /** Set once the plan became this book; the reader fades the sketch over its first spread, then the plan is reset. */
  createdDocumentId?: string;
};

export type StoryboardSketchInput = {
  index: number;
  caption?: string;
  marks: StoryboardMark[];
};

/** A reader stroke as Codex reads it: where it is and what it points at. */
type AnnotationSummary = StoryboardStroke & {
  /** A closed loop encloses something; a stroke underlines, crosses, or points. */
  shape: "loop" | "stroke";
  page: "left" | "right" | "both";
  bounds: StoryboardBox;
  /** Labels of Codex marks the stroke overlaps, nearest first. */
  near: string[];
};

/** Context-sized view: every mark as a labelled box, no freehand geometry. */
type StoryboardSummary = {
  revision: number;
  spreads: {
    index: number;
    caption: string;
    sketchRevision: number;
    marks: { kind: StoryboardMark["kind"]; label?: string; assetId?: string; box: StoryboardBox }[];
    annotations: AnnotationSummary[];
  }[];
};

export const MAX_STROKE_POINTS = 120;
export const MAX_MARKS_PER_SPREAD = 36;
export const MAX_ANNOTATIONS_PER_SPREAD = 24;
export const MAX_LABEL_LENGTH = 40;
const STORAGE_KEY = "apertale:storyboard:v2";
const listeners = new Set<() => void>();

/**
 * The storyboard is the reader's only channel back to the Agent, so a reload
 * between drawing a red mark and the Agent's next context read must not lose
 * it. sessionStorage scopes it to this tab and this authoring session.
 */
function restore(): StoryboardSnapshot {
  try {
    const parsed: unknown = JSON.parse(globalThis.sessionStorage?.getItem(STORAGE_KEY) ?? "null");
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as StoryboardSnapshot).spreads)) return parsed as StoryboardSnapshot;
  } catch {
    // Corrupt or unavailable storage starts a blank storyboard.
  }
  return { revision: 0, spreads: [] };
}

function persist(next: StoryboardSnapshot) {
  try {
    globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota or privacy mode: the in-memory storyboard still works.
  }
}

let snapshot: StoryboardSnapshot = restore();

/** Three decimals is below one texel on the 2048px overlay and halves the JSON. */
const unit = (value: number) => Math.round(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 1000) / 1000;
const point = (source: StoryboardPoint): StoryboardPoint => ({ x: unit(source.x), y: unit(source.y) });
const text = (value: string | undefined) => value?.trim().slice(0, MAX_LABEL_LENGTH) || undefined;

/** Even resampling keeps the whole gesture; truncating kept only its first 120 points. */
const resample = (points: StoryboardPoint[]) => {
  if (points.length <= MAX_STROKE_POINTS) return points;
  const step = (points.length - 1) / (MAX_STROKE_POINTS - 1);
  return Array.from({ length: MAX_STROKE_POINTS }, (_, index) => points[Math.round(index * step)]);
};

const normalizedStroke = (stroke: StoryboardStroke): StoryboardStroke => ({
  points: resample(stroke.points
    .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y))
    .map(point)),
});

/** A box that always has some extent, so a zero-size region still shows. */
const box = (mark: { x: number; y: number; w: number; h: number }): StoryboardBox => {
  const x = unit(mark.x);
  const y = unit(mark.y);
  return { x, y, w: Math.max(0.01, unit(Math.min(mark.w, 1 - x))), h: Math.max(0.01, unit(Math.min(mark.h, 1 - y))) };
};

function normalizedMark(mark: StoryboardMark): StoryboardMark | null {
  switch (mark.kind) {
    case "line": {
      const { points } = normalizedStroke({ points: mark.points ?? [] });
      return points.length >= 2 ? { kind: "line", points, label: text(mark.label) } : null;
    }
    case "rect":
      return { kind: "rect", ...box(mark), label: text(mark.label), assetId: mark.assetId?.trim() || undefined };
    case "ellipse":
      return { kind: "ellipse", ...box(mark), label: text(mark.label) };
    case "arrow":
      return { kind: "arrow", from: point(mark.from), to: point(mark.to), label: text(mark.label) };
    case "label": {
      const content = text(mark.text);
      return content ? { kind: "label", x: unit(mark.x), y: unit(mark.y), text: content, size: mark.size ?? "m" } : null;
    }
    default:
      return null;
  }
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

const boundsOf = (points: readonly StoryboardPoint[]): StoryboardBox => {
  let minX = 1; let minY = 1; let maxX = 0; let maxY = 0;
  points.forEach((item) => {
    minX = Math.min(minX, item.x); minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x); maxY = Math.max(maxY, item.y);
  });
  return { x: unit(minX), y: unit(minY), w: unit(maxX - minX), h: unit(maxY - minY) };
};

/** Where a mark sits, for overlap tests and the compact summary. */
function markBox(mark: StoryboardMark): StoryboardBox {
  switch (mark.kind) {
    case "line": return boundsOf(mark.points);
    case "rect":
    case "ellipse": return { x: mark.x, y: mark.y, w: mark.w, h: mark.h };
    case "arrow": return boundsOf([mark.from, mark.to]);
    case "label": {
      const em = mark.size === "l" ? 0.031 : mark.size === "s" ? 0.018 : 0.023;
      return { x: mark.x, y: mark.y, w: unit(mark.text.length * em * 0.55), h: em * 1.3 };
    }
  }
}

const markLabel = (mark: StoryboardMark) => (mark.kind === "label" ? mark.text : mark.label);

const overlaps = (a: StoryboardBox, b: StoryboardBox, slack = 0.02) => (
  a.x - slack < b.x + b.w && a.x + a.w + slack > b.x && a.y - slack < b.y + b.h && a.y + a.h + slack > b.y
);

const centerDistance = (a: StoryboardBox, b: StoryboardBox) => Math.hypot((a.x + a.w / 2) - (b.x + b.w / 2), (a.y + a.h / 2) - (b.y + b.h / 2));

/** Reads one red stroke against the marks it was drawn over. */
export function describeAnnotation(stroke: StoryboardStroke, marks: readonly StoryboardMark[]): AnnotationSummary {
  const bounds = boundsOf(stroke.points);
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  const closes = stroke.points.length >= 8 && Math.hypot(first.x - last.x, first.y - last.y) < 0.08;
  const shape = closes && bounds.w > 0.03 && bounds.h > 0.03 ? "loop" : "stroke";
  const page = bounds.x + bounds.w <= 0.5 ? "left" : bounds.x >= 0.5 ? "right" : "both";
  const near = marks
    .map((mark) => ({ label: markLabel(mark), boxOf: markBox(mark) }))
    .filter((item): item is { label: string; boxOf: StoryboardBox } => Boolean(item.label) && overlaps(bounds, item.boxOf))
    .sort((a, b) => centerDistance(bounds, a.boxOf) - centerDistance(bounds, b.boxOf))
    .map((item) => item.label)
    .filter((label, index, all) => all.indexOf(label) === index)
    .slice(0, 3);
  return { points: stroke.points, shape, page, bounds, near };
}

function publish(spreads: StoryboardSpread[]) {
  snapshot = { revision: snapshot.revision + 1, spreads: spreads.sort((a, b) => a.index - b.index) };
  persist(snapshot);
  listeners.forEach((listener) => listener());
  return snapshot;
}

export function getStoryboardSnapshot() {
  return snapshot;
}

export function summarizeStoryboard(source: StoryboardSnapshot = snapshot): StoryboardSummary {
  return {
    revision: source.revision,
    spreads: source.spreads.map((spread) => ({
      index: spread.index,
      caption: spread.caption,
      sketchRevision: spread.sketchRevision,
      marks: spread.marks.map((mark) => stripUndefined({ kind: mark.kind, label: markLabel(mark), assetId: mark.kind === "rect" ? mark.assetId : undefined, box: markBox(mark) })),
      annotations: spread.annotations.map((stroke) => describeAnnotation(stroke, spread.marks)),
    })),
  };
}

export function subscribeToStoryboard(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * `expectedRevision` is the revision the Agent read its annotations at. A
 * later reader mark bumps the revision, so clearing marks against a stale
 * read is refused instead of silently discarding feedback nobody has seen.
 */
export function applyStoryboardSketches(
  action: "replace" | "update",
  incoming: readonly StoryboardSketchInput[],
  resolvedAnnotations: readonly number[] = [],
  expectedRevision?: number,
) {
  if (typeof expectedRevision === "number" && expectedRevision !== snapshot.revision) {
    return { ok: false as const, code: "storyboard_conflict" as const, currentRevision: snapshot.revision };
  }
  const resolved = new Set(resolvedAnnotations);
  const sketchRevision = snapshot.revision + 1;
  const prior = new Map(snapshot.spreads.map((spread) => [spread.index, spread]));
  const next = action === "replace" ? new Map<number, StoryboardSpread>() : new Map(prior);
  incoming.forEach((spread) => {
    const current = prior.get(spread.index);
    next.set(spread.index, {
      index: spread.index,
      caption: spread.caption?.trim() || current?.caption || `Spread ${spread.index + 1}`,
      sketchRevision,
      marks: spread.marks
        .map(normalizedMark)
        .filter((mark): mark is StoryboardMark => mark !== null)
        .map(stripUndefined)
        .slice(0, MAX_MARKS_PER_SPREAD),
      annotations: resolved.has(spread.index) ? [] : current?.annotations ?? [],
    });
  });
  resolved.forEach((index) => {
    const spread = next.get(index);
    if (spread) next.set(index, { ...spread, annotations: [] });
  });
  return { ok: true as const, storyboard: publish([...next.values()]) };
}

export function addStoryboardAnnotation(index: number, stroke: StoryboardStroke) {
  const normalized = normalizedStroke(stroke);
  if (normalized.points.length < 2) return snapshot;
  const next = new Map(snapshot.spreads.map((spread) => [spread.index, spread]));
  const spread = next.get(index) ?? { index, caption: `Spread ${index + 1}`, sketchRevision: 0, marks: [], annotations: [] };
  // The cap is enforced by the pencil control, which stops accepting marks at
  // the limit instead of silently forgetting the oldest one.
  if (spread.annotations.length >= MAX_ANNOTATIONS_PER_SPREAD) return snapshot;
  next.set(index, { ...spread, annotations: [...spread.annotations, normalized] });
  return publish([...next.values()]);
}

export function undoStoryboardAnnotation(index: number) {
  const spread = snapshot.spreads.find((candidate) => candidate.index === index);
  if (!spread?.annotations.length) return snapshot;
  return publish(snapshot.spreads.map((candidate) => candidate.index === index
    ? { ...candidate, annotations: candidate.annotations.slice(0, -1) }
    : candidate));
}

export function clearStoryboardAnnotations(index: number) {
  const spread = snapshot.spreads.find((candidate) => candidate.index === index);
  if (!spread?.annotations.length) return snapshot;
  return publish(snapshot.spreads.map((candidate) => candidate.index === index ? { ...candidate, annotations: [] } : candidate));
}

/** The plan stays readable until the created book's first frame has shown it fading into the final art. */
export function retireStoryboard(documentId: string) {
  snapshot = { ...snapshot, createdDocumentId: documentId };
  persist(snapshot);
  listeners.forEach((listener) => listener());
}

export function resetStoryboard() {
  snapshot = { revision: 0, spreads: [] };
  persist(snapshot);
  listeners.forEach((listener) => listener());
}
