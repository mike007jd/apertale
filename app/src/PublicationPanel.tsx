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
import { collectLocalAssetIds, deletePublication, getPublicationRecord, publishDocument, revokePublication } from "./publishingClient";
import type { PublicationProgress, PublicationRecord } from "./publishingClient";
import { recordDiagnostic } from "./diagnostics";
import type { DocumentState } from "./types";

type Busy = "publishing" | "revoking" | "deleting" | null;

type Props = {
  document: DocumentState;
  record: PublicationRecord | null;
  onRecordChange: (record: PublicationRecord | null) => void;
  onClose: () => void;
};

const PROGRESS_COPY: Record<PublicationProgress["phase"], string> = {
  creating: "Creating this book's private record",
  uploading: "Uploading the images this book references",
  publishing: "Publishing the manifest and opening the link",
};

const STATUS_COPY = {
  draft: { label: "Not published", detail: "This book only exists in this browser." },
  publishing: { label: "Publish interrupted", detail: "Your progress is saved in this browser. Resume to finish opening the link." },
  published: { label: "Published", detail: "Anyone holding the link can open this book." },
  revoked: { label: "Revoked", detail: "The previous link is dead. Nothing public remains." },
} as const;

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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const card = useRef<HTMLDivElement | null>(null);

  const status = busy === "publishing" ? "publishing" : record?.status ?? "draft";
  const statusCopy = busy === "publishing"
    ? { label: "Publishing", detail: "Uploading and publishing this revision." }
    : STATUS_COPY[status];
  const shareUrl = record?.status === "published" ? record.shareUrl ?? "" : "";
  const stale = record?.status === "published"
    && typeof record.publishedRevision === "number"
    && record.publishedRevision !== documentState.revision;

  // Only browser-local blobs are uploaded; bundled `/assets/...` references travel
  // inside the manifest. The count comes from the same collector the publishing
  // client uploads from — including a browser-local `spread.textureUrl` — so the
  // disclosure can never promise fewer images than actually leave this browser.
  const localImageCount = useMemo(() => collectLocalAssetIds(documentState).length, [documentState]);

  // Escape listens on the window, not the card: a completed publish, revoke, or
  // delete can remove the button that had focus, and the dialog must still close.
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [busy, onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = [...(card.current?.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])') ?? [])]
        .filter((control) => !control.hasAttribute("disabled"));
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls.at(-1)!;
      if (event.shiftKey && globalThis.document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && globalThis.document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const node = card.current;
    node?.addEventListener("keydown", onKeyDown);
    return () => node?.removeEventListener("keydown", onKeyDown);
  }, []);

  const run = useCallback(async (kind: Exclude<Busy, null>, work: () => Promise<PublicationRecord | null>, fallback: string) => {
    setBusy(kind);
    setError(null);
    setCopied(false);
    setCopyError(null);
    try {
      const next = await work();
      onRecordChange(next);
      recordDiagnostic(`publication:${kind}-succeeded`, { documentId: documentState.id, revision: documentState.revision });
      return next;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : fallback;
      setError(message);
      onRecordChange(getPublicationRecord(documentState.id));
      recordDiagnostic(`publication:${kind}-failed`, { documentId: documentState.id });
      return undefined;
    } finally {
      setBusy(null);
      setProgress(null);
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
    setProgress({ phase: "creating", completed: 0, total: 1 });
    void run("publishing", () => publishDocument(documentState, setProgress), "Apertale could not publish this book.");
  }, [documentState, run]);

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
      if (result === null) onClose();
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
    <section className="publication-overlay" role="dialog" aria-modal="true" aria-labelledby="publication-title">
      <div className="publication-card" ref={card}>
        <header>
          <span><LinkSimple size={16} weight="bold" /> Publish &amp; share</span>
          <button autoFocus onClick={onClose} aria-label="Close publishing panel" disabled={Boolean(busy)}><X size={18} /></button>
        </header>

        <div className="publication-body">
          <p className={`publication-status is-${status}`}><i aria-hidden="true" />{statusCopy.label}</p>
          <h2 id="publication-title">{documentState.title}</h2>
          <span className="publication-lede">
            {statusCopy.detail}
            {status !== "published" && (localImageCount === 0
              ? ` Publishing uploads revision ${documentState.revision} of the manifest; this book references no browser-stored images.`
              : ` Publishing uploads ${localImageCount} browser-stored image${localImageCount === 1 ? "" : "s"} and revision ${documentState.revision} of the manifest.`)}
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

          <ul className="publication-disclosures">
            <li>
              <ShieldWarning size={16} weight="fill" />
              <span><strong>Anyone with the link can view this book.</strong> There is no sign-in and it is not a private album. Treat the link itself as the permission.</span>
            </li>
            <li>
              <ShieldWarning size={16} weight="fill" />
              <span><strong>The creator capability stays in this browser.</strong> It is required to revoke or delete later and cannot be recovered. Clearing this browser's storage or using another device ends your ability to manage this publication.</span>
            </li>
            <li>
              <ShieldWarning size={16} weight="fill" />
              <span><strong>Review permission for every personal photo.</strong> Faces, names, and locations in your images become publicly readable. Do not publish photos you are not entitled to share.</span>
            </li>
          </ul>
        </div>

        <footer className="publication-actions">
          {status !== "published" && (
            <button className="publication-primary" onClick={publish} disabled={Boolean(busy)}>
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
              <p><strong>Delete this publication permanently?</strong> The public link, the uploaded images, and the published record are destroyed. This cannot be undone and the book cannot be restored from the server.</p>
              <div>
                <button className="publication-secondary" onClick={() => setConfirmingDelete(false)} disabled={Boolean(busy)}>Cancel deletion</button>
                <button className="publication-danger" onClick={remove} disabled={Boolean(busy)}>
                  {busy === "deleting" ? <SpinnerGap size={17} weight="bold" className="is-spinning" /> : <Trash size={17} weight="fill" />}
                  {busy === "deleting" ? "Deleting" : "Yes, delete permanently"}
                </button>
              </div>
            </div>
          )}
        </footer>
      </div>
    </section>
  );
}
