import { describe, expect, it } from "vitest";
import { paintSketchFade, paintWorkshopDrawing, sampleCanvasLuminance, wrapText } from "./pageCanvas";
import type { StoryboardSpread } from "./storyboard";

/** A measuring context: every character is 10px wide. */
const measuring = { measureText: (text: string) => ({ width: text.length * 10 }) } as unknown as CanvasRenderingContext2D;

describe("wrapText", () => {
  it("breaks Latin text at word boundaries within the width", () => {
    expect(wrapText(measuring, "the quick brown fox jumps", 100)).toEqual(["the quick", "brown fox", "jumps"]);
  });

  it("breaks CJK text between characters instead of producing one overlong line", () => {
    const lines = wrapText(measuring, "一本会呼吸的图画书在桌上打开", 60);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.length * 10 <= 60)).toBe(true);
  });

  it("lets a single over-long segment overhang rather than loop forever", () => {
    expect(wrapText(measuring, "supercalifragilistic", 50)).toEqual(["supercalifragilistic"]);
    expect(wrapText(measuring, "   ", 50)).toEqual([""]);
  });
});

describe("sampleCanvasLuminance", () => {
  it("averages the sampled pixels with perceptual weights", () => {
    const white = { getImageData: () => ({ data: new Uint8ClampedArray(4 * 64 * 3).fill(255) }) } as unknown as CanvasRenderingContext2D;
    const black = { getImageData: () => ({ data: new Uint8ClampedArray(4 * 64 * 3).fill(0) }) } as unknown as CanvasRenderingContext2D;
    expect(sampleCanvasLuminance(white)).toBeCloseTo(255, 0);
    expect(sampleCanvasLuminance(black)).toBe(0);
  });
});

describe("paintWorkshopDrawing", () => {
  /** A recording 2D context: remembers every stroke with its colour, and every text it set. */
  function recordingCanvas() {
    const strokes: { color: string; width: number; segments: number; alpha: number }[] = [];
    const texts: { text: string; alpha: number }[] = [];
    const drawn: unknown[] = [];
    let segments = 0;
    const context = {
      strokeStyle: "", fillStyle: "", lineWidth: 0, lineCap: "", lineJoin: "", font: "", textBaseline: "", globalAlpha: 1,
      clearRect: () => undefined,
      drawImage: (image: unknown) => { drawn.push(image); },
      save: () => undefined,
      restore() { this.globalAlpha = 1; },
      beginPath: () => { segments = 0; },
      moveTo: () => undefined,
      lineTo: () => { segments += 1; },
      stroke() { strokes.push({ color: String(this.strokeStyle), width: Number(this.lineWidth), segments, alpha: Number(this.globalAlpha) }); },
      fillText(text: string) { texts.push({ text, alpha: Number(this.globalAlpha) }); },
    };
    const canvas = { width: 200, height: 100, getContext: () => context };
    return { strokes, texts, drawn, pair: { overlay: { image: canvas, needsUpdate: false }, spread: {} } as unknown as Parameters<typeof paintWorkshopDrawing>[0] };
  }
  const line = (n: number) => ({ kind: "line" as const, points: Array.from({ length: n }, (_, index) => ({ x: index / (n - 1), y: 0.5 })) });
  const spread = (marks: StoryboardSpread["marks"], annotations: StoryboardSpread["annotations"] = []): StoryboardSpread => ({ index: 0, caption: "", sketchRevision: 1, marks, annotations });

  it("reveals Codex marks one after another and paints reader marks in red on top", () => {
    const { strokes, pair } = recordingCanvas();
    paintWorkshopDrawing(pair, spread([line(11), line(11)], [line(5)]), [], 0.5);
    // Half of the reveal: the first mark is complete, the second has not started.
    expect(strokes.map((item) => item.segments)).toEqual([10, 4]);
    expect(strokes[1].color).toContain("230, 74, 61");
    expect(strokes[1].width).toBeGreaterThan(strokes[0].width);
    expect(pair.overlay.needsUpdate).toBe(true);
  });

  it("draws boxes, arrows with heads, and labels only once their turn has come", () => {
    const { strokes, texts, pair } = recordingCanvas();
    const marks: StoryboardSpread["marks"] = [
      { kind: "rect", x: 0.1, y: 0.1, w: 0.3, h: 0.3, label: "boat" },
      { kind: "arrow", from: { x: 0.2, y: 0.2 }, to: { x: 0.6, y: 0.6 } },
      { kind: "label", x: 0.5, y: 0.1, text: "harbour", size: "l" },
    ];
    paintWorkshopDrawing(pair, spread(marks), [], 1);
    // Box outline, arrow shaft, arrow head: three stroked paths.
    expect(strokes).toHaveLength(3);
    expect(strokes[0].segments).toBe(7);
    expect(texts.map((item) => item.text)).toEqual(["boat", "harbour"]);

    const partial = recordingCanvas();
    paintWorkshopDrawing(partial.pair, spread(marks), [], 2.5 / 3);
    // The label's own turn is half way: it fades in and no box label is skipped.
    expect(partial.texts).toEqual([{ text: "boat", alpha: 1 }, { text: "harbour", alpha: 0.5 }]);
  });

  it("draws the in-progress red mark from the live draft", () => {
    const { strokes, pair } = recordingCanvas();
    paintWorkshopDrawing(pair, undefined, [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.3, y: 0.1 }], 1);
    expect(strokes).toHaveLength(1);
    expect(strokes[0].segments).toBe(2);
  });

  it("fades the finished plan over the loaded overlay and leaves the overlay alone at alpha 0", () => {
    const { strokes, drawn, pair } = recordingCanvas();
    const base = { width: 200, height: 100 } as unknown as HTMLCanvasElement;
    paintSketchFade(pair, spread([line(4)], [line(3)]), base, 0.4);
    expect(drawn).toEqual([base]);
    expect(strokes.map((stroke) => stroke.alpha)).toEqual([0.4, 0.4]);
    paintSketchFade(pair, spread([line(4)]), base, 0);
    expect(drawn).toEqual([base, base]);
    expect(strokes).toHaveLength(2);
  });
});
