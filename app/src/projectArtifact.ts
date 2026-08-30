import { isStoredAssetId } from "./assetId";
import { renderedElementAssetIds, spreadBaseAssetId } from "./types";
import type { DocumentState } from "./types";

type ProjectAssetLocation =
  | { kind: "cover"; field: "coverAssetId" | "coverTextureUrl" }
  | { kind: "spread"; spreadId: string; field: "textureUrl" | "cleanPlateAssetId" | "sourceAssetId" | "personalSourceAssetId" }
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
    add(spread.artwork?.personalSourceAssetId, { kind: "spread", spreadId: spread.id, field: "personalSourceAssetId" });
    for (const element of spread.elements) {
      add(element.assetId, { kind: "element", spreadId: spread.id, elementId: element.id, field: "assetId" });
      element.frameAssetIds?.forEach((assetId, frameIndex) => {
        add(assetId, { kind: "element", spreadId: spread.id, elementId: element.id, field: "frameAssetId", frameIndex });
      });
    }
  }
  return references;
}

/**
 * Lists only browser-local assets a reader actually renders. Author-side
 * composite and personal-photo provenance stay in the private project.
 */
export function listStoredPublishedAssetIds(documentState: DocumentState): string[] {
  const rendered = [documentState.coverAssetId ?? documentState.coverTextureUrl];
  documentState.spreads.forEach((spread) => {
    rendered.push(spreadBaseAssetId(spread));
    spread.elements.forEach((element) => rendered.push(...renderedElementAssetIds(element)));
  });
  return [...new Set(rendered.filter((assetId): assetId is string => (
    typeof assetId === "string" && isStoredAssetId(assetId)
  )))];
}
