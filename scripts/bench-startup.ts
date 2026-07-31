/**
 * Startup benchmark for pi-free.
 *
 * Times the `piFreeEntry` extension factory — the exact thing Pi awaits before
 * flushing provider registrations — under controlled cache/network conditions,
 * so startup performance can be measured rather than guessed. Run it before and
 * after a change to get a real before/after delta.
 *
 * Usage (via tsx, which is already a dev dependency):
 *   npx tsx scripts/bench-startup.ts <warm|cold|fastcold>
 *
 * Modes:
 *   warm     - Sandbox seeded with your real ~/.pi/provider-cache.json (timestamps
 *              freshened to "now") and ~/.pi/free.json, so every configured
 *              provider that still uses the disk cache registers with ZERO network.
 *              Kilo and Cline now use the native models store instead: after the
 *              factory the bench seeds an in-memory store (Pi's real one lives at
 *              ~/.pi/agent/models-store.json) and drives each native provider's
 *              refreshModels(allowNetwork:false) to prove offline init populates its
 *              catalog with zero network (kiloOfflineInitMs / kiloOfflineModels,
 *              clineOfflineInitMs / clineOfflineModels).
 *              NOTE: copies your free.json (which may contain API keys) into a local
 *              temp dir that is deleted on exit; nothing leaves the machine.
 *   cold     - Empty cache + your real API keys, with fetch mocked to HANG until
 *              the caller aborts. Simulates a cold/stale cache with unresponsive
 *              provider APIs — the worst case. Bounded by STARTUP_FETCH_DEADLINE_MS.
 *   fastcold - Empty cache, fetch mocked to resolve instantly with an empty model
 *              list. Measures the cold code path with a fast network.
 *
 * Each invocation runs the factory once in a fresh process (module state is
 * singleton, so re-running in-process is not representative). For stable numbers,
 * run in a loop, e.g.:
 *   for i in 1 2 3 4 5; do npx tsx scripts/bench-startup.ts warm; done
 *
 * Prints a human-readable summary plus a `RESULT {...}` JSON line for scripting.
 */
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const mode = process.argv[2] ?? "warm";
if (!["warm", "cold", "fastcold"].includes(mode)) {
	console.error("Usage: tsx scripts/bench-startup.ts <warm|cold|fastcold>");
	process.exit(2);
}

// Capture the REAL home before we override HOME/USERPROFILE for the sandbox.
const REAL_HOME = process.env.USERPROFILE || process.env.HOME || homedir();
const REAL_PI = join(REAL_HOME, ".pi");

// ---------------------------------------------------------------------------
// Sandboxed HOME so we never touch the user's real ~/.pi state. Cleaned up on
// exit (best-effort).
// ---------------------------------------------------------------------------
const sandbox = mkdtempSync(join(tmpdir(), "pifree-bench-"));
const piDir = join(sandbox, ".pi");
mkdirSync(piDir, { recursive: true });
process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox;

function cleanup(): void {
	try {
		rmSync(sandbox, { recursive: true, force: true });
	} catch {
		// best-effort
	}
}
process.on("exit", cleanup);

const MINIMAL_CONFIG = JSON.stringify(
	{ free_only: true, hidden_models: [] },
	null,
	2,
);

function freshenCache(src: string, dest: string): number {
	const raw = JSON.parse(readFileSync(src, "utf-8"));
	const now = new Date().toISOString();
	let n = 0;
	for (const v of Object.values<any>(raw.providers ?? {})) {
		v.fetchedAt = now;
		n++;
	}
	writeFileSync(dest, JSON.stringify(raw));
	return n;
}

let seededProviders = 0;
if (mode === "warm") {
	const cacheSrc = join(REAL_PI, "provider-cache.json");
	if (existsSync(cacheSrc)) {
		seededProviders = freshenCache(cacheSrc, join(piDir, "provider-cache.json"));
	}
	const cfgSrc = join(REAL_PI, "free.json");
	if (existsSync(cfgSrc)) copyFileSync(cfgSrc, join(piDir, "free.json"));
	else writeFileSync(join(piDir, "free.json"), MINIMAL_CONFIG);
} else if (mode === "cold") {
	// Real keys, no cache: realistic worst case when the TTL expires.
	const cfgSrc = join(REAL_PI, "free.json");
	if (existsSync(cfgSrc)) copyFileSync(cfgSrc, join(piDir, "free.json"));
	else writeFileSync(join(piDir, "free.json"), MINIMAL_CONFIG);
} else {
	writeFileSync(join(piDir, "free.json"), MINIMAL_CONFIG);
}

