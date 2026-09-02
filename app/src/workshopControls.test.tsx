// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { INITIAL_CREATION_WORKSHOP } from "./creationWorkshop";
import { StoryPencilControls, WorkshopPickers } from "./workshopControls";

afterEach(cleanup);

const button = (name: string) => screen.getByRole("button", { name });

describe("WorkshopPickers", () => {
  it("renders every choice as a pressed-state group and reports taps as reducer actions", () => {
    const dispatch = vi.fn();
    render(<WorkshopPickers workshop={INITIAL_CREATION_WORKSHOP} dispatch={dispatch} />);

    const spreads = screen.getByRole("group", { name: "Spreads" });
    expect(spreads.querySelector("button[aria-pressed='true']")?.textContent).toBe(String(INITIAL_CREATION_WORKSHOP.spreadCount));
    expect(spreads.querySelector(".switch-underline")).not.toBeNull();

    fireEvent.click(button("8 spreads"));
    expect(dispatch).toHaveBeenLastCalledWith({ type: "set-spread-count", spreadCount: 8 });

    fireEvent.click(button("Photos"));
    expect(dispatch).toHaveBeenLastCalledWith({ type: "set-mode", mode: "photos" });
  });

  it("shows Photo use only once the brief includes photos", () => {
    const { rerender } = render(<WorkshopPickers workshop={INITIAL_CREATION_WORKSHOP} dispatch={() => undefined} />);
    expect(screen.queryByRole("group", { name: "Photo use" })).toBeNull();

    rerender(<WorkshopPickers workshop={{ ...INITIAL_CREATION_WORKSHOP, mode: "both" }} dispatch={() => undefined} />);
    expect(screen.getByRole("group", { name: "Photo use" })).toBeTruthy();
  });
});

describe("StoryPencilControls", () => {
  const base = { index: 0, count: 4, caption: "Meet the guide", active: false, annotationCount: 0, annotationLimit: 24, onPrevious: vi.fn(), onNext: vi.fn(), onToggle: vi.fn(), onUndo: vi.fn(), onClear: vi.fn() };

  it("disables paging at the ends and hides undo until a red mark exists", () => {
    const { rerender } = render(<StoryPencilControls {...base} />);
    expect(button("Previous storyboard spread")).toHaveProperty("disabled", true);
    expect(button("Next storyboard spread")).toHaveProperty("disabled", false);
    expect(screen.queryByRole("button", { name: "Undo last red mark" })).toBeNull();
    expect(screen.getByText("Storyboard 1/4")).toBeTruthy();

    rerender(<StoryPencilControls {...base} index={3} annotationCount={1} active />);
    expect(button("Next storyboard spread")).toHaveProperty("disabled", true);
    expect(button("Stop marking changes")).toHaveProperty("ariaPressed", "true");
    fireEvent.click(button("Undo last red mark"));
    expect(base.onUndo).toHaveBeenCalledOnce();
  });

  it("shows how Codex will read the latest red mark", () => {
    render(<StoryPencilControls {...base} annotationCount={1} lastMark="Right page · loop · boat" />);
    expect(screen.getByRole("status").textContent).toBe("Right page · loop · boat");
  });

  it("offers clear-all from the second mark and stops the pencil at the limit", () => {
    const { rerender } = render(<StoryPencilControls {...base} annotationCount={2} />);
    fireEvent.click(button("Clear all red marks on this spread"));
    expect(base.onClear).toHaveBeenCalledOnce();

    rerender(<StoryPencilControls {...base} annotationCount={24} />);
    const toggle = button("24 marks on this spread; waiting for Codex");
    expect(toggle).toHaveProperty("disabled", true);
    expect(toggle.textContent).toContain("waiting for Codex");
  });

  it("falls back to a waiting caption before Codex has sketched", () => {
    render(<StoryPencilControls {...base} caption={undefined} />);
    expect(screen.getByText("Waiting for Codex sketch")).toBeTruthy();
  });
});
