import { describe, expect, it } from "vitest";
import { getStoredAssetBlob, isStoredAssetId } from "./assetStore";

describe("asset store blob access", () => {
  it("treats bundled and procedural references as non-local without opening IndexedDB", async () => {
    expect(isStoredAssetId("/assets/covers/atlas-of-living-wonders-v2.png")).toBe(false);
    expect(isStoredAssetId("procedural:hotspot:amber")).toBe(false);
    await expect(getStoredAssetBlob("/assets/covers/atlas-of-living-wonders-v2.png")).resolves.toBeNull();
    await expect(getStoredAssetBlob("procedural:hotspot:amber")).resolves.toBeNull();
  });
});
