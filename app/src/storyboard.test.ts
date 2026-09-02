import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_ANNOTATIONS_PER_SPREAD,
  addStoryboardAnnotation,
  applyStoryboardSketches,
  clearStoryboardAnnotations,
  describeAnnotation,
  getStoryboardSnapshot,
  resetStoryboard,
  subscribeToStoryboard,
  summarizeStoryboard,
  undoStoryboardAnnotation,
  type StoryboardMark,
} from "./storyboard";

const stroke = (offset = 0) => ({
  points: [{ x: 0.1 + offset, y: 0.2 }, { x: 0.4 + offset, y: 0.5 }],
});
const line = (offset = 0): StoryboardMark => ({ kind: "line", ...stroke(offset) });
/** A closed red loop around the given box. */
const loopAround = (x: number, y: number, w: number, h: number) => ({
  points: Array.from({ length: 24 }, (_, index) => {
    const angle = (index / 23) * Math.PI * 2;
    return { x: x + w / 2 + Math.cos(angle) * (w / 2 + 0.01), y: y + h / 2 + Math.sin(angle) * (h / 2 + 0.01) };
  }),
});

beforeEach(resetStoryboard);

describe("storyboard shared state", () => {
  it("keeps reader marks while Codex updates another spread, then clears only applied marks", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToStoryboard(listener);
    applyStoryboardSketches("replace", [
      { index: 0, caption: "Meet the guide", marks: [line()] },
      { index: 1, caption: "Cross the river", marks: [line(0.1)] },
    ]);
    addStoryboardAnnotation(0, stroke(0.2));

    applyStoryboardSketches("update", [
      { index: 1, caption: "Cross beneath the moon", marks: [line(0.3)] },
    ]);
    expect(getStoryboardSnapshot().spreads[0].annotations).toHaveLength(1);

    applyStoryboardSketches("update", [
      { index: 0, caption: "Move the guide left", marks: [line(0.05)] },
    ], [0], 3);
    expect(getStoryboardSnapshot().spreads).toMatchObject([
      { index: 0, caption: "Move the guide left", annotations: [] },
      { index: 1, caption: "Cross beneath the moon" },
    ]);
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
  });

  it("refuses to clear marks the Agent has not read", () => {
    applyStoryboardSketches("replace", [{ index: 0, marks: [line()] }]);
    addStoryboardAnnotation(0, stroke(0.2));
    const stale = applyStoryboardSketches("update", [{ index: 0, marks: [line(0.1)] }], [0], 1);
    expect(stale).toMatchObject({ ok: false, code: "storyboard_conflict", currentRevision: 2 });
    expect(getStoryboardSnapshot().spreads[0].annotations).toHaveLength(1);
    const fresh = applyStoryboardSketches("update", [{ index: 0, marks: [line(0.1)] }], [0], 2);
    expect(fresh).toMatchObject({ ok: true, storyboard: { revision: 3 } });
    expect(getStoryboardSnapshot().spreads[0].annotations).toHaveLength(0);
  });

  it("persists every revision to sessionStorage and clears it on reset", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
    try {
      applyStoryboardSketches("replace", [{ index: 0, caption: "Meet the guide", marks: [line()] }]);
      addStoryboardAnnotation(0, stroke(0.2));
      const saved = JSON.parse(store.get("apertale:storyboard:v2") ?? "null");
      expect(saved).toMatchObject({ revision: 2, spreads: [{ index: 0, caption: "Meet the guide", annotations: [{}] }] });
      resetStoryboard();
      expect(JSON.parse(store.get("apertale:storyboard:v2") ?? "null")).toEqual({ revision: 0, spreads: [] });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Codex marks", () => {
  it("normalizes every mark kind into the spread, keeps labels short, and drops empty ones", () => {
    applyStoryboardSketches("replace", [{
      index: 0,
      marks: [
        { kind: "rect", x: 0.9, y: 0.9, w: 0.5, h: 0.5, label: " boat ".padEnd(60, "x") },
        { kind: "ellipse", x: -1, y: 0.2, w: 0.2, h: 0.1, label: "sun" },
        { kind: "arrow", from: { x: 0.2, y: 0.2 }, to: { x: 1.5, y: 0.4 } },
        { kind: "label", x: 0.6, y: 0.1, text: "   " },
        { kind: "label", x: 0.6, y: 0.1, text: "harbour", size: "l" },
        { kind: "line", points: [{ x: 0.1, y: 0.1 }] },
      ],
    }]);
    const marks = getStoryboardSnapshot().spreads[0].marks;
    expect(marks.map((mark) => mark.kind)).toEqual(["rect", "ellipse", "arrow", "label"]);
    expect(marks[0]).toMatchObject({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 });
    expect((marks[0] as { label: string }).label).toHaveLength(40);
    expect(marks[1]).toMatchObject({ x: 0, w: 0.2 });
    expect(marks[2]).toMatchObject({ to: { x: 1, y: 0.4 } });
    expect(marks[3]).toMatchObject({ text: "harbour", size: "l" });
  });

  it("summarizes marks as labelled boxes without freehand geometry", () => {
    applyStoryboardSketches("replace", [{ index: 0, marks: [{ kind: "line", points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.4 }], label: "path" }, { kind: "label", x: 0.6, y: 0.2, text: "moon" }] }]);
    const summary = summarizeStoryboard().spreads[0];
    expect(summary.marks).toEqual([
      { kind: "line", label: "path", box: { x: 0.1, y: 0.1, w: 0.2, h: 0.3 } },
      { kind: "label", label: "moon", box: expect.objectContaining({ x: 0.6, y: 0.2 }) },
    ]);
    expect(JSON.stringify(summary)).not.toContain("points");
  });
});

