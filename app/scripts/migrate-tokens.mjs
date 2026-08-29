#!/usr/bin/env node
/**
 * One-shot codemod that rewrites styles.css onto the token scales.
 *
 * This exists as a script rather than as hand edits because the mapping is
 * deterministic — nearest step, ties round up — and 500-odd declarations done
 * by hand is exactly how a value drifts back in. Run it with no flag to see
 * every change; pass `--write` to apply.
 *
 *   node scripts/migrate-tokens.mjs            dry run, prints every rewrite
 *   node scripts/migrate-tokens.mjs --write    apply
 *   node scripts/migrate-tokens.mjs --only=font-size,border-radius
 *
 * The `.book-nav-*` block is skipped: it is deleted wholesale when the real
 * WebGL cover open lands, so migrating its values would be wasted work.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const stylesPath = join(here, "..", "src", "styles.css");

/** Seven steps. Anything under 12px lands on the floor — that is the point. */
const FONT_SIZE = new Map([
  ["7.5px", "--text-caption"], ["8px", "--text-caption"], ["9px", "--text-caption"],
  ["10px", "--text-caption"], ["10.5px", "--text-caption"], ["11px", "--text-caption"],
  ["11.5px", "--text-caption"], ["12px", "--text-caption"],
  ["12.5px", "--text-body"], ["13px", "--text-body"], ["13.5px", "--text-body"],
  ["14px", "--text-body"], ["15px", "--text-body"], ["16px", "--text-body"], ["17px", "--text-body"],
  ["18px", "--text-lead"], ["22px", "--text-lead"], ["23px", "--text-lead"],
  ["24px", "--text-title"], ["25px", "--text-title"], ["26px", "--text-title"], ["27px", "--text-title"],
  // Fluid sizes collapse onto the step whose own clamp covers the same range.
  ["clamp(10px, 1.2vw, 14px)", "--text-body"],
  ["clamp(25px, 2vw, 32px)", "--text-title"],
  ["clamp(25px, 4vw, 32px)", "--text-title"],
  ["clamp(26px, 3.2vw, 32px)", "--text-title"],
  ["clamp(26px, 4vw, 34px)", "--text-display-s"],
  ["clamp(28px, 8.6vw, 34px)", "--text-display-s"],
  ["clamp(28px, 4vw, 46px)", "--text-display-m"],
  ["clamp(30px, 4vw, 42px)", "--text-display-m"],
  ["clamp(30px, 9.4vw, 44px)", "--text-display-m"],
  ["clamp(34px, 4.3vw, 66px)", "--text-display-l"],
]);

/** Four steps plus the shape primitives, which are exempt from the scale. */
const RADIUS = new Map([
  ["10px", "--radius-s"], ["11px", "--radius-s"], ["12px", "--radius-s"], ["13px", "--radius-s"],
  ["14px", "--radius-m"], ["15px", "--radius-m"], ["16px", "--radius-m"], ["18px", "--radius-m"],
  ["20px", "--radius-l"], ["22px", "--radius-l"], ["24px", "--radius-l"],
  ["26px", "--radius-l"], ["28px", "--radius-l"],
  ["999px", "--radius-pill"],
  ["50%", "--shape-circle"],
  ["45% 52% 44% 48%", "--shape-selection"],
  ["4px 9px 9px 4px", "--shape-cover"],
]);

/**
 * Shadows map by exact string because they carry intent, not magnitude:
 * a ring and a lift can have the same blur and mean opposite things.
 */
