import qualityRubricSource from "../worker/qualityRubric.json";
import {
  CREATION_READINESS_VERSION,
  assessCreationReadiness,
  creationBriefSourceAssetIds,
  interactionLayerTarget,
  supportedBookType,
  type CreationBookType,
  type CreationBriefPayload,
} from "./authoringContract";
import { bookAssetReferenceIssues, bookAssetReferenceManifest } from "./bookAssetContract";
import { hasAuthoredInteraction } from "./interaction";
import { listStoredPublishedAssetIds } from "./projectArtifact";
import { MAX_BOOK_PUBLISHABLE_ASSETS, MAX_BOOK_SPREADS, isProceduralElement, spreadBaseAssetId } from "./types";
import type { DocumentState, ThemeId } from "./types";

export const QUALITY_CONTRACT_VERSION = 2 as const;
export const QUALITY_REVIEW_MAX_ROUNDS = 2 as const;
/** Closed runtime vocabulary for persisted quality lifecycle status. */
export const QUALITY_REVIEW_STATUSES = ["needs-review", "checking", "ready", "blocked", "needs-user-input"] as const;

const MIN_SPREAD_FOREGROUND_LAYERS = 2;
/**
 * Capacity for the common fully distinct 12-spread asset plan: a dedicated
 * cover plus, per spread, the original composite, final clean plate, and two
 * foreground layers (1 + 12 × 4 = 49), with one extra slot available for a
 * personal source or animation frame. Cross-spread foreground reuse remains
 * legal and can reduce the actual total.
 */
export const MINIMUM_CAPABLE_BOOK_ASSETS = 1 + MAX_BOOK_SPREADS * (2 + MIN_SPREAD_FOREGROUND_LAYERS);

type QualityCriterionMode = "deterministic" | "visual" | "both";
type QualityCriterion = {
  id: string;
  label: string;
  mode: QualityCriterionMode;
  description: string;
};

type QualityRubric = {
  id: string;
  version: typeof QUALITY_CONTRACT_VERSION;
  maxReviewRounds: typeof QUALITY_REVIEW_MAX_ROUNDS;
  maxBookUploadedAssets: number;
  spreadAssetPolicies: Record<CreationBookType, {
    separation: "inpainted-clean-plate" | "preserved-photo-layout";
    sourceUse: "reference-and-compose" | "preserve-original-layout";
    requiresPersonalSourceAsset: boolean;
  }>;
  criteria: QualityCriterion[];
};

export const QUALITY_RUBRIC = Object.freeze(qualityRubricSource) as QualityRubric;

type QualityOutcome = "pass" | "blocker" | "warn" | "note";

type QualityEvidenceLocation = {
  scope: "book" | "cover" | "spread";
  spreadId?: string;
  locator: string;
  description: string;
};

export type QualityRenderEvidence = {
  documentId: string;
  revision: number;
  scope: "cover" | "spread";
  spreadId?: string;
  theme: ThemeId;
  surface: "shelf" | "webgl" | "fallback";
  locator: string;
  renderedAt: string;
};

type QualityCheckResult = {
  criterionId: string;
  outcome: QualityOutcome;
  message: string;
  evidence: QualityEvidenceLocation[];
  suggestedPatch?: string;
};

export type QualityVisualReviewSubmission = {
  contractVersion: typeof QUALITY_CONTRACT_VERSION;
  reviewedRevision: number;
  expectedRound: number;
  sampleReady: boolean;
  summary: string;
  checks: QualityCheckResult[];
};

type QualityReportStatus = "ready" | "blocked" | "needs-user-input";

type QualityReport = {
  contractVersion: typeof QUALITY_CONTRACT_VERSION;
  rubricVersion: typeof QUALITY_CONTRACT_VERSION;
  documentId: string;
  reviewedRevision: number;
  round: number;
  maxRounds: typeof QUALITY_REVIEW_MAX_ROUNDS;
  creationBrief: CreationBriefPayload;
  status: QualityReportStatus;
  checks: QualityCheckResult[];
  blockerCount: number;
  warningCount: number;
  noteCount: number;
  warningsRecorded: boolean;
  sampleReady: boolean;
  summary: string;
};

