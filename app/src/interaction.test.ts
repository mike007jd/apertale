import { describe, expect, it } from "vitest";
import {
  FOCUS_RESPONSES,
  HOVER_RESPONSES,
  focusTraits,
  hasReveal,
  hoverTraits,
  motionTraits,
  resolveInteraction,
} from "./interaction";
import { initialDocument } from "./sampleBook";
import type { BookElement } from "./types";

const landmark = initialDocument.spreads[0].elements[0];

describe("structured interaction schema", () => {
  it("resolves an authored interaction without inventing behaviour", () => {
    const spec = resolveInteraction(landmark);
    expect(spec).toMatchObject({ hover: "tilt-toward-pointer", focus: "orbit-inspect" });
    expect(spec.reveal.kind).toBe("fact-card");
    expect(spec.reveal.facts.length).toBeGreaterThanOrEqual(4);
    expect(spec.reveal.source).toContain("Flavian Amphitheatre");
    expect(hasReveal(spec)).toBe(true);
  });

  it("gives unauthored elements a predictable default", () => {
    const bare = { label: "Boat" } as Pick<BookElement, "interaction" | "motion" | "label">;
    const spec = resolveInteraction(bare);
    expect(spec.hover).toBe("lift-glow");
    expect(spec.focus).toBe("spotlight");
    expect(spec.reveal.kind).toBe("caption");
    expect(hasReveal(spec)).toBe(true);
    expect(spec.hint).toBe("Explore Boat");
  });

  it("prefers the element's own named motion over the authored fallback", () => {
    const spec = resolveInteraction({
      label: "Bird",
      motion: { preset: "fly-across", durationMs: 5200, loop: true },
      interaction: {
        hover: "lift-glow",
        focus: "spotlight",
        reveal: { kind: "none", title: "", summary: "", facts: [] },
        motion: { preset: "gentle-float", durationMs: 3600, loop: true },
      },
    });
    expect(spec.motion?.preset).toBe("fly-across");
    expect(hasReveal(spec)).toBe(false);
  });

  it("maps every vocabulary entry to finite render traits", () => {
    HOVER_RESPONSES.forEach((response) => {
      const traits = hoverTraits(response);
      expect(Number.isFinite(traits.rise + traits.scale + traits.emissive + traits.tilt)).toBe(true);
      expect(traits.scale).toBeGreaterThan(0);
    });
    FOCUS_RESPONSES.forEach((response) => {
      const traits = focusTraits(response);
      expect(Number.isFinite(traits.rise + traits.scale + traits.shift + traits.spotlight + traits.spin)).toBe(true);
    });
    expect(hoverTraits("none")).toEqual({ rise: 0, scale: 1, emissive: 0, tilt: 0 });
    expect(focusTraits("orbit-inspect").spin).toBeGreaterThan(0);
  });

  it("renders slow-orbit and honors one-shot versus looping motion", () => {
    const orbit = motionTraits({ preset: "slow-orbit", durationMs: 4000, loop: true }, 1000);
    expect(orbit).toMatchObject({ progress: 0.25 });
    expect(Math.abs(orbit.x) + Math.abs(orbit.y)).toBeGreaterThan(0);

    const oneShot = { preset: "fly-across", durationMs: 4000, loop: false } as const;
    expect(motionTraits(oneShot, 4000)).toEqual(motionTraits(oneShot, 12_000));
    expect(motionTraits(oneShot, 12_000).progress).toBe(1);

    const looping = { preset: "gentle-float", durationMs: 4000, loop: true } as const;
    expect(motionTraits(looping, 5000)).toEqual(motionTraits(looping, 1000));
  });
});
