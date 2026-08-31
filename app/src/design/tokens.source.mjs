/**
 * The single source of truth for every scale in Apertale.
 *
 * `scripts/generate-tokens.mjs` reads this file and emits two artifacts that
 * must never be edited by hand:
 *
 *   src/design/tokens.generated.css  — custom properties consumed by styles.css
 *   src/design/tokens.generated.ts   — runtime motion constants consumed by React
 *
 * Motion needs numeric spring settings, durations, and easing points at
 * runtime. Emitting those values here keeps React animation code aligned with
 * the CSS motion custom properties without exposing unused JS copies of every
 * visual scale.
 *
 * Type sizes, radius, and elevation are closed sets. Adding a step is a design
 * decision made here, not an ad-hoc value added at a call site;
 * `scripts/check-tokens.mjs` fails the build when styles.css reintroduces a raw
 * value in those scales. Other typography properties and spacing tokens name
 * recurring values without claiming a closed gate that the stylesheet does
 * not yet satisfy; measured component geometry remains explicit.
 */

/**
 * Seven steps on a perfect fourth (1.3286), anchored at a 12px floor and the
 * 66px ceiling the library hero already used. The floor is the point: 65% of
 * the stylesheet's font-size declarations used to sit between 7.5px and 13.5px,
 * which is the mechanical cause of the text-heavy read.
 *
 * Steps 1-3 are the UI sans; steps 4-7 are the display serif. The handoff sits
 * at step 4 rather than step 5 because Iowan's larger x-height means 28px
 * serif optically matches 26px sans.
 */
export const type = {
  caption: { size: "12px", line: "1.4", track: "track-caps", weight: "strong", family: "ui" },
  body: { size: "16px", line: "1.5", track: "track-normal", weight: "text", family: "ui" },
  lead: { size: "21px", line: "1.4", track: "track-normal", weight: "strong", family: "ui" },
  title: { size: "28px", line: "1.25", track: "track-tight", weight: "title", family: "display" },
  "display-s": { size: "clamp(28px, 3.4vw, 38px)", line: "1.15", track: "track-display", weight: "display", family: "display" },
  "display-m": { size: "clamp(28px, 4.2vw, 50px)", line: "1.08", track: "track-display", weight: "display", family: "display" },
  // The 4.6vw slope is measured, not chosen: it lands at 59px on the primary
  // 1280px canvas. A steeper slope hits the 66px ceiling there and eats enough
  // vertical budget to clip the shelf below the hero.
  "display-l": { size: "clamp(38px, 4.6vw, 66px)", line: "1.02", track: "track-display", weight: "display", family: "display" },
};

/** Seven distinct weights across two families collapsed to four roles. */
export const weight = {
  text: 400,
  strong: 600,
  title: 700,
  display: 800,
};

/** Twenty ad-hoc letter-spacings collapsed to four intents. */
export const track = {
  "track-caps": ".12em",
  "track-normal": "0",
  "track-tight": "-.02em",
  "track-display": "-.035em",
};

export const family = {
  ui: '"Avenir Next", Avenir, "Segoe UI", system-ui, sans-serif',
  display: '"Iowan Old Style", Baskerville, Georgia, serif',
};

/**
 * Four steps on the 8pt grid. The scale encodes containment depth, not size
 * for its own sake: `s` is for controls nested inside a surface, `m` for the
 * surface itself, `l` for a sheet that owns the screen.
 */
export const radius = {
  s: 8,
  m: 16,
  l: 24,
  pill: 999,
};

/**
 * Shapes that are deliberately off-scale because they describe a physical
 * object rather than a UI container. These are exempt from the token check.
 */
export const shape = {
  circle: "50%",
  /** Cover board with a spine on the left; mirrors the WebGL board bevel. */
  cover: "4px 8px 8px 4px",
  /** A hand-drawn organic ring. Off-grid is the entire point. */
  selection: "45% 52% 44% 48%",
};

/**
 * Full steps are multiples of 8. Half-steps exist where 8 is too coarse. These
 * tokens cover recurring containment values; one-off measured layout geometry
 * stays at its call site until a future spacing migration proves it is shared.
 */
export const space = {
  0: "0",
  hair: "2px",
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "24px",
  6: "32px",
  7: "48px",
  8: "64px",
};

/** One fluid step for page gutters that must breathe with the viewport. */
export const spaceFluid = "clamp(24px, 4vw, 64px)";

/**
 * Three elevations, each a two-layer contact-plus-ambient pair.
 *
 * elev-1  resting on the paper   — page-edge objects, inline status
 * elev-2  lifted off the paper   — popped-out menus
 * elev-3  floating over the book — sheets and overlays
 *
 * Night is not the day shadow with a different alpha. The file already needed
 * a warm lamp rim at night and had been expressing it as two undocumented
 * one-off shadows; that rim is promoted here instead of re-invented per card.
 */
export const elevation = {
  day: {
    1: "0 1px 2px rgb(74 55 39 / .10), 0 2px 6px rgb(74 55 39 / .08)",
    2: "0 2px 4px rgb(74 55 39 / .12), 0 10px 24px rgb(74 55 39 / .14)",
    3: "0 4px 8px rgb(74 55 39 / .14), 0 28px 64px rgb(74 55 39 / .22)",
  },
  night: {
    1: "0 1px 2px rgb(0 0 0 / .34), 0 2px 6px rgb(0 0 0 / .28), inset 0 1px 0 rgb(255 183 87 / .05)",
    2: "0 2px 4px rgb(0 0 0 / .40), 0 10px 24px rgb(0 0 0 / .36), 0 0 28px rgb(255 183 87 / .05)",
    3: "0 4px 8px rgb(0 0 0 / .46), 0 28px 64px rgb(0 0 0 / .52), 0 0 70px rgb(255 183 87 / .09)",
  },
};

