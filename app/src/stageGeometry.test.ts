import { describe, expect, it } from "vitest";
import { readerCameraPage, readerSinglePagePresentation } from "./stageGeometry";

describe("reader camera page", () => {
  it("uses one selected page only in the portrait reader frame", () => {
    expect(readerCameraPage("reader", true)).toBe("right");
    expect(readerCameraPage("reader", true, "left")).toBe("left");
    expect(readerCameraPage("reader", false, "left")).toBeNull();
    expect(readerCameraPage("workshop", true, "left")).toBeNull();
  });

  it("places one authored page in the settled portrait book shell", () => {
    expect(readerSinglePagePresentation("reader", true, 1)).toBe("right");
    expect(readerSinglePagePresentation("reader", true, 1, "left")).toBe("left");
    expect(readerSinglePagePresentation("reader", true, 1, "left", true)).toBe("right");
    expect(readerSinglePagePresentation("reader", true, 1, "left", false)).toBe("left");
    expect(readerSinglePagePresentation("reader", true, 0.8, "left")).toBeNull();
    expect(readerSinglePagePresentation("workshop", true, 1, "left")).toBeNull();
  });
});
