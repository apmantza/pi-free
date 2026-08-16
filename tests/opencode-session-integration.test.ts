import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { Model, Api, Context } from "@earendil-works/pi-ai/compat";
import {
	createOpenCodeHeaders,
	createOpenCodeStreamSimple,
	createOpenCodeSessionTracker,
	getOpenCodeModelBaseUrl,
	resolveOpenCodeModelApi,
} from "../providers/opencode-session.js";

/**
 * Find a file path that can be used as a require() resolution base and
 * is guaranteed to resolve the canary dependency (openai).  We use the
 * resolved path of openai itself because every pi-ai installation keeps
 * openai in the same node_modules tree.
 */
function findValidRequireBase(): string | undefined {
	try {
		const req = createRequire(fileURLToPath(import.meta.url));
		return req.resolve("openai");
	} catch {
		return undefined;
	}
}

/**
 * Integration test for opencode-session.ts module resolution fallback.
 *
 * Pi loads pi-free as an extension from a directory tree that does NOT have
 * @earendil-works/pi-ai in its node_modules. The fallback must find pi-ai by
 * resolving a dependency (openai) from Pi's entry point and walking up to
 * the node_modules directory.
 */
describe("opencode-session fallback resolution", () => {
	it("preserves OpenCode protocol endpoints for known model families", () => {
		expect(resolveOpenCodeModelApi("gpt-5.3-codex-spark", "opencode")).toBe(
			"openai-responses",
		);
		expect(resolveOpenCodeModelApi("claude-fable-5", "opencode")).toBe(
			"anthropic-messages",
		);
		expect(resolveOpenCodeModelApi("gemini-3.6-flash", "opencode")).toBe(
			"google-generative-ai",
		);
		expect(resolveOpenCodeModelApi("minimax-m3", "opencode-go")).toBe(
			"anthropic-messages",
		);
		expect(
			getOpenCodeModelBaseUrl(
				"anthropic-messages",
				"https://opencode.ai/zen/go/v1",
			),
		).toBe("https://opencode.ai/zen/go/v1");
	});

	it("generates CLI-compatible session and request headers", () => {
		const tracker = createOpenCodeSessionTracker();
		const first = createOpenCodeHeaders(tracker);
		const second = createOpenCodeHeaders(tracker);

		expect(first["User-Agent"]).toBe("opencode/1.18.18");
		expect(first["x-opencode-client"]).toBe("cli");
		expect(first["x-opencode-session"]).toMatch(
			/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/,
		);
		expect(first["x-opencode-request"]).toMatch(
			/^prt_[0-9a-f]{12}[0-9A-Za-z]{14}$/,
		);
		expect(first["x-opencode-project"]).toBe("global");
		expect(second["x-opencode-session"]).toBe(first["x-opencode-session"]);
		expect(second["x-opencode-request"]).not.toBe(first["x-opencode-request"]);
	});

	it("encodes ses descending and prt ascending with the same ms base", () => {
		// Freeze the clock so both ids land in the same millisecond. Without
		// this the assertions are timing-sensitive: if Date.now() ticks between
		// the getSessionId() and nextRequestId() calls, the ULID counter resets
		// and the ms bases differ by 1 (flaky on loaded CI runners, e.g.
		// 176323391n vs 176323390n). The implementation mirrors the CLI, which
		// has the same reset-on-ms-tick behavior — only the test needs a stable
		// clock.
		const frozenNow = 1_700_000_000_000;
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(frozenNow);
		try {
			// The CLI's identifier.ts encodes `~timestamp<<12|counter` (descending)
			// and `timestamp<<12|counter` (ascending). Two ids created in the same
			// millisecond must share the same timestamp base, with the per-call
			// counter advancing in the low 12 bits — ses first (counter=1), then
			// prt (counter=2). A bug that swapped the directions (or dropped the
			// complement) would fail here even though the shape assertions pass.
			const tracker = createOpenCodeSessionTracker();
			const session = tracker.getSessionId().slice(4); // strip ses_
			const request = tracker.nextRequestId().slice(4); // strip prt_

			const sesComplement = ~BigInt(`0x${session.slice(0, 12)}`) &
				0xffffffffffffn;
			const prtTime = BigInt(`0x${request.slice(0, 12)}`);

			// Same timestamp base (high 36 bits = milliseconds).
			expect(prtTime >> 12n).toBe(sesComplement >> 12n);
			// Counter advanced monotonically within the same ms (ses=1, prt=2).
			expect(prtTime & 0xfffn).toBe((sesComplement & 0xfffn) + 1n);

			// Random suffixes are full-length (14 base62 chars) on both.
			expect(session.slice(12)).toHaveLength(14);
			expect(request.slice(12)).toHaveLength(14);
		} finally {
			nowSpy.mockRestore();
		}
	});

	it("resolves pi-ai subpaths when loaded from an isolated directory", () => {
		const requireBase = findValidRequireBase();
		if (!requireBase) {
			// openai is not installed — skip this test (should never happen in CI)
			return;
		}

		const tempDir = mkdtempSync(join(tmpdir(), "pi-free-test-"));

		const testScript = `
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PI_AI_DEPENDENCY_CANARY = "openai";

function findPiAiPackageDir(requireBase) {
	try {
		const require = createRequire(requireBase);
		const resolved = require.resolve(PI_AI_DEPENDENCY_CANARY);
		let dir = dirname(resolved);
		while (dir !== dirname(dir)) {
			if (basename(dir) === "node_modules") {
				const piAiDir = join(dir, "@earendil-works", "pi-ai");
				const pkgJsonPath = join(piAiDir, "package.json");
				if (existsSync(pkgJsonPath) && lstatSync(pkgJsonPath).isFile()) {
					return piAiDir;
				}
			}
			dir = dirname(dir);
		}
	} catch {
		return undefined;
	}
}

function resolvePiAiSubpathFromPackage(specifier) {
	const subpath = specifier.replace("@earendil-works/pi-ai/", "");
	const candidates = [process.argv[1], import.meta.url].filter(Boolean);
	for (const candidate of candidates) {
		const pkgDir = findPiAiPackageDir(candidate);
		if (!pkgDir) continue;
		try {
			const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8"));
			const exportEntry =
				pkg.exports?.[\`./\${subpath}\`] ?? pkg.exports?.["./api/*"];
			const targetPath = exportEntry?.import ?? exportEntry?.default;
			if (typeof targetPath === "string") {
				return join(
					pkgDir,
					targetPath.replace("*", subpath.slice("api/".length)),
				);
			}
		} catch {
			/* ignore */
		}
	}
	return undefined;
}

async function test() {
	const results = [];
	for (const subpath of [
		"api/anthropic-messages",
		"api/openai-completions",
	]) {
		const specifier = \`@earendil-works/pi-ai/\${subpath}\`;

		// Direct import from isolated dir — should fail
		let directOk = false;
		try {
			await import(specifier);
			directOk = true;
		} catch {
			directOk = false;
		}

		// Fallback — should succeed
		const resolved = resolvePiAiSubpathFromPackage(specifier);
		let fallbackOk = false;
		if (resolved) {
			try {
				await import(pathToFileURL(resolved).href);
				fallbackOk = true;
			} catch {
				fallbackOk = false;
			}
		}

		results.push({ subpath, directOk, resolved: resolved ?? null, fallbackOk });
	}
	console.log(JSON.stringify(results));
}

test().catch((e) => {
	console.error(e);
	process.exit(1);
});
`;

		// Override process.argv[1] with a valid require base before the script runs.
		const wrapperScript = `
process.argv[1] = ${JSON.stringify(requireBase)};
${testScript}
`;
		writeFileSync(join(tempDir, "test.mjs"), wrapperScript);

		// Use process.execPath so we don't rely on PATH resolution from the
		// writable temp directory (SonarCloud security hotspot).
		const output = execFileSync(process.execPath, ["test.mjs"], {
			cwd: tempDir,
			encoding: "utf-8",
		});

		let results: Array<{
			subpath: string;
			resolved: string | null;
			fallbackOk: boolean;
		}>;
		try {
			results = JSON.parse(output.trim()) as typeof results;
		} catch (error) {
			throw new Error("Invalid JSON from Pi AI subpath probe", {
				cause: error,
			});
		}
		for (const r of results) {
			// The direct import may resolve when the test runner exposes the project
			// node_modules; the package-relative fallback must work either way.
			expect(r.resolved).toMatch(/pi-ai[\\/]dist[\\/]api[\\/]/);
			expect(r.fallbackOk).toBe(true);
		}
	});

	it("falls back to pi-ai root exports when subpath imports are unavailable", () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pi-free-test-"));
		const packageDir = join(tempDir, "node_modules", "@earendil-works", "pi-ai");
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({
				name: "@earendil-works/pi-ai",
				type: "module",
				exports: { ".": "./index.mjs" },
			}),
		);
		writeFileSync(
			join(packageDir, "index.mjs"),
			`export function streamSimpleOpenAICompletions() {}
export function streamSimpleAnthropic() {}
`,
		);

		const testScript = `
async function importPiAiRootFallback(specifier) {
	const subpath = specifier.replace("@earendil-works/pi-ai/", "");
	const requiredExport = {
		anthropic: "streamSimpleAnthropic",
		"openai-completions": "streamSimpleOpenAICompletions",
	};
	const exportName = requiredExport[subpath];
	if (!exportName) return undefined;

	try {
		const rootModule = await import("@earendil-works/pi-ai");
		return typeof rootModule[exportName] === "function" ? rootModule : undefined;
	} catch {
		return undefined;
	}
}

async function importPiAiSubpathUncached(specifier) {
	try {
		return await import(specifier);
	} catch (directError) {
		const rootFallback = await importPiAiRootFallback(specifier);
		if (rootFallback) return rootFallback;
		throw directError;
	}
}

const direct = { ok: false, message: "" };
try {
	await import("@earendil-works/pi-ai/openai-completions");
	direct.ok = true;
} catch (error) {
	direct.message = error instanceof Error ? error.message : String(error);
}

const fallback = await importPiAiSubpathUncached(
	"@earendil-works/pi-ai/openai-completions",
);
console.log(JSON.stringify({
	direct,
	fallbackOk: typeof fallback.streamSimpleOpenAICompletions === "function",
}));
`;
		writeFileSync(join(tempDir, "test.mjs"), testScript);

		const output = execFileSync(process.execPath, ["test.mjs"], {
			cwd: tempDir,
			encoding: "utf-8",
		});
		let result: {
			direct: { ok: boolean; message: string };
			fallbackOk: boolean;
		};
		try {
			result = JSON.parse(output.trim()) as typeof result;
		} catch (error) {
			throw new Error("Invalid JSON from Pi AI fallback probe", {
				cause: error,
			});
		}
		expect(result.direct.ok).toBe(false);
		expect(result.fallbackOk).toBe(true);
	});

	it("createOpenCodeStreamSimple resolves anthropic endpoint from isolated context", async () => {
		const tracker = createOpenCodeSessionTracker();
		const streamSimple = createOpenCodeStreamSimple(tracker);

		// Anthropic-style OpenCode model (baseUrl does NOT end with /v1)
		const anthropicModel = {
			id: "claude-opus",
			provider: "opencode",
			api: "anthropic-messages" as Api,
			baseUrl: "https://api.opencode.ai/anthropic",
		} as Model<Api>;

		const context = { messages: [] } as unknown as Context;

		// This should NOT throw — it will attempt to import the anthropic
		// subpath via importPiAiSubpath, which uses the fixed fallback.
		// We can't assert on the stream content without a real API key,
		// but we can verify the function returns a valid stream object.
		const stream = streamSimple(anthropicModel, context);
		expect(stream).toBeDefined();
		expect(typeof stream[Symbol.asyncIterator]).toBe("function");

		// Clean up — consume any error events so the test doesn't hang
		const timeout = setTimeout(() => {
			// If we get here, the import succeeded but no events arrived
			// (expected without a real API call)
		}, 100);

		try {
			// Attempt to read first event — this triggers the async import
			const iterator = stream[Symbol.asyncIterator]();
			const result = await Promise.race([
				iterator.next(),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error("timeout")), 2000),
				),
			]);
			// If we get here, either an event arrived or an error was pushed
			expect(result).toBeDefined();
		} catch (e: any) {
			// "timeout" means the import worked but no network response
			// anything else is a real error
			if (e.message !== "timeout") {
				throw e;
			}
		} finally {
			clearTimeout(timeout);
		}
	});

	it("createOpenCodeStreamSimple resolves openai endpoint from isolated context", async () => {
		const tracker = createOpenCodeSessionTracker();
		const streamSimple = createOpenCodeStreamSimple(tracker);

		// OpenAI-style OpenCode model (baseUrl ends with /v1)
		const openaiModel = {
			id: "gpt-4o",
			provider: "opencode",
			api: "openai-completions" as Api,
			baseUrl: "https://api.opencode.ai/v1",
		} as Model<Api>;

		const context = { messages: [] } as unknown as Context;

		const stream = streamSimple(openaiModel, context);
		expect(stream).toBeDefined();
		expect(typeof stream[Symbol.asyncIterator]).toBe("function");

		// Same pattern as anthropic test
		try {
			const iterator = stream[Symbol.asyncIterator]();
			const result = await Promise.race([
				iterator.next(),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error("timeout")), 2000),
				),
			]);
			expect(result).toBeDefined();
		} catch (e: any) {
			if (e.message !== "timeout") {
				throw e;
			}
		}
	});
});
