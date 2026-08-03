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
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
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
			} else if (code !== 0) {
				rejectRun(
					new Error(
						`Node exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}`,
					),
				);
			} else {
				resolveRun();
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
const rpcDriver = join(dirname(fileURLToPath(import.meta.url)), "rpc-load-check.mjs");
const piOptions = { cwd: project, env: environment, stdio: "inherit" };

try {
	// Pi treats a bare local path as a source extension, not an npm package.
	// Use npm's package@file tarball form so Pi installs the artifact and then
	// records the installed package name in its extension settings.
	const installSpec = `npm:pi-free@${pathToFileURL(tarball).href}`;
	console.log(`Installing ${tarball} through Pi (${piCli})`);
	await run([piCli, "install", installSpec], piOptions);
	console.log("Launching Pi RPC load check");
	await run([rpcDriver], piOptions, 45_000);
	console.log("Pi install smoke passed");
} catch (error) {
	console.error(`Pi install smoke failed: ${error.message}`);
	process.exitCode = 1;
} finally {
	rmSync(testRoot, { recursive: true, force: true });
}
