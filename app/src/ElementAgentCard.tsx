import { Check, Copy, Sparkle, X } from "@phosphor-icons/react";
import type { RefObject } from "react";

/**
 * The "Ask Codex about this element" handoff card. Pure presentation: App
 * decides when it is shown, owns the clipboard call, and keeps the dialog
 * ref so it can call `showModal()` at the right moment.
 */
export function ElementAgentCard({
  dialogRef,
  label,
  bookTitle,
  spreadTitle,
  hint,
  prompt,
  copied,
  copyError,
  onCopy,
  onClose,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  label: string;
  bookTitle: string;
  spreadTitle: string;
  hint: string | undefined;
  prompt: string;
  copied: boolean;
  copyError: boolean;
  onCopy: () => void;
  onClose: () => void;
}) {
  return (
    <section className="element-agent-overlay">
      <dialog className="agent-card element-agent-card" ref={dialogRef} aria-labelledby="element-agent-title">
        <header>
          <span><Sparkle size={16} weight="fill" /> Ask Codex about this element</span>
          <button autoFocus onClick={onClose} aria-label="Close Ask Codex handoff"><X size={18} /></button>
        </header>
        <div className="element-agent-body">
          <p>Selected element</p>
          <h2 id="element-agent-title">{label}</h2>
          <span>This keeps the current book and spread. It does not start a new book.</span>
          <dl>
            <div><dt>Book</dt><dd>{bookTitle}</dd></div>
            <div><dt>Spread</dt><dd>{spreadTitle}</dd></div>
            <div><dt>Intent</dt><dd>{hint}</dd></div>
          </dl>
        </div>
        <footer>
          <p>Continue in the Agent conversation beside this page.</p>
          <button className="copy-element-request" onClick={onCopy}>
            {copied ? <Check size={17} weight="bold" /> : <Copy size={17} weight="bold" />}
            {copied ? "Copied — paste in your Agent" : "Copy element request"}
          </button>
          {copyError && (
            <div className="copy-fallback" role="alert">
              <span>Copy was blocked. Select the request below.</span>
              <textarea readOnly value={prompt} onFocus={(event) => event.currentTarget.select()} aria-label="Element request to copy manually" />
            </div>
          )}
        </footer>
      </dialog>
    </section>
  );
}