const SHADOW = new Map([
  ["0 3px 10px var(--shadow)", "--elev-1"],
  ["0 8px 22px rgba(0,0,0,.24)", "--elev-1"],
  ["0 12px 32px var(--shadow)", "--elev-2"],
  ["0 16px 42px var(--shadow)", "--elev-2"],
  ["0 18px 44px var(--shadow)", "--elev-3"],
  ["0 22px 58px var(--shadow)", "--elev-3"],
  ["0 26px 76px var(--shadow)", "--elev-3"],
  ["0 30px 80px rgba(39, 27, 17, .26)", "--elev-3"],
  ["0 36px 70px rgba(38, 28, 18, 0.35)", "--elev-3"],
  ["0 34px 90px rgba(0, 0, 0, .5), 0 0 70px rgba(255, 183, 87, .09)", "--elev-3"],
  // The shelf book is a physical object: a hard page-block offset, not a lift.
  ["0 22px 34px rgba(42, 28, 17, .24), -6px 5px 0 rgba(65, 44, 29, .16)", "--elev-book"],
  ["0 32px 45px rgba(42, 28, 17, .3), -7px 6px 0 rgba(65, 44, 29, .13)", "--elev-book-hover"],
  ["0 25px 45px rgba(0, 0, 0, .6), -6px 5px 0 rgba(70, 44, 24, .5)", "--elev-book"],
  // Rings are focus and state. Six of the old "shadows" were these, misfiled.
  ["0 0 0 4px rgba(145, 139, 125, .12)", "--ring-neutral"],
  ["0 0 0 4px var(--accent-soft)", "--ring-accent"],
  ["0 0 0 4px rgba(71, 168, 121, 0.14)", "--ring-ok"],
  ["0 0 0 4px rgba(71, 168, 121, .14)", "--ring-ok"],
  ["0 0 0 4px rgba(71, 168, 121, .16)", "--ring-ok"],
  // The one primary action per screen.
  ["0 9px 22px rgba(104, 42, 31, .2)", "--elev-accent-rest"],
  ["0 12px 26px rgba(104, 42, 31, .26)", "--elev-accent-hover"],
  ["0 6px 15px rgba(104, 42, 31, .2)", "--elev-accent-press"],
  ["0 16px 34px color-mix(in srgb, var(--accent) 25%, transparent)", "--elev-accent-rest"],
  ["0 13px 30px color-mix(in srgb, var(--accent) 24%, transparent)", "--elev-accent-rest"],
  ["0 12px 28px color-mix(in srgb, var(--accent) 26%, transparent)", "--elev-accent-rest"],
  ["0 12px 28px color-mix(in srgb, var(--accent) 28%, transparent)", "--elev-accent-rest"],
  ["inset 0 0 0 1px color-mix(in srgb, var(--accent) 14%, transparent)", "--ring-inset-accent"],
]);

/** Composite values that need two tokens rather than one. */
const SHADOW_COMPOSITE = new Map([
  ["0 0 0 4px rgba(255, 255, 255, 0.75), 0 12px 30px var(--shadow)", "var(--ring-neutral), var(--elev-2)"],
]);

const PROPERTIES = {
  "font-size": { map: FONT_SIZE },
  "border-radius": { map: RADIUS },
  "box-shadow": { map: SHADOW, composite: SHADOW_COMPOSITE },
};

const write = process.argv.includes("--write");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",")) : null;

const original = readFileSync(stylesPath, "utf8");
const lines = original.split("\n");

/** Line range of the fake transition, which is deleted with the real 3D open. */
const skipFrom = lines.findIndex((l) => l.startsWith(".book-nav-transition {")) + 1;
const skipTo = lines.findIndex((l) => l.startsWith(".app-shell.is-book-nav-active"));

const changes = [];
const unmapped = new Map();

const next = lines.map((line, index) => {
  const lineNumber = index + 1;
  if (skipFrom > 0 && skipTo > 0 && lineNumber >= skipFrom && lineNumber <= skipTo) return line;

  let out = line;
  for (const [property, { map, composite }] of Object.entries(PROPERTIES)) {
    if (only && !only.has(property)) continue;
    const pattern = new RegExp(`(^|[;{\\s])(${property}):\\s*([^;}]+)`, "g");
    out = out.replace(pattern, (whole, lead, prop, rawValue) => {
      const value = rawValue.trim();
      if (value.startsWith("var(")) return whole;
      const compositeHit = composite?.get(value);
      if (compositeHit) {
        changes.push({ line: lineNumber, property: prop, from: value, to: compositeHit });
        return `${lead}${prop}: ${compositeHit}`;
      }
      const token = map.get(value);
      if (!token) {
        const key = `${prop}: ${value}`;
        unmapped.set(key, (unmapped.get(key) ?? 0) + 1);
        return whole;
      }
      changes.push({ line: lineNumber, property: prop, from: value, to: `var(${token})` });
      return `${lead}${prop}: var(${token})`;
    });
  }
  return out;
});

for (const change of changes) {
  console.log(`  styles.css:${String(change.line).padStart(4)}  ${change.property}: ${change.from}  →  ${change.to}`);
}

console.log(`\n${changes.length} declaration${changes.length === 1 ? "" : "s"} rewritten`);
if (skipFrom > 0) console.log(`skipped styles.css:${skipFrom}-${skipTo} (.book-nav-* — pending deletion)`);

if (unmapped.size) {
  console.log(`\n${unmapped.size} value${unmapped.size === 1 ? "" : "s"} left for a human — no scale step expresses them:`);
  for (const [key, count] of [...unmapped.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count}×  ${key}`);
  }
}

if (write) {
  writeFileSync(stylesPath, next.join("\n"));
  console.log("\nwrote src/styles.css");
} else {
  console.log("\ndry run — pass --write to apply");
}
