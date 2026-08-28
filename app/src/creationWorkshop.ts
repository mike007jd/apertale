import {
  getAssetMetadata,
  isStoredAssetId,
  resolveAssetUrl,
  storeLocalImages,
  type StoredAssetMetadata,
} from "./assetStore";
import { buildCreationBrief, type AuthoringMode, type CreationBrief } from "./creationBrief";

export const CREATION_STYLES = ["Paper collage", "Watercolor", "Cinematic", "Surprise me"] as const;
export const CREATION_LENGTHS = [4, 6, 8, 10, 12] as const;
export const CREATION_SOURCES = [
  { id: "idea", label: "Idea" },
  { id: "photos", label: "Photos" },
  { id: "both", label: "Idea + photos" },
] as const;

/** One source image per spread covers a full book without overloading the horizontal strip. */
export const MAX_WORKSHOP_ASSETS = 12;
const WORKSHOP_ASSET_ORDER_KEY = "apertale:workshop-asset-order:v1";

export type CreationStyle = (typeof CREATION_STYLES)[number];
export type WorkshopAsset = { id: string; name: string; url: string };

export type CreationWorkshopState = {
  mode: AuthoringMode;
  spreadCount: number;
  visualDirection: CreationStyle;
  assets: WorkshopAsset[];
};

export const INITIAL_CREATION_WORKSHOP: CreationWorkshopState = {
  mode: "idea",
  spreadCount: 6,
  visualDirection: "Paper collage",
  assets: [],
};

export type CreationWorkshopAction =
  | { type: "set-mode"; mode: AuthoringMode }
  | { type: "set-spread-count"; spreadCount: number }
  | { type: "set-visual-direction"; visualDirection: CreationStyle }
  | { type: "restore-assets"; assets: WorkshopAsset[] }
  | { type: "append-assets"; assets: WorkshopAsset[] }
  | { type: "move-asset"; index: number; direction: -1 | 1 }
  | { type: "remove-asset"; assetId: string };

function uniqueAssets(assets: readonly WorkshopAsset[]) {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    if (!isStoredAssetId(asset.id) || seen.has(asset.id)) return false;
    seen.add(asset.id);
    return true;
  }).slice(0, MAX_WORKSHOP_ASSETS);
}

export function reduceCreationWorkshop(
  state: CreationWorkshopState,
  action: CreationWorkshopAction,
): CreationWorkshopState {
  if (action.type === "set-mode") return { ...state, mode: action.mode };
  if (action.type === "set-spread-count") {
    return CREATION_LENGTHS.includes(action.spreadCount as (typeof CREATION_LENGTHS)[number])
      ? { ...state, spreadCount: action.spreadCount }
      : state;
  }
  if (action.type === "set-visual-direction") return { ...state, visualDirection: action.visualDirection };
  if (action.type === "restore-assets") {
    return { ...state, assets: uniqueAssets([...action.assets, ...state.assets]) };
  }
  if (action.type === "append-assets") {
    const assets = uniqueAssets([...state.assets, ...action.assets]);
    return {
      ...state,
      mode: assets.length > state.assets.length && state.mode === "idea" ? "both" : state.mode,
      assets,
    };
  }
  if (action.type === "remove-asset") {
    return { ...state, assets: state.assets.filter((asset) => asset.id !== action.assetId) };
  }
  const target = action.index + action.direction;
  if (action.index < 0 || target < 0 || action.index >= state.assets.length || target >= state.assets.length) return state;
  const assets = [...state.assets];
  [assets[action.index], assets[target]] = [assets[target], assets[action.index]];
  return { ...state, assets };
}

export function readCreationWorkshopAssetOrder(): string[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(WORKSHOP_ASSET_ORDER_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id): id is string => typeof id === "string" && isStoredAssetId(id)))]
      .slice(0, MAX_WORKSHOP_ASSETS);
  } catch {
    return [];
  }
}

export function persistCreationWorkshopAssetOrder(assets: readonly WorkshopAsset[]) {
  try {
    sessionStorage.setItem(WORKSHOP_ASSET_ORDER_KEY, JSON.stringify(uniqueAssets(assets).map((asset) => asset.id)));
  } catch {
    // A storage-blocked browser can still keep the current in-memory brief.
  }
}

export async function restoreCreationWorkshopAssets(): Promise<WorkshopAsset[]> {
  const selectedIds = readCreationWorkshopAssetOrder();
  if (selectedIds.length === 0) return [];
  const metadata = await getAssetMetadata(selectedIds);
  const metadataById = new Map(metadata.map((asset) => [asset.id, asset]));
  const restored = await Promise.all(selectedIds.map(async (id) => {
    const asset = metadataById.get(id);
    if (!asset) return null;
    try {
      return { id: asset.id, name: asset.name, url: await resolveAssetUrl(asset.id) } satisfies WorkshopAsset;
    } catch {
      return null;
    }
  }));
  return restored.filter((asset): asset is WorkshopAsset => Boolean(asset));
}

export type CreationWorkshopImport = {
  imported: WorkshopAsset[];
  stored: StoredAssetMetadata[];
  rejected: number;
  failed: number;
};

export async function importCreationWorkshopAssets(files: Iterable<File>, limit: number): Promise<CreationWorkshopImport> {
  const batch = await storeLocalImages(files, limit);
  const imported = await Promise.all(batch.assets.map(async (asset) => {
    try {
      return { id: asset.id, name: asset.name, url: await resolveAssetUrl(asset.id) } satisfies WorkshopAsset;
    } catch {
      return { id: asset.id, name: asset.name, url: "" } satisfies WorkshopAsset;
    }
  }));
  return { imported, stored: batch.assets, rejected: batch.rejected, failed: batch.failed };
}

export function buildCreationWorkshopBrief(state: CreationWorkshopState): CreationBrief {
  return buildCreationBrief({
    mode: state.mode,
    spreadCount: state.spreadCount,
    visualDirection: state.visualDirection,
    sourceAssets: (state.mode === "idea" ? [] : state.assets).map(({ id, name }) => ({ id, name })),
  });
}
