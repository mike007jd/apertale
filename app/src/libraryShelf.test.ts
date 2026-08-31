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

const { partitionLibraryBooks, readerSceneShouldMount, shelfCoverAssetPlan } = await import("./App");

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

  it("retains local cover URLs only for the shelf section that is mounted", () => {
    const yours = [{ id: "mine", coverAssetId: "asset:mine" }];
    const explore = [{ id: "guide", coverAssetId: "asset:guide" }];
    expect([...shelfCoverAssetPlan(true, yours)]).toEqual([["mine", "asset:mine"]]);
    expect([...shelfCoverAssetPlan(true, explore)]).toEqual([["guide", "asset:guide"]]);
    expect([...shelfCoverAssetPlan(false, yours)]).toEqual([]);
  });

  it("keeps the reader scene out of the settled shelf but mounts it for every transition target", () => {
    expect(readerSceneShouldMount({
      showLibrary: true,
      showCreateGuide: false,
      openingBookMatchesDocument: false,
      libraryMotion: "idle",
    })).toBe(false);
    expect(readerSceneShouldMount({
      showLibrary: true,
      showCreateGuide: false,
      openingBookMatchesDocument: true,
      libraryMotion: "idle",
    })).toBe(true);
    expect(readerSceneShouldMount({
      showLibrary: true,
      showCreateGuide: false,
      openingBookMatchesDocument: false,
      libraryMotion: "closing-book",
    })).toBe(true);
    expect(readerSceneShouldMount({
      showLibrary: true,
      showCreateGuide: true,
      openingBookMatchesDocument: false,
      libraryMotion: "idle",
    })).toBe(true);
    expect(readerSceneShouldMount({
      showLibrary: false,
      showCreateGuide: false,
      openingBookMatchesDocument: false,
      libraryMotion: "idle",
    })).toBe(true);
  });
});
