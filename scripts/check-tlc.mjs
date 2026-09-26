#!/usr/bin/env node
/**
 * TLC model-checking gate for tla/*.tla (see tla/README.md).
 *
 * Usage:
 *   node scripts/check-tlc.mjs [--list]
 *
 * --list prints the planned checks without needing a toolchain.
 * Otherwise every check in the HOLD/FALSIFY tables below runs through
 * TLC: holding configs must verify clean, falsifying configs must
 * produce their named violation (proving the specs catch the bug).
 *
 * Toolchain: Temurin JRE + tla2tools, pinned below, bootstrapped into
 * TLC_CACHE_DIR (default ~/.cache/pi-free-tlc). Override with TLC_JAVA /
 * TLC_JAR to reuse an existing toolchain and skip downloading. With
 * TLC_NO_DOWNLOAD=1 a missing toolchain is a hard error instead.
 */
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { get } from "node:https";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Pinned toolchain (verified 2026-09-26).
const JRE_VERSION = "21.0.12.1+1";
const JRE_URL =
	"https://github.com/adoptium/temurin21-binaries/releases/download/" +
	`jdk-21.0.12.1%2B1/OpenJDK21U-jre_x64_linux_hotspot_21.0.12.1_1.tar.gz`;
const TLC_VERSION = "v1.7.4";
const TLC_URL = `https://github.com/tlaplus/tlaplus/releases/download/${TLC_VERSION}/tla2tools.jar`;

const HOLD = [
	{ cfg: "RefreshB", module: "Refresh" },
	{ cfg: "RefreshR-B", module: "RefreshR" },
	{ cfg: "RefreshR-C", module: "RefreshR" },
	{ cfg: "ToggleA", module: "Toggle" },
	{ cfg: "ToggleC", module: "Toggle" },
];

const FALSIFY = [
	{ cfg: "RefreshA", module: "Refresh", invariant: "NoFalseClean" },
	{ cfg: "RefreshA-starve", module: "Refresh", invariant: "EventualRefresh" },
	{ cfg: "RefreshR-A", module: "RefreshR", invariant: "NoFalseClean" },
	{
		cfg: "RefreshR-A-starve",
		module: "RefreshR",
		invariant: "EventualRefresh",
	},
	{ cfg: "RefreshR-F", module: "RefreshR", invariant: "EventualRefresh" },
	{ cfg: "ToggleB", module: "Toggle", invariant: "NoSubsetAsAll" },
];

function usage(exitCode) {
	const lines = [
		"Usage: node scripts/check-tlc.mjs [--list]",
		"",
		"Runs TLC over every tla/*.cfg plan (see tla/README.md).",
		"Env: TLC_JAVA, TLC_JAR (toolchain overrides),",
		"     TLC_CACHE_DIR (default ~/.cache/pi-free-tlc),",
		"     TLC_NO_DOWNLOAD=1 (fail instead of downloading).",
	];
	process.stderr.write(lines.join("\n") + "\n");
	process.exit(exitCode);
}

function listPlans() {
	for (const { cfg, module } of HOLD) {
		process.stdout.write(`hold    ${cfg} (${module}): must verify clean\n`);
	}
	for (const { cfg, module, invariant } of FALSIFY) {
		process.stdout.write(
			`falsify ${cfg} (${module}): must violate ${invariant}\n`,
		);
	}
}

function fetchToFile(url, dest, redirects = 5) {
	return new Promise((resolve, reject) => {
		if (redirects < 0) {
			reject(new Error(`too many redirects fetching ${url}`));
			return;
		}
		get(url, { timeout: 120_000 }, (res) => {
			const status = res.statusCode ?? 0;
			if (status >= 300 && status < 400 && res.headers.location) {
				res.resume();
				resolve(fetchToFile(res.headers.location, dest, redirects - 1));
				return;
			}
			if (status !== 200) {
				res.resume();
				reject(new Error(`HTTP ${status} fetching ${url}`));
				return;
			}
			const out = createWriteStream(dest);
			res.pipe(out);
			out.on("finish", () => resolve());
			out.on("error", reject);
		}).on("error", reject);
	});
}

