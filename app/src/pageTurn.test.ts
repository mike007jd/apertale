import { describe, expect, it } from "vitest";
import { deformPageVertex } from "./pageTurn";

const PAGE_WIDTH = 4.2;

describe("page-turn deformation", () => {
  it("lands exactly on the open right and left pages", () => {
    const samples = [-PAGE_WIDTH / 2, 0, PAGE_WIDTH / 2];
    for (const x of samples) {
      const start = deformPageVertex(x, 0.4, 0, PAGE_WIDTH);
      const end = deformPageVertex(x, 0.4, 1, PAGE_WIDTH);
      expect(start).toEqual({ x, y: 0.4, z: 0 });
      expect(end.x + PAGE_WIDTH / 2).toBeCloseTo(-(x + PAGE_WIDTH / 2), 8);
      expect(end.y).toBe(0.4);
      expect(end.z).toBeCloseTo(0, 8);
    }
  });

  it("keeps every sampled midpoint vertex within the book-scale depth envelope", () => {
    let maximumDepth = 0;
    for (let step = 0; step <= 40; step += 1) {
      const x = -PAGE_WIDTH / 2 + (step / 40) * PAGE_WIDTH;
      const vertex = deformPageVertex(x, 0, 0.44, PAGE_WIDTH);
      maximumDepth = Math.max(maximumDepth, vertex.z);
      expect(vertex.z).toBeGreaterThanOrEqual(0);
      expect(vertex.z).toBeLessThanOrEqual(1.46);
    }
    expect(maximumDepth).toBeGreaterThan(1.2);
  });
});
