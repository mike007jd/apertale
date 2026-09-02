import type { StoredAssetMetadata } from "./assetStore";
import { isStoredAssetId } from "./assetId";
import { SUPPORTED_IMAGE_TYPES } from "./bookElementGrammar";
import { MAX_BOOK_PUBLISHABLE_ASSETS } from "./authoringContract";
import { isProceduralElement, renderedElementAssetIds } from "./types";
import type { DocumentState, PreparedBookBackground, PreparedBookLayer } from "./types";

const COVER_ASPECT = { min: 0.58, max: 0.78 };
const SPREAD_ASPECT = { min: 1.45, max: 2.1 };
const ALPHA_IMAGE_TYPES = new Set(["image/png", "image/webp"]);

type PreparedAssetManifest = {
  coverAssetId: string;
  spreads: Array<{
    background: PreparedBookBackground;
    layers: PreparedBookLayer[];
  }>;
};

type BookAssetReferenceManifest = {
  coverAssetId?: string;
  spreads: Array<{
    background?: {
      cleanPlateAssetId: string;
      sourceAssetId?: string;
      separation: PreparedBookBackground["separation"];
    };
    layers: Array<Pick<PreparedBookLayer, "assetId" | "frameAssetIds">>;
  }>;
};

type BookAssetReferenceIssue =
  | { code: "generated-source-clean-reuse"; spreadIndex: number; sourceAssetId: string; cleanPlateAssetId: string }
  | { code: "cover-interior-reuse"; spreadIndex: number; assetId: string }
  | { code: "background-cross-spread-reuse"; spreadIndex: number; ownerSpreadIndex: number; assetId: string }
  | { code: "resting-frame-mismatch"; spreadIndex: number; layerIndex: number; assetId: string; firstFrameAssetId: string }
  | { code: "foreground-cross-layer-reuse"; spreadIndex: number; layerIndex: number; ownerLayerIndex: number; assetId: string }
  | { code: "cover-foreground-reuse"; spreadIndex: number; layerIndex: number; assetId: string }
  | { code: "background-foreground-reuse"; spreadIndex: number; layerIndex: number; assetId: string };

export function bookAssetReferenceManifest(documentState: DocumentState): BookAssetReferenceManifest {
  return {
    coverAssetId: documentState.coverAssetId ?? documentState.coverTextureUrl,
    spreads: documentState.spreads.map((spread) => ({
      ...(spread.artwork ? { background: spread.artwork } : {}),
      layers: spread.elements
        .filter((element) => !isProceduralElement(element))
        .map((element) => ({ assetId: element.assetId, frameAssetIds: element.frameAssetIds })),
    })),
  };
}

const unique = (issues: string[]) => [...new Set(issues)];

function metadataMap(metadata: readonly StoredAssetMetadata[]) {
  return new Map(metadata.map((asset) => [asset.id, asset]));
}

function dimensions(asset: StoredAssetMetadata | undefined, label: string, issues: string[]) {
  if (!asset) {
    issues.push(`${label} is not a verified browser-local asset.`);
    return null;
  }
  if (!SUPPORTED_IMAGE_TYPES.has(asset.type)) {
    issues.push(`${label} has an unsupported image type.`);
    return null;
  }
  if (!asset.width || !asset.height) {
    issues.push(`${label} has no verified image dimensions.`);
    return null;
  }
  return { width: asset.width, height: asset.height, aspect: asset.width / asset.height };
}

function assetUseIssues(
  assetIds: readonly string[],
  metadata: readonly StoredAssetMetadata[],
  allowedUse: NonNullable<StoredAssetMetadata["assetUse"]>,
  label: string,
) {
  const byId = metadataMap(metadata);
  const issues: string[] = [];
  assetIds.forEach((assetId, index) => {
    const asset = byId.get(assetId);
    if (!asset) return;
    const itemLabel = assetIds.length === 1 ? label : `${label} ${index + 1}`;
    if (!asset.assetUse) {
      issues.push(`${itemLabel} was imported before asset roles were recorded; re-import it through the matching image handoff.`);
    } else if (asset.assetUse !== allowedUse) {
      issues.push(`${itemLabel} was imported as ${asset.assetUse} and cannot be used in this book-art role.`);
    }
  });
  return issues;
}

