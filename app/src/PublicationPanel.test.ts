import { describe, expect, it } from "vitest";
import { commitPublicationRecordIfCurrent, publicationActionDisabled, publicationLauncherPresentation, publicationRecordForDocument } from "./PublicationPanel";
import type { PublicationRecord } from "./publishingClient";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

describe("publication action availability", () => {
  it("only disables sharing during another action or deletion recovery", () => {
    expect(publicationActionDisabled("draft", false)).toBe(false);
    expect(publicationActionDisabled("revoked", false)).toBe(false);
    expect(publicationActionDisabled("publishing", false)).toBe(false);
    expect(publicationActionDisabled("publishing", true)).toBe(true);
    expect(publicationActionDisabled("deleting", false)).toBe(true);
  });
});

describe("publication launcher presentation", () => {
  it.each([
    [null, 4, "Share", "ready"],
    [{ status: "draft" }, 4, "Share", "ready"],
    [{ status: "revoked" }, 4, "Share", "ready"],
    [{ status: "publishing" }, 4, "Sharing", "publishing"],
    [{ status: "deleting" }, 4, "Share", "ready"],
    [{ status: "published", publishedRevision: 4 }, 4, "Share", "shared"],
    [{ status: "published", publishedRevision: 3 }, 4, "Share", "ready"],
    [{ status: "published" }, 4, "Share", "ready"],
  ] as const)("maps publication state to %s", (record, revision, label, state) => {
    expect(publicationLauncherPresentation(record, revision)).toEqual({ label, state });
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