// ---------------------------------------------------------------------------
// Fetch mock (installed before import so module-level fetchers see it).
// ---------------------------------------------------------------------------
let fetchCalls = 0;
const fetchUrls: string[] = [];

function mockResponse(url: string): Response {
	return {
		ok: true,
		status: 200,
		statusText: "OK",
		url,
		json: async () => ({ data: [] }),
		text: async () => "{}",
		headers: new Headers(),
	} as unknown as Response;
}

function urlOf(input: any): string {
	return typeof input === "string" ? input : (input?.url ?? String(input));
}

if (mode === "cold") {
	// Hang until the caller's AbortSignal fires (a dead API that only dies when
	// the client gives up). Respects the signal so the timeout budget bounds us.
	globalThis.fetch = ((input: any, init?: any) => {
		fetchCalls++;
		fetchUrls.push(urlOf(input));
		return new Promise((_resolve, reject) => {
			const signal: AbortSignal | undefined = init?.signal;
			if (signal?.aborted) {
				reject(new DOMException("Aborted", "AbortError"));
				return;
			}
			signal?.addEventListener("abort", () =>
				reject(new DOMException("Aborted", "AbortError")),
			);
		});
	}) as any;
} else {
	// warm: should make ZERO calls (cache is fresh). fastcold: instant empty list.
	globalThis.fetch = (async (input: any) => {
		fetchCalls++;
		fetchUrls.push(urlOf(input));
		return mockResponse(urlOf(input));
	}) as any;
}

// ---------------------------------------------------------------------------
// Mock ExtensionAPI
// ---------------------------------------------------------------------------
const registered = new Map<string, number>();
// Native createProvider object registrations (registerProvider(provider)), keyed
// by provider id, so we can exercise their refreshModels offline-init path below.
const nativeProviders = new Map<string, any>();
const mockPi: any = {
	registerProvider: (idOrProvider: any, cfg: any) => {
		// Native object form: a Provider has an id + sync getModels().
		if (
			idOrProvider &&
			typeof idOrProvider === "object" &&
			typeof idOrProvider.getModels === "function"
		) {
			nativeProviders.set(idOrProvider.id, idOrProvider);
			registered.set(idOrProvider.id, idOrProvider.getModels().length);
			return;
		}
		registered.set(idOrProvider, (cfg?.models ?? []).length);
	},
	registerCommand: () => {},
	on: () => {},
};

// ---------------------------------------------------------------------------
// Import (tsx transpile happens here, OUTSIDE the timed region), then time only
// the factory — that is what Pi awaits before flushing registrations.
// ---------------------------------------------------------------------------
const mod = await import("../index.ts");
const { getStartupSummary, formatStartupSummary } = await import(
	"../lib/startup-timing.ts"
);

const t0 = performance.now();
await mod.default(mockPi);
const t1 = performance.now();

const summary = getStartupSummary();
const factoryMs = Math.round((t1 - t0) * 10) / 10;

