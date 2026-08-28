import { describe, expect, it, vi } from "vitest";

// App.tsx reads browser globals at module scope; the shelf partition rule under
// test is pure, so the smallest possible browser stand-in is enough to load it.
const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => { storage.clear(); },
});
vi.stubGlobal("window", {
  location: { search: "" },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
  localStorage,
});

const { partitionLibraryBooks } = await import("./App");

describe("library shelf sections", () => {
  it("treats any book that is not a sample as the reader's own", () => {
    const result = partitionLibraryBooks([
      { id: "guide", sample: true },
      { id: "authored", sample: false },
      { id: "published-in" },
    ]);
    expect(result.personal.map((book) => book.id)).toEqual(["authored", "published-in"]);
    expect(result.curated.map((book) => book.id)).toEqual(["guide"]);
  });

  it("offers the segmented control only once a personal book exists", () => {
    expect(partitionLibraryBooks([{ id: "guide", sample: true }]).tabbed).toBe(false);
    expect(partitionLibraryBooks([]).tabbed).toBe(false);
    expect(partitionLibraryBooks([{ id: "guide", sample: true }, { id: "mine" }]).tabbed).toBe(true);
  });
});
