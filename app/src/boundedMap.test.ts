import { describe, expect, it } from "vitest";
import { BoundedMap } from "./boundedMap";

describe("BoundedMap", () => {
  it("evicts the oldest entry and refreshes an overwritten key", () => {
    const journal = new BoundedMap<string, number>(2);
    journal.set("first", 1).set("second", 2).set("first", 3).set("third", 4);

    expect([...journal]).toEqual([["first", 3], ["third", 4]]);
  });

  it("preserves the bound when restored from a larger snapshot", () => {
    const restored = new BoundedMap(2, [["one", 1], ["two", 2], ["three", 3]] as const);
    expect([...restored]).toEqual([["two", 2], ["three", 3]]);
  });
});
