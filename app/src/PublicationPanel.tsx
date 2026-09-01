import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowSquareOut,
  Check,
  Copy,
  LinkSimple,
  Prohibit,
  ShieldWarning,
  SpinnerGap,
  Trash,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { deletePublication, getPublicationRecord, publishDocument, revokePublication } from "./publishingClient";
import type { PublicationProgress, PublicationRecord } from "./publishingClient";
import { recordDiagnostic } from "./diagnostics";
import { listStoredPublishedAssetIds } from "./projectArtifact";
import { groupQualityBlockers } from "./qualityContract";
import type { QualityGateState } from "./qualityContract";
import type { DocumentState } from "./types";

type Busy = "publishing" | "revoking" | "deleting" | null;

type Props = {
  document: DocumentState;
  record: PublicationRecord | null;
  qualityGate: QualityGateState;
  onRecordChange: (expectedDocumentId: string, record: PublicationRecord | null) => boolean;
  onClose: (expectedDocumentId?: string) => void;
};

export function commitPublicationRecordIfCurrent(
  activeDocumentId: string,
  expectedDocumentId: string,
  record: PublicationRecord | null,
  commit: (record: PublicationRecord | null) => void,
) {
  if (
    activeDocumentId !== expectedDocumentId
    || (record && record.documentId !== expectedDocumentId)
  ) return false;
  commit(record);
  return true;
}

export function publicationRecordForDocument(
  activeDocumentId: string,
  record: PublicationRecord | null,
) {
  return record?.documentId === activeDocumentId ? record : null;
}

const PROGRESS_COPY: Record<PublicationProgress["phase"], string> = {
  creating: "Creating this book's private record",
  uploading: "Uploading the images this book references",
  publishing: "Publishing the manifest and opening the link",
};

const STATUS_COPY = {
  draft: { label: "Not published", detail: "Local only" },
  publishing: { label: "Publish interrupted", detail: "Ready to resume" },
  published: { label: "Published", detail: "Anyone with the link can view" },
  revoked: { label: "Revoked", detail: "The previous link no longer works" },
  deleting: { label: "Delete interrupted", detail: "Retry permanent deletion" },
} as const;

export function publicationActionDisabled(
  status: PublicationRecord["status"],
  busy: boolean,
  qualityStatus: QualityGateState["status"],
) {
  return busy || status === "deleting" || (status !== "publishing" && qualityStatus !== "ready");
}

type PublicationLauncherPresentation = {
  label: string;
  state: "attention" | "checking" | "publishing" | "ready" | "shared";
};

const QUALITY_LAUNCHER_PRESENTATION = {
  "needs-review": { label: "Review needed", state: "attention" },
  checking: { label: "Reviewing", state: "checking" },
  blocked: { label: "Fix blockers", state: "attention" },
  "needs-user-input": { label: "Needs input", state: "attention" },
  ready: { label: "Publish", state: "ready" },
} as const satisfies Record<QualityGateState["status"], PublicationLauncherPresentation>;

/**
 * Projects the authoritative publication and quality state into the reader's
 * footer. The launcher stays available so blocked creators can inspect the
 * panel, but it never promises that publishing is possible before review.
 */
export function publicationLauncherPresentation(
  record: Pick<PublicationRecord, "status" | "publishedRevision"> | null,
  qualityStatus: QualityGateState["status"],
  documentRevision: number,
): PublicationLauncherPresentation {
  if (record?.status === "published") {
    return record.publishedRevision === documentRevision
      ? { label: "Shared", state: "shared" }
      : { label: "Share outdated", state: "attention" };
  }
  if (record?.status === "publishing") return { label: "Resume publishing", state: "publishing" };
  if (record?.status === "deleting") return { label: "Finish deleting", state: "attention" };
  if (record?.status === "revoked" && qualityStatus === "ready") {
    return { label: "Publish again", state: "ready" };
  }
  return QUALITY_LAUNCHER_PRESENTATION[qualityStatus];
}

