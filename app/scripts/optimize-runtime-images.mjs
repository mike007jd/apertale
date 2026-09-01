import { mkdtempSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const publicDir = join(process.cwd(), "public");
const write = process.argv.includes("--write");
const temporaryDir = mkdtempSync(join(tmpdir(), "apertale-images-"));

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} failed for ${args.at(-1)}: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

const files = readdirSync(publicDir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".png")
  .map((entry) => join(entry.parentPath, entry.name));
let beforeBytes = 0;
let afterBytes = 0;
let replacedCount = 0;

try {
  for (const [index, file] of files.entries()) {
    const inputBytes = statSync(file).size;
    const output = join(temporaryDir, `${index}.png`);
    const args = [file, "-strip", "-dither", "FloydSteinberg", "-colors", "256", "-define", "png:compression-level=9", `PNG8:${output}`];
    run("magick", args);
    const outputBytes = statSync(output).size;
    const shouldReplace = outputBytes < inputBytes;

    beforeBytes += inputBytes;
    afterBytes += shouldReplace ? outputBytes : inputBytes;
    if (shouldReplace) replacedCount += 1;

    if (write && shouldReplace) renameSync(output, file);
    console.log(`${write && shouldReplace ? "WRITE" : shouldReplace ? "PLAN " : "KEEP "} ${relative(publicDir, file)} ${Math.round(inputBytes / 1024)} -> ${Math.round((shouldReplace ? outputBytes : inputBytes) / 1024)} KiB`);
  }
} finally {
  rmSync(temporaryDir, { recursive: true, force: true });
}

const savedBytes = beforeBytes - afterBytes;
console.log(`\n${write ? "Optimized" : "Would optimize"} ${replacedCount}/${files.length} PNG files without changing dimensions or alpha geometry.`);
console.log(`${(beforeBytes / 1024 / 1024).toFixed(1)} MiB -> ${(afterBytes / 1024 / 1024).toFixed(1)} MiB (${(savedBytes / beforeBytes * 100).toFixed(1)}% smaller).`);