const BOOK_ART_USE = "book-art";
const SOURCE_PHOTO_USE = "source-photo";

export function sourcePhotoAssetRoleIssues(
  assetIds: readonly string[],
  metadata: readonly StoredAssetMetadata[],
  label = "The declared source photo",
) {
  return unique(assetUseIssues(assetIds, metadata, SOURCE_PHOTO_USE, label));
}

export function backgroundAssetUseIssues(
  assetIds: readonly string[],
  metadata: readonly StoredAssetMetadata[],
  separation: PreparedBookBackground["separation"],
  declaredSourceAssetIds: readonly string[],
  label: string,
) {
  const declaredSources = new Set(declaredSourceAssetIds);
  const byId = metadataMap(metadata);
  const issues: string[] = [];
  assetIds.forEach((assetId, index) => {
    const asset = byId.get(assetId);
    if (!asset) return;
    const itemLabel = assetIds.length === 1 ? label : `${label} ${index + 1}`;
    if (!asset.assetUse) {
      issues.push(`${itemLabel} was imported before asset roles were recorded; re-import it through the matching image handoff.`);
    } else if (
      asset.assetUse !== "book-art"
      && !(separation === "preserved-photo-layout" && declaredSources.has(assetId))
    ) {
      issues.push(`${itemLabel} is a reader source photo and is not an approved preserved-photo layout source.`);
    }
  });
  return unique(issues);
}

export function coverAssetRoleIssues(
  assetId: string,
  metadata: readonly StoredAssetMetadata[],
  label = "The dedicated cover",
) {
  const issues: string[] = [];
  const size = dimensions(metadataMap(metadata).get(assetId), label, issues);
  issues.push(...assetUseIssues([assetId], metadata, BOOK_ART_USE, label));
  if (size && (
    size.width < 512
    || size.height < 768
    || size.aspect < COVER_ASPECT.min
    || size.aspect > COVER_ASPECT.max
  )) {
    issues.push(`${label} must be a portrait image at least 512×768 with a cover-shaped aspect ratio.`);
  }
  return unique(issues);
}

export function fullSpreadAssetRoleIssues(
  assetIds: readonly string[],
  metadata: readonly StoredAssetMetadata[],
  label: string,
) {
  const byId = metadataMap(metadata);
  const issues: string[] = [];
  assetIds.forEach((assetId, index) => {
    const itemLabel = assetIds.length === 1 ? label : `${label} ${index + 1}`;
    const size = dimensions(byId.get(assetId), itemLabel, issues);
    if (size && (
      size.width < 1024
      || size.height < 512
      || size.aspect < SPREAD_ASPECT.min
      || size.aspect > SPREAD_ASPECT.max
    )) {
      issues.push(`${itemLabel} must be a full-spread landscape image at least 1024×512 with a 1.45–2.10 aspect ratio.`);
    }
  });
  return unique(issues);
}

export function foregroundAssetRoleIssues(
  assetIds: readonly string[],
  metadata: readonly StoredAssetMetadata[],
  label: string,
) {
  const byId = metadataMap(metadata);
  const issues: string[] = [];
  assetIds.forEach((assetId, index) => {
    const itemLabel = assetIds.length === 1 ? label : `${label} ${index + 1}`;
    const asset = byId.get(assetId);
    const size = dimensions(asset, itemLabel, issues);
    issues.push(...assetUseIssues([assetId], metadata, BOOK_ART_USE, itemLabel));
    if (size && (Math.max(size.width, size.height) < 256 || Math.min(size.width, size.height) < 96)) {
      issues.push(`${itemLabel} is too small for a foreground subject.`);
    }
    if (asset && !ALPHA_IMAGE_TYPES.has(asset.type)) {
      issues.push(`${itemLabel} must be a native-alpha PNG or WebP image.`);
    }
    if (asset && asset.analysis?.hasMeaningfulAlpha !== true) {
      issues.push(`${itemLabel} must contain a visible subject with genuine transparent padding.`);
    }
  });
  return unique(issues);
}

