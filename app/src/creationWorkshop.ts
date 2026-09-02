import {
  acquireAssetUrl,
  getAssetMetadata,
  isStoredAssetId,
  storeLocalImages,
  type AssetUrlLease,
  type StoredAssetMetadata,
} from "./assetStore";
import { buildCreationBrief, type AuthoringMode, type CreationBrief } from "./creationBrief";
import { type CreationBookType, type CreationPhotoPolicy, type InteractionDensity } from "./authoringContract";

export const CREATION_STYLES = ["Paper collage", "Watercolor", "Cinematic", "Surprise me"] as const;
export const CREATION_LENGTHS = [4, 6, 8, 10, 12] as const;
export const CREATION_SOURCES = [
  { id: "idea", label: "Idea" },
  { id: "photos", label: "Photos" },
  { id: "both", label: "Idea + photos" },
] as const;
export const CREATION_PHOTO_USES = [
  { id: "illustrated-keepsake", label: "Illustrated keepsake" },
  { id: "preserve-originals", label: "Keep original photos" },
] as const;
export type CreationPhotoUse = (typeof CREATION_PHOTO_USES)[number]["id"];

/** One source image per spread covers a full book without overloading the horizontal strip. */
export const MAX_WORKSHOP_ASSETS = 12;
const WORKSHOP_ASSET_ORDER_KEY = "apertale:workshop-asset-order:v1";

type CreationStyle = (typeof CREATION_STYLES)[number];
export type WorkshopAsset = { id: string; name: string; url: string };

export type CreationWorkshopState = {
  mode: AuthoringMode;
  spreadCount: number;
  visualDirection: CreationStyle;
  interactionDensity: InteractionDensity;
  photoUse: CreationPhotoUse | null;
  assets: WorkshopAsset[];
};

export const INITIAL_CREATION_WORKSHOP: CreationWorkshopState = {
  mode: "idea",
  spreadCount: 6,
  visualDirection: "Paper collage",
  interactionDensity: "balanced",
  photoUse: null,
  assets: [],
};

export type CreationWorkshopAction =
  | { type: "set-mode"; mode: AuthoringMode }
  | { type: "set-spread-count"; spreadCount: number }
  | { type: "set-visual-direction"; visualDirection: CreationStyle }
  | { type: "set-interaction-density"; interactionDensity: InteractionDensity }
  | { type: "set-photo-use"; photoUse: CreationPhotoUse }
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