/** Distinguishes reports that can be used under the currently shipped gate. */
export function isCurrentQualityReport(report: unknown): report is QualityReport {
  if (!report || typeof report !== "object") return false;
  const candidate = report as Partial<QualityReport>;
  return candidate.contractVersion === QUALITY_CONTRACT_VERSION
    && candidate.rubricVersion === QUALITY_CONTRACT_VERSION;
}

export type AuthoringQualityLifecycle = {
  creationBrief: CreationBriefPayload;
  reviewRounds: number;
  reviewStatus: "needs-review" | "checking" | QualityReportStatus;
  renderEvidence: QualityRenderEvidence[];
  report?: QualityReport;
};

export type QualityGateState = {
  status: "needs-review" | "checking" | "blocked" | "needs-user-input" | "ready";
  message: string;
  report: QualityReport | null;
  nextRound: number | null;
  remainingRounds: number;
};

type QualityRenderManifest = {
  contractVersion: typeof QUALITY_CONTRACT_VERSION;
  documentId: string;
  revision: number;
  pageUrl: string;
  screenshotBoundary: string;
  cover: {
    assetId: string | null;
    evidenceLocator: string;
  };
  spreads: Array<{
    id: string;
    order: number;
    title: string;
    body: string;
    finalBaseAssetId: string | null;
    separation: "inpainted-clean-plate" | "preserved-photo-layout" | null;
    sourceAssetId: string | null;
    personalSourceAssetId: string | null;
    foregroundLayers: Array<{
      id: string;
      label: string;
      assetId: string;
      interaction: boolean;
    }>;
    evidenceLocator: string;
  }>;
};

export function creationAssetPolicyIssues(
  documentState: DocumentState,
  creationBrief: CreationBriefPayload | null | undefined,
): string[] {
  if (!supportedBookType(creationBrief?.bookType)) return ["The book has no validated creation asset policy."];
  const readiness = assessCreationReadiness(creationBrief, {
    expectedSpreadCount: documentState.spreads.length,
    // These ids were resolved by the trusted adapter when the immutable brief
    // was created or adopted. Publication separately traverses and uploads the
    // current artifact, so this call reuses the readiness semantics without
    // pretending the pure quality contract can query IndexedDB.
    validatedSourceAssetIds: creationBriefSourceAssetIds(creationBrief),
  });
  if (!readiness.ready) return readiness.blockingMissingFields.map((blocker) => blocker.reason);
  const policy = QUALITY_RUBRIC.spreadAssetPolicies[creationBrief.bookType];
  const sourceAssets = Array.isArray(creationBrief.sourceAssets) ? creationBrief.sourceAssets : [];
  const sourceIds = new Set(sourceAssets.map((asset) => asset?.id).filter((id): id is string => typeof id === "string" && id.length > 0));
  const issues: string[] = [];
  if (creationBrief.spreadCount !== documentState.spreads.length) issues.push("The final spread count does not match the ready creation brief.");
  if (sourceIds.size > 0 && creationBrief.photoPolicy?.sourceUse !== policy.sourceUse) {
    issues.push(`The source-photo policy must remain ${policy.sourceUse}.`);
  }
  if (creationBrief.bookType !== "illustrated-storybook" && sourceIds.size === 0) issues.push("The photo book has no declared source assets.");
  const effectiveCoverAssetId = documentState.coverAssetId ?? documentState.coverTextureUrl;
  if (effectiveCoverAssetId && sourceIds.has(effectiveCoverAssetId)) issues.push("A personal source photo cannot replace the dedicated cover.");
  for (const spread of documentState.spreads) {
    const artwork = spread.artwork;
    if (!artwork) continue;
    if (artwork.separation !== policy.separation) {
      issues.push(`Spread ${spread.order + 1} must use ${policy.separation}.`);
    }
    if (!artwork.sourceAssetId) {
      issues.push(`Spread ${spread.order + 1} must retain its original composite reference.`);
    } else if (creationBrief.bookType !== "preserved-photo-album" && artwork.sourceAssetId === artwork.cleanPlateAssetId) {
      issues.push(`Spread ${spread.order + 1} must keep the original composite separate from its repaired clean plate.`);
    }
    if (artwork.sourceAssetId && sourceIds.has(artwork.sourceAssetId) && creationBrief.bookType !== "preserved-photo-album") {
      issues.push(`Spread ${spread.order + 1} uses a personal source photo as its generated composite reference.`);
    }
    const requiresPersonalSource = policy.requiresPersonalSourceAsset || sourceIds.size > 0;
    if (requiresPersonalSource) {
      if (!artwork.personalSourceAssetId || !sourceIds.has(artwork.personalSourceAssetId)) {
        issues.push(`Spread ${spread.order + 1} must retain one declared personal-photo source.`);
      }
    } else if (artwork.personalSourceAssetId) {
      issues.push(`Spread ${spread.order + 1} has an undeclared personal-photo reference.`);
    }
    if (creationBrief.bookType !== "preserved-photo-album" && sourceIds.has(artwork.cleanPlateAssetId)) {
      issues.push(`Spread ${spread.order + 1} uses a source photo as generated final artwork.`);
    }
    const rawSourceLayer = spread.elements.some((element) => (
      sourceIds.has(element.assetId) || element.frameAssetIds?.some((assetId) => sourceIds.has(assetId))
    ));
    if (rawSourceLayer) issues.push(`Spread ${spread.order + 1} uses a declared source photo as a foreground final.`);
  }
  return [...new Set(issues)];
}

