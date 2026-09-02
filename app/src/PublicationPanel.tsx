import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowSquareOut,
  Check,
  Copy,
  LinkSimple,
  Prohibit,
  SpinnerGap,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { getPublicationRecord, publishDocument, revokePublication } from "./publishingClient";
import type { PublicationProgress, PublicationRecord } from "./publishingClient";
import { recordDiagnostic } from "./diagnostics";
import { listStoredPublishedAssetIds } from "./projectArtifact";
import type { DocumentState } from "./types";

type Busy = "publishing" | "revoking" | null;

type Props = {
  document: DocumentState;
  record: PublicationRecord | null;
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
  creating: "Preparing this book",
  uploading: "Uploading this book's images",
  publishing: "Opening the share link",
};

const STATUS_COPY = {
  draft: { label: "Not shared", detail: "Only on this device" },
  publishing: { label: "Share interrupted", detail: "Ready to resume" },
  published: { label: "Shared", detail: "Anyone with the link can view" },
  revoked: { label: "Link revoked", detail: "The previous link no longer works" },
  deleting: { label: "Delete interrupted", detail: "Retry permanent deletion" },
} as const;

export function publicationActionDisabled(
  status: PublicationRecord["status"],
  busy: boolean,
) {
  return busy || status === "deleting";
}

type PublicationLauncherPresentation = {
  label: "Share" | "Sharing";
  state: "publishing" | "ready" | "shared";
};

export function publicationLauncherPresentation(
  record: Pick<PublicationRecord, "status" | "publishedRevision"> | null,
  documentRevision: number,
): PublicationLauncherPresentation {
  if (record?.status === "publishing") return { label: "Sharing", state: "publishing" };
  return {
    label: "Share",
    state: record?.status === "published" && record.publishedRevision === documentRevision ? "shared" : "ready",
  };
}

/**
 * Creator-facing publication surface.
 *
 * Publishing hands the current document to the publishing client, which uploads
 * every referenced local blob before the manifest goes public. The creator
 * capability that authorises revoke and delete never leaves that client, so it
 * is never rendered, copied, or written into a URL here.
 */
export function PublicationPanel({ document: documentState, record, onRecordChange, onClose }: Props) {
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState<PublicationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const card = useRef<HTMLDialogElement | null>(null);
  const mountedDocumentId = useRef<string | null>(documentState.id);

  useEffect(() => {
    mountedDocumentId.current = documentState.id;
    return () => { mountedDocumentId.current = null; };
  }, [documentState.id]);

  const status = busy === "publishing" ? "publishing" : record?.status ?? "draft";
  const statusCopy = busy === "publishing"
    ? { label: "Sharing", detail: "Uploading this revision." }
    : STATUS_COPY[status];
  const shareUrl = record?.status === "published" ? record.shareUrl ?? "" : "";
  const stale = record?.status === "published" && record.publishedRevision !== documentState.revision;
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
  }, [busy, record?.status]);

  const publish = useCallback(() => {
    setProgress({ phase: "creating", completed: 0, total: 1 });
    void run("publishing", () => publishDocument(documentState, setProgress), "Apertale could not share this book.");
  }, [documentState, run]);

  const revoke = useCallback(() => {
    if (!record) return;
    void run("revoking", () => revokePublication(record.documentId), "Apertale could not revoke this link.");
  }, [record, run]);

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
        className="agent-card publication-card"
        ref={card}
        aria-labelledby="publication-title"
        onCancel={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        <header>
          <span><LinkSimple size={16} weight="bold" /> Share book</span>
          <button autoFocus onClick={() => onClose()} aria-label="Close sharing panel"><X size={18} /></button>
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

        </div>

        <footer className="publication-actions">
          {status !== "published" && (
            <button className="publication-primary" onClick={publish} disabled={publicationActionDisabled(status, Boolean(busy))}>
              {busy === "publishing" ? <SpinnerGap size={17} weight="bold" className="is-spinning" /> : <UploadSimple size={17} weight="bold" />}
              {busy === "publishing" ? "Sharing" : status === "revoked" ? "Share again" : status === "publishing" ? "Resume sharing" : "Share"}
            </button>
          )}

          {status === "published" && (
            <button className="publication-secondary is-caution" onClick={revoke} disabled={Boolean(busy)}>
              {busy === "revoking" ? <SpinnerGap size={17} weight="bold" className="is-spinning" /> : <Prohibit size={17} />}
              {busy === "revoking" ? "Revoking" : "Revoke link"}
            </button>
          )}

        </footer>
      </dialog>
    </section>
  );
}