/** Returns only the incoming previews that can still enter the current strip. */
export function admitWorkshopAssets(
  current: readonly WorkshopAsset[],
  incoming: readonly WorkshopAsset[],
) {
  const currentIds = new Set(current.map((asset) => asset.id));
  const room = Math.max(0, MAX_WORKSHOP_ASSETS - currentIds.size);
  return uniqueAssets(incoming.filter((asset) => !currentIds.has(asset.id))).slice(0, room);
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
  if (action.type === "set-interaction-density") return { ...state, interactionDensity: action.interactionDensity };
  if (action.type === "set-photo-use") return { ...state, photoUse: action.photoUse };
  if (action.type === "restore-assets") {
    return { ...state, assets: uniqueAssets([...action.assets, ...state.assets]) };
  }
  if (action.type === "append-assets") {
    const assets = [...state.assets, ...admitWorkshopAssets(state.assets, action.assets)];
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

type ResolvedWorkshopAssets = {
  assets: WorkshopAsset[];
  leases: AssetUrlLease[];
  unresolvedAssetIds: string[];
};

async function resolveWorkshopAssets(metadata: readonly Pick<StoredAssetMetadata, "id" | "name">[]): Promise<ResolvedWorkshopAssets> {
  const assets: WorkshopAsset[] = [];
  const leases: AssetUrlLease[] = [];
  const unresolvedAssetIds: string[] = [];
  for (const asset of metadata) {
    try {
      const lease = await acquireAssetUrl(asset.id);
      leases.push(lease);
      assets.push({ id: asset.id, name: asset.name, url: lease.url });
    } catch {
      unresolvedAssetIds.push(asset.id);
    }
  }
  return { assets, leases, unresolvedAssetIds };
}

export async function restoreCreationWorkshopAssets(): Promise<Omit<ResolvedWorkshopAssets, "unresolvedAssetIds">> {
  const selectedIds = readCreationWorkshopAssetOrder();
  if (selectedIds.length === 0) return { assets: [], leases: [] };
  const metadata = await getAssetMetadata(selectedIds);
  const metadataById = new Map(metadata.map((asset) => [asset.id, asset]));
  const restored = selectedIds.flatMap((id) => {
    const asset = metadataById.get(id);
    return asset?.assetUse === "source-photo" ? [asset] : [];
  });
  const resolved = await resolveWorkshopAssets(restored);
  if (resolved.unresolvedAssetIds.length > 0) {
    resolved.leases.forEach((lease) => lease.release());
    throw new Error("One or more saved photo previews could not be restored.");
  }
  return { assets: resolved.assets, leases: resolved.leases };
}

type CreationWorkshopImport = {
  imported: WorkshopAsset[];
  stored: StoredAssetMetadata[];
  leases: AssetUrlLease[];
  rejected: number;
  failed: number;
};

export async function importCreationWorkshopAssets(files: Iterable<File>, limit: number): Promise<CreationWorkshopImport> {
  const batch = await storeLocalImages(files, { assetUse: "source-photo", limit });
  const resolved = await resolveWorkshopAssets(batch.assets);
  return {
    imported: resolved.assets,
    stored: batch.assets,
    leases: resolved.leases,
    rejected: batch.rejected,
    failed: batch.failed + batch.assets.length - resolved.assets.length,
  };
}

/** Photos are in play for every mode except a pure idea brief. */
export const workshopUsesPhotos = (state: Pick<CreationWorkshopState, "mode">) => state.mode !== "idea";

type WorkshopBookContract = { bookType?: CreationBookType; photoPolicy?: CreationPhotoPolicy };

/** The reader's explicit photo choice, and nothing else, decides the photo book contract. */
const PHOTO_USE_CONTRACT: Record<CreationPhotoUse, WorkshopBookContract> = {
  "illustrated-keepsake": {
    bookType: "photo-led-keepsake",
    photoPolicy: { sourceUse: "reference-and-compose", preserveIdentity: true, allowFaceChanges: false },
  },
  "preserve-originals": {
    bookType: "preserved-photo-album",
    photoPolicy: { sourceUse: "preserve-original-layout", preserveIdentity: true, allowFaceChanges: false },
  },
};

/**
 * Single site that turns a workshop session into a book type and photo policy.
 * `buildCreationBrief` validates and renders what this decides; it never
 * re-infers either field, so an unanswered photo question stays unanswered.
 */
export function workshopBookContract(state: Pick<CreationWorkshopState, "mode" | "photoUse">): WorkshopBookContract {
  if (!workshopUsesPhotos(state)) return { bookType: "illustrated-storybook" };
  return state.photoUse ? PHOTO_USE_CONTRACT[state.photoUse] : {};
}

export function buildCreationWorkshopBrief(state: CreationWorkshopState): CreationBrief {
  // Every workshop photo was stored or restored through the trusted asset
  // adapter, so it is already verified: passing the ids as validated stops the
  // readiness gate from asking a false Image-handoff question.
  return buildCreationBrief({
    mode: state.mode,
    spreadCount: state.spreadCount,
    visualDirection: state.visualDirection,
    interactionDensity: state.interactionDensity,
    sourceAssets: (state.mode === "idea" ? [] : state.assets).map(({ id, name }) => ({ id, name })),
    validatedSourceAssetIds: state.assets.map(({ id }) => id),
    ...workshopBookContract(state),
  });
}
