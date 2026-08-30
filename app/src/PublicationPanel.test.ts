import { describe, expect, it } from "vitest";
import { publicationActionDisabled } from "./PublicationPanel";

describe("publication action availability", () => {
  it("allows an interrupted publish to reconcile before the current revision passes quality", () => {
    expect(publicationActionDisabled("publishing", false, "needs-review")).toBe(false);
    expect(publicationActionDisabled("publishing", false, "blocked")).toBe(false);
  });

  it("keeps first-time and revoked publication behind the current quality gate", () => {
    expect(publicationActionDisabled("draft", false, "needs-review")).toBe(true);
    expect(publicationActionDisabled("revoked", false, "blocked")).toBe(true);
    expect(publicationActionDisabled("draft", false, "ready")).toBe(false);
    expect(publicationActionDisabled("publishing", true, "ready")).toBe(true);
  });
});
