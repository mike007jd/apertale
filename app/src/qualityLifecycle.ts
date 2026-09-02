/**
 * Authoring quality lifecycle: the brief attached to a personal book, its
 * current-revision render evidence, and the bounded critique rounds.
 *
 * These are pure decisions over the persisted lifecycle store. BookEngine
 * owns the store, the document, persistence, and the visible action strip;
 * it calls in here and commits when `changed` says the store moved.
 * Keeping the rules out of the engine makes them testable without localStorage
 * or cross-tab locks and keeps bookEngine.ts about documents and undo.
 */
import { CREATION_READINESS_VERSION, assessCreationReadiness, type CreationBriefPayload } from "./authoringContract";
import {
  QUALITY_REVIEW_MAX_ROUNDS,
  buildQualityReport,
  evaluateDeterministicQuality,
  isCurrentQualityReport,
  qualityGateState,
  validateVisualReview,
  type AuthoringQualityLifecycle,
  type QualityRenderEvidence,
  type QualityVisualReviewSubmission,
} from "./qualityContract";
import { MAX_BOOK_SPREADS, THEME_IDS, type DocumentState } from "./types";

type QualityLifecycleStore = Record<string, AuthoringQualityLifecycle>;

/**
 * Every render-evidence identity a fully rendered book can hold at one
 * revision: each spread on both themes across the WebGL and fallback
 * surfaces, plus a shelf cover per theme. Bounding the buffer at this derived
 * size keeps storage bounded while a complete 12-spread book can never evict
 * genuine current-revision evidence.
 */
const RENDER_EVIDENCE_LIMIT = MAX_BOOK_SPREADS * THEME_IDS.length * 2 + THEME_IDS.length;

const renderEvidenceKey = (item: QualityRenderEvidence) => `${item.scope}:${item.spreadId ?? ""}:${item.theme}:${item.surface}`;

function ensureQualityLifecycle(store: QualityLifecycleStore, documentId: string) {
  return store[documentId] ??= {
    creationBrief: {},
    reviewRounds: 0,
    reviewStatus: "needs-review",
    renderEvidence: [],
  };
}

const gate = (store: QualityLifecycleStore, document: DocumentState) => qualityGateState(document, store[document.id] ?? null);

/** A rejected call: the store is untouched and the result names why. */
const refuse = <Code extends string, Extra extends object = Record<never, never>>(document: DocumentState, code: Code, summary: string, extra?: Extra) => ({
  changed: false as const,
  result: { ok: false as const, code, currentRevision: document.revision, summary, ...(extra ?? {} as Extra) },
});

/** A successful call that did not need to move the store. */
const unchanged = <Result>(result: Result) => ({ changed: false as const, result });

export function adoptCreationBrief(
  store: QualityLifecycleStore,
  document: DocumentState,
  isSample: boolean,
  creationBrief: CreationBriefPayload,
  validatedSourceAssetIds: string[],
  expectedRevision: number,
  assetRoleIssues: readonly string[],
) {
  if (expectedRevision !== document.revision) {
    return refuse(document, "revision_conflict", `Expected revision ${expectedRevision}; refresh creation-readiness before attaching the brief.`);
  }
  if (isSample) {
    return refuse(document, "invalid", "Curated samples keep their shipped provenance and cannot adopt a personal creation brief.");
  }
  const existing = store[document.id];
  if (existing?.creationBrief?.bookType && existing.creationBrief.contractVersion === CREATION_READINESS_VERSION) {
    return refuse(document, "creation_brief_already_attached", "This book already has its immutable creation brief.");
  }
  if (assetRoleIssues.length > 0) {
    return refuse(document, "creation_artifact_incomplete", "This legacy book contains assets whose stored roles do not match their reader-facing use.", { issues: [...assetRoleIssues] });
  }
  const readiness = assessCreationReadiness(creationBrief, {
    expectedSpreadCount: document.spreads.length,
    validatedSourceAssetIds,
  });
  if (!readiness.ready) {
    return refuse(document, "creation_not_ready", "This legacy book needs a complete creation brief before quality review.", { readiness });
  }
  store[document.id] = {
    creationBrief: structuredClone(creationBrief),
    reviewRounds: 0,
    reviewStatus: "needs-review",
    renderEvidence: [],
  };
  return {
    changed: true as const,
    result: {
      ok: true as const,
      currentRevision: document.revision,
      summary: "Attached the ready creation brief. Render this revision before critique.",
      qualityGate: gate(store, document),
    },
  };
}