describe("reader annotations", () => {
  const marks: StoryboardMark[] = [
    { kind: "rect", x: 0.55, y: 0.5, w: 0.2, h: 0.2, label: "boat" },
    { kind: "ellipse", x: 0.1, y: 0.1, w: 0.15, h: 0.1, label: "sun" },
    { kind: "label", x: 0.6, y: 0.1, text: "harbour" },
  ];

  it("reads a loop around a labelled mark as pointing at it", () => {
    const loop = describeAnnotation(loopAround(0.55, 0.5, 0.2, 0.2), marks);
    expect(loop).toMatchObject({ shape: "loop", page: "right", near: ["boat"] });
    expect(loop.bounds.x).toBeCloseTo(0.54, 1);
  });

  it("reads an open stroke as a stroke and reports both pages when it crosses the gutter", () => {
    const across = describeAnnotation({ points: [{ x: 0.2, y: 0.12 }, { x: 0.6, y: 0.12 }] }, marks);
    expect(across).toMatchObject({ shape: "stroke", page: "both" });
    expect(across.near).toEqual(["sun", "harbour"]);
    const nowhere = describeAnnotation({ points: [{ x: 0.3, y: 0.9 }, { x: 0.35, y: 0.95 }] }, marks);
    expect(nowhere).toMatchObject({ page: "left", near: [] });
  });

  it("resamples a long freehand mark instead of truncating it", () => {
    const points = Array.from({ length: 300 }, (_, index) => ({ x: index / 299, y: 0.5 }));
    addStoryboardAnnotation(0, { points });
    const stored = getStoryboardSnapshot().spreads[0].annotations[0].points;
    expect(stored).toHaveLength(120);
    expect(stored[0]).toEqual({ x: 0, y: 0.5 });
    expect(stored[119]).toEqual({ x: 1, y: 0.5 });
  });

  it("stops at the per-spread limit, undoes the last mark, and clears the rest", () => {
    applyStoryboardSketches("replace", [{ index: 0, marks: [line()] }]);
    for (let index = 0; index < MAX_ANNOTATIONS_PER_SPREAD + 3; index += 1) addStoryboardAnnotation(0, stroke(index / 100));
    expect(getStoryboardSnapshot().spreads[0].annotations).toHaveLength(MAX_ANNOTATIONS_PER_SPREAD);
    expect(getStoryboardSnapshot().spreads[0].annotations[0].points[0].x).toBe(0.1);
    undoStoryboardAnnotation(0);
    expect(getStoryboardSnapshot().spreads[0].annotations).toHaveLength(MAX_ANNOTATIONS_PER_SPREAD - 1);
    clearStoryboardAnnotations(0);
    expect(getStoryboardSnapshot().spreads[0].annotations).toHaveLength(0);
    addStoryboardAnnotation(0, { points: [{ x: -1, y: 2 }, { x: 0.3, y: 0.4 }] });
    expect(getStoryboardSnapshot().spreads[0].annotations[0].points[0]).toEqual({ x: 0, y: 1 });
  });
});
