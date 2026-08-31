import { describe, expect, it } from "vitest";
import { bookCaseMatterPose, deformPageVertex, resolveTurnContentPlan, restingPageDepth } from "./pageTurn";

const PAGE_WIDTH = 4.2;
const PAGE_HEIGHT = 5.18;

describe("page-turn deformation", () => {
  it("binds the front matter to the case while preserving the settled spread", () => {
    expect(bookCaseMatterPose(0)).toEqual({ foldY: -Math.PI, reliefZ: 0.08 });
    expect(bookCaseMatterPose(0.5)).toEqual({ foldY: -Math.PI / 2, reliefZ: 0.54 });
    expect(bookCaseMatterPose(1)).toEqual({ foldY: 0, reliefZ: 1 });
  });

  it("keeps the correct illustrated spread on the moving leaf and underlay", () => {
    expect(resolveTurnContentPlan(3, "forward", 8)).toEqual({
      destinationIndex: 4,
      turningSpreadIndex: 3,
      underlaySpreadIndex: 4,
    });
    expect(resolveTurnContentPlan(4, "backward", 8)).toEqual({
      destinationIndex: 3,
      turningSpreadIndex: 3,
      underlaySpreadIndex: 4,
    });
    expect(resolveTurnContentPlan(0, "backward", 8)).toBeNull();
    expect(resolveTurnContentPlan(7, "forward", 8)).toBeNull();
  });

  it("starts and settles on the same curved surface as the resting pages", () => {
    const quarter = deformPageVertex(-PAGE_WIDTH / 4, 0, 0, PAGE_WIDTH);
    const mirroredQuarter = deformPageVertex(-PAGE_WIDTH / 4, 0, 1, PAGE_WIDTH);

    expect(quarter.z).toBeGreaterThan(0.1);
    expect(mirroredQuarter.z).toBeCloseTo(quarter.z, 8);
  });

  it("lands exactly on the open right and left pages", () => {
    const samples = [-PAGE_WIDTH / 2, 0, PAGE_WIDTH / 2];
    for (const x of samples) {
      const start = deformPageVertex(x, 0.4, 0, PAGE_WIDTH);
      const end = deformPageVertex(x, 0.4, 1, PAGE_WIDTH);
      const restingDepth = restingPageDepth(x, 0.4, PAGE_WIDTH, PAGE_HEIGHT);
      expect(start.x).toBeCloseTo(x, 8);
      expect(start.y).toBe(0.4);
      expect(start.z).toBeCloseTo(restingDepth, 8);
      expect(end.x + PAGE_WIDTH / 2).toBeCloseTo(-(x + PAGE_WIDTH / 2), 8);
      expect(end.y).toBe(0.4);
      expect(end.z).toBeCloseTo(restingDepth, 8);
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
    expect(maximumDepth).toBeGreaterThan(1.1);
  });

  it("keeps a visible projected crescent at the midpoint", () => {
    const spine = deformPageVertex(-PAGE_WIDTH / 2, 0, 0.5, PAGE_WIDTH);
    const outer = deformPageVertex(PAGE_WIDTH / 2, 0, 0.5, PAGE_WIDTH);
    expect(outer.x - spine.x).toBeGreaterThan(PAGE_WIDTH * 0.09);
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