export function frameSequenceAssetRoleIssues(
  assetIds: readonly string[],
  metadata: readonly StoredAssetMetadata[],
  label: string,
) {
  const issues = foregroundAssetRoleIssues(assetIds, metadata, label);
  const byId = metadataMap(metadata);
  const sizes = assetIds.map((assetId) => byId.get(assetId)).filter((asset): asset is StoredAssetMetadata => Boolean(asset));
  const first = sizes[0];
  if (first?.width && first.height && sizes.some((asset) => asset.width !== first.width || asset.height !== first.height)) {
    issues.push(`${label} frames must use one consistent canvas size.`);
  }
  return unique(issues);
}

function sourceCanvas(asset: StoredAssetMetadata | undefined) {
  if (!asset?.sourceWidth || !asset.sourceHeight) return null;
  return { width: asset.sourceWidth, height: asset.sourceHeight };
}

export function backgroundPairAssetRoleIssues(
  sourceAssetId: string,
  cleanPlateAssetId: string,
  metadata: readonly StoredAssetMetadata[],
  label: string,
) {
  const byId = metadataMap(metadata);
  const source = byId.get(sourceAssetId);
  const clean = byId.get(cleanPlateAssetId);
  if (!source || !clean) return [];
  const sourceDimensions = sourceCanvas(source);
  const cleanDimensions = sourceCanvas(clean);
  if (!sourceDimensions || !cleanDimensions) {
    return [`${label} need verified original canvas dimensions; re-import both images before continuing.`];
  }
  if (sourceDimensions.width !== cleanDimensions.width || sourceDimensions.height !== cleanDimensions.height) {
    return [`${label} must use the same original canvas size.`];
  }
  return [];
}

/**
 * Cross-resource invariants that do not require decoding browser-local blobs.
 *
 * Keeping these separate from pixel-role checks lets the engine preserve the
 * same book-wide contract after a patch, including for curated bundled assets.
 */
export function bookAssetReferenceIssueKey(issue: BookAssetReferenceIssue) {
  return JSON.stringify(issue);
}

export function formatBookAssetReferenceIssue(issue: BookAssetReferenceIssue) {
  const spreadNumber = issue.spreadIndex + 1;
  switch (issue.code) {
    case "generated-source-clean-reuse":
      return `Spread ${spreadNumber} must keep its original composite separate from its final clean plate.`;
    case "cover-interior-reuse":
      return `Spread ${spreadNumber} cannot reuse the dedicated cover as interior artwork.`;
    case "background-cross-spread-reuse":
      return `Spread ${spreadNumber} must use purpose-built background artwork instead of reusing asset ${issue.assetId} from spread ${issue.ownerSpreadIndex + 1}.`;
    case "resting-frame-mismatch":
      return `Spread ${spreadNumber} layer ${issue.layerIndex + 1} must use its resting frame as assetId.`;
    case "foreground-cross-layer-reuse":
      return `Spread ${spreadNumber} reuses foreground final ${issue.assetId} across layers; layers must use distinct final assets.`;
    case "cover-foreground-reuse":
      return `Spread ${spreadNumber} cannot reuse its cover as a foreground layer.`;
    case "background-foreground-reuse":
      return `Spread ${spreadNumber} cannot reuse background asset ${issue.assetId} as a foreground layer.`;
  }
}

