#!/usr/bin/env node
/**
 * Upgrade-path smoke test: install the latest PUBLISHED pi-free, then
 * upgrade it with the local tarball through Pi, and verify the upgraded
 * tree the same way install-test does.
 *
 * Long-lived agent dirs (stale peers, nested duplicates, half-pruned
 * trees) are where sick install shapes come from — a pristine install
 * never exercises them. This seeds reality first: a real previous release
 * installed the same way Pi installs it.
 *
 * Usage:
 *   node scripts/pi-upgrade-smoke.mjs ./pi-free-<version>.tgz
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const tarball = process.argv[2] && resolve(process.argv[2]);
if (!tarball || !existsSync(tarball)) {
	console.error("Usage: node scripts/pi-upgrade-smoke.mjs <pi-free-tarball>");
	process.exit(1);
}

function run(args, options, timeoutMs = 180_000) {
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
				const signalSuffix = signal ? ` (${String(signal)})` : "";
				rejectRun(new Error(`Node exited with code ${code ?? "unknown"}${signalSuffix}`));
			}
		});
	});
}

/** Run npm in isolation and return trimmed stdout. */
function npm(args, options, timeoutMs = 180_000) {
	return new Promise((resolveRun, rejectRun) => {
		const child = spawn(
			process.platform === "win32" ? "npm.cmd" : "npm",
			args,
			options,
		);
		let stdout = "";
		const timer = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				// The process may already have exited.
			}
			rejectRun(new Error(`npm timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		child.stdout?.on("data", (data) => {
			stdout += data.toString();
		});
		child.once("error", (error) => {
			clearTimeout(timer);
			rejectRun(error);
		});
		child.once("close", (code) => {
			clearTimeout(timer);
			if (code === 0) {
				resolveRun(stdout.trim());
			} else {
				rejectRun(new Error(`npm exited with code ${code ?? "unknown"}`));
			}
		});
	});
}

const testRoot = mkdtempSync(join(tmpdir(), "pi-free-upgrade-smoke-"));
const home = join(testRoot, "home");
const project = join(testRoot, "project");
mkdirSync(home);
mkdirSync(project);

const environment = { ...process.env };
for (const name of Object.keys(environment)) {
	if (/(?:API_KEY|APIKEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET)$/i.test(name)) {
		delete environment[name];
	}
}
environment.ANTHROPIC_API_KEY = "sk-ant-dummy-pi-free-upgrade-smoke";
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
const piOptions = { cwd: project, env: environment, stdio: "inherit" };

try {
	// Seed reality: the latest published release, installed exactly the way
	// Pi installs it. A failure here means no published baseline to upgrade
	// from (offline mirror, registry outage) — fail loudly, not silently.
	const published = await npm(["view", "pi-free", "version"], {
		cwd: project,
		env: environment,
	});
	console.log(`Seeding previous release pi-free@${published} through Pi`);
	await run([piCli, "install", `npm:pi-free@${published}`], piOptions);

	console.log(`Upgrading through Pi with ${tarball}`);
	const installSpec = `npm:pi-free@${pathToFileURL(tarball).href}`;
	await run([piCli, "install", installSpec], piOptions);

	console.log("Launching Pi RPC load check on the upgraded tree");
	await run([join(scriptDir, "rpc-load-check.mjs")], piOptions, 45_000);
	console.log("Launching Pi RPC session + filter check on the upgraded tree");
	await run([join(scriptDir, "rpc-session-check.mjs")], piOptions, 150_000);
	console.log("Pi upgrade smoke passed");
} catch (error) {
	console.error(
		`Pi upgrade smoke failed: ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exitCode = 1;
} finally {
	rmSync(testRoot, { recursive: true, force: true });
}