/**
 * Rings are focus and state, not elevation. Keeping them out of the elevation
 * namespace is why the scale can stay at three steps — six of the thirty
 * "shadows" in the old stylesheet were rings filed in the wrong place.
 */
export const ring = {
  neutral: { day: "0 0 0 3px rgb(25 27 24 / .12)", night: "0 0 0 3px rgb(247 240 227 / .14)" },
  accent: { day: "0 0 0 3px var(--accent-soft)", night: "0 0 0 3px var(--accent-soft)" },
  ok: { day: "0 0 0 3px rgb(71 168 121 / .16)", night: "0 0 0 3px rgb(107 168 143 / .18)" },
  marker: {
    day: "0 0 0 4px color-mix(in srgb, var(--marker-color) 35%, transparent)",
    night: "0 0 0 4px color-mix(in srgb, var(--marker-color) 42%, transparent)",
  },
  /** Drawn inside the box, for a selected option that must not grow. */
  "inset-accent": {
    day: "inset 0 0 0 1px color-mix(in srgb, var(--accent) 14%, transparent)",
    night: "inset 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent)",
  },
};

/** The shelf and WebGL stage share one soft, paper-on-desk light language. */
export const bookShadow = {
  rest: { day: "0 8px 18px rgb(42 28 17 / .14), 0 24px 42px rgb(42 28 17 / .20)", night: "0 10px 22px rgb(0 0 0 / .34), 0 28px 50px rgb(0 0 0 / .48)" },
  hover: { day: "0 12px 24px rgb(42 28 17 / .16), 0 34px 54px rgb(42 28 17 / .24)", night: "0 14px 28px rgb(0 0 0 / .38), 0 38px 62px rgb(0 0 0 / .54)" },
};

/**
 * The accent elevation is reserved for the single primary action on a screen.
 * `check-tokens.mjs` counts its uses; five controls carried it before this
 * layer existed, which is why none of them read as primary.
 */
export const accentElevation = {
  rest: "0 9px 22px color-mix(in srgb, var(--accent) 24%, transparent)",
  hover: "0 13px 30px color-mix(in srgb, var(--accent) 30%, transparent)",
  press: "0 5px 12px color-mix(in srgb, var(--accent) 22%, transparent)",
};

/**
 * Two motion families, and every animation must declare which one it belongs
 * to. Anything with a physical metaphor — the book, a ribbon, a bookmark, a
 * page, a drawer — is an object and gets a damped spring. Anything that is
 * pure information — a toast appearing, panel content swapping, a loading
 * state — gets a duration, because information should not have inertia.
 *
 * The numeric spring lives in tokens.generated.ts for Motion; the CSS form is
 * a bezier fitted to the same curve for the transitions that stay in CSS.
 */
export const motion = {
  /** Damped, no perceptible overshoot. Matches CSS `--ease-object`. */
  springObject: { stiffness: 180, damping: 26, mass: 1 },
  /** Looser, for large surfaces that should feel weighty rather than snappy. */
  springSurface: { stiffness: 120, damping: 24, mass: 1.1 },
  duration: {
    feedback: "120ms",
    state: "220ms",
    theme: "240ms",
    reveal: "320ms",
    book: "1100ms",
    navigation: "760ms",
  },
  ease: {
    object: "cubic-bezier(.22, 1, .36, 1)",
    info: "cubic-bezier(.2, .8, .2, 1)",
    navigation: "cubic-bezier(.22, .72, .16, 1)",
  },
};

/**
 * Colors keep the existing palette — it was never the problem. What changes is
 * that ink gains explicit opacity tiers so hierarchy can be expressed without
 * reaching for the accent, and the accent narrows to one primary action per
 * screen.
 */
export const color = {
  day: {
    "ink-rgb": "25 27 24",
    ink: "rgb(25 27 24)",
    "ink-2": "rgb(25 27 24 / .72)",
    "ink-3": "rgb(25 27 24 / .55)",
    "ink-4": "rgb(25 27 24 / .38)",
    muted: "#676762",
    surface: "rgba(255, 253, 248, 0.9)",
    "surface-strong": "#fffdf8",
    line: "rgba(25, 27, 24, 0.11)",
    accent: "#ff654f",
    "accent-soft": "rgba(255, 101, 79, 0.14)",
    "accent-ink": "#fffdf8",
    shadow: "rgba(74, 55, 39, 0.18)",
  },
  night: {
    "ink-rgb": "247 240 227",
    ink: "rgb(247 240 227)",
    "ink-2": "rgb(247 240 227 / .74)",
    "ink-3": "rgb(247 240 227 / .56)",
    "ink-4": "rgb(247 240 227 / .40)",
    muted: "#cfc4b1",
    surface: "rgba(30, 25, 20, 0.88)",
    "surface-strong": "#2a2119",
    line: "rgba(255, 245, 224, 0.13)",
    accent: "#f1bd6a",
    "accent-soft": "rgba(241, 189, 106, 0.16)",
    "accent-ink": "#241a11",
    shadow: "rgba(0, 0, 0, 0.42)",
  },
};
