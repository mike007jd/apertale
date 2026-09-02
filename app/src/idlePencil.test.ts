import { describe, expect, it } from "vitest";
import { idlePencil } from "./ThreeBook";

describe("idlePencil", () => {
  it("is absent until Codex calls a tool, breathes over the right page before the plan, and rests at the corner after it", () => {
    expect(idlePencil("absent", 0, 1, 1000)).toBeUndefined();
    expect(idlePencil("waiting", 0, 1, 0)).toEqual({ x: 0.72, y: 0.42, hover: 0.55 });
    const breathing = [0, 1100, 2200].map((now) => idlePencil("waiting", 0, 1, now)!.hover);
    expect(new Set(breathing).size).toBe(3);
    expect(idlePencil("busy", 0, 1, 0)).toEqual(idlePencil("waiting", 0, 1, 0));
    expect(idlePencil("waiting", 12, 0.5, 1000)).toBeUndefined();
    expect(idlePencil("waiting", 12, 1, 1000)).toEqual({ x: 0.86, y: 0.92, hover: 0 });
  });
});
