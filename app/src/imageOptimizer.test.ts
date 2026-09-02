import { describe, expect, it } from "vitest";
import { fitImageDimensions, keyOutBackdrop, summarizeAlphaPixels } from "./imageOptimizer";

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

  it("reports the box around the visible pixels so a cutout can be trimmed to its subject", () => {
    const data = new Uint8ClampedArray(4 * 20 * 10);
    for (let y = 2; y < 6; y += 1) for (let x = 5; x < 15; x += 1) data[(y * 20 + x) * 4 + 3] = 255;
    expect(summarizeAlphaPixels(data, 20, 10).visibleBounds).toEqual({ x: 0.25, y: 0.2, w: 0.5, h: 0.4 });
    expect(summarizeAlphaPixels(new Uint8ClampedArray(4 * 20 * 10), 20, 10).visibleBounds).toBeUndefined();
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

describe("flat backdrop key-out", () => {
  it("turns the corner colour transparent, keeps far colours opaque, and ramps near ones", () => {
    const magenta = [255, 0, 255, 255];
    const subject = [40, 120, 30, 255];
    const nearMagenta = [255, 40, 255, 255];
    // 3×3: magenta everywhere except a subject pixel in the centre and a near-magenta pixel beside it.
    const rows = [[magenta, magenta, magenta], [magenta, subject, nearMagenta], [magenta, magenta, magenta]];
    const pixels = new Uint8ClampedArray(rows.flat(2));
    keyOutBackdrop(pixels, 3, 3);
    const alpha = (x: number, y: number) => pixels[(y * 3 + x) * 4 + 3];
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(2, 2)).toBe(0);
    expect(alpha(1, 1)).toBe(255);
    expect(alpha(2, 1)).toBe(128);
    expect(Array.from(pixels.slice(16, 19))).toEqual([40, 120, 30]);
  });
});
