import { describe, expect, it } from "vitest";
import { centeredContainPlacement, centeredCoverCrop } from "./imageCrop";

const STAGE_ASPECT = (4.2 * 2) / 5.18;

describe("centered cover crop", () => {
  it("preserves an image that already matches the stage", () => {
    expect(centeredCoverCrop(840, 518, STAGE_ASPECT)).toEqual({
      x: 0,
      y: 0,
      width: 840,
      height: 518,
    });
  });

  it("crops a 2:1 spread equally from both outer edges", () => {
    const crop = centeredCoverCrop(2000, 1000, STAGE_ASPECT);

    expect(crop.width / crop.height).toBeCloseTo(STAGE_ASPECT, 12);
    expect(crop.x).toBeCloseTo((2000 - crop.width) / 2, 12);
    expect(crop.y).toBe(0);
  });

  it("crops a portrait image equally from the top and bottom", () => {
    const crop = centeredCoverCrop(800, 1000, STAGE_ASPECT);

    expect(crop.width / crop.height).toBeCloseTo(STAGE_ASPECT, 12);
    expect(crop.x).toBe(0);
    expect(crop.y).toBeCloseTo((1000 - crop.height) / 2, 12);
  });

  it("rejects impossible source or target geometry", () => {
    expect(() => centeredCoverCrop(0, 1000, STAGE_ASPECT)).toThrow(RangeError);
    expect(() => centeredCoverCrop(Number.NaN, 1000, STAGE_ASPECT)).toThrow(RangeError);
    expect(() => centeredCoverCrop(2000, 1000, 0)).toThrow(RangeError);
  });

  it("keeps a preserved 2:1 layout complete inside the narrower stage", () => {
    const placement = centeredContainPlacement(2000, 1000, 840, 518);

    expect(placement).toEqual({ x: 0, y: 49, width: 840, height: 420 });
    expect(placement.width / placement.height).toBe(2);
  });
});
