import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";

const generatedDir = join(process.cwd(), "public", "assets", "generated");
const requested = process.argv.slice(2);
const files = requested.length > 0
  ? requested
  : readdirSync(generatedDir)
      .filter((name) => name.includes("cutout") && name.endsWith(".png"))
      .map((name) => join(generatedDir, name));

if (files.length === 0) {
  console.error("No cutout PNG files found.");
  process.exit(1);
}

const failures = [];
for (const file of files) {
  const identity = spawnSync("magick", ["identify", "-format", "%w %h %[channels] %[opaque]", file], { encoding: "utf8" });
  const alpha = spawnSync("magick", [file, "-alpha", "extract", "-format", "%[fx:mean] %@", "info:"], { encoding: "utf8" });

  if (identity.status !== 0 || alpha.status !== 0) {
    failures.push(`${basename(file)}: ImageMagick inspection failed`);
    continue;
  }

  const match = `${identity.stdout.trim()} ${alpha.stdout.trim()}`.match(/^(\d+) (\d+) (.+?) (True|False) ([\d.]+) (\d+)x(\d+)\+(\d+)\+(\d+)$/);
  if (!match) {
    failures.push(`${basename(file)}: unrecognised inspection output`);
    continue;
  }

  const [, widthRaw, heightRaw, channels, opaque, meanRaw, boxWidthRaw, boxHeightRaw, xRaw, yRaw] = match;
  const width = Number(widthRaw);
  const height = Number(heightRaw);
  const alphaMean = Number(meanRaw);
  const boxWidth = Number(boxWidthRaw);
  const boxHeight = Number(boxHeightRaw);
  const x = Number(xRaw);
  const y = Number(yRaw);
  const rightPadding = width - x - boxWidth;
  const bottomPadding = height - y - boxHeight;
  const minimumPadding = Math.max(2, Math.round(Math.min(width, height) * 0.02));

  const reasons = [];
  if (!channels.includes("a") || opaque === "True") reasons.push("no usable alpha transparency");
  if (alphaMean < 0.015) reasons.push("subject is effectively empty");
  if (alphaMean > 0.94) reasons.push("canvas is effectively opaque");
  if ([x, y, rightPadding, bottomPadding].some((padding) => padding < minimumPadding)) {
    reasons.push(`subject or fragment touches the edge; require ${minimumPadding}px transparent padding`);
  }

  if (reasons.length > 0) failures.push(`${basename(file)}: ${reasons.join("; ")}`);
  else console.log(`PASS ${basename(file)} alpha=${alphaMean.toFixed(3)} padding=${x}/${y}/${rightPadding}/${bottomPadding}`);
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join("\n"));
  process.exit(1);
}