export const QUALITY_VISUAL_CRITERION_IDS = Object.freeze(
  QUALITY_RUBRIC.criteria.filter((item) => item.mode !== "deterministic").map((item) => item.id),
);

const evidence = (
  criterionId: string,
  outcome: QualityOutcome,
  message: string,
  locations: QualityEvidenceLocation[],
  suggestedPatch?: string,
): QualityCheckResult => ({
  criterionId,
  outcome,
  message,
  evidence: locations,
  ...(suggestedPatch ? { suggestedPatch } : {}),
});

function meaningfulInteraction(documentState: DocumentState, spreadId: string) {
  const spread = documentState.spreads.find((item) => item.id === spreadId);
  return Boolean(spread?.elements.some((element) => hasAuthoredInteraction(element.interaction)));
}

function evaluateCreationArtifactQuality(
  documentState: DocumentState,
  creationBrief?: CreationBriefPayload | null,
): QualityCheckResult[] {
  const checks: QualityCheckResult[] = [];
  const interactionTarget = interactionLayerTarget(creationBrief?.interactionDensity);
  const elementIds = documentState.spreads.flatMap((spread) => spread.elements.map((element) => element.id));
  const globallyUniqueElementIds = new Set(elementIds).size === elementIds.length;
  checks.push(evidence(
    "layered-spread-contract",
    globallyUniqueElementIds ? "pass" : "blocker",
    globallyUniqueElementIds
      ? "Foreground layer ids are unique across the book."
      : "Foreground layer ids must be unique across the whole book.",
    [{ scope: "book", locator: ".book-app", description: "Book-wide foreground layer identity" }],
    globallyUniqueElementIds ? undefined : "Give every foreground layer a book-wide stable id before continuing.",
  ));

  const localAssetCount = listStoredPublishedAssetIds(documentState).length;
  const publishableAssetCount = localAssetCount <= MAX_BOOK_PUBLISHABLE_ASSETS;
  checks.push(evidence(
    "creation-asset-policy",
    publishableAssetCount ? "pass" : "blocker",
    publishableAssetCount
      ? `The book references ${localAssetCount} of ${MAX_BOOK_PUBLISHABLE_ASSETS} available uploaded-image slots.`
      : `The book references ${localAssetCount} local images, above the publishable limit of ${MAX_BOOK_PUBLISHABLE_ASSETS}.`,
    [{ scope: "book", locator: ".book-app", description: "Publishable local image capacity" }],
    publishableAssetCount ? undefined : "Reduce unique local image references before review.",
  ));
  const coverAssetId = documentState.coverAssetId ?? documentState.coverTextureUrl;
  checks.push(evidence(
    "missing-or-fallback-assets",
    coverAssetId ? "pass" : "blocker",
    coverAssetId ? "A dedicated cover asset is present." : "The book has no dedicated cover asset.",
    [{ scope: "cover", locator: "[data-book-id] .library-cover-frame img", description: "Creator shelf cover" }],
    coverAssetId ? undefined : "Set a dedicated portrait cover before review.",
  ));

  for (const spread of documentState.spreads) {
    const spreadLocation: QualityEvidenceLocation = {
      scope: "spread",
      spreadId: spread.id,
      locator: ".book-scene canvas",
      description: `Rendered spread ${spread.order + 1}: ${spread.title}`,
    };
    const cleanPlate = spread.artwork?.cleanPlateAssetId;
    checks.push(evidence(
      "missing-or-fallback-assets",
      cleanPlate ? "pass" : "blocker",
      cleanPlate ? `Spread ${spread.order + 1} has a final base.` : `Spread ${spread.order + 1} is using a blank or fallback base.`,
      [spreadLocation],
      cleanPlate ? undefined : "Add the final generated clean plate or approved preserved-photo layout.",
    ));

    const foreground = spread.elements.filter((element) => !isProceduralElement(element));
    const layered = Boolean(cleanPlate)
      && foreground.length >= interactionTarget.minimum
      && foreground.length <= interactionTarget.maximum;
    checks.push(evidence(
      "layered-spread-contract",
      layered ? "pass" : "blocker",
      layered
        ? `Spread ${spread.order + 1} has one final base and ${foreground.length} foreground layers.`
        : `Spread ${spread.order + 1} needs one final base and ${interactionTarget.count} interactive layers for ${interactionTarget.label.toLowerCase()} density; found ${foreground.length}.`,
      [spreadLocation],
      layered ? undefined : `Prepare the final base and ${interactionTarget.count} true-alpha interactive layers.`,
    ));

    const hasInteraction = interactionTarget.minimum === 0 || meaningfulInteraction(documentState, spread.id);
    checks.push(evidence(
      "meaningful-interaction",
      hasInteraction ? "pass" : "blocker",
      interactionTarget.minimum === 0
        ? `Spread ${spread.order + 1} intentionally has no interactive layers.`
        : hasInteraction
          ? `Spread ${spread.order + 1} has an authored interaction.`
          : `Spread ${spread.order + 1} has no authored interaction.`,
      [spreadLocation],
      hasInteraction ? undefined : "Add a spread-specific hover, focus response, or click reveal.",
    ));

    const safeTextLength = spread.title.trim().length > 0 && spread.title.length <= 100 && spread.body.length <= 800;
    checks.push(evidence(
      "text-safety-readability",
      safeTextLength ? "pass" : "blocker",
      safeTextLength ? `Spread ${spread.order + 1} copy is within the authoring bounds.` : `Spread ${spread.order + 1} copy exceeds the authoring bounds.`,
      [spreadLocation],
      safeTextLength ? undefined : "Shorten the title or body before visual readability review.",
    ));
  }

  const policyIssues = [
    ...creationAssetPolicyIssues(documentState, creationBrief),
    ...bookAssetReferenceIssues(bookAssetReferenceManifest(documentState)),
  ];
  checks.push(evidence(
    "creation-asset-policy",
    policyIssues.length === 0 ? "pass" : "blocker",
    policyIssues.length === 0 ? "Every spread follows the ready creation asset policy." : policyIssues.join(" "),
    [{ scope: "book", locator: ".book-app", description: "Creation brief and final spread asset policy" }],
    policyIssues.length === 0 ? undefined : "Restore the generated/preserved asset treatment and declared source-photo roles from the ready brief.",
  ));

  return checks;
}