export function beginQualityReview(store: QualityLifecycleStore, document: DocumentState, expectedRevision?: number) {
  const currentRevision = document.revision;
  if (typeof expectedRevision === "number" && expectedRevision !== currentRevision) {
    return refuse(document, "revision_conflict", `Expected revision ${expectedRevision}; refresh quality-review before starting critique.`);
  }
  const lifecycle = ensureQualityLifecycle(store, document.id);
  const gated = { qualityGate: gate(store, document) };
  if (lifecycle.creationBrief?.bookType && lifecycle.creationBrief.contractVersion !== CREATION_READINESS_VERSION) {
    return refuse(document, "creation_brief_upgrade_required", `Replace the legacy creation brief with contract version ${CREATION_READINESS_VERSION} before starting quality review.`, gated);
  }
  if (!lifecycle.creationBrief?.bookType) {
    return refuse(document, "creation_brief_required", "Attach a readiness-passed creation brief before starting quality review.", gated);
  }
  const remainingRounds = QUALITY_REVIEW_MAX_ROUNDS - lifecycle.reviewRounds;
  if (
    isCurrentQualityReport(lifecycle.report)
    && lifecycle.report.status === "ready"
    && lifecycle.report.reviewedRevision === currentRevision
  ) {
    return unchanged({ ok: true as const, currentRevision, alreadyReviewed: true, nextRound: null, remainingRounds });
  }
  if (lifecycle.reviewStatus === "checking") {
    return unchanged({ ok: true as const, currentRevision, nextRound: lifecycle.reviewRounds + 1, remainingRounds });
  }
  if (lifecycle.reviewRounds >= QUALITY_REVIEW_MAX_ROUNDS && lifecycle.report?.status !== "ready") {
    return refuse(document, "quality_review_limit", "Two quality review rounds are complete. Ask for new material or a user decision.", gated);
  }
  if (lifecycle.report && lifecycle.report.status !== "ready" && lifecycle.report.reviewedRevision === currentRevision) {
    return refuse(document, "quality_patch_required", "Apply the suggested patches before starting the next quality review round.", gated);
  }
  lifecycle.reviewStatus = "checking";
  return {
    changed: true as const,
    result: { ok: true as const, currentRevision, nextRound: lifecycle.reviewRounds + 1, remainingRounds },
  };
}

/** Returns false when the evidence is stale or names an unknown spread. */
export function recordRenderEvidence(
  store: QualityLifecycleStore,
  document: DocumentState,
  input: Omit<QualityRenderEvidence, "renderedAt">,
) {
  if (input.revision !== document.revision) return false;
  if (input.scope === "spread" && !document.spreads.some((spread) => spread.id === input.spreadId)) return false;
  const lifecycle = ensureQualityLifecycle(store, document.id);
  const next: QualityRenderEvidence = { ...input, renderedAt: new Date().toISOString() };
  const nextKey = renderEvidenceKey(next);
  // Drop stale-revision history and the entry this render supersedes, keyed
  // by evidence identity so WebGL and fallback evidence for the same spread
  // coexist without evicting each other.
  lifecycle.renderEvidence = [
    ...lifecycle.renderEvidence.filter((item) => item.revision === document.revision && renderEvidenceKey(item) !== nextKey),
    next,
  ].slice(-RENDER_EVIDENCE_LIMIT);
  if (
    lifecycle.report?.reviewedRevision === document.revision
    && lifecycle.report.status !== "ready"
    && lifecycle.report.checks.some((check) => (
      check.criterionId === "render-evidence-completeness" && check.outcome === "blocker"
    ))
    && evaluateDeterministicQuality(document, lifecycle.renderEvidence, lifecycle.creationBrief).some((check) => (
      check.criterionId === "render-evidence-completeness" && check.outcome === "pass"
    ))
  ) {
    lifecycle.reviewStatus = "needs-review";
    delete lifecycle.report;
  }
  return true;
}

export function recordQualityReview(
  store: QualityLifecycleStore,
  document: DocumentState,
  submission: QualityVisualReviewSubmission,
  expectedRevision?: number,
) {
  const currentRevision = document.revision;
  if (typeof expectedRevision === "number" && expectedRevision !== currentRevision) {
    return refuse(document, "revision_conflict", `Expected revision ${expectedRevision}; refresh quality-review before recording critique.`);
  }
  const lifecycle = ensureQualityLifecycle(store, document.id);
  const nextRound = lifecycle.reviewRounds + 1;
  const gated = { qualityGate: gate(store, document) };
  if (lifecycle.reviewStatus !== "checking") {
    return refuse(document, "quality_review_not_started", "Start the quality review before recording the visual critique.", gated);
  }
  if (nextRound > QUALITY_REVIEW_MAX_ROUNDS) {
    return refuse(document, "quality_review_limit", "Two quality review rounds are complete. Ask for new material or a user decision.", gated);
  }
  if (lifecycle.report && lifecycle.report.status !== "ready" && lifecycle.report.reviewedRevision === currentRevision) {
    return refuse(document, "quality_patch_required", "Apply the suggested patches before recording the next quality review round.", gated);
  }
  const invalid = validateVisualReview(document, submission, nextRound);
  if (invalid) return refuse(document, "invalid_quality_review", invalid, gated);
  const deterministic = evaluateDeterministicQuality(document, lifecycle.renderEvidence, lifecycle.creationBrief);
  const renderEvidenceBlocker = deterministic.find((check) => (
    check.criterionId === "render-evidence-completeness" && check.outcome === "blocker"
  ));
  if (renderEvidenceBlocker) return refuse(document, "render_evidence_required", renderEvidenceBlocker.message, gated);
  const report = buildQualityReport(document, nextRound, deterministic, submission, lifecycle.creationBrief);
  lifecycle.reviewRounds = nextRound;
  lifecycle.reviewStatus = report.status;
  lifecycle.report = report;
  return {
    changed: true as const,
    action: report.status === "ready"
      ? "Quality review complete — this revision looks ready"
      : report.status === "needs-user-input"
        ? "Quality review complete — new material or a decision could improve it"
        : "Quality review recorded — polish notes are available",
    result: {
      ok: true as const,
      currentRevision,
      qualityReport: structuredClone(report),
      qualityGate: gate(store, document),
    },
  };
}
