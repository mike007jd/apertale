import { isStoredAssetId } from "./assetStore";
import type { DocumentState } from "./types";

type ProjectAssetLocation =
  | { kind: "cover"; field: "coverAssetId" | "coverTextureUrl" }
  | { kind: "spread"; spreadId: string; field: "textureUrl" | "cleanPlateAssetId" | "sourceAssetId" }
  | { kind: "element"; spreadId: string; elementId: string; field: "assetId" | "frameAssetId"; frameIndex?: number };

export type ProjectAssetReference = {
  assetId: string;
  location: ProjectAssetLocation;
};

/**
 * Lists every asset-bearing location in a Project artifact without deciding
 * whether the reference is bundled, procedural, browser-local, or authorized
 * for a particular mutation. Those policies stay with their owning Adapter.
 */
export function listProjectAssetReferences(documentState: DocumentState): ProjectAssetReference[] {
  const references: ProjectAssetReference[] = [];
  const add = (assetId: string | undefined, location: ProjectAssetLocation) => {
    if (typeof assetId === "string" && assetId.length > 0) references.push({ assetId, location });
  };

  add(documentState.coverAssetId, { kind: "cover", field: "coverAssetId" });
  add(documentState.coverTextureUrl, { kind: "cover", field: "coverTextureUrl" });
  for (const spread of documentState.spreads) {
    add(spread.textureUrl, { kind: "spread", spreadId: spread.id, field: "textureUrl" });
    add(spread.artwork?.cleanPlateAssetId, { kind: "spread", spreadId: spread.id, field: "cleanPlateAssetId" });
    add(spread.artwork?.sourceAssetId, { kind: "spread", spreadId: spread.id, field: "sourceAssetId" });
    for (const element of spread.elements) {
      add(element.assetId, { kind: "element", spreadId: spread.id, elementId: element.id, field: "assetId" });
      element.frameAssetIds?.forEach((assetId, frameIndex) => {
        add(assetId, { kind: "element", spreadId: spread.id, elementId: element.id, field: "frameAssetId", frameIndex });
      });
    }
  }
  return references;
}

export function listStoredProjectAssetIds(documentState: DocumentState): string[] {
  return [...new Set(
    listProjectAssetReferences(documentState)
      .map((reference) => reference.assetId)
      .filter(isStoredAssetId),
  )];
}
