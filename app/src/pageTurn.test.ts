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

  it("keeps the paper centreline free of self-intersections throughout the turn", () => {
    const orientation = (a: Deformed, b: Deformed, c: Deformed) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    const intersects = (a: Deformed, b: Deformed, c: Deformed, d: Deformed) => {
      const abC = orientation(a, b, c);
      const abD = orientation(a, b, d);
      const cdA = orientation(c, d, a);
      const cdB = orientation(c, d, b);
      return abC * abD < -1e-10 && cdA * cdB < -1e-10;
    };

    for (let frame = 1; frame < 20; frame += 1) {
      const progress = frame / 20;
      const points = Array.from({ length: 41 }, (_, index) => (
        deformPageVertex(-PAGE_WIDTH / 2 + (index / 40) * PAGE_WIDTH, 0, progress, PAGE_WIDTH)
      ));
      for (let first = 0; first < points.length - 1; first += 1) {
        for (let second = first + 2; second < points.length - 1; second += 1) {
          expect(intersects(points[first], points[first + 1], points[second], points[second + 1])).toBe(false);
        }
      }
    }
  });
});

type Deformed = ReturnType<typeof deformPageVertex>;
