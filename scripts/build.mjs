#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const localTsc = join(root, "node_modules", "typescript", "bin", "tsc");
const buildConfig = join(root, "tsconfig.build.json");

/** esbuild version used for the vendored pi-ai bundles (see below). */
const ESBUILD_VERSION = "0.28.1";

execFileSync(process.execPath, [join(root, "scripts", "clean.mjs")], {
	cwd: root,
	stdio: "inherit",
});
// Git-based Pi installs run `npm install --omit=dev`, so the local compiler is
// intentionally absent during `prepare`. Match pi-lens's production-install
// strategy: use the pinned local compiler when available, otherwise fetch the
// exact compiler transiently with npx instead of asking users to repair the
// checkout manually.
if (existsSync(localTsc)) {
	execFileSync(process.execPath, [localTsc, "-p", buildConfig], {
		cwd: root,
		stdio: "inherit",
	});
} else {
	const npxArgs = ["--yes", "-p", "typescript@7.0.2", "tsc", "-p", buildConfig];
	const npxCli = [
		process.env.npm_execpath
			? join(dirname(process.env.npm_execpath), "npx-cli.js")
			: undefined,
		join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js"),
	].find((candidate) => candidate !== undefined && existsSync(candidate));
	if (npxCli) {
		execFileSync(process.execPath, [npxCli, ...npxArgs], {
			cwd: root,
			stdio: "inherit",
		});
	} else {
		const npx = process.platform === "win32" ? "npx.cmd" : "npx";
		execFileSync(npx, npxArgs, {
			cwd: root,
			stdio: "inherit",
			shell: process.platform === "win32",
		});
	}
}

const assetDir = join(root, "dist", "provider-failover");
mkdirSync(assetDir, { recursive: true });
copyFileSync(
	join(root, "provider-failover", "benchmarks.json"),
	join(assetDir, "benchmarks.json"),
);
console.log("Built dist/ and copied provider-failover/benchmarks.json");

// --- Vendored pi-ai bundles ------------------------------------------------
// Bun-compiled pi binaries (scoop/winget/standalone zip) cannot resolve bare
// specifiers from external files at all, so no on-disk pi-ai layout can serve
// pi-free's runtime imports there (#502). These self-contained bundles inline
// every transitive dependency (only node:* builtins stay external) and are the
// last-resort fallback in lib/pi-ai-loader.ts. The compat entry imports the
// per-API lazy wrappers directly instead of pi-ai's public `compat` entry:
// compat.js is marked sideEffects and would drag the images registry and the
// full generated catalog into the eagerly-loaded entry chunk.

const VENDOR_ENTRIES = {
	// The two API factories pi-free streams through, plus the two extra
	// factories the OpenCode session stream can resolve per model
	// (providers/opencode-session.ts importPiAiSubpath vendored stage).
	"pi-ai-compat": `
		export { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
		export { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
		export { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
		export { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
	`,
	"pi-ai-providers-all": `
		export { builtinModels, getBuiltinModel, getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
	`,
};

async function buildVendoredPiAi() {
	// @earendil-works/pi-ai is a peer dependency: npm never installs a
	// package's own peers into its own node_modules, so under Pi's managed
	// extension install (`npm install --omit=dev --legacy-peer-deps`, see
	// pi's package-manager getNpmInstallArgs) no copy is present — the
	// dev-time transitive copy via @earendil-works/pi-coding-agent is omitted
	// too. The vendored bundles are a last-resort fallback for Bun-compiled
	// hosts; at runtime inside Pi the host supplies pi-ai through loader
	// aliases, and lib/pi-ai-loader.ts already runs without the bundles
	// (resolveVendoredPiAiEntryFile returns undefined). Failing the whole
	// install here bricks GitHub updates, so skip with a loud warning
	// instead. A present-but-incompatible pi-ai (missing subpaths) still
	// fails loudly below, as it should.
	// Probe one of the vendored entries' specifiers directly, through the ESM
	// resolver (await tolerates both the sync-string and legacy Promise
	// shapes of import.meta.resolve). A CJS require.resolve probe cannot be
	// used here: pi-ai's exports map only defines `types`/`import`
	// conditions, so require.resolve always throws ERR_PACKAGE_PATH_NOT_
	// EXPORTED even when the package is installed and esbuild (ESM mode)
	// resolves it fine.
	let piAiResolvable = true;
	try {
		await import.meta.resolve("@earendil-works/pi-ai/providers/all");
	} catch {
		piAiResolvable = false;
	}
	if (!piAiResolvable) {
		console.warn(
			"[pi-free] WARNING: skipping dist/vendor/ pi-ai fallback bundles: " +
				"@earendil-works/pi-ai is not installed (expected under Pi's " +
				"`npm install --omit=dev --legacy-peer-deps`, which disables " +
				"peer resolution). " +
				"Node-based Pi hosts resolve pi-ai from the host at runtime; " +
				"Bun-compiled hosts need a full install to build the fallback.",
		);
		return;
	}
	const entryDir = join(root, "node_modules", ".cache", "pi-free-vendor");
	mkdirSync(entryDir, { recursive: true });
	const entryPoints = [];
	for (const [name, source] of Object.entries(VENDOR_ENTRIES)) {
		const file = join(entryDir, `${name}.js`);
		writeFileSync(file, source);
		entryPoints.push(file);
	}
	const buildOptions = {
		entryPoints,
		bundle: true,
		format: "esm",
		platform: "node",
		target: "node20",
		splitting: true,
		minify: true,
		outdir: join(root, "dist", "vendor"),
		logLevel: "warning",
	};
	try {
		const esbuild = await import("esbuild");
		await esbuild.build(buildOptions);
	} catch (error) {
		if (
			!error ||
			(error.code !== "ERR_MODULE_NOT_FOUND" &&
				!/Cannot find (?:package|module) 'esbuild'/.test(String(error.message)))
		) {
			throw error;
		}
		// Git-based Pi installs run `npm install --omit=dev`, so a local esbuild
		// is absent during `prepare`. Same strategy as the compiler above:
		// fetch the exact version transiently with npx (CLI, one entry at a time
		// keeps the command line identical across platforms).
		const npxArgs = [
			"--yes",
			"-p",
			`esbuild@${ESBUILD_VERSION}`,
			"esbuild",
			...entryPoints,
			"--bundle",
			"--format=esm",
			"--platform=node",
			"--target=node20",
			"--splitting",
			"--minify",
			`--outdir=${join(root, "dist", "vendor")}`,
			"--log-level=warning",
		];
		const npxCli = [
			process.env.npm_execpath
				? join(dirname(process.env.npm_execpath), "npx-cli.js")
				: undefined,
			join(
				dirname(process.execPath),
				"node_modules",
				"npm",
				"bin",
				"npx-cli.js",
			),
		].find((candidate) => candidate !== undefined && existsSync(candidate));
		if (npxCli) {
			execFileSync(process.execPath, [npxCli, ...npxArgs], {
				cwd: root,
				stdio: "inherit",
			});
		} else {
			const npx = process.platform === "win32" ? "npx.cmd" : "npx";
			execFileSync(npx, npxArgs, {
				cwd: root,
				stdio: "inherit",
				shell: process.platform === "win32",
			});
		}
	}
	console.log("Built dist/vendor/ pi-ai fallback bundles");
}

await buildVendoredPiAi();
