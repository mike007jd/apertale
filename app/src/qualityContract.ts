import qualityRubricSource from "../worker/qualityRubric.json";
import {
  CREATION_BOOK_TYPES,
  assessCreationReadiness,
  creationBriefSourceAssetIds,
  type CreationBookType,
  type CreationBriefPayload,
} from "./authoringContract";
import type { DocumentState, ThemeId } from "./types";

export const QUALITY_CONTRACT_VERSION = 1 as const;
export const QUALITY_RUBRIC_VERSION = 1 as const;
export const QUALITY_REVIEW_MAX_ROUNDS = 2 as const;

export type QualityCriterionMode = "deterministic" | "visual" | "both";
export type QualityCriterion = {
  id: string;
  label: string;
  mode: QualityCriterionMode;
  description: string;
};

export type QualityRubric = {
  id: string;
  version: typeof QUALITY_RUBRIC_VERSION;
  maxReviewRounds: typeof QUALITY_REVIEW_MAX_ROUNDS;
  spreadAssetPolicies: Record<CreationBookType, {
    separation: "inpainted-clean-plate" | "preserved-photo-layout";
    sourceUse: "reference-and-compose" | "preserve-original-layout";
    requiresPersonalSourceAsset: boolean;
  }>;
  criteria: QualityCriterion[];
};

export const QUALITY_RUBRIC = Object.freeze(qualityRubricSource) as QualityRubric;
if (QUALITY_RUBRIC.version !== QUALITY_RUBRIC_VERSION || QUALITY_RUBRIC.maxReviewRounds !== QUALITY_REVIEW_MAX_ROUNDS) {
  throw new TypeError("Invalid Apertale quality rubric version.");
}

export type QualitySeverity = "blocker" | "warn" | "note";
export type QualityOutcome = "pass" | QualitySeverity;

