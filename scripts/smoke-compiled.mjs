#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const entry = resolve(process.argv[2] ?? "dist/index.js");
await import(pathToFileURL(entry).href);
console.log(`Compiled entry loaded: ${entry}`);
