import { afterEach, describe, expect, it, vi } from "vitest";
import { coverBoardMaterials, createCoverEndpaperCanvas, paintCoverEndpaper } from "./endpaper";

type RecordedContext = CanvasRenderingContext2D & {
  operations: string[];
};

function fakeCanvas() {
  const operations: string[] = [];
  const context = {
    operations,
    save: () => operations.push("save"),
    restore: () => operations.push("restore"),
    fillRect: () => operations.push("fillRect"),
    strokeRect: () => operations.push("strokeRect"),
    beginPath: () => operations.push("beginPath"),
    closePath: () => operations.push("closePath"),
    moveTo: () => operations.push("moveTo"),
    lineTo: () => operations.push("lineTo"),
    rect: () => operations.push("rect"),
    clip: () => operations.push("clip"),
    stroke: () => operations.push("stroke"),
    fill: () => operations.push("fill"),
    arc: () => operations.push("arc"),
    translate: () => operations.push("translate"),
    rotate: () => operations.push("rotate"),
    drawImage: () => operations.push("drawImage"),
    createLinearGradient: () => ({ addColorStop: () => operations.push("addColorStop") }),
  } as unknown as RecordedContext;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  return { canvas, context };
}

afterEach(() => vi.unstubAllGlobals());

describe("cover endpaper", () => {
  it("binds the treatment to the back face exposed during the opening swing", () => {
    const paper = { id: "paper" };
    const endpaper = { id: "endpaper" };

    expect(coverBoardMaterials(paper, paper, endpaper)).toEqual([
      paper,
      paper,
      paper,
      paper,
      paper,
      endpaper,
    ]);
  });

  it("binds the printed cover and endpaper to the two real board faces", () => {
    const cloth = { id: "cloth" };
    const cover = { id: "cover" };
    const endpaper = { id: "endpaper" };

    expect(coverBoardMaterials(cloth, cover, endpaper)).toEqual([
      cloth,
      cloth,
      cloth,
      cloth,
      cover,
      endpaper,
    ]);
  });

  it("draws a framed patterned fallback before the cover image is ready", () => {
    const fake = fakeCanvas();
    vi.stubGlobal("document", { createElement: () => fake.canvas });

    const canvas = createCoverEndpaperCanvas();

    expect(canvas).toBe(fake.canvas);
    expect(canvas.width).toBe(768);
    expect(canvas.height).toBe(1034);
    expect(fake.context.operations.filter((operation) => operation === "strokeRect")).toHaveLength(2);
    expect(fake.context.operations.filter((operation) => operation === "lineTo").length).toBeGreaterThan(20);
    expect(fake.context.operations).toContain("arc");
    expect(fake.context.operations).not.toContain("drawImage");
  });

  it("folds the resolved cover colours into the pattern without copying its title literally", () => {
    const fake = fakeCanvas();
    const image = { naturalWidth: 768, naturalHeight: 1152 } as HTMLImageElement;

    paintCoverEndpaper(fake.canvas, image);

    expect(fake.context.operations.filter((operation) => operation === "drawImage")).toHaveLength(1);
    expect(fake.context.operations.filter((operation) => operation === "strokeRect")).toHaveLength(2);
    expect(fake.context.operations.filter((operation) => operation === "lineTo").length).toBeGreaterThan(20);
  });
});