export function bookAssetReferenceFindings(manifest: BookAssetReferenceManifest) {
  const findings: BookAssetReferenceIssue[] = [];
  const backgroundOwner = new Map<string, number>();
  const backgroundIds = new Set<string>();

  manifest.spreads.forEach((spread, index) => {
    if (!spread.background) return;
    const ids = [spread.background.sourceAssetId, spread.background.cleanPlateAssetId]
      .filter((assetId): assetId is string => Boolean(assetId));
    if (
      spread.background.sourceAssetId
      && spread.background.sourceAssetId === spread.background.cleanPlateAssetId
      && spread.background.separation !== "preserved-photo-layout"
    ) {
      findings.push({
        code: "generated-source-clean-reuse",
        spreadIndex: index,
        sourceAssetId: spread.background.sourceAssetId,
        cleanPlateAssetId: spread.background.cleanPlateAssetId,
      });
    }
    ids.forEach((assetId) => {
      if (assetId === manifest.coverAssetId) {
        findings.push({ code: "cover-interior-reuse", spreadIndex: index, assetId });
      }
      const owner = backgroundOwner.get(assetId);
      if (typeof owner === "number" && owner !== index) {
        findings.push({ code: "background-cross-spread-reuse", spreadIndex: index, ownerSpreadIndex: owner, assetId });
      } else {
        backgroundOwner.set(assetId, index);
      }
      backgroundIds.add(assetId);
    });
  });

  manifest.spreads.forEach((spread, index) => {
    const foregroundOwner = new Map<string, number>();
    spread.layers.forEach((layer, layerIndex) => {
      if (layer.frameAssetIds?.length && layer.frameAssetIds[0] !== layer.assetId) {
        findings.push({
          code: "resting-frame-mismatch",
          spreadIndex: index,
          layerIndex,
          assetId: layer.assetId,
          firstFrameAssetId: layer.frameAssetIds[0],
        });
      }
      new Set(renderedElementAssetIds(layer)).forEach((assetId) => {
        const owner = foregroundOwner.get(assetId);
        if (typeof owner === "number" && owner !== layerIndex) {
          findings.push({ code: "foreground-cross-layer-reuse", spreadIndex: index, layerIndex, ownerLayerIndex: owner, assetId });
        } else {
          foregroundOwner.set(assetId, layerIndex);
        }
        if (assetId === manifest.coverAssetId) {
          findings.push({ code: "cover-foreground-reuse", spreadIndex: index, layerIndex, assetId });
        }
        if (backgroundIds.has(assetId)) {
          findings.push({ code: "background-foreground-reuse", spreadIndex: index, layerIndex, assetId });
        }
      });
    });
  });

  const uniqueFindings = new Map(findings.map((issue) => [bookAssetReferenceIssueKey(issue), issue]));
  return [...uniqueFindings.values()];
}

export function bookAssetReferenceIssues(manifest: BookAssetReferenceManifest) {
  return bookAssetReferenceFindings(manifest).map(formatBookAssetReferenceIssue);
}

/**
 * Admission checks that require trusted blob metadata. Aesthetic composition
 * remains a rendered-frame review, but wrong roles, duplicate finals, opaque
 * cutouts, and books that cannot fit the publishing quota fail before create.
 */
export function preparedBookAssetIssues(
  manifest: PreparedAssetManifest,
  metadata: readonly StoredAssetMetadata[],
  declaredSourceAssetIds: readonly string[] = [],
) {
  const issues = [
    ...coverAssetRoleIssues(manifest.coverAssetId, metadata),
    ...bookAssetReferenceIssues(manifest),
  ];
  const referenced = new Set<string>([manifest.coverAssetId]);

  manifest.spreads.forEach((spread, index) => {
    const spreadNumber = index + 1;
    const backgroundIds = [spread.background.sourceAssetId, spread.background.cleanPlateAssetId];
    issues.push(...fullSpreadAssetRoleIssues(backgroundIds, metadata, `Spread ${spreadNumber} background asset`));
    issues.push(...backgroundAssetUseIssues(
      backgroundIds,
      metadata,
      spread.background.separation,
      declaredSourceAssetIds,
      `Spread ${spreadNumber} background asset`,
    ));
    issues.push(...backgroundPairAssetRoleIssues(
      spread.background.sourceAssetId,
      spread.background.cleanPlateAssetId,
      metadata,
      `Spread ${spreadNumber} original composite and final base`,
    ));
    if (spread.background.personalSourceAssetId) {
      issues.push(...sourcePhotoAssetRoleIssues(
        [spread.background.personalSourceAssetId],
        metadata,
        `Spread ${spreadNumber} personal source`,
      ));
      if (!declaredSourceAssetIds.includes(spread.background.personalSourceAssetId)) {
        issues.push(`Spread ${spreadNumber} personal source is not declared by the ready creation brief.`);
      }
    }

    referenced.add(spread.background.cleanPlateAssetId);

    const foregroundIds = [...new Set(spread.layers.flatMap(renderedElementAssetIds))];
    spread.layers.forEach((layer) => {
      const renderedIds = [...new Set(renderedElementAssetIds(layer))];
      issues.push(...(layer.frameAssetIds?.length
        ? frameSequenceAssetRoleIssues(renderedIds, metadata, `Spread ${spreadNumber} ${layer.label} animation`)
        : foregroundAssetRoleIssues(renderedIds, metadata, `Spread ${spreadNumber} ${layer.label}`)));
    });
    foregroundIds.forEach((assetId) => {
      referenced.add(assetId);
    });
  });

  if (referenced.size > MAX_BOOK_PUBLISHABLE_ASSETS) {
    issues.push(`The finished book references ${referenced.size} local images, above the publishable limit of ${MAX_BOOK_PUBLISHABLE_ASSETS}.`);
  }
  return unique(issues);
}

