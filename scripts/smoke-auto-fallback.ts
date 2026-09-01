#!/usr/bin/env npx tsx
/**
 * Smoke test for the auto-fallback status surface (#496 fix branch).
 *
 * Unlike tests/auto-fallback.integration.test.ts (which mocks the
 * ExtensionAPI and the model registry), this drives createAutoFallback()
 * against a REAL pi-coding-agent ModelRuntime:
 *
 *   - real ModelRegistry (auth gates, setModel semantics, getAll())
 *   - an in-memory models store seeded with two free "providers"
 *   - real credential store on a temp HOME (no user config touched)
 *
 * It then emits a realistic failure sequence (message_end -> agent_settled)
 * and asserts the observable STATUS surface end to end:
 *
 *   1. getStatus() before anything: enabled=false (default), 0 switches
 *   2. after enable + failure + settle: switched=1, blacklist=1
 *   3. after a clean run on the new model: recovery (un-ban + refill)
 *   4. /pi-free-health's formatHealthReport() contains the auto_fallback
 *      line — proving the lib/auto-fallback-status.ts registration works
 *      through the real wiring (no circular import, live handle).
 *
 * Exit code 0 = all assertions passed. No network calls; no user files.
 *
 * Usage: npx tsx scripts/smoke-auto-fallback.ts
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate HOME so the real ModelRuntime's auth storage + models store
// never touch the developer's ~/.pi. Must happen BEFORE importing
// pi-coding-agent (getAgentDir() reads env lazily, but be safe).
const sandbox = mkdtempSync(join(tmpdir(), "pi-free-afb-smoke-"));
process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox;
process.env.PI_FREE_CONFIG_PATH = join(sandbox, "free.json");

function fail(message: string): never {
	console.error(`✗ ${message}`);
	rmSync(sandbox, { recursive: true, force: true });
	process.exit(1);
}

// --- Real pi-coding-agent runtime -----------------------------------------

const pca = await import("@earendil-works/pi-coding-agent");

const store: {
	entry?: unknown;
} = {};
const modelsStore = {
	async read() {
		return store.entry as never;
	},
	async write(entry: unknown) {
		store.entry = entry;
	},
};

// Real ModelRuntime: offline, isolated stores, no built-in providers needed.
const runtime = await pca.ModelRuntime.create({
	modelsStore: modelsStore as never,
	allowModelNetwork: false,
	refreshOnCreate: false,
	modelsPath: null,
});

// Seed two "providers" with free models via the real registration path.
// hasConfiguredAuth must be true for the fallback target — give the target
// provider a runtime API key (real credential path, stored in the sandbox).
const registry = new pca.ModelRegistry(runtime);

// Register kilo-like failing provider (config form) + a target provider.
runtime.registerProvider("afb-failing", {
	name: "AFB Failing",
	baseUrl: "https://afb-failing.invalid/v1",
	api: "openai-completions",
	models: [
		{
			id: "afb-fail-model",
			name: "AFB Fail Model",
			reasoning: false,
			attachment: false,
			contextWindow: 128000,
			maxTokens: 8192,
		},
	],
} as never);
runtime.registerProvider("afb-target", {
	name: "AFB Target",
	baseUrl: "https://afb-target.invalid/v1",
	api: "openai-completions",
	models: [
		{
			id: "afb-target-model",
			name: "AFB Target Model",
			reasoning: false,
			attachment: false,
			contextWindow: 128000,
			maxTokens: 8192,
		},
	],
} as never);
// Real configured auth for the target so hasConfiguredAuth passes.
runtime.setRuntimeApiKey("afb-target", "afb-smoke-key-not-real");

await registry.refresh({ allowNetwork: false });
if (!registry.hasConfiguredAuth({ provider: "afb-target" } as never)) {
	fail("afb-target should have configured auth after setRuntimeApiKey");
}
if (registry.hasConfiguredAuth({ provider: "afb-failing" } as never)) {
	fail("afb-failing should NOT have configured auth");
}

// Seed pi-free's OWN provider registry (the toggle-system registry that
// auto-fallback's candidate pool reads). In production, registerWithGlobalToggle
// fills this at provider registration time; the smoke seeds it directly with
// the same ProviderEntry shape.
const { getProviderRegistry } = await import("../lib/registry.ts");
// SAFETY: the production registry is populated through registerWithGlobalToggle
// at provider-registration time; the smoke seeds it directly with the same
// ProviderEntry shape. The runtime map is mutable even though the public
// getter types it Readonly, hence the double cast.
const providerRegistry = getProviderRegistry() as unknown as Map<
	string,
	{ stored: { free: unknown[]; all: unknown[] }; reRegister: () => void }
>;
providerRegistry.set("afb-failing", {
	stored: {
		free: [{ id: "afb-fail-model", name: "AFB Fail Model" }],
		all: [{ id: "afb-fail-model", name: "AFB Fail Model" }],
	},
	reRegister: () => {},
});
providerRegistry.set("afb-target", {
	stored: {
		free: [{ id: "afb-target-model", name: "AFB Target Model" }],
		all: [{ id: "afb-target-model", name: "AFB Target Model" }],
	},
	reRegister: () => {},
});

// --- Wire the extension's auto-fallback ------------------------------------

const { createAutoFallback } = await import("../lib/auto-fallback/index.ts");
const { registerAutoFallbackStatusGetter } = await import(
	"../lib/auto-fallback-status.ts"
);
const { formatHealthReport } = await import("../lib/health.ts");
const { loadConfigFile, updateConfig } = await import("../config.ts");

type Emit = (event: string, payload: unknown, ctx: unknown) => Promise<void>

const handlers: Record<string, Array<(e: unknown, ctx: unknown) => unknown>> =
	{};
const setModelCalls: unknown[] = [];
const sentMessages: unknown[] = [];

const mockPi = {
	on(event: string, handler: (e: unknown, ctx: unknown) => unknown) {
		(handlers[event] ??= []).push(handler);
	},
	registerCommand() {},
	// Real ModelRegistry object — the smoke test's whole point.
	setModel: async (model: unknown) => {
		setModelCalls.push(model);
		return true;
	},
	sendUserMessage: async (content: unknown) => {
		sentMessages.push(content);
	},
};

const handle = createAutoFallback();
handle.register(mockPi as never);
registerAutoFallbackStatusGetter(() => handle);

const emit: Emit = async (event, payload, ctx) => {
	for (const handler of handlers[event] ?? []) await handler(payload, ctx);
};

const makeCtx = (provider: string, id: string) => ({
	model: { provider, id },
	modelRegistry: registry,
	ui: { notify: () => {}, setStatus: () => {} },
});

// --- 1. Default state: feature OFF, zero switches ---------------------------

// config.ts seeds CONFIG_TEMPLATE on first read; with the corrected
// template the feature is seeded OFF (opt-in), never ON.
const cfgBefore = loadConfigFile();
if (cfgBefore.auto_fallback !== false) {
	fail(
		`fresh sandbox config should seed auto_fallback: false (opt-in), got ${String(cfgBefore.auto_fallback)}`,
	);
}
const status0 = handle.getStatus();
if (status0.enabled !== false) fail(`default enabled should be false, got ${status0.enabled}`);
if (status0.switchCount !== 0) fail(`initial switchCount should be 0, got ${status0.switchCount}`);
console.log(`✓ 1. default status: enabled=false, switches=0 (opt-in by default)`);

// --- 2. Enable via the real config path, then fail + settle -----------------

await updateConfig((current) => ({
	...(current as Record<string, unknown>),
	auto_fallback: true,
}));
if (handle.getStatus().enabled !== true) {
	fail("getStatus().enabled should be true after updateConfig({auto_fallback:true})");
}
console.log(`✓ 2. config round-trip: /toggle-style write is visible to getStatus()`);

// Realistic failure sequence against the REAL registry: the failing
// provider has NO configured auth on its models (pi-free's anonymous-
// catalog shape) — hasConfiguredAuth gating is exercised at selection.
await emit(
	"message_end",
	{
		message: {
			role: "assistant",
			provider: "afb-failing",
			model: "afb-fail-model",
			stopReason: "error",
			errorMessage: "rate limit exceeded",
		},
	},
	makeCtx("afb-failing", "afb-fail-model"),
);
await emit("agent_settled", {}, makeCtx("afb-failing", "afb-fail-model"));

const status1 = handle.getStatus();
if (status1.switchCount !== 1) {
	fail(`after failure+settle, switchCount should be 1, got ${status1.switchCount}`);
}
if (status1.blacklistSize < 1) {
	fail(`after failure+settle, blacklist should hold the failing model`);
}
const switchedTo = setModelCalls[0] as { provider?: string; id?: string };
if (
	switchedTo?.provider !== "afb-target" ||
	switchedTo?.id !== "afb-target-model"
) {
	fail(`fallback should land on afb-target/afb-target-model, got ${JSON.stringify(switchedTo)}`);
}
console.log(
	`✓ 3. failure → real-registry selection → setModel(afb-target/afb-target-model), blacklist=${status1.blacklistSize}`,
);

// --- 3. Clean run on the new model: recovery --------------------------------

await emit(
	"message_end",
	{
		message: {
			role: "assistant",
			provider: "afb-target",
			model: "afb-target-model",
			stopReason: "stop",
		},
	},
	makeCtx("afb-target", "afb-target-model"),
);
await emit("agent_settled", {}, makeCtx("afb-target", "afb-target-model"));

const status2 = handle.getStatus();
if (status2.blacklistSize !== 0) {
	fail(`after clean settle, failing model should be un-banned, blacklist=${status2.blacklistSize}`);
}
console.log(`✓ 4. clean settle → recovery: blacklist cleared, switches=${status2.switchCount}`);

// --- 4. /pi-free-health reports the live handle through the registry --------

const report = formatHealthReport();
if (!report.includes("auto_fallback")) {
	fail("formatHealthReport() missing auto_fallback line — status registration broken");
}
console.log(`✓ 5. /pi-free-health auto_fallback line present:`);
console.log(
	report
		.split("\n")
		.filter((line: string) => line.includes("auto_fallback"))
		.map((line: string) => `    ${line.trim()}`)
		.join("\n"),
);

rmSync(sandbox, { recursive: true, force: true });
console.log(`\nSMOKE OK — status surface verified against a real ModelRuntime (sandbox ${sandbox} removed)`);
