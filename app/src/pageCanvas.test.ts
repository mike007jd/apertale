import { describe, expect, it, vi } from "vitest";
import { getSketchImageVersion, heroCentre, paintSketchBloom, paintWorkshopDrawing, sampleCanvasLuminance, wrapText } from "./pageCanvas";
import type { StoryboardSpread } from "./storyboard";

/** Preview leases resolve for `photo-*` ids and reject for anything else; full-size leases are untouched. */
vi.mock("./assetStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./assetStore")>()),
  acquireAssetPreviewUrl: (assetId: string) => assetId.startsWith("photo-")
    ? Promise.resolve({ assetId, url: `blob:${assetId}`, release: () => undefined })
    : Promise.reject(new Error("missing")),
}));
globalThis.Image = class { decoding = ""; src = ""; naturalWidth = 400; naturalHeight = 300; decode = () => Promise.resolve(); } as unknown as typeof Image;

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
    const positions: { text: string; x: number; y: number }[] = [];
    const drawn: unknown[] = [];
    const order: string[] = [];
    const pencils: string[] = [];
    const shadows: number[] = [];
    const gradients: number[][] = [];
    let segments = 0;
    const context = {
      strokeStyle: "", fillStyle: "", lineWidth: 0, lineCap: "", lineJoin: "", font: "", textBaseline: "", globalAlpha: 1, filter: "none", globalCompositeOperation: "source-over",
      clearRect: () => undefined,
      ellipse(_x: number, y: number) { shadows.push(y); },
      createRadialGradient(...args: number[]) { gradients.push(args); return { addColorStop: () => undefined }; },
      translate: () => undefined,
      rotate: () => undefined,
      closePath: () => undefined,
      fill: () => undefined,
      fillRect() { pencils.push(this.globalCompositeOperation === "destination-out" ? "hole" : String(this.fillStyle)); },
      measureText: (text: string) => ({ width: text.length * 10 }),
      drawImage(image: unknown) { drawn.push(image); order.push(`image:${this.globalAlpha}:${this.filter}`); },
      save: () => undefined,
      restore() { this.globalAlpha = 1; this.filter = "none"; this.globalCompositeOperation = "source-over"; },
      beginPath: () => { segments = 0; },
      moveTo: () => undefined,
      lineTo: () => { segments += 1; },
      stroke() { order.push("stroke"); strokes.push({ color: String(this.strokeStyle), width: Number(this.lineWidth), segments, alpha: Number(this.globalAlpha) }); },
      fillText(text: string, x: number, y: number) { texts.push({ text, alpha: Number(this.globalAlpha) }); positions.push({ text, x, y }); },
    };
    const canvas = { width: 200, height: 100, getContext: () => context };
    return { strokes, texts, positions, drawn, order, pencils, shadows, gradients, pair: { overlay: { image: canvas, needsUpdate: false }, spread: {} } as unknown as Parameters<typeof paintWorkshopDrawing>[0] };
  }
  const LIGHT = "rgba(64, 58, 50, .36)";
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

  it("rides a pencil on the mark being drawn and lifts it once the sketch is complete", () => {
    const mid = recordingCanvas();
    // A quarter of the reveal: the first of two marks is half drawn.
    paintWorkshopDrawing(mid.pair, spread([line(11), line(11)]), [], 0.25);
    expect(mid.strokes.map((item) => item.segments)).toEqual([5]);
    expect(mid.pencils).toEqual(["#e8b04c", "rgba(38, 34, 30, .95)", "#d8615a"]);

    const done = recordingCanvas();
    paintWorkshopDrawing(done.pair, spread([line(11), line(11)]), [], 1);
    expect(done.pencils).toEqual([]);
  });

  it("draws boxes, arrows with heads, and labels only once their turn has come", () => {
    const { strokes, texts, pair } = recordingCanvas();
    const marks: StoryboardSpread["marks"] = [
      { kind: "rect", x: 0.1, y: 0.1, w: 0.3, h: 0.3, label: "boat" },
      { kind: "arrow", from: { x: 0.2, y: 0.2 }, to: { x: 0.6, y: 0.6 } },
      { kind: "label", x: 0.5, y: 0.1, text: "harbour", size: "l" },
    ];
    paintWorkshopDrawing(pair, spread(marks), [], 1);
    // Box outline, its lighter second pass, arrow shaft, arrow head.
    expect(strokes.map((item) => item.width)).toEqual([6.5, 4, 5.5, 5.5]);
    expect(strokes[0].segments).toBe(7);
    expect(strokes[1].color).toBe(LIGHT);
    expect(texts.map((item) => item.text)).toEqual(["boat", "harbour"]);

    const partial = recordingCanvas();
    paintWorkshopDrawing(partial.pair, spread(marks), [], 2.5 / 3);
    // The label's own turn is half way: it fades in and no box label is skipped.
    expect(partial.texts).toEqual([{ text: "boat", alpha: 1 }, { text: "harbour", alpha: 0.5 }]);
  });

  it("goes round an ellipse twice and hatches its shadow side only once the outline is complete", () => {
    const ellipse: StoryboardSpread["marks"][number] = { kind: "ellipse", x: 0.2, y: 0.2, w: 0.4, h: 0.4, label: "sun" };
    const done = recordingCanvas();
    paintWorkshopDrawing(done.pair, spread([ellipse]), [], 1);
    expect(done.strokes.map((item) => item.segments)).toEqual([43, 43, 7]);
    expect(done.strokes.map((item) => item.color === LIGHT)).toEqual([false, true, true]);

    const half = recordingCanvas();
    paintWorkshopDrawing(half.pair, spread([ellipse]), [], 0.5);
    expect(half.strokes.map((item) => item.segments)).toEqual([21]);
    expect(half.strokes[0].color).not.toBe(LIGHT);
  });

  it("draws an unlabelled ellipse once, thin and soft, and a labelled one as a hatched subject", () => {
    const { strokes, pair } = recordingCanvas();
    paintWorkshopDrawing(pair, spread([
      { kind: "ellipse", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      { kind: "ellipse", x: 0.5, y: 0.1, w: 0.2, h: 0.2, label: "sun" },
    ]), [], 1);
    expect(strokes.map((item) => [item.width, item.color === "rgba(64, 58, 50, .55)"])).toEqual([[4, true], [6.5, false], [4, false], [4, false]]);

    const lines = recordingCanvas();
    paintWorkshopDrawing(lines.pair, spread([line(4), { ...line(4), label: "kite" }]), [], 1);
    // A bare line is a horizon or a limb; a labelled line is a drawn subject.
    expect(lines.strokes.map((item) => [item.width, item.color === "rgba(64, 58, 50, .55)"])).toEqual([[4, true], [4.5, false]]);
  });

  it("writes shape labels inside the shape: rect top-left, ellipse centre", () => {
    const { positions, pair } = recordingCanvas();
    paintWorkshopDrawing(pair, spread([
      { kind: "rect", x: 0.1, y: 0.1, w: 0.3, h: 0.3, label: "boat" },
      { kind: "ellipse", x: 0.2, y: 0.2, w: 0.4, h: 0.4, label: "sun" },
    ]), [], 1);
    expect(positions).toEqual([{ text: "boat", x: 30, y: 18 }, { text: "sun", x: 80, y: 40 }]);
  });

  it("reveals a rich spread back to front without double counting the overdraw", () => {
    const marks: StoryboardSpread["marks"] = [
      ...Array.from({ length: 6 }, (_, i) => ({ ...line(5), label: `m${i}` })),
      ...Array.from({ length: 6 }, (_, i) => ({ kind: "ellipse" as const, x: 0.1 * i, y: 0.3, w: 0.08, h: 0.1, label: `m${6 + i}` })),
      ...Array.from({ length: 6 }, (_, i) => ({ kind: "rect" as const, x: 0.1 * i, y: 0.5, w: 0.08, h: 0.1, label: `m${12 + i}` })),
      ...Array.from({ length: 5 }, (_, i) => ({ kind: "arrow" as const, from: { x: 0.1 * i, y: 0.7 }, to: { x: 0.1 * i + 0.05, y: 0.8 }, label: `m${18 + i}` })),
      { kind: "label", x: 0.6, y: 0.1, text: "m23", size: "l" },
    ];
    const mid = recordingCanvas();
    paintWorkshopDrawing(mid.pair, spread(marks), [], 12.5 / 24);
    // Marks 0–11 complete (6 lines, 6 ellipses × 3 passes), mark 12 half drawn under the pencil.
    expect(mid.texts.map((item) => item.text)).toEqual(Array.from({ length: 12 }, (_, i) => `m${i}`));
    expect(mid.strokes).toHaveLength(6 + 18 + 1);
    expect(mid.pencils.length).toBeGreaterThan(0);

    const done = recordingCanvas();
    paintWorkshopDrawing(done.pair, spread(marks), [], 1);
    expect(done.texts.map((item) => item.text)).toEqual(Array.from({ length: 24 }, (_, i) => `m${i}`));
    expect(done.strokes).toHaveLength(6 * 1 + 6 * 3 + 6 * 2 + 5 * 2);
    expect(done.pencils).toEqual([]);
  });

  it("draws the in-progress red mark from the live draft", () => {
    const { strokes, pair } = recordingCanvas();
    paintWorkshopDrawing(pair, undefined, [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.3, y: 0.1 }], 1);
    expect(strokes).toHaveLength(1);
    expect(strokes[0].segments).toBe(2);
  });

  it("ghosts a reader photo under a box once its preview loads, and repaints on the version bump", async () => {
    const { drawn, order, pair } = recordingCanvas();
    const marks: StoryboardSpread["marks"] = [{ kind: "rect", x: 0.1, y: 0.1, w: 0.4, h: 0.3, assetId: "photo-1", label: "boat" }];
    const before = getSketchImageVersion();
    paintWorkshopDrawing(pair, spread(marks), [], 1);
    expect(drawn).toEqual([]);
    await vi.waitFor(() => expect(getSketchImageVersion()).toBe(before + 1));
    paintWorkshopDrawing(pair, spread(marks), [], 1);
    expect(drawn).toHaveLength(1);
    expect((drawn[0] as HTMLImageElement).naturalWidth).toBe(400);
    expect(order).toEqual(["stroke", "stroke", "image:0.4:grayscale(1) contrast(1.35)", "stroke", "stroke"]);
  });

  it("leaves the plain pencil box when the photo lease fails", async () => {
    const { drawn, strokes, pair } = recordingCanvas();
    const marks: StoryboardSpread["marks"] = [{ kind: "rect", x: 0.1, y: 0.1, w: 0.4, h: 0.3, assetId: "gone" }];
    const before = getSketchImageVersion();
    paintWorkshopDrawing(pair, spread(marks), [], 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    paintWorkshopDrawing(pair, spread(marks), [], 1);
    expect(getSketchImageVersion()).toBe(before);
    expect(drawn).toEqual([]);
    // An unlabelled box is construction: one soft pass per paint, no overdraw.
    expect(strokes).toHaveLength(2);
    expect(strokes[0].color).toBe("rgba(64, 58, 50, .55)");
  });

  it("blooms the created spread out of its hero: a sketched paper veil, a growing hole, and the text fading in", () => {
    const { strokes, drawn, pencils, gradients, pair } = recordingCanvas();
    const base = { width: 200, height: 100 } as unknown as HTMLCanvasElement;
    const plan = spread([line(4), { kind: "ellipse", x: 0.6, y: 0.2, w: 0.2, h: 0.4, label: "bear" }, { kind: "ellipse", x: 0.1, y: 0.1, w: 0.1, h: 0.1 }]);
    expect(heroCentre(plan)).toEqual({ x: 0.7, y: 0.4 });
    expect(heroCentre(spread([line(2)]))).toEqual({ x: 0.5, y: 0.5 });

    paintSketchBloom(pair, plan, base, 0.5);
    // Veil first, the sketch on it at full strength, then the hole, then the text at the bloom's alpha.
    expect(pencils[0]).toBe("#f7efdf");
    expect(pencils.at(-1)).toBe("hole");
    expect(strokes[0]).toMatchObject({ alpha: 1 });
    expect(gradients).toHaveLength(1);
    expect(gradients[0].slice(0, 2)).toEqual([140, 40]);
    expect(gradients[0][2]).toBeLessThan(gradients[0][5]);
    expect(drawn).toEqual([base]);

    paintSketchBloom(pair, plan, base, 1);
    expect(drawn).toEqual([base, base]);
    expect(gradients).toHaveLength(1);
    expect(pencils.filter((fill) => fill === "hole")).toHaveLength(1);
  });

  it("floats the idle pencil with its shadow when Codex is present and nothing is being drawn", () => {
    const { pencils, shadows, pair } = recordingCanvas();
    paintWorkshopDrawing(pair, spread([]), [], 1);
    expect(pencils).toEqual([]);
    paintWorkshopDrawing(pair, spread([]), [], 1, { x: 0.7, y: 0.4, hover: 0.5 });
    expect(shadows).toEqual([40 + 15 * 0.3]);
    expect(pencils).toContain("#e8b04c");
    // While a mark is mid-stroke the drawing pencil wins and no shadow is cast.
    paintWorkshopDrawing(pair, spread([line(4), line(4)]), [], 0.25, { x: 0.7, y: 0.4, hover: 0.5 });
    expect(shadows).toHaveLength(1);
  });
});