// ---------------------------------------------------------------------------
// Exercise Kilo's native offline-init path. Kilo no longer fetches in the
// factory; Pi calls refreshModels(allowNetwork:false) to restore the catalog
// from the models store (Pi's real store: ~/.pi/agent/models-store.json). Seed an
// in-memory store and confirm Kilo populates from it with ZERO network, fast.
// ---------------------------------------------------------------------------
let kiloOfflineInitMs: number | null = null;
let kiloOfflineModels = 0;
const kilo = nativeProviders.get("kilo");
if (kilo && typeof kilo.refreshModels === "function") {
	const seededModels = [0, 1, 2].map((i) => ({
		id: `kilo-seeded-${i}`,
		name: `Kilo Seeded Free ${i}`,
		api: "openai-completions",
		provider: "kilo",
		baseUrl: "https://api.kilo.ai/api/gateway",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	}));
	let entry: any = { models: seededModels, checkedAt: Date.now() };
	const store = {
		read: async () => entry,
		write: async (e: any) => {
			entry = e;
		},
		delete: async () => {
			entry = undefined;
		},
	};
	const fetchBefore = fetchCalls;
	const t2 = performance.now();
	await kilo.refreshModels({
		store,
		allowNetwork: false,
		signal: AbortSignal.timeout(2000),
	});
	const t3 = performance.now();
	kiloOfflineInitMs = Math.round((t3 - t2) * 100) / 100;
	kiloOfflineModels = kilo.getModels().length;
	if (fetchCalls !== fetchBefore) {
		console.log("WARN: Kilo offline init made a network call");
	}
}
const kiloFactoryNetworkCalls = fetchUrls.filter((u) =>
	u.includes("kilo"),
).length;

// ---------------------------------------------------------------------------
// Exercise Cline's native offline-init path (same contract as Kilo, custom
// "cline-xml-tools" wire api). Cline's catalog is public, so at runtime Pi
// drives this even for logged-out users; here we only prove the store restore.
// ---------------------------------------------------------------------------
let clineOfflineInitMs: number | null = null;
let clineOfflineModels = 0;
const cline = nativeProviders.get("cline");
if (cline && typeof cline.refreshModels === "function") {
	const seededModels = [0, 1, 2].map((i) => ({
		id: `cline-seeded-${i}`,
		name: `Cline Seeded Free ${i}`,
		api: "cline-xml-tools",
		provider: "cline",
		baseUrl: "https://api.cline.bot/api/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	}));
	let entry: any = { models: seededModels, checkedAt: Date.now() };
	const store = {
		read: async () => entry,
		write: async (e: any) => {
			entry = e;
		},
		delete: async () => {
			entry = undefined;
		},
	};
	const fetchBefore = fetchCalls;
	const t2 = performance.now();
	await cline.refreshModels({
		store,
		allowNetwork: false,
		signal: AbortSignal.timeout(2000),
	});
	const t3 = performance.now();
	clineOfflineInitMs = Math.round((t3 - t2) * 100) / 100;
	clineOfflineModels = cline.getModels().length;
	if (fetchCalls !== fetchBefore) {
		console.log("WARN: Cline offline init made a network call");
	}
}
const clineFactoryNetworkCalls = fetchUrls.filter((u) =>
	u.includes("cline"),
).length;

console.log(`\nmode: ${mode}`);
console.log(`factory (awaited by Pi): ${factoryMs}ms`);
console.log(`registered providers: ${registered.size}`);
console.log(`network calls during factory: ${fetchCalls}`);
console.log(`kilo factory network calls: ${kiloFactoryNetworkCalls}`);
if (kiloOfflineInitMs !== null) {
	console.log(
		`kilo offline-init (from models store, 0 network): ${kiloOfflineInitMs}ms -> ${kiloOfflineModels} models`,
	);
}
console.log(`cline factory network calls: ${clineFactoryNetworkCalls}`);
if (clineOfflineInitMs !== null) {
	console.log(
		`cline offline-init (from models store, 0 network): ${clineOfflineInitMs}ms -> ${clineOfflineModels} models`,
	);
}
console.log("");
console.log(formatStartupSummary());

const result = {
	mode,
	factoryMs,
	summaryTotalMs: summary.totalMs,
	seededProviders,
	registeredProviders: registered.size,
	fetchCalls,
	cacheHits: summary.cacheHits,
	networkFetches: summary.networkFetches,
	failures: summary.failures,
	fetchUrls: [...new Set(fetchUrls)].slice(0, 12),
	kiloFactoryNetworkCalls,
	kiloOfflineInitMs,
	kiloOfflineModels,
	clineFactoryNetworkCalls,
	clineOfflineInitMs,
	clineOfflineModels,
};
console.log("\nRESULT " + JSON.stringify(result));

// Exit now so dangling background fetches (cold mode) don't hold the process.
process.exit(0);
