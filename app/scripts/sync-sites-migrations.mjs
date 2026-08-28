#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";

const source = new URL("../drizzle/", import.meta.url);
const targetParent = new URL("../dist/.openai/", import.meta.url);
const target = new URL("../dist/.openai/drizzle/", import.meta.url);

if (!existsSync(source)) throw new Error("Missing Sites migration source: app/drizzle");
mkdirSync(targetParent, { recursive: true });
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
