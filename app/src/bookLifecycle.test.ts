import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bookLifecycleLockManager,
  bookLifecycleLockName,
  BOOK_LIBRARY_STORAGE_KEY,
  storedLibraryDocumentMatches,
} from "./bookLifecycle";
import type { DocumentState } from "./types";

const documentState: DocumentState = {
  id: "book-lifecycle-test",
  revision: 3,
  title: "Lifecycle Test",
  spreads: [],
};

describe("book lifecycle coordination", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
      clear: () => { storage.clear(); },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses one stable per-book lock namespace and fails closed without Web Locks", () => {
    expect(bookLifecycleLockName(documentState.id)).toBe("apertale:publication:book-lifecycle-test");
    vi.stubGlobal("navigator", {});
    expect(bookLifecycleLockManager()).toBeNull();
    const locks = { request: vi.fn() };
    vi.stubGlobal("navigator", { locks });
    expect(bookLifecycleLockManager()).toBe(locks);
  });

  it("matches the exact durable library revision", () => {
    localStorage.setItem(BOOK_LIBRARY_STORAGE_KEY, JSON.stringify({
      activeBookId: documentState.id,
      documents: [documentState],
    }));
    expect(storedLibraryDocumentMatches(documentState)).toBe(true);
    expect(storedLibraryDocumentMatches({ ...documentState, revision: 4 })).toBe(false);
    localStorage.removeItem(BOOK_LIBRARY_STORAGE_KEY);
    expect(storedLibraryDocumentMatches(documentState)).toBe(false);
  });

});
