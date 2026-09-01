import { useLayoutEffect, useRef, useState } from "react";
import { BookOpen, DeviceMobile } from "@phosphor-icons/react";

const PORTRAIT_PHONE_QUERY = "(max-width: 560px) and (orientation: portrait)";

/** Keeps the physical two-page reader large without trapping rotation-locked users. */
export function PortraitOrientationGate() {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useLayoutEffect(() => {
    const portraitPhone = window.matchMedia(PORTRAIT_PHONE_QUERY);
    const sync = () => {
      const gate = dialog.current;
      if (!gate) return;
      if (portraitPhone.matches && !dismissed) {
        if (!gate.open) gate.showModal();
      } else if (gate.open) {
        gate.close();
      }
    };

    // Let any reader/library dialog enter the top layer first, then place this
    // blocking orientation cue above it without a painted intermediate frame.
    queueMicrotask(sync);
    portraitPhone.addEventListener("change", sync);
    return () => {
      portraitPhone.removeEventListener("change", sync);
      if (dialog.current?.open) dialog.current.close();
    };
  }, [dismissed]);

  return (
    <dialog
      ref={dialog}
      className="portrait-orientation-gate"
      aria-labelledby="portrait-orientation-title"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        setDismissed(true);
      }}
      onCancel={(event) => {
        event.preventDefault();
        setDismissed(true);
      }}
    >
      <span className="portrait-orientation-phone" aria-hidden="true">
        <DeviceMobile size={132} weight="regular" />
        <BookOpen className="portrait-orientation-book" size={38} weight="duotone" />
      </span>
      <h1 id="portrait-orientation-title">Rotate to read.</h1>
      <button type="button" onClick={() => setDismissed(true)}>Stay portrait</button>
    </dialog>
  );
}
