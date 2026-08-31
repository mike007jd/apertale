import { describe, expect, it } from "vitest";
import {
  INITIAL_CREATION_NAVIGATION,
  reduceCreationNavigation,
  workspaceMotionOrigin,
} from "./creationNavigation";

describe("creation workspace navigation", () => {
  it("covers each scene before switching and completes the reverse path", () => {
    const coveringSource = reduceCreationNavigation(INITIAL_CREATION_NAVIGATION, { type: "request-open" });
    expect(coveringSource).toEqual({ phase: "covering-source", workspaceOpen: false });

    const revealingWorkspace = reduceCreationNavigation(coveringSource, { type: "animation-complete" });
    expect(revealingWorkspace).toEqual({ phase: "revealing-workspace", workspaceOpen: true });
    const open = reduceCreationNavigation(revealingWorkspace, { type: "animation-complete" });
    expect(open).toEqual({ phase: "idle", workspaceOpen: true });

    const coveringWorkspace = reduceCreationNavigation(open, { type: "request-close" });
    expect(coveringWorkspace).toEqual({ phase: "covering-workspace", workspaceOpen: true });
    const revealingSource = reduceCreationNavigation(coveringWorkspace, { type: "animation-complete" });
    expect(revealingSource).toEqual({ phase: "revealing-source", workspaceOpen: false });
    expect(reduceCreationNavigation(revealingSource, { type: "animation-complete" }))
      .toEqual(INITIAL_CREATION_NAVIGATION);
  });

  it("cancels an unfinished open and never queues repeated requests", () => {
    const covering = reduceCreationNavigation(INITIAL_CREATION_NAVIGATION, { type: "request-open" });
    expect(reduceCreationNavigation(covering, { type: "request-open" })).toBe(covering);
    expect(reduceCreationNavigation(covering, { type: "request-close" }))
      .toEqual(INITIAL_CREATION_NAVIGATION);
  });

  it("supports the non-spatial reduced-motion path", () => {
    const open = reduceCreationNavigation(INITIAL_CREATION_NAVIGATION, { type: "show-immediately" });
    expect(open).toEqual({ phase: "idle", workspaceOpen: true });
    expect(reduceCreationNavigation(open, { type: "hide-immediately" }))
      .toEqual(INITIAL_CREATION_NAVIGATION);
  });

  it("expands from the real control and covers the farthest viewport corner", () => {
    const origin = workspaceMotionOrigin(
      { left: 1120, top: 690, width: 180, height: 48 },
      { width: 1404, height: 800 },
    );

    expect(origin.x).toBe(1210);
    expect(origin.y).toBe(714);
    expect(origin.radius).toBeGreaterThan(Math.hypot(origin.x, origin.y));
  });
});