function run(cmd, args, opts = {}) {
	return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

async function ensureToolchain() {
	if (process.env.TLC_JAVA && process.env.TLC_JAR) {
		return { java: process.env.TLC_JAVA, jar: process.env.TLC_JAR };
	}
	const cacheDir =
		process.env.TLC_CACHE_DIR ?? join(homedir(), ".cache", "pi-free-tlc");
	const java = join(cacheDir, `jdk-${JRE_VERSION}-jre`, "bin", "java");
	const jar = join(cacheDir, "tla2tools.jar");
	if (existsSync(java) && existsSync(jar)) return { java, jar };
	if (process.env.TLC_NO_DOWNLOAD === "1") {
		throw new Error(
			`TLC toolchain missing in ${cacheDir} and TLC_NO_DOWNLOAD=1 ` +
				`(need java ${JRE_VERSION} + tla2tools ${TLC_VERSION})`,
		);
	}
	if (platform() !== "linux" || process.arch !== "x64") {
		throw new Error(
			`no pinned JRE for ${platform()}/${process.arch}: set TLC_JAVA + TLC_JAR`,
		);
	}
	mkdirSync(cacheDir, { recursive: true });
	process.stderr.write(`[tlc] downloading tla2tools ${TLC_VERSION}...\n`);
	await fetchToFile(TLC_URL, jar);
	process.stderr.write(`[tlc] downloading Temurin JRE ${JRE_VERSION}...\n`);
	const tarball = join(cacheDir, "jre.tar.gz");
	await fetchToFile(JRE_URL, tarball);
	const tar = run("tar", ["xzf", tarball, "-C", cacheDir]);
	if (tar.status !== 0) {
		throw new Error(`tar extract failed: ${(tar.stderr ?? "").trim()}`);
	}
	const smoke = run(java, ["-version"]);
	if (smoke.status !== 0) {
		throw new Error(
			`downloaded java fails to run: ${(smoke.stderr ?? "").trim()}`,
		);
	}
	return { java, jar };
}

function checkOne(java, jar, { cfg, module }) {
	const result = run(
		java,
		["-cp", jar, "tlc2.TLC", "-config", `tla/${cfg}.cfg`, `tla/${module}.tla`],
		{ cwd: REPO_ROOT, timeout: 10 * 60_000, maxBuffer: 16 * 1024 * 1024 },
	);
	if (result.error) throw result.error;
	return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

async function main() {
	const args = process.argv.slice(2);
	if (args.includes("--help") || args.includes("-h")) usage(0);
	if (args.includes("--list")) {
		listPlans();
		return;
	}
	if (args.length > 0) usage(2);

	const { java, jar } = await ensureToolchain();
	let failed = 0;
	for (const { cfg, module } of HOLD) {
		const output = checkOne(java, jar, { cfg, module });
		if (output.includes("No error has been found")) {
			process.stdout.write(`ok - ${cfg} (${module}): holds\n`);
		} else {
			failed += 1;
			process.stdout.write(`FAIL - ${cfg} (${module}): expected clean\n`);
			process.stdout.write(output.slice(-2000) + "\n");
		}
	}
	for (const { cfg, module, invariant } of FALSIFY) {
		const output = checkOne(java, jar, { cfg, module });
		if (output.includes(`Invariant ${invariant} is violated`)) {
			process.stdout.write(
				`ok - ${cfg} (${module}): falsifies ${invariant} as expected\n`,
			);
		} else {
			failed += 1;
			process.stdout.write(
				`FAIL - ${cfg} (${module}): expected violation of ${invariant}\n`,
			);
			process.stdout.write(output.slice(-2000) + "\n");
		}
	}
	if (failed > 0) {
		throw new Error(`${failed} TLC check(s) failed`);
	}
	process.stdout.write(`all ${HOLD.length + FALSIFY.length} TLC checks ok\n`);
}

main().catch((error) => {
	process.stderr.write(`check-tlc: ${error.message}\n`);
	process.exit(1);
});
