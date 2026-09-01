import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addStoryboardAnnotation,
  applyStoryboardSketches,
  getStoryboardSnapshot,
  resetStoryboard,
  subscribeToStoryboard,
  undoStoryboardAnnotation,
} from "./storyboard";

const stroke = (offset = 0) => ({
  points: [{ x: 0.1 + offset, y: 0.2 }, { x: 0.4 + offset, y: 0.5 }],
});

beforeEach(resetStoryboard);

describe("storyboard shared state", () => {
  it("keeps reader marks while Codex updates another spread, then clears only applied marks", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToStoryboard(listener);
    applyStoryboardSketches("replace", [
      { index: 0, caption: "Meet the guide", strokes: [stroke()] },
      { index: 1, caption: "Cross the river", strokes: [stroke(0.1)] },
    ]);
    addStoryboardAnnotation(0, stroke(0.2));

    applyStoryboardSketches("update", [
      { index: 1, caption: "Cross beneath the moon", strokes: [stroke(0.3)] },
    ]);
    expect(getStoryboardSnapshot().spreads[0].annotations).toHaveLength(1);

    applyStoryboardSketches("update", [
      { index: 0, caption: "Move the guide left", strokes: [stroke(0.05)] },
    ], [0]);
    expect(getStoryboardSnapshot().spreads).toMatchObject([
      { index: 0, caption: "Move the guide left", annotations: [] },
      { index: 1, caption: "Cross beneath the moon" },
    ]);
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
  });

  it("clamps freehand points and undoes only the last correction", () => {
    applyStoryboardSketches("replace", [{ index: 0, strokes: [stroke()] }]);
    addStoryboardAnnotation(0, { points: [{ x: -1, y: 2 }, { x: 0.3, y: 0.4 }] });
    addStoryboardAnnotation(0, stroke(0.2));
    expect(getStoryboardSnapshot().spreads[0].annotations[0].points[0]).toEqual({ x: 0, y: 1 });

    undoStoryboardAnnotation(0);
    expect(getStoryboardSnapshot().spreads[0].annotations).toHaveLength(1);
  });
});
