import { describe, expect, it } from "vitest";
import { beginQualityReview, recordRenderEvidence } from "./qualityLifecycle";
import { CREATION_READINESS_VERSION } from "./authoringContract";
import { sampleBooks } from "./sampleBook";
import type { AuthoringQualityLifecycle } from "./qualityContract";

const document = structuredClone(sampleBooks[1]);
const briefed = (): Record<string, AuthoringQualityLifecycle> => ({
  [document.id]: {
    creationBrief: { contractVersion: CREATION_READINESS_VERSION, bookType: "illustrated-storybook" },
    reviewRounds: 0,
    reviewStatus: "needs-review",
    renderEvidence: [],
  },
});

describe("beginQualityReview", () => {
  it("refuses without a brief and never touches the store", () => {
    const store = {};
    const outcome = beginQualityReview(store, document);
    expect(outcome.changed).toBe(false);
    expect(outcome.result).toMatchObject({ ok: false, code: "creation_brief_required", currentRevision: document.revision });
  });

  it("enters checking once, then reports the same round without changing again", () => {
    const store = briefed();
    const first = beginQualityReview(store, document, document.revision);
    expect(first).toMatchObject({ changed: true, result: { ok: true, nextRound: 1, remainingRounds: 2 } });
    const second = beginQualityReview(store, document, document.revision);
    expect(second).toMatchObject({ changed: false, result: { ok: true, nextRound: 1 } });
    expect(beginQualityReview(store, document, document.revision + 1).result).toMatchObject({ code: "revision_conflict" });
  });
});

describe("recordRenderEvidence", () => {
  it("keeps only current-revision evidence and replaces the same surface in place", () => {
    const store = briefed();
    const base = { documentId: document.id, locator: "reader", scope: "spread" as const, spreadId: document.spreads[0].id, theme: "paper-atelier" as const, surface: "webgl" as const };
    expect(recordRenderEvidence(store, document, { ...base, revision: document.revision - 1 })).toBe(false);
    expect(recordRenderEvidence(store, document, { ...base, revision: document.revision })).toBe(true);
    expect(recordRenderEvidence(store, document, { ...base, revision: document.revision, surface: "fallback" })).toBe(true);
    expect(recordRenderEvidence(store, document, { ...base, revision: document.revision })).toBe(true);
    expect(store[document.id].renderEvidence).toHaveLength(2);
    expect(recordRenderEvidence(store, document, { ...base, revision: document.revision, spreadId: "missing" })).toBe(false);
  });
});
