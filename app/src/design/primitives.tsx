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
 * 2. Motion belongs to the stylesheet. Presence and travel are both expressible
 *    in CSS now that `@starting-style` and a discrete `display` transition
 *    exist, so neither needs an animation runtime — and the reduced-motion
 *    rules in styles.css already cover both `prefers-reduced-motion` and the
 *    `?reducedMotion=1` override, so a CSS animation honours them for free.
 *
 * The four states themselves are NOT delivered here. They come from the element
 * selector block at the top of styles.css, which reaches every bare `button`
 * without a call site having to adopt anything — which is what made fixing all
 * 63 at once possible. Wrappers only exist where a selector cannot say it:
 * presence, which needs the element to stay mounted while it leaves, and the
 * travelling switch marker, which needs the selected option measured.
 */
import { useEffect, useRef, useState } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { durationMs, easePoints } from "./tokens";
import type { CreationNavigationPhase, WorkspaceMotionOrigin } from "./creationNavigation";

const portalCircle = (origin: WorkspaceMotionOrigin, radius: number) =>
  `circle(${radius}px at ${origin.x}px ${origin.y}px)`;

const cubic = (points: readonly number[]) => `cubic-bezier(${points.join(",")})`;

/**
 * An origin-aware opaque handoff between the library/reader and the blank-book
 * workspace. The mounted scene changes only while this paper surface covers
 * the viewport, so WebGL setup cannot flash as a navigation cut.
 *
 * The one animation still driven from JS: it has to report completion so React
 * can swap the mounted scene, and a stylesheet that turns transitions off would
 * strand the phase machine mid-navigation. `reduced` is passed in rather than
 * sniffed because the caller's flag also carries the `?reducedMotion=1` override.
 */
export function WorkspaceTransition({
  phase,
  sourceOrigin,
  actionOrigin,
  reduced = false,
  onPhaseComplete,
}: {
  phase: CreationNavigationPhase;
  sourceOrigin: WorkspaceMotionOrigin;
  actionOrigin: WorkspaceMotionOrigin;
  reduced?: boolean;
  onPhaseComplete: () => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const complete = useRef(onPhaseComplete);
  complete.current = onPhaseComplete;

  const idle = phase === "idle";
  const origin = phase === "covering-workspace" ? actionOrigin : sourceOrigin;
  const point = portalCircle(origin, 0);
  const cover = portalCircle(origin, origin.radius);
  const revealWorkspace = phase === "revealing-workspace";
  const revealSource = phase === "revealing-source";
  const from = revealWorkspace || revealSource
    ? { opacity: 1, clipPath: cover }
    : { opacity: 1, clipPath: point };
  const to = revealWorkspace
    ? { opacity: 0, clipPath: cover }
    : revealSource
      ? { opacity: 1, clipPath: point }
      : { opacity: 1, clipPath: cover };

  useEffect(() => {
    const element = surface.current;
    if (idle) return;
    const duration = reduced ? 0 : revealWorkspace ? durationMs.state : durationMs.navigation;
    const animation = element?.animate?.(
      [from, to],
      { duration, easing: cubic(revealWorkspace ? easePoints.info : easePoints.navigation), fill: "forwards" },
    );
    if (!animation) {
      // No Web Animations API: report the phase done rather than leaving
      // navigation waiting on a callback that cannot arrive.
      const settle = requestAnimationFrame(() => complete.current());
      return () => cancelAnimationFrame(settle);
    }
    animation.finished.then(() => complete.current(), () => undefined);
    return () => animation.cancel();
    // The phase is the whole identity of one run; the origins are read from it.
  }, [phase, idle, reduced, revealWorkspace]); // eslint-disable-line react-hooks/exhaustive-deps

  if (idle) return null;

  return (
    <div
      ref={surface}
      key={phase}
      className="workspace-transition"
      data-phase={phase}
      aria-hidden="true"
      style={from}
    >
      <span className="workspace-transition-mark">Apertale</span>
    </div>
  );
}

type SwitchOption<T extends string> = {
  value: T;
  label: ReactNode;
  /** Only needed when the visible label is not the full spoken name. */
  ariaLabel?: string;
};

type MarkerBox = { left: number; top: number; width: number; height: number };

/**
 * A segmented control whose selected marker physically travels between options.
 *
 * The previous implementation swapped a background colour, which is a state
 * change with no motion in it — you could not see which way the selection
 * moved. One marker lives in the group rather than one per option, so it keeps
 * its identity across a change and CSS transitions the real distance between
 * the two option boxes.
 *
 * `thumb` is a pill behind the option (Day/Night). `underline` is a rule under
 * the word, the way print marks a selection; the workshop pickers used to
 * hand-roll that with a CSS `::after`, which is the same job done a second way.
 */
export function Switch<T extends string>({
  value,
  options,
  onChange,
  className,
  groupLabel,
  variant = "thumb",
  disabled = false,
}: {
  value: T;
  options: readonly SwitchOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  groupLabel: string;
  variant?: "thumb" | "underline";
  disabled?: boolean;
}) {
  const group = useRef<HTMLDivElement>(null);
  const [marker, setMarker] = useState<MarkerBox | null>(null);

  // The options are laid out by the call site's own stylesheet — pills, wrapped
  // chips, a row of words — so the marker box is measured rather than derived
  // from an option count that would only be right for equal-width options.
  useEffect(() => {
    const measure = () => {
      const selected = group.current?.querySelector<HTMLElement>("button[aria-pressed='true']");
      setMarker(selected
        ? { left: selected.offsetLeft, top: selected.offsetTop, width: selected.offsetWidth, height: selected.offsetHeight }
        : null);
    };
    measure();
    // A switch mounted inside a hidden topbar measures zero, so re-measure when
    // the group is finally laid out — the same event as a resize or a late
    // font. (No ResizeObserver in the test DOM, which has no layout anyway.)
    if (typeof ResizeObserver === "undefined" || !group.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(group.current);
    return () => observer.disconnect();
  }, [value, options]);

  return (
    <div className={className} role="group" aria-label={groupLabel} ref={group}>
      {marker && (
        <span
          aria-hidden="true"
          className={variant === "thumb" ? "switch-thumb" : "switch-underline"}
          style={marker}
        />
      )}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={selected ? "is-active" : ""}
            onClick={() => onChange(option.value)}
            aria-label={option.ariaLabel}
            aria-pressed={selected}
            disabled={disabled}
          >
            <span className="switch-label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * A surface that enters and leaves. Panels are summoned, so they arrive from
 * slightly below and behind — the direction a thing lifted toward the reader
 * would come from — and leave the same way.
 *
 * The surface stays mounted and carries `data-open`, because an element React
 * has already removed cannot animate on its way out. `.presence` owns the rest.
 */
export function Panel({
  children,
  className,
  from,
  open = true,
  ...rest
}: ComponentPropsWithoutRef<"div"> & { from: "left" | "scale"; open?: boolean }) {
  return (
    <div
      className={`presence presence-${from} ${className ?? ""}`}
      data-open={open}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * Transient status. It is the lowest thing on the screen by design: a toast
 * that outranks the book is a lie about its own importance.
 *
 * Animating its presence is the point — before this, status appeared and
 * vanished on a class toggle, so a reader who looked away missed that anything
 * had happened at all.
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
  return (
    <div
      className={`presence presence-toast ${className ?? ""}`}
      data-open={open}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {children}
    </div>
  );
}
