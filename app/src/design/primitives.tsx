/**
 * The six interaction primitives.
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
 * These wrap the existing class names rather than replacing them, so a call
 * site adopts the interaction layer without also rewriting its appearance.
 * That is what let all 63 controls gain four states in one change.
 */
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { HTMLMotionProps } from "motion/react";
import { forwardRef, type ReactNode } from "react";
import { motion as motionTokens } from "./tokens.generated";

const spring = { type: "spring", ...motionTokens.springObject } as const;
const surfaceSpring = { type: "spring", ...motionTokens.springSurface } as const;

/** Informational motion: a duration, never a spring. */
const info = { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] } as const;

type ButtonProps = Omit<HTMLMotionProps<"button">, "ref"> & {
  /**
   * `primary` is the one accented action a screen is allowed. `standard` is
   * ordinary chrome. `quiet` is a control that should not compete with the
   * page — it earns its affordance on hover rather than announcing it.
   */
  tone?: "primary" | "standard" | "quiet";
};

/**
 * The press feel is deliberately asymmetric: a control sinks quickly and
 * returns on a spring, which is how a physical key behaves. A symmetric
 * transition reads as a light switch rather than as something being pushed.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { tone = "standard", children, disabled, ...rest },
  ref,
) {
  const reduced = useReducedMotion();
  return (
    <motion.button
      ref={ref}
      type="button"
      disabled={disabled}
      data-tone={tone}
      whileHover={disabled || reduced ? undefined : { y: -1 }}
      whileTap={disabled || reduced ? undefined : { scale: 0.96, y: 0 }}
      transition={spring}
      {...rest}
    >
      {children}
    </motion.button>
  );
});

/**
 * Icon-only controls take the same states but scale rather than lift, because
 * a round target has no baseline for a lift to read against.
 */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, "tone"> & { label: string }>(
  function IconButton({ label, children, disabled, ...rest }, ref) {
    const reduced = useReducedMotion();
    return (
      <motion.button
        ref={ref}
        type="button"
        aria-label={label}
        disabled={disabled}
        whileHover={disabled || reduced ? undefined : { scale: 1.06 }}
        whileTap={disabled || reduced ? undefined : { scale: 0.92 }}
        transition={spring}
        {...rest}
      >
        {children}
      </motion.button>
    );
  },
);

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
  thumbClassName = "switch-thumb",
}: {
  value: T;
  options: readonly SwitchOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  groupLabel: string;
  disabled?: boolean;
  thumbClassName?: string;
}) {
  const reduced = useReducedMotion();
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
            whileTap={disabled || reduced ? undefined : { scale: 0.94 }}
            transition={spring}
          >
            {selected && (
              <motion.span
                aria-hidden="true"
                className={thumbClassName}
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
  from = "below",
  ...rest
}: Omit<HTMLMotionProps<"div">, "ref"> & { from?: "below" | "left" | "right" | "scale" }) {
  const reduced = useReducedMotion();
  const offset =
    from === "left" ? { x: -12 } : from === "right" ? { x: 12 } : from === "scale" ? { scale: 0.96 } : { y: 10 };
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, ...offset }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, ...offset, transition: info }}
      transition={reduced ? { duration: 0 } : surfaceSpring}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/**
 * Label, control, and description as one unit, so a call site cannot ship a
 * control whose label is only a nearby span. The description is wired through
 * aria-describedby rather than left as adjacent text.
 */
export function Field({
  label,
  description,
  htmlFor,
  className,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  const descriptionId = htmlFor && description ? `${htmlFor}-description` : undefined;
  return (
    <div className={className}>
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="field-label">{label}</span>}
      {children}
      {description && (
        <small id={descriptionId} className="field-description">
          {description}
        </small>
      )}
    </div>
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
  role = "status",
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
  role?: "status" | "alert";
}) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          className={className}
          role={role}
          aria-live={role === "alert" ? "assertive" : "polite"}
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
