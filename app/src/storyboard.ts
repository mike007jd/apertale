export type StoryboardPoint = { x: number; y: number };
export type StoryboardStroke = { points: StoryboardPoint[] };
export type StoryboardSpread = {
  index: number;
  caption: string;
  sketchRevision: number;
  sketches: StoryboardStroke[];
  annotations: StoryboardStroke[];
};

export type StoryboardSnapshot = {
  revision: number;
  spreads: StoryboardSpread[];
};

export type StoryboardSketchInput = {
  index: number;
  caption?: string;
  strokes: StoryboardStroke[];
};

const listeners = new Set<() => void>();
let snapshot: StoryboardSnapshot = { revision: 0, spreads: [] };

const normalizedStroke = (stroke: StoryboardStroke): StoryboardStroke => ({
  points: stroke.points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({
      x: Math.max(0, Math.min(1, point.x)),
      y: Math.max(0, Math.min(1, point.y)),
    }))
    .slice(0, 120),
});

function publish(spreads: StoryboardSpread[]) {
  snapshot = { revision: snapshot.revision + 1, spreads: spreads.sort((a, b) => a.index - b.index) };
  listeners.forEach((listener) => listener());
  return snapshot;
}

export function getStoryboardSnapshot() {
  return snapshot;
}

export function subscribeToStoryboard(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function applyStoryboardSketches(
  action: "replace" | "update",
  incoming: readonly StoryboardSketchInput[],
  resolvedAnnotations: readonly number[] = [],
) {
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
      sketches: spread.strokes.map(normalizedStroke).filter((stroke) => stroke.points.length >= 2).slice(0, 36),
      annotations: resolved.has(spread.index) ? [] : current?.annotations ?? [],
    });
  });
  resolved.forEach((index) => {
    const spread = next.get(index);
    if (spread) next.set(index, { ...spread, annotations: [] });
  });
  return publish([...next.values()]);
}

export function addStoryboardAnnotation(index: number, stroke: StoryboardStroke) {
  const normalized = normalizedStroke(stroke);
  if (normalized.points.length < 2) return snapshot;
  const next = new Map(snapshot.spreads.map((spread) => [spread.index, spread]));
  const spread = next.get(index) ?? { index, caption: `Spread ${index + 1}`, sketchRevision: 0, sketches: [], annotations: [] };
  next.set(index, { ...spread, annotations: [...spread.annotations, normalized].slice(-24) });
  return publish([...next.values()]);
}

export function undoStoryboardAnnotation(index: number) {
  const spread = snapshot.spreads.find((candidate) => candidate.index === index);
  if (!spread?.annotations.length) return snapshot;
  return publish(snapshot.spreads.map((candidate) => candidate.index === index
    ? { ...candidate, annotations: candidate.annotations.slice(0, -1) }
    : candidate));
}

export function resetStoryboard() {
  snapshot = { revision: 0, spreads: [] };
  listeners.forEach((listener) => listener());
}