export function creationArtifactIssues(
  documentState: DocumentState,
  creationBrief?: CreationBriefPayload | null,
) {
  return evaluateCreationArtifactQuality(documentState, creationBrief)
    .filter((check) => check.outcome === "blocker")
    .map((check) => check.message);
}

export function evaluateDeterministicQuality(
  documentState: DocumentState,
  renderEvidence: readonly QualityRenderEvidence[],
  creationBrief?: CreationBriefPayload | null,
): QualityCheckResult[] {
  const checks = evaluateCreationArtifactQuality(documentState, creationBrief);

  const currentEvidence = renderEvidence.filter((item) => (
    item.documentId === documentState.id && item.revision === documentState.revision
  ));
  const hasCoverEvidence = currentEvidence.some((item) => item.scope === "cover");
  const missingSpreadEvidence = documentState.spreads.filter((spread) => !currentEvidence.some((item) => (
    item.scope === "spread" && item.spreadId === spread.id
  )));
  const completeEvidence = hasCoverEvidence && missingSpreadEvidence.length === 0;
  checks.push(evidence(
    "render-evidence-completeness",
    completeEvidence ? "pass" : "blocker",
    completeEvidence
      ? "The current revision has rendered cover and spread evidence."
      : `Render evidence is missing for ${hasCoverEvidence ? "" : "the cover"}${!hasCoverEvidence && missingSpreadEvidence.length ? " and " : ""}${missingSpreadEvidence.length ? `${missingSpreadEvidence.length} spread${missingSpreadEvidence.length === 1 ? "" : "s"}` : ""}.`,
    [
      { scope: "cover", locator: "[data-book-id] .library-cover-frame img", description: "Creator shelf cover" },
      ...missingSpreadEvidence.map((spread) => ({
        scope: "spread" as const,
        spreadId: spread.id,
        locator: ".book-scene canvas",
        description: `Spread ${spread.order + 1}: ${spread.title}`,
      })),
    ],
    completeEvidence ? undefined : "Render the cover on the shelf and visit every spread in the current revision before critique.",
  ));
  return checks;
}