export type QualityEvidenceLocation = {
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

export type QualityCheckResult = {
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

export type QualityReportStatus = "ready" | "blocked" | "needs-user-input";

export type QualityReport = {
  contractVersion: typeof QUALITY_CONTRACT_VERSION;
  rubricVersion: typeof QUALITY_RUBRIC_VERSION;
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
  publishAllowed: boolean;
  summary: string;
};

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

export type QualityRenderManifest = {
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

function criterion(id: string) {
  const found = QUALITY_RUBRIC.criteria.find((item) => item.id === id);
  if (!found) throw new TypeError(`Unknown quality criterion ${id}.`);
  return found;
}

function supportedBookType(value: unknown): value is CreationBookType {
  return typeof value === "string" && (CREATION_BOOK_TYPES as readonly string[]).includes(value);
}

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
  if (documentState.coverAssetId && sourceIds.has(documentState.coverAssetId)) issues.push("A personal source photo cannot replace the dedicated cover.");
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

export const QUALITY_DETERMINISTIC_CRITERION_IDS = Object.freeze(
  QUALITY_RUBRIC.criteria.filter((item) => item.mode !== "visual").map((item) => item.id),
);

const evidence = (
  criterionId: string,
  outcome: QualityOutcome,
  message: string,
  locations: QualityEvidenceLocation[],
  suggestedPatch?: string,
): QualityCheckResult => ({
  criterionId: criterion(criterionId).id,
  outcome,
  message,
  evidence: locations,
  ...(suggestedPatch ? { suggestedPatch } : {}),
});

function elementHasMeaningfulInteraction(element: DocumentState["spreads"][number]["elements"][number]) {
  const interaction = element.interaction;
  return Boolean(
    element.motion
    || (interaction && (
      interaction.hover !== "none"
      || interaction.focus !== "none"
      || interaction.reveal.kind !== "none"
    )),
  );
}

function meaningfulInteraction(documentState: DocumentState, spreadId: string) {
  const spread = documentState.spreads.find((item) => item.id === spreadId);
  return Boolean(spread?.elements.some(elementHasMeaningfulInteraction));
}

export function evaluateDeterministicQuality(
  documentState: DocumentState,
  renderEvidence: readonly QualityRenderEvidence[],
  creationBrief?: CreationBriefPayload | null,
): QualityCheckResult[] {
  const checks: QualityCheckResult[] = [];
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

    const foreground = spread.elements.filter((element) => !element.assetId.startsWith("procedural:"));
    const layered = Boolean(cleanPlate) && foreground.length >= 2 && foreground.length <= 4;
    checks.push(evidence(
      "layered-spread-contract",
      layered ? "pass" : "blocker",
      layered
        ? `Spread ${spread.order + 1} has one final base and ${foreground.length} foreground layers.`
        : `Spread ${spread.order + 1} needs one final base and 2–4 foreground layers; found ${foreground.length}.`,
      [spreadLocation],
      layered ? undefined : "Prepare the generated clean plate or preserved-photo final base and add 2–4 true-alpha foreground or interactive layers.",
    ));

    const hasInteraction = meaningfulInteraction(documentState, spread.id);
    checks.push(evidence(
      "meaningful-interaction",
      hasInteraction ? "pass" : "blocker",
      hasInteraction ? `Spread ${spread.order + 1} has an authored interaction.` : `Spread ${spread.order + 1} has no authored interaction.`,
      [spreadLocation],
      hasInteraction ? undefined : "Add a spread-specific reveal, focus response, or story-relevant motion.",
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

  const policyIssues = creationAssetPolicyIssues(documentState, creationBrief);
  checks.push(evidence(
    "creation-asset-policy",
    policyIssues.length === 0 ? "pass" : "blocker",
    policyIssues.length === 0 ? "Every spread follows the ready creation asset policy." : policyIssues.join(" "),
    [{ scope: "book", locator: ".book-app", description: "Creation brief and final spread asset policy" }],
    policyIssues.length === 0 ? undefined : "Restore the generated/preserved asset treatment and declared source-photo roles from the ready brief.",
  ));

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
  return documentState.spreads.every((spread) => check.evidence.some((item) => (
    item.scope === "spread" && item.spreadId === spread.id
  )));
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
  const invalid = submission.checks.find((check) => (
    !["pass", "blocker", "warn", "note"].includes(check.outcome)
    || typeof check.message !== "string"
    || check.message.trim().length < 1
    || check.message.length > 800
    || !Array.isArray(check.evidence)
    || check.evidence.length < 1
    || check.evidence.some((item) => !validEvidenceLocation(documentState, item))
    || !visualEvidenceCoversDocument(documentState, check)
    || (["blocker", "warn"].includes(check.outcome) && (!check.suggestedPatch || check.suggestedPatch.trim().length < 1))
  ));
  return invalid ? `Visual criterion ${invalid.criterionId} is incomplete.` : null;
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
  const publishAllowed = sampleReady && blockerCount === 0;
  const status: QualityReportStatus = publishAllowed
    ? "ready"
    : round >= QUALITY_REVIEW_MAX_ROUNDS
      ? "needs-user-input"
      : "blocked";
  return {
    contractVersion: QUALITY_CONTRACT_VERSION,
    rubricVersion: QUALITY_RUBRIC_VERSION,
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
    publishAllowed,
    summary: submission.summary.trim(),
  };
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
      finalBaseAssetId: spread.artwork?.cleanPlateAssetId ?? null,
      separation: spread.artwork?.separation ?? null,
      sourceAssetId: spread.artwork?.sourceAssetId ?? null,
      personalSourceAssetId: spread.artwork?.personalSourceAssetId ?? null,
      foregroundLayers: spread.elements
        .filter((element) => !element.assetId.startsWith("procedural:"))
        .map((element) => ({
          id: element.id,
          label: element.label,
          assetId: element.assetId,
          interaction: elementHasMeaningfulInteraction(element),
        })),
      evidenceLocator: ".book-scene canvas",
    })),
  };
}

export function qualityGateState(
  documentState: DocumentState,
  lifecycle: AuthoringQualityLifecycle | null,
): QualityGateState {
  if (!lifecycle) {
    return {
      status: "needs-review",
      message: "Attach a readiness-passed creation brief before quality review.",
      report: null,
      nextRound: null,
      remainingRounds: QUALITY_REVIEW_MAX_ROUNDS,
    };
  }
  if (!supportedBookType(lifecycle.creationBrief?.bookType)) {
    return {
      status: "needs-review",
      message: "Attach a readiness-passed creation brief before quality review.",
      report: null,
      nextRound: null,
      remainingRounds: QUALITY_REVIEW_MAX_ROUNDS,
    };
  }
  const report = lifecycle.report && lifecycle.report.reviewedRevision === documentState.revision
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
  if (report?.publishAllowed) {
    return { status: "ready", message: "Quality check passed. This revision is ready to publish.", report, nextRound: null, remainingRounds };
  }
  if (lifecycle.reviewRounds >= QUALITY_REVIEW_MAX_ROUNDS) {
    return { status: "needs-user-input", message: "Two review rounds are complete. New source material or a user decision is required.", report, nextRound: null, remainingRounds: 0 };
  }
  if (report) {
    return { status: "blocked", message: "Quality blockers must be fixed before publishing.", report, nextRound: lifecycle.reviewRounds + 1, remainingRounds };
  }
  return {
    status: "needs-review",
    message: "Run the quality check before publishing this revision.",
    report: null,
    nextRound: lifecycle.reviewRounds + 1,
    remainingRounds,
  };
}

export function assertPublishableQuality(documentState: DocumentState, report: QualityReport | null | undefined) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const blockerCount = checks.filter((check) => check.outcome === "blocker").length;
  const warningCount = checks.filter((check) => check.outcome === "warn").length;
  const noteCount = checks.filter((check) => check.outcome === "note").length;
  const missingCriteria = QUALITY_RUBRIC.criteria.some((criterion) => !checks.some((check) => check.criterionId === criterion.id));
  const invalidEvidence = checks.some((check) => (
    !Array.isArray(check.evidence)
    || check.evidence.length < 1
    || check.evidence.some((item) => !validEvidenceLocation(documentState, item))
  ));
  const missingVisualCoverage = QUALITY_VISUAL_CRITERION_IDS.some((criterionId) => {
    const evidence = checks
      .filter((check) => check.criterionId === criterionId)
      .flatMap((check) => Array.isArray(check.evidence) ? check.evidence : []);
    return !visualEvidenceCoversDocument(documentState, {
      criterionId,
      outcome: "pass",
      message: "coverage",
      evidence,
    });
  });
  if (
    !report
    || report.contractVersion !== QUALITY_CONTRACT_VERSION
    || report.rubricVersion !== QUALITY_RUBRIC_VERSION
    || report.documentId !== documentState.id
    || report.reviewedRevision !== documentState.revision
    || report.round < 1
    || report.round > QUALITY_REVIEW_MAX_ROUNDS
    || missingCriteria
    || invalidEvidence
    || missingVisualCoverage
    || creationAssetPolicyIssues(documentState, report.creationBrief).length > 0
    || report.blockerCount !== blockerCount
    || report.warningCount !== warningCount
    || report.noteCount !== noteCount
    || blockerCount !== 0
    || !report.warningsRecorded
    || !report.sampleReady
    || !report.publishAllowed
  ) {
    throw new Error("This revision has not passed the Apertale quality gate.");
  }
}
