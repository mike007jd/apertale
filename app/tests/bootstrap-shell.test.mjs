import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps an honest library skeleton in the app shell until JavaScript mounts", async () => {
  const shell = await readFile(new URL("../dist/client/app-shell", import.meta.url), "utf8");

  assert.match(shell, /<div id="root">\s*<main class="apertale-boot"/u);
  assert.match(shell, /aria-label="Opening Apertale"/u);
  assert.match(shell, /class="apertale-boot__cover"/u);
  assert.match(shell, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.doesNotMatch(shell, /<div id="root"><\/div>/u);
});
