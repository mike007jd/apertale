/**
 * The three interaction primitives.
 *
 * Before these existed, 63 controls were hand-styled bare elements: 8 had any
 * transition at all, 9 changed on hover with no transition declared so the
 * change snapped, and 16 had no hover, active or focus state whatsoever. There
 * was no single place to fix that, which is why it had never been fixed.
 *
 * Two rules govern everything here:
 *
 * 1. Every interactive element has four states — hover, press, focus-visible,
 *    disabled. Not three. A control that cannot be seen to accept a press is
 *    not finished.
 *
 * 2. Motion declares which family it belongs to. Anything with a physical
 *    metaphor (a control being pushed, a drawer sliding, a thumb travelling)
 *    uses `springObject`. Anything purely informational (a toast arriving, a
 *    panel swapping its contents) uses a duration and `ease.info`, because
 *    information should not have inertia.
 *
 * The four states themselves are NOT delivered here. They come from the element
 * selector block at the top of styles.css, which reaches every bare `button`
 * without a call site having to adopt anything — which is what made fixing all
 * 63 at once possible. Wrappers only exist where a state cannot be expressed in
 * CSS at all: presence (a thing that must animate on its way out, after React
 * would have unmounted it) and shared-element travel. Anything a `:hover` rule
 * can already say belongs in the stylesheet, not in a component here.
 */
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import type { HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";
import { durationMs, easePoints, motion as motionTokens } from "./tokens.generated";

const spring = { type: "spring", ...motionTokens.springObject } as const;
const surfaceSpring = { type: "spring", ...motionTokens.springSurface } as const;

/** Informational motion: a duration, never a spring. */
const info = { duration: durationMs.state / 1000, ease: easePoints.info } as const;

export type SwitchOption<T extends string> = {
  value: T;
  label: ReactNode;
  ariaLabel: string;
};

/**
 * A segmented control whose selected thumb physically travels between options.
 *
 * The previous implementation swapped a background colour, which is a state
 * change with no motion in it — you could not see which way the selection
 * moved. `layoutId` gives the thumb a shared identity across options, so
 * Motion measures both positions and animates the real distance between them.
 */
export function Switch<T extends string>({
  value,
  options,
  onChange,
  className,
  groupLabel,
  disabled = false,
}: {
  value: T;
  options: readonly SwitchOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  groupLabel: string;
  disabled?: boolean;
}) {
  const reduced = useReducedMotionConfig();
  return (
    <div className={className} role="group" aria-label={groupLabel}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <motion.button
            key={option.value}
            type="button"
            className={selected ? "is-active" : ""}
            onClick={() => onChange(option.value)}
            aria-label={option.ariaLabel}
            aria-pressed={selected}
            disabled={disabled}
          >
            {selected && (
              <motion.span
                aria-hidden="true"
                className="switch-thumb"
                layoutId={`${groupLabel}-thumb`}
                transition={reduced ? { duration: 0 } : spring}
              />
            )}
            <span className="switch-label">{option.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

/**
 * A surface that enters and leaves. Panels are summoned, so they arrive on a
 * spring from slightly below and behind — the direction a thing lifted toward
 * the reader would come from — and leave on a duration, because a dismissal
 * should not linger.
 */
export function Panel({
  children,
  className,
  from,
  ...rest
}: Omit<HTMLMotionProps<"div">, "ref"> & { from: "left" | "scale" }) {
  const reduced = useReducedMotionConfig();
  const offset = from === "left" ? { x: -12 } : { scale: 0.96 };
  // Only the axis `from` introduced is animated back. Writing all four settled
  // values would emit `translate(0,0) scale(1)` into the inline transform and
  // overwrite whatever the call site's stylesheet had put there.
  const settled = from === "left" ? { x: 0 } : { scale: 1 };
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, ...offset }}
      animate={{ opacity: 1, ...settled }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, ...offset, transition: info }}
      transition={reduced ? { duration: 0 } : surfaceSpring}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/**
 * Transient status. It is the lowest thing on the screen by design: a toast
 * that outranks the book is a lie about its own importance.
 *
 * Rendering it through AnimatePresence is the point — before this, status
 * appeared and vanished on a class toggle, so a reader who looked away missed
 * that anything had happened at all.
 */
export function Toast({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  const reduced = useReducedMotionConfig();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          className={className}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          initial={reduced ? false : { opacity: 0, y: -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98, transition: info }}
          transition={reduced ? { duration: 0 } : spring}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
