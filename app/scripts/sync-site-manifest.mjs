#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

const source = new URL("../site-manifest.json", import.meta.url);
const publicManifest = new URL("../public/apertale-manifest.json", import.meta.url);

const catalog = JSON.parse(readFileSync(source, "utf8"));
const manifest = {
  ...catalog,
  webMcp: {
    ...catalog.webMcp,
    tools: Object.values(catalog.webMcp.tools),
  },
};

writeFileSync(publicManifest, `${JSON.stringify(manifest, null, 2)}\n`);