function validEvidenceLocation(documentState: DocumentState, value: unknown): value is QualityEvidenceLocation {
  if (!value || typeof value !== "object") return false;
  const location = value as Partial<QualityEvidenceLocation>;
  return ["book", "cover", "spread"].includes(String(location.scope))
    && typeof location.locator === "string"
    && location.locator.trim().length > 0
    && typeof location.description === "string"
    && location.description.trim().length > 0
    && (location.scope !== "spread" || (
      typeof location.spreadId === "string"
      && documentState.spreads.some((spread) => spread.id === location.spreadId)
    ));
}

function visualEvidenceCoversDocument(documentState: DocumentState, check: QualityCheckResult) {
  if (check.criterionId === "cover-appeal") return check.evidence.some((item) => item.scope === "cover");
  const coversEverySpread = documentState.spreads.every((spread) => check.evidence.some((item) => (
    item.scope === "spread" && item.spreadId === spread.id
  )));
  if (coversEverySpread) return true;
  return check.criterionId === "photo-fidelity-integration"
    && !documentState.spreads.some((spread) => Boolean(spread.artwork?.personalSourceAssetId))
    && check.outcome === "note"
    && check.evidence.some((item) => item.scope === "book" && item.locator === "creationBrief.sourceAssets");
}

export function validateVisualReview(
  documentState: DocumentState,
  submission: QualityVisualReviewSubmission,
  expectedRound: number,
): string | null {
  if (!submission || typeof submission !== "object") return "A structured visual critique is required.";
  if (submission.contractVersion !== QUALITY_CONTRACT_VERSION) return `Use quality contract version ${QUALITY_CONTRACT_VERSION}.`;
  if (submission.reviewedRevision !== documentState.revision) return "The critique must inspect the current document revision.";
  if (submission.expectedRound !== expectedRound) return `The next critique round is ${expectedRound}.`;
  if (typeof submission.summary !== "string" || submission.summary.trim().length < 1 || submission.summary.length > 800) return "A concise critique summary is required.";
  if (!Array.isArray(submission.checks)) return "Visual critique checks are required.";
  if (submission.checks.some((check) => !check || typeof check !== "object")) return "Every visual criterion must be a structured result.";
  const byId = new Map(submission.checks.map((check) => [check.criterionId, check]));
  if (byId.size !== submission.checks.length) return "Each visual criterion must be reported exactly once.";
  const missing = QUALITY_VISUAL_CRITERION_IDS.filter((id) => !byId.has(id));
  if (missing.length > 0) return `Visual critique is missing: ${missing.join(", ")}.`;
  const unknown = submission.checks.find((check) => !QUALITY_VISUAL_CRITERION_IDS.includes(check.criterionId));
  if (unknown) return `Visual critique contains unsupported criterion ${unknown.criterionId}.`;
  const invalid = QUALITY_VISUAL_CRITERION_IDS.filter((criterionId) => {
    const check = byId.get(criterionId)!;
    return !["pass", "blocker", "warn", "note"].includes(check.outcome)
      || typeof check.message !== "string"
      || check.message.trim().length < 1
      || check.message.length > 800
      || !Array.isArray(check.evidence)
      || check.evidence.length < 1
      || check.evidence.some((item) => !validEvidenceLocation(documentState, item))
      || !visualEvidenceCoversDocument(documentState, check)
      || (["blocker", "warn"].includes(check.outcome) && (!check.suggestedPatch || check.suggestedPatch.trim().length < 1));
  });
  return invalid.length > 0 ? `Visual criteria are incomplete: ${invalid.join(", ")}.` : null;
}

