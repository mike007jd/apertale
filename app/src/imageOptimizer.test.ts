import { describe, expect, it } from "vitest";
import { fitImageDimensions } from "./imageOptimizer";

describe("image optimization bounds", () => {
  it("preserves small images and proportionally limits large images", () => {
    expect(fitImageDimensions(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(fitImageDimensions(4096, 2048)).toEqual({ width: 2048, height: 1024 });
    expect(fitImageDimensions(1000, 4000)).toEqual({ width: 512, height: 2048 });
  });
});