/**
 * Creator-facing publication surface.
 *
 * Publishing hands the current document to the publishing client, which uploads
 * every referenced local blob before the manifest goes public. The creator
 * capability that authorises revoke and delete never leaves that client, so it
 * is never rendered, copied, or written into a URL here.
 */
export function PublicationPanel({ document: documentState, record, qualityGate, onRecordChange, onClose }: Props) {
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState<PublicationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const card = useRef<HTMLDialogElement | null>(null);
  const mountedDocumentId = useRef<string | null>(documentState.id);

  useEffect(() => {
    mountedDocumentId.current = documentState.id;
    return () => { mountedDocumentId.current = null; };
  }, [documentState.id]);

  const status = busy === "publishing" ? "publishing" : record?.status ?? "draft";
  const statusCopy = busy === "publishing"
    ? { label: "Publishing", detail: "Uploading and publishing this revision." }
    : STATUS_COPY[status];
  const shareUrl = record?.status === "published" ? record.shareUrl ?? "" : "";
  const stale = record?.status === "published" && record.publishedRevision !== documentState.revision;
  const qualityCopy = qualityGate.status === "ready"
    ? {
        label: qualityGate.report?.warningCount ? "Ready with notes" : "Ready to publish",
        detail: qualityGate.report?.warningCount
          ? `${qualityGate.report.warningCount} warning${qualityGate.report.warningCount === 1 ? "" : "s"} recorded in the critique.`
          : "The current revision passed structural and visual review.",
      }
    : qualityGate.status === "checking"
      ? { label: "Checking quality", detail: qualityGate.message }
      : qualityGate.status === "needs-user-input"
        ? { label: "Needs source material", detail: qualityGate.message }
        : qualityGate.status === "blocked"
          ? { label: "Fix quality blockers", detail: qualityGate.message }
          : { label: "Quality check needed", detail: qualityGate.message };
  // One line per distinct problem; see groupQualityBlockers for why the raw
  // check list repeats itself.
  const qualityBlockers = useMemo(() => groupQualityBlockers(qualityGate.report?.checks), [qualityGate.report]);

  // Only browser-local blobs are uploaded; bundled `/assets/...` references travel
  // inside the manifest. The count comes from the same collector the publishing
  // client uploads from, after resolving shadow cover/spread references and
  // excluding author-only source provenance.
  const localImageCount = useMemo(() => listStoredPublishedAssetIds(documentState).length, [documentState]);

  useEffect(() => {
    if (card.current && !card.current.open) card.current.showModal();
  }, []);

  const run = useCallback(async (kind: Exclude<Busy, null>, work: () => Promise<PublicationRecord | null>, fallback: string) => {
    const operationDocumentId = documentState.id;
    setBusy(kind);
    setError(null);
    setCopied(false);
    setCopyError(null);
    try {
      const next = await work();
      const applied = onRecordChange(operationDocumentId, next);
      recordDiagnostic(`publication:${kind}-succeeded`, { documentId: operationDocumentId, revision: documentState.revision });
      return { applied, record: next };
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : fallback;
      const applied = onRecordChange(operationDocumentId, getPublicationRecord(operationDocumentId));
      if (mountedDocumentId.current === operationDocumentId) setError(message);
      recordDiagnostic(`publication:${kind}-failed`, { documentId: operationDocumentId });
      if (!applied) return { applied: false, record: undefined };
      return undefined;
    } finally {
      if (mountedDocumentId.current === operationDocumentId) {
        setBusy(null);
        setProgress(null);
      }
    }
  }, [documentState.id, documentState.revision, onRecordChange]);

  // Publishing, revoking, and deleting all replace the button that was focused.
  // Once the new state has rendered, hand focus back to a control inside the
  // dialog so the keyboard never lands on the document body.
  useEffect(() => {
    if (busy) return;
    const node = card.current;
    if (!node || node.contains(globalThis.document.activeElement)) return;
    node.querySelector<HTMLButtonElement>("header button")?.focus();
  }, [busy, record?.status, confirmingDelete]);

  const publish = useCallback(() => {
    if (record?.status !== "publishing" && !qualityGate.report?.publishAllowed) return;
    setProgress({ phase: "creating", completed: 0, total: 1 });
    void run("publishing", () => publishDocument(documentState, qualityGate.report, setProgress), "Apertale could not publish this book.");
  }, [documentState, qualityGate.report, record?.status, run]);

  const revoke = useCallback(() => {
    if (!record) return;
    void run("revoking", () => revokePublication(record.documentId), "Apertale could not revoke this link.");
  }, [record, run]);

  const remove = useCallback(() => {
    if (!record) return;
    void run("deleting", async () => {
      await deletePublication(record.documentId);
      return null;
    }, "Apertale could not delete this publication.").then((result) => {
      if (result?.applied && result.record === null) onClose(record.documentId);
    });
  }, [onClose, record, run]);

  /**
   * Success is claimed only after the clipboard write actually resolves. A
   * browser without `navigator.clipboard` (insecure origin) and a denied
   * permission both land in the same recoverable branch: the panel keeps the
   * full URL on screen and selectable, and never says "Link copied".
   */
  const copyLink = useCallback(async () => {
    if (!shareUrl) return;
    try {
      const clipboard = navigator.clipboard;
      if (!clipboard?.writeText) throw new Error("clipboard-unavailable");
      await clipboard.writeText(shareUrl);
      setCopyError(null);
      setCopied(true);
      recordDiagnostic("publication:link-copied", { documentId: documentState.id });
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // A blocked clipboard must not look like a broken publication.
      setCopied(false);
      setCopyError("This browser blocked the clipboard. The link above is complete — select it and copy manually.");
      recordDiagnostic("publication:link-copy-blocked", { documentId: documentState.id });
    }
  }, [documentState.id, shareUrl]);

  return (
    <section className="publication-overlay">
      <dialog
        className="publication-card"
        ref={card}
        aria-labelledby="publication-title"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) onClose();
        }}
      >
        <header>
          <span><LinkSimple size={16} weight="bold" /> Publish &amp; share</span>
          <button autoFocus onClick={() => onClose()} aria-label="Close publishing panel" disabled={Boolean(busy)}><X size={18} /></button>
        </header>

        <div className="publication-body">
          <p className={`publication-status is-${status}`}><i aria-hidden="true" />{statusCopy.label}</p>
          <h2 id="publication-title">{documentState.title}</h2>
          <span className="publication-lede">
            {statusCopy.detail}
            {status !== "published" && (localImageCount === 0
              ? ` · revision ${documentState.revision}`
              : ` · ${localImageCount} image${localImageCount === 1 ? "" : "s"} · revision ${documentState.revision}`)}
          </span>

          {status !== "published" && status !== "deleting" && (
            <div className={`publication-quality is-${qualityGate.status}`} role="status" aria-live="polite">
              {qualityGate.status === "checking"
                ? <SpinnerGap size={17} weight="bold" className="is-spinning" />
                : qualityGate.status === "ready"
                  ? <Check size={17} weight="bold" />
                  : <WarningCircle size={17} weight="fill" />}
              <div><strong>{qualityCopy.label}</strong><span>{qualityCopy.detail}</span></div>
            </div>
          )}

          {status !== "published" && qualityBlockers.length > 0 && (
            <ul className="publication-quality-findings" aria-label="Quality blockers">
              {qualityBlockers.slice(0, 3).map((finding) => (
                <li key={finding.message}>
                  <strong>{finding.message}{finding.count > 1 ? ` (${finding.count}×)` : ""}</strong>
                  {finding.suggestedPatch && <span>{finding.suggestedPatch}</span>}
                </li>
              ))}
              {/* Say what is not shown rather than letting three lines imply
                  three problems is all there is. */}
              {qualityBlockers.length > 3 && (
                <li className="publication-quality-more">
                  <strong>{qualityBlockers.length - 3} more blocker{qualityBlockers.length - 3 === 1 ? "" : "s"} in the critique</strong>
                </li>
              )}
            </ul>
          )}

          {shareUrl && (
            <div className="publication-link">
              <p className="publication-link-label">Public link</p>
              <p className="publication-link-url" data-testid="publication-share-url">{shareUrl}</p>
              <div className="publication-link-actions">
                <button className="publication-primary" onClick={() => void copyLink()}>
                  {copied ? <Check size={16} weight="bold" /> : <Copy size={16} weight="bold" />}
                  {copied ? "Link copied" : "Copy link"}
                </button>
                <a className="publication-secondary" href={shareUrl} target="_blank" rel="noreferrer noopener">
                  <ArrowSquareOut size={16} /> Open reader
                </a>
              </div>
              {copyError && (
                <p className="publication-copy-error" role="alert" data-testid="publication-copy-error">
                  <WarningCircle size={15} weight="fill" /><span>{copyError}</span>
                </p>
              )}
            </div>
          )}

          {stale && (
            <p className="publication-notice is-stale" role="status">
              <WarningCircle size={16} weight="fill" />
              <span>
                You edited this book after publishing revision {record?.publishedRevision}. The public link still shows the old
                revision. Revoke it first, then publish again to share revision {documentState.revision}.
              </span>
            </p>
          )}

          {busy === "publishing" && (
            <div className="publication-progress" role="status" aria-live="polite">
              <p><SpinnerGap size={16} weight="bold" className="is-spinning" /> {PROGRESS_COPY[progress?.phase ?? "creating"]}</p>
              <div className="publication-progress-track" aria-hidden="true">
                <i style={{ width: `${Math.round(((progress?.completed ?? 0) / Math.max(1, progress?.total ?? 1)) * 100)}%` }} />
              </div>
              <small>{progress?.completed ?? 0} of {Math.max(1, progress?.total ?? 1)} in this step</small>
            </div>
          )}

          {error && <p className="publication-notice is-error" role="alert"><WarningCircle size={16} weight="fill" /><span>{error}</span></p>}

          <ul className="publication-disclosures">
            <li>
              <ShieldWarning size={16} weight="fill" />
              <span><strong>Public link</strong>Anyone with it can view.</span>
            </li>
            <li>
              <ShieldWarning size={16} weight="fill" />
              <span><strong>This browser</strong>Keep it to revoke or delete.</span>
            </li>
            <li>
              <ShieldWarning size={16} weight="fill" />
              <span><strong>Your photos</strong>Share only with permission.</span>
            </li>
          </ul>
        </div>

        <footer className="publication-actions">
          {status !== "published" && (
            <button className="publication-primary" onClick={publish} disabled={publicationActionDisabled(status, Boolean(busy), qualityGate.status)}>
              {busy === "publishing" ? <SpinnerGap size={17} weight="bold" className="is-spinning" /> : <UploadSimple size={17} weight="bold" />}
              {busy === "publishing" ? "Publishing" : status === "revoked" ? "Publish again" : status === "publishing" ? "Resume publishing" : "Publish and share"}
            </button>
          )}

          {status === "published" && (
            <button className="publication-secondary is-caution" onClick={revoke} disabled={Boolean(busy)}>
              {busy === "revoking" ? <SpinnerGap size={17} weight="bold" className="is-spinning" /> : <Prohibit size={17} />}
              {busy === "revoking" ? "Revoking" : "Revoke link"}
            </button>
          )}

          {record && !confirmingDelete && (
            <button className="publication-danger" onClick={() => setConfirmingDelete(true)} disabled={Boolean(busy)}>
              <Trash size={17} /> Delete permanently
            </button>
          )}

          {record && confirmingDelete && (
            <div className="publication-confirm" role="alertdialog" aria-label="Confirm permanent delete">
              <p><strong>Delete this publication?</strong> Removes the link, uploaded images, and server record. This cannot be undone.</p>
              <div>
                <button className="publication-secondary" onClick={() => setConfirmingDelete(false)} disabled={Boolean(busy)}>Keep it</button>
                <button className="publication-danger" onClick={remove} disabled={Boolean(busy)}>
                  {busy === "deleting" ? <SpinnerGap size={17} weight="bold" className="is-spinning" /> : <Trash size={17} weight="fill" />}
                  {busy === "deleting" ? "Deleting" : "Delete forever"}
                </button>
              </div>
            </div>
          )}
        </footer>
      </dialog>
    </section>
  );
}