export function buildQualityReport(
  documentState: DocumentState,
  round: number,
  deterministicChecks: QualityCheckResult[],
  submission: QualityVisualReviewSubmission,
  creationBrief: CreationBriefPayload,
): QualityReport {
  const checks = [...deterministicChecks, ...submission.checks];
  const blockerCount = checks.filter((check) => check.outcome === "blocker").length;
  const warningCount = checks.filter((check) => check.outcome === "warn").length;
  const noteCount = checks.filter((check) => check.outcome === "note").length;
  const sampleReady = submission.sampleReady && blockerCount === 0;
  const status: QualityReportStatus = sampleReady
    ? "ready"
    : round >= QUALITY_REVIEW_MAX_ROUNDS
      ? "needs-user-input"
      : "blocked";
  return {
    contractVersion: QUALITY_CONTRACT_VERSION,
    rubricVersion: QUALITY_CONTRACT_VERSION,
    documentId: documentState.id,
    reviewedRevision: documentState.revision,
    round,
    maxRounds: QUALITY_REVIEW_MAX_ROUNDS,
    creationBrief: structuredClone(creationBrief),
    status,
    checks,
    blockerCount,
    warningCount,
    noteCount,
    warningsRecorded: true,
    sampleReady,
    summary: submission.summary.trim(),
  };
}

type QualityBlockerGroup = {
  message: string;
  suggestedPatch?: string;
  count: number;
};

/**
 * One entry per distinct blocker message, newest evidence folded into the
 * first occurrence.
 *
 * A visual critique records a blocker per criterion per piece of evidence, so
 * one fault - a cover with no legible title - arrives once for the cover and
 * again for every spread that shows it. Listing the raw checks made a single
 * problem look like three, which is both wrong and the most discouraging
 * possible way to be wrong. The repeat count is kept because it is the only
 * information the duplicate entries carried.
 */