/**
 * Revalidates the asset roles of an existing personal book before it can enter
 * the current quality lifecycle. Legacy documents predate role metadata, so
 * structure alone must never attest that a source photo is safe to publish as
 * a cover, clean plate, or foreground cutout.
 */
export function documentAssetRoleIssues(
  documentState: DocumentState,
  metadata: readonly StoredAssetMetadata[],
  declaredSourceAssetIds: readonly string[] = [],
) {
  const issues: string[] = [];
  const byId = metadataMap(metadata);
  const needsMetadataCheck = (assetId: string) => byId.has(assetId) || isStoredAssetId(assetId);
  const coverAssetId = documentState.coverAssetId ?? documentState.coverTextureUrl;
  if (coverAssetId && needsMetadataCheck(coverAssetId)) {
    issues.push(...coverAssetRoleIssues(coverAssetId, metadata));
  }

  documentState.spreads.forEach((spread, index) => {
    const spreadNumber = index + 1;
    const artwork = spread.artwork;
    if (artwork) {
      const backgroundIds = [artwork.sourceAssetId, artwork.cleanPlateAssetId]
        .filter((assetId): assetId is string => typeof assetId === "string" && needsMetadataCheck(assetId));
      issues.push(...fullSpreadAssetRoleIssues(backgroundIds, metadata, `Spread ${spreadNumber} background asset`));
      issues.push(...backgroundAssetUseIssues(
        backgroundIds,
        metadata,
        artwork.separation,
        declaredSourceAssetIds,
        `Spread ${spreadNumber} background asset`,
      ));
      if (artwork.sourceAssetId) {
        issues.push(...backgroundPairAssetRoleIssues(
          artwork.sourceAssetId,
          artwork.cleanPlateAssetId,
          metadata,
          `Spread ${spreadNumber} original composite and final base`,
        ));
      }
      if (artwork.personalSourceAssetId) {
        if (isStoredAssetId(artwork.personalSourceAssetId) && !byId.has(artwork.personalSourceAssetId)) {
          issues.push(`Spread ${spreadNumber} personal source is not a verified browser-local asset.`);
        }
        issues.push(...sourcePhotoAssetRoleIssues(
          [artwork.personalSourceAssetId],
          metadata,
          `Spread ${spreadNumber} personal source`,
        ));
        if (!declaredSourceAssetIds.includes(artwork.personalSourceAssetId)) {
          issues.push(`Spread ${spreadNumber} personal source is not declared by the ready creation brief.`);
        }
      }
    }

    spread.elements.filter((element) => !isProceduralElement(element)).forEach((element) => {
      const renderedIds = [...new Set(renderedElementAssetIds(element))].filter(needsMetadataCheck);
      if (renderedIds.length === 0) return;
      issues.push(...(element.frameAssetIds?.length
        ? frameSequenceAssetRoleIssues(renderedIds, metadata, `Spread ${spreadNumber} ${element.label} animation`)
        : foregroundAssetRoleIssues(renderedIds, metadata, `Spread ${spreadNumber} ${element.label}`)));
    });
  });

  issues.push(...bookAssetReferenceIssues(bookAssetReferenceManifest(documentState)));
  return unique(issues);
}
