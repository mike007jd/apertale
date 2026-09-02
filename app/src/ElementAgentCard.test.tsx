// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { ElementAgentCard } from "./ElementAgentCard";

afterEach(cleanup);

// jsdom keeps a closed <dialog> out of the accessibility tree; App opens it
// with showModal(), which jsdom lacks, so the test opens it by attribute.

const props = {
  dialogRef: createRef<HTMLDialogElement>(),
  label: "Lighthouse",
  bookTitle: "Atlas of Living Wonders",
  spreadTitle: "The Harbour",
  hint: "Reveals a fact card",
  prompt: "Change the lighthouse hover to warm-rim.",
  copied: false,
  copyError: false,
  onCopy: vi.fn(),
  onClose: vi.fn(),
};

describe("ElementAgentCard", () => {
  it("names the element, keeps the copy action honest, and only shows the manual fallback when copy is blocked", () => {
    const { rerender } = render(<ElementAgentCard {...props} />);
    props.dialogRef.current!.open = true;
    expect(screen.getByRole("heading", { name: "Lighthouse" })).toBeTruthy();
    expect(screen.getByText("Atlas of Living Wonders")).toBeTruthy();
    expect(screen.queryByRole("alert", { hidden: true })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Copy element request" }));
    expect(props.onCopy).toHaveBeenCalledOnce();

    rerender(<ElementAgentCard {...props} copied copyError />);
    expect(screen.getByRole("button", { name: /Copied/ })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Element request to copy manually" })).toHaveProperty("value", props.prompt);

    fireEvent.click(screen.getByRole("button", { name: "Close Ask Codex handoff" }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