export function groupQualityBlockers(checks: readonly QualityCheckResult[] | undefined): QualityBlockerGroup[] {
  const byMessage = new Map<string, QualityBlockerGroup>();
  for (const check of checks ?? []) {
    if (check.outcome !== "blocker") continue;
    const seen = byMessage.get(check.message);
    if (seen) {
      seen.count += 1;
      seen.suggestedPatch ??= check.suggestedPatch;
      continue;
    }
    byMessage.set(check.message, { message: check.message, suggestedPatch: check.suggestedPatch, count: 1 });
  }
  return [...byMessage.values()];
}

export function buildQualityRenderManifest(documentState: DocumentState, pageUrl: string): QualityRenderManifest {
  return {
    contractVersion: QUALITY_CONTRACT_VERSION,
    documentId: documentState.id,
    revision: documentState.revision,
    pageUrl,
    screenshotBoundary: "Rendered evidence proves the frame existed. Use the host browser/screenshot capability for aesthetic judgments; schema alone cannot judge visual quality.",
    cover: {
      assetId: documentState.coverAssetId ?? documentState.coverTextureUrl ?? null,
      evidenceLocator: `[data-book-id="${documentState.id}"] .library-cover-frame img`,
    },
    spreads: documentState.spreads.map((spread) => ({
      id: spread.id,
      order: spread.order + 1,
      title: spread.title,
      body: spread.body,
      finalBaseAssetId: spreadBaseAssetId(spread) ?? null,
      separation: spread.artwork?.separation ?? null,
      sourceAssetId: spread.artwork?.sourceAssetId ?? null,
      personalSourceAssetId: spread.artwork?.personalSourceAssetId ?? null,
      foregroundLayers: spread.elements
        .filter((element) => !isProceduralElement(element))
        .map((element) => ({
          id: element.id,
          label: element.label,
          assetId: element.assetId,
          interaction: hasAuthoredInteraction(element.interaction),
        })),
      evidenceLocator: ".book-scene canvas",
    })),
  };
}

export function qualityGateState(
  documentState: DocumentState,
  lifecycle: AuthoringQualityLifecycle | null,
): QualityGateState {
  if (!lifecycle || !supportedBookType(lifecycle.creationBrief?.bookType)) {
    return {
      status: "needs-review",
      message: "Attach a readiness-passed creation brief before quality review.",
      report: null,
      nextRound: null,
      remainingRounds: QUALITY_REVIEW_MAX_ROUNDS,
    };
  }
  if (lifecycle.creationBrief.contractVersion !== CREATION_READINESS_VERSION) {
    return {
      status: "needs-review",
      message: `Replace the legacy creation brief with contract version ${CREATION_READINESS_VERSION} before quality review.`,
      report: null,
      nextRound: null,
      remainingRounds: QUALITY_REVIEW_MAX_ROUNDS,
    };
  }
  const report = isCurrentQualityReport(lifecycle.report) && lifecycle.report.reviewedRevision === documentState.revision
    ? lifecycle.report
    : null;
  const remainingRounds = Math.max(0, QUALITY_REVIEW_MAX_ROUNDS - lifecycle.reviewRounds);
  if (lifecycle.reviewStatus === "checking" && remainingRounds > 0) {
    return {
      status: "checking",
      message: `Quality check round ${lifecycle.reviewRounds + 1} is in progress.`,
      report,
      nextRound: lifecycle.reviewRounds + 1,
      remainingRounds,
    };
  }
  if (report?.status === "ready") {
    return { status: "ready", message: "Quality review complete. This revision looks ready.", report, nextRound: null, remainingRounds };
  }
  if (lifecycle.reviewRounds >= QUALITY_REVIEW_MAX_ROUNDS) {
    return { status: "needs-user-input", message: "Two review rounds are complete. New source material or a user decision is required.", report, nextRound: null, remainingRounds: 0 };
  }
  if (report) {
    return { status: "blocked", message: "Quality review found optional polish items.", report, nextRound: lifecycle.reviewRounds + 1, remainingRounds };
  }
  return {
    status: "needs-review",
    message: "Run the optional quality review for polish notes.",
    report: null,
    nextRound: lifecycle.reviewRounds + 1,
    remainingRounds,
  };
}
