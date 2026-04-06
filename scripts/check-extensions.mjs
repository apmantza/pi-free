/**
 * Verifies all pi extension entry points can be loaded after install.
 * Catches "Cannot find module" errors caused by missing files in the npm package.
 *
 * Usage: node scripts/check-extensions.mjs <install-dir>
 * Example: node scripts/check-extensions.mjs $(npm root -g)/pi-free
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";

const installDir = resolve(process.argv[2] ?? ".");
const pkg = JSON.parse(readFileSync(join(installDir, "package.json"), "utf8"));
const extensions = pkg.pi?.extensions ?? [];

if (extensions.length === 0) {
  console.error("No pi.extensions found in package.json");
  process.exit(1);
}

console.log(`Checking ${extensions.length} extension(s) in: ${installDir}\n`);

let failed = 0;

for (const ext of extensions) {
  const file = ext.replace(/^\.\//, "");
  const fullPath = join(installDir, file);
  const url = pathToFileURL(fullPath).href;

  process.stdout.write(`  ${file} ... `);
  try {
    await import(url);
    console.log("✓");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Cannot find module") || msg.includes("Cannot find package") || msg.includes("ERR_MODULE_NOT_FOUND")) {
      console.log("✗ FAILED");
      console.error(`    → ${msg.split("\n")[0]}`);
      failed++;
    } else {
      // Non-module errors (missing pi API, config issues) are expected in a stub env
      console.log(`✓ (runtime error ignored: ${msg.slice(0, 80)})`);
    }
  }
}

console.log(`\n${failed === 0 ? "All extensions loaded OK" : `${failed} extension(s) failed`}`);
process.exit(failed > 0 ? 1 : 0);
