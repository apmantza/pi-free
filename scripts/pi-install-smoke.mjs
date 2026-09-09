#!/usr/bin/env node
/**
 * End-to-end local package smoke test.
 *
 * Installs the supplied tarball through Pi's package manager in an isolated
 * HOME, then uses Pi's RPC mode to prove the extension was loaded. No model
 * request is made.
 *
 * Usage:
 *   node scripts/pi-install-smoke.mjs ./pi-free-<version>.tgz
 */
import { spawn } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdtempSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const tarball = process.argv[2] && resolve(process.argv[2]);
if (!tarball || !existsSync(tarball)) {
	console.error("Usage: node scripts/pi-install-smoke.mjs <pi-free-tarball>");
	process.exit(1);
}

function scrubSecrets(environment) {
	for (const name of Object.keys(environment)) {
		if (/(?:API_KEY|APIKEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET)$/i.test(name)) {
			delete environment[name];
		}
	}
	// Pi needs a provider to initialize RPC, but this value is deliberately fake.
	environment.ANTHROPIC_API_KEY = "sk-ant-dummy-pi-free-install-smoke";
	// Presence-only dummy so Pi's built-in opencode catalog is *available*
	// (availability gates on key presence, never validity). The toggle
	// check needs opencode-free in the snapshot; no model is ever called.
	environment.OPENCODE_API_KEY = "sk-opencode-dummy-pi-free-install-smoke";
}

function run(args, options, timeoutMs = 120_000) {
	return new Promise((resolveRun, rejectRun) => {
		const child = spawn(process.execPath, args, options);
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			try {
				child.kill("SIGKILL");
			} catch {
				// The process may already have exited.
			}
		}, timeoutMs);

		child.once("error", rejectRun);
		child.once("close", (code, signal) => {
			clearTimeout(timer);
			if (timedOut) {
				rejectRun(new Error(`Node timed out after ${timeoutMs}ms`));
			} else if (code === 0) {
				resolveRun();
			} else {
				const signalSuffix = signal ? " (" + String(signal) + ")" : "";
				const exitCode = code ?? "unknown";
				rejectRun(
					new Error(`Node exited with code ${exitCode}${signalSuffix}`),
				);
			}
		});
	});
}

const testRoot = mkdtempSync(join(tmpdir(), "pi-free-install-smoke-"));
const home = join(testRoot, "home");
const project = join(testRoot, "project");
mkdirSync(home);
mkdirSync(project);

const environment = { ...process.env };
scrubSecrets(environment);
// Pi and npm both consult HOME on POSIX; Node uses USERPROFILE for os.homedir()
// on Windows. Set both so the test cannot read or modify the runner's config.
environment.HOME = home;
environment.USERPROFILE = home;
environment.NPM_CONFIG_USERCONFIG = join(testRoot, "npmrc");
environment.NPM_CONFIG_CACHE = join(testRoot, "npm-cache");
environment.PI_FREE_FILE_LOG = "false";
delete environment.PI_CODING_AGENT_DIR;
delete environment.PI_CODING_AGENT_SESSION_DIR;
delete environment.PI_PACKAGE_DIR;

const piModule = fileURLToPath(
	import.meta.resolve("@earendil-works/pi-coding-agent"),
);
const piCli = join(dirname(piModule), "cli.js");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const rpcDriver = join(scriptDir, "rpc-load-check.mjs");
const rpcSessionDriver = join(scriptDir, "rpc-session-check.mjs");
const rpcToggleDriver = join(scriptDir, "rpc-toggle-check.mjs");
const rpcRestoreDriver = join(scriptDir, "rpc-restore-check.mjs");
const piOptions = { cwd: project, env: environment, stdio: "inherit" };

// Seed an explicit free_only default so the session check's filter
// assertions do not depend on template defaults (deterministic input).
mkdirSync(join(home, ".pi"), { recursive: true });
writeFileSync(
	join(home, ".pi", "free.json"),
	JSON.stringify({ free_only: true }, null, 2),
);

try {
	// Pi treats a bare local path as a source extension, not an npm package.
	// Use npm's package@file tarball form so Pi installs the artifact and then
	// records the installed package name in its extension settings.
	const installSpec = `npm:pi-free@${pathToFileURL(tarball).href}`;
	console.log(`Installing ${tarball} through Pi (${piCli})`);
	await run([piCli, "install", installSpec], piOptions);
	console.log("Launching Pi RPC load check");
	await run([rpcDriver], piOptions, 45_000);
	console.log("Launching Pi RPC session + filter check");
	await run([rpcSessionDriver], piOptions, 420_000);
	console.log("Launching Pi RPC toggle check");
	await run([rpcToggleDriver], piOptions, 420_000);
	console.log("Launching Pi RPC restore check");
	await run([rpcRestoreDriver], piOptions, 420_000);
	console.log("Pi install smoke passed");
} catch (error) {
	console.error(`Pi install smoke failed: ${error.message}`);
	preserveArtifacts("install");
	process.exitCode = 1;
} finally {
	rmSync(testRoot, { recursive: true, force: true });
}

/**
 * Copy the isolated HOME's diagnostics out of the temp dir (which the
 * finally block deletes) into the checkout, so CI can upload them as
 * failure artifacts. Best-effort: never fail the smoke itself.
 */
function preserveArtifacts(label) {
	try {
		const dir = join(process.cwd(), ".smoke-artifacts", `${label}-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		for (const file of ["free.log", "free.json"]) {
			const src = join(home, ".pi", file);
			if (existsSync(src)) copyFileSync(src, join(dir, file));
		}
		console.log(`Preserved smoke artifacts in ${dir}`);
	} catch {
		// Artifact preservation must not mask the original failure.
	}
}
