import { describe, expect, it } from "vitest";
import { fitImageDimensions, summarizeAlphaPixels } from "./imageOptimizer";

describe("image optimization bounds", () => {
  it("preserves small images and proportionally limits large images", () => {
    expect(fitImageDimensions(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(fitImageDimensions(4096, 2048)).toEqual({ width: 2048, height: 1024 });
    expect(fitImageDimensions(1000, 4000)).toEqual({ width: 512, height: 2048 });
  });
});

describe("image alpha analysis", () => {
  const pixels = (width: number, height: number, alphaAt: (x: number, y: number) => number) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = 180;
        data[offset + 1] = 120;
        data[offset + 2] = 80;
        data[offset + 3] = alphaAt(x, y);
      }
    }
    return data;
  };

  it("accepts a visible subject with transparent padding", () => {
    const analysis = summarizeAlphaPixels(
      pixels(20, 20, (x, y) => (x >= 5 && x <= 14 && y >= 5 && y <= 14 ? 255 : 0)),
      20,
      20,
    );

    expect(analysis).toMatchObject({
      version: 1,
      hasTransparency: true,
      hasMeaningfulAlpha: true,
      transparentBorderRatio: 1,
      visiblePixelRatio: 0.25,
    });
  });

  it("rejects opaque mattes and empty transparent canvases", () => {
    expect(summarizeAlphaPixels(pixels(20, 20, () => 255), 20, 20)).toMatchObject({
      hasTransparency: false,
      hasMeaningfulAlpha: false,
    });
    expect(summarizeAlphaPixels(pixels(20, 20, () => 0), 20, 20)).toMatchObject({
      hasTransparency: true,
      hasMeaningfulAlpha: false,
      visiblePixelRatio: 0,
    });
  });

  it("does not mistake a token transparent edge around an opaque matte for a cutout", () => {
    const analysis = summarizeAlphaPixels(
      pixels(200, 200, (x, y) => (x < 3 || y < 3 || x >= 197 || y >= 197 ? 0 : 255)),
      200,
      200,
    );

    expect(analysis).toMatchObject({ hasTransparency: true, hasMeaningfulAlpha: false });
  });
});
