#!/usr/bin/env node
/**
 * The guard that keeps the design scales closed.
 *
 * styles.css reached 34 font sizes, 20 radii, 30 shadows and 68 spacing values
 * because nothing ever counted them. This script counts them, on every
 * `verify:release`, and fails when a raw value reappears where a token belongs.
 *
 * It deliberately reports every offender with its line number rather than just
 * a count, so a failure is directly actionable.
 *
 *   node scripts/check-tokens.mjs           report and exit non-zero on failure
 *   node scripts/check-tokens.mjs --report  report only, always exit 0
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "..");
const stylesPath = join(appDir, "src", "styles.css");
const generatedPath = join(appDir, "src", "design", "tokens.generated.css");

const styles = readFileSync(stylesPath, "utf8");
const generated = readFileSync(generatedPath, "utf8");

/**
 * The fake open/close transition is scheduled for deletion when the real WebGL
 * cover open lands. Migrating its values first and deleting them second would
 * be wasted work, so it is excluded until the block itself goes away.
 */
const PENDING_DELETION = /\.book-nav-[\s\S]*?(?=\n\.app-shell\.is-book-nav-active)/;

/** Values a scale legitimately cannot express. Each needs a stated reason. */
const EXEMPT = {
  radius: new Set([
    "50%", // circles — a shape primitive, not a scale step
    "inherit",
    "999px", // the pill token's own definition
    "0", // resetting a radius is not choosing one
  ]),
  fontSize: new Set([
    "inherit",
  ]),
  shadow: new Set([
    "none", // the absence of elevation is not a magnitude
  ]),
};

const budget = {
  fontSize: 0,
  radius: 0,
  shadow: 0,
  /** Unused: accent ownership is checked per screen below, not by count. */
};

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function withLines(css) {
  return css.split("\n").map((text, index) => ({ text, line: index + 1 }));
}

/** Lines inside the pending-deletion block, so offenders there are not counted. */
function pendingDeletionRange(css) {
  const match = PENDING_DELETION.exec(css);
  if (!match) return null;
  const before = css.slice(0, match.index).split("\n").length;
  return { from: before, to: before + match[0].split("\n").length - 1 };
}

const pending = pendingDeletionRange(styles);
const isPending = (line) => Boolean(pending && line >= pending.from && line <= pending.to);

const source = withLines(stripComments(styles));
const failures = [];

function scan({ label, pattern, exempt = new Set(), allowVar = true }) {
  const offenders = [];
  for (const { text, line } of source) {
    if (isPending(line)) continue;
    for (const match of text.matchAll(pattern)) {
      const value = match[1].trim();
      if (allowVar && value.startsWith("var(")) continue;
      if (exempt.has(value)) continue;
      offenders.push({ line, value, text: text.trim() });
    }
  }
  return { label, offenders };
}

const checks = [
  scan({ label: "font-size", pattern: /font-size:\s*([^;}]+)/g, exempt: EXEMPT.fontSize }),
  scan({ label: "border-radius", pattern: /border-radius:\s*([^;}]+)/g, exempt: EXEMPT.radius }),
  scan({ label: "box-shadow", pattern: /box-shadow:\s*([^;}]+)/g, exempt: EXEMPT.shadow }),
];

const budgets = { "font-size": budget.fontSize, "border-radius": budget.radius, "box-shadow": budget.shadow };

for (const { label, offenders } of checks) {
  const allowed = budgets[label] ?? 0;
  if (offenders.length <= allowed) {
    console.log(`ok   ${label}: ${offenders.length} raw value${offenders.length === 1 ? "" : "s"} (budget ${allowed})`);
    continue;
  }
  failures.push(label);
  console.error(`FAIL ${label}: ${offenders.length} raw values, budget ${allowed}`);
  for (const offender of offenders.slice(0, 40)) {
    console.error(`       styles.css:${offender.line}  ${offender.value}`);
  }
  if (offenders.length > 40) console.error(`       …and ${offenders.length - 40} more`);
}

/**
 * The accent carries exactly one control per screen. A plain count would be
 * the wrong check — five controls carry it today and that is correct, because
 * they sit on five different screens. What must never happen is a second
 * accent on a screen that already has one, or a sixth screen appearing without
 * a deliberate decision. So the rule is encoded as an allowlist keyed by
 * screen, and any accent outside it fails.
 */
const ACCENT_OWNER = new Map([
  [".create-codex-button", "library"],
  [".agent-prompt", "reading"],
  [".workshop-actionbar .copy-starter-button", "workshop"],
  [".copy-element-request", "element-agent"],
  [".publication-primary", "publish"],
]);

/** Walks back from a line to the selector whose block it sits in. */
function selectorFor(lineNumber) {
  for (let index = lineNumber - 1; index >= 0; index -= 1) {
    const text = source[index]?.text ?? "";
    const match = /^([.#:a-zA-Z][^{]*)\{/.exec(text);
    if (match) return match[1].trim();
  }
  return "<unknown>";
}

const accentSelectors = source
  .filter(({ text }) => text.includes("--elev-accent-rest"))
  .map(({ line }) => ({ line, selector: selectorFor(line) }));

const screensSeen = new Map();
const accentProblems = [];

for (const { line, selector } of accentSelectors) {
  const screen = ACCENT_OWNER.get(selector);
  if (!screen) {
    accentProblems.push(`styles.css:${line}  ${selector} — not the primary action of any screen`);
    continue;
  }
  if (screensSeen.has(screen)) {
    accentProblems.push(`styles.css:${line}  ${selector} — ${screen} already has an accent action (${screensSeen.get(screen)})`);
    continue;
  }
  screensSeen.set(screen, selector);
}

if (accentProblems.length) {
  failures.push("accent ownership");
  console.error(`FAIL accent ownership: one primary action per screen`);
  for (const problem of accentProblems) console.error(`       ${problem}`);
} else {
  console.log(`ok   accent ownership: ${screensSeen.size} screen${screensSeen.size === 1 ? "" : "s"}, one primary action each`);
}

/** Scale sizes, reported so a widening scale is visible in review. */
const scaleSize = (name, pattern) => [...generated.matchAll(pattern)].length;
console.log(
  `     scale sizes — type ${scaleSize("type", /^\s*--text-[a-z-]+:/gm)}` +
    `, radius ${scaleSize("radius", /^\s*--radius-[a-z]+:/gm)}` +
    `, elevation ${scaleSize("elev", /^\s*--elev-\d:/gm) / 2}` +
    `, space ${scaleSize("space", /^\s*--space-[a-z0-9]+:/gm)}`,
);

if (pending) {
  console.log(`     skipped styles.css:${pending.from}-${pending.to} (.book-nav-* — pending deletion with the real 3D open)`);
}

if (failures.length && !process.argv.includes("--report")) {
  console.error(`\n${failures.length} check${failures.length === 1 ? "" : "s"} failed: ${failures.join(", ")}`);
  process.exit(1);
}
