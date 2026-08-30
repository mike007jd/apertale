import { describe, expect, it } from "vitest";
import { commitPublicationRecordIfCurrent, publicationActionDisabled, publicationLauncherPresentation, publicationRecordForDocument } from "./PublicationPanel";
import type { PublicationRecord } from "./publishingClient";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

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
    expect(publicationActionDisabled("deleting", false, "ready")).toBe(true);
  });
});

describe("publication launcher presentation", () => {
  it.each([
    [null, "needs-review", 4, "Review needed", "attention"],
    [{ status: "draft" }, "checking", 4, "Reviewing", "checking"],
    [{ status: "draft" }, "blocked", 4, "Fix blockers", "attention"],
    [{ status: "draft" }, "needs-user-input", 4, "Needs input", "attention"],
    [{ status: "draft" }, "ready", 4, "Publish", "ready"],
    [{ status: "revoked" }, "ready", 4, "Publish again", "ready"],
    [{ status: "publishing" }, "needs-review", 4, "Resume publishing", "publishing"],
    [{ status: "deleting" }, "ready", 4, "Finish deleting", "attention"],
    [{ status: "published", publishedRevision: 4 }, "needs-review", 4, "Shared", "shared"],
    [{ status: "published", publishedRevision: 3 }, "ready", 4, "Share outdated", "attention"],
    [{ status: "published" }, "ready", 4, "Share outdated", "attention"],
  ] as const)("maps publication and quality state to %s", (record, qualityStatus, revision, label, state) => {
    expect(publicationLauncherPresentation(record, qualityStatus, revision)).toEqual({ label, state });
  });
});

describe("publication result identity", () => {
  it("hides a previous book's record during the render before hydration effects run", () => {
    const record: PublicationRecord = { documentId: "book-a", status: "published", shareUrl: "https://example.test/share/a" };
    expect(publicationRecordForDocument("book-b", record)).toBeNull();
    expect(publicationRecordForDocument("book-a", record)).toBe(record);
  });

  it.each([
    [{ documentId: "book-a", status: "published", shareUrl: "https://example.test/share/a", publishedRevision: 4 }],
    [{ documentId: "book-a", status: "revoked" }],
    [null],
  ] as Array<[PublicationRecord | null]>)
  ("ignores a delayed success, recovery, or deletion after another book becomes active", async (record) => {
    const completion = deferred<PublicationRecord | null>();
    const active = { documentId: "book-a" };
    const committed: Array<PublicationRecord | null> = [];
    const pending = completion.promise.then((next) => commitPublicationRecordIfCurrent(
      active.documentId,
      "book-a",
      next,
      (value) => committed.push(value),
    ));

    active.documentId = "book-b";
    completion.resolve(record);

    await expect(pending).resolves.toBe(false);
    expect(committed).toEqual([]);
  });

  it("commits a result that still belongs to the active book", () => {
    const record: PublicationRecord = { documentId: "book-a", status: "revoked" };
    let committed: PublicationRecord | null = null;
    expect(commitPublicationRecordIfCurrent("book-a", "book-a", record, (next) => { committed = next; })).toBe(true);
    expect(committed).toEqual(record);
  });

  it("rejects a record whose own document identity disagrees with the operation", () => {
    const wrongRecord: PublicationRecord = { documentId: "book-a", status: "revoked" };
    expect(commitPublicationRecordIfCurrent("book-b", "book-b", wrongRecord, () => {
      throw new Error("a foreign publication record must never commit");
    })).toBe(false);
  });
});
