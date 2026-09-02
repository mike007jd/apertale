// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { announce, useReaderShell, type ReaderShellOptions } from "./readerShell";

beforeEach(() => vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * A reader surface in miniature: the spread index lives outside the shell and
 * comes back in through props, exactly as the book engine and the shared
 * reader's local state both do.
 */
function mountShell(overrides: Partial<ReaderShellOptions> = {}) {
  const commits: number[] = [];
  let spreadIndex = 0;
  const options = (): ReaderShellOptions => ({
    navigationKey: `book:1:${spreadIndex}`,
    spreadIndex,
    spreadCount: 4,
    sceneKey: "scene-a",
    webGlAvailable: true,
    reducedMotion: false,
    commit: (index) => {
      commits.push(index);
      spreadIndex = index;
    },
    ...overrides,
  });
  const view = renderHook((props: ReaderShellOptions) => useReaderShell(props), { initialProps: options() });
  return {
    commits,
    shell: () => view.result.current,
    /** Re-renders with the current spread index, the way a state commit would. */
    sync: () => act(() => view.rerender(options())),
    ready: () => act(() => {
      view.result.current.onPageTurnReady("forward", true);
      view.result.current.onPageTurnReady("backward", true);
    }),
    settle: () => act(() => { vi.advanceTimersByTime(1600); }),
    unmount: view.unmount,
  };
}

describe("announce", () => {
  it("terminates each fragment so a screen reader does not run them together", () => {
    expect(announce("Lifted", "Spread 3 of 12")).toBe("Lifted. Spread 3 of 12.");
    expect(announce("Done.", undefined, "  ", "Next")).toBe("Done. Next.");
  });
});

describe("reader shell", () => {
  it("locks navigation until the renderer reports the current position ready", () => {
    const reader = mountShell();
    expect(reader.shell().navDisabled).toEqual({ previous: true, next: true });

    reader.ready();
    expect(reader.shell().navDisabled).toEqual({ previous: true, next: false });

    reader.shell().turnPage("forward");
    reader.settle();
    reader.sync();
    expect(reader.commits).toEqual([1]);
    // The destination spread is unrenderable until the renderer says otherwise.
    expect(reader.shell().navDisabled).toEqual({ previous: true, next: true });
  });

  it("advances the spread exactly once per turn and never past a boundary", () => {
    const reader = mountShell();
    reader.ready();
    reader.shell().turnPage("backward");
    expect(reader.commits).toEqual([]);

    reader.shell().turnPage("forward");
    reader.shell().turnPage("forward");
    reader.settle();
    expect(reader.commits).toEqual([1]);
  });

  it("commits immediately for a static fallback reader instead of animating an invisible leaf", () => {
    const reader = mountShell({ webGlAvailable: false });
    expect(reader.shell().renderWebGl).toBe(false);
    // Nothing has to become ready first: there is no renderer to wait for.
    expect(reader.shell().navDisabled).toEqual({ previous: true, next: false });

    reader.shell().turnPage("forward");
    expect(reader.commits).toEqual([1]);
    expect(reader.shell().turn).toBeNull();
  });

  it("commits immediately under reduced motion", () => {
    const reader = mountShell({ reducedMotion: true });
    reader.ready();
    reader.shell().turnPage("forward");
    expect(reader.commits).toEqual([1]);
    expect(reader.shell().turn).toBeNull();
  });

  it("keeps the 3D scene until the failure belongs to the scene on screen", () => {
    const reader = mountShell();
    act(() => reader.shell().onSceneFailure("scene-retired"));
    expect(reader.shell().renderWebGl).toBe(true);

    act(() => reader.shell().onSceneFailure("scene-a"));
    expect(reader.shell().renderWebGl).toBe(false);
    expect(reader.shell().sceneFailed).toBe(true);
  });

  it("drops renderer readiness when the scene starts rebuilding", () => {
    const reader = mountShell();
    reader.ready();
    expect(reader.shell().navDisabled.next).toBe(false);

    act(() => reader.shell().onSceneLoading());
    expect(reader.shell().navDisabled).toEqual({ previous: true, next: true });
  });

  it("holds the spread while the leaf is still turning", () => {
    const reader = mountShell();
    reader.ready();
    act(() => reader.shell().turnPage("forward"));
    act(() => { vi.advanceTimersByTime(80); });

    expect(reader.commits).toEqual([]);
    expect(reader.shell().turn).toMatchObject({ direction: "forward" });
    expect(reader.shell().navDisabled).toEqual({ previous: true, next: true });
  });
});
