import { useEffect } from "react";
import type { RefObject } from "react";

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab focus inside one open dialog. Disabled and hidden controls stay
 * skipped so a busy or partially rendered dialog never traps focus on them,
 * and wrap-around restores the first/last control ordering unchanged.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const node = ref.current;
    if (!enabled || !node) return undefined;
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = [...node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
        .filter((control) => !control.hasAttribute("disabled") && !control.hasAttribute("hidden"));
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    node.addEventListener("keydown", keepFocusInside);
    return () => node.removeEventListener("keydown", keepFocusInside);
  }, [ref, enabled]);
}
