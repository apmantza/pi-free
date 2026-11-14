/**
 * #672: a native provider's visible model set must stay stable through Pi's
 * startup register / restore / refresh / retry transitions.
 *
 * Recurrence this prevents (live, llm7 2026-11-14, sampled through RPC
 * `get_available_models` once a second): the free view showed
 * [default,fast], then [] from t=1s to t=5s, then the PAID `pro` at t=22s,
 * and an RPC `set_model llm7/default` landing in the gap failed "Model not
 * found". Two causes, both through Pi's real ModelRuntime:
 *
 * - Pi rebuilds its provisional availability snapshot from the provider's
 *   unfiltered `getModels()` on every registerProvider and refresh start
 *   (model-runtime `updateModelSnapshot`), before the availability pass runs
 *   `filterModels`. A complete-catalog `getModels()` therefore flashed paid
 *   models into the free view on every refresh and retry.
 * - The free-view persist (#519) stores only the free subset. Restoring it
 *   re-classified that subset in isolation: all zero-cost with no priced
 *   sibling reads as "pricing not exposed", the name-only route finds no
 *   "free", and the free view went empty until a network refresh landed.
 *
 * Drives Pi's real loader, session, models store and refresh dispatcher;
 * only the catalog fetch (the host network boundary) is substituted.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionAPI,
	ModelRuntime,
	type ProviderModelConfig,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";

let home: string | undefined;
const sessions: { dispose(): void }[] = [];

afterEach(async () => {
	for (const session of sessions.splice(0)) session.dispose();
	const { flushLogsSync } = await import("../lib/logger.ts");
	flushLogsSync();
	vi.unstubAllEnvs();
	if (home) rmSync(home, { recursive: true, force: true });
	home = undefined;
});

function pinHome(): string {
	const artifacts = resolve(".smoke-artifacts");
	mkdirSync(artifacts, { recursive: true });
	home = mkdtempSync(resolve(artifacts, "native-visible-"));
	const agentDir = resolve(home, ".pi/agent");
	mkdirSync(agentDir, { recursive: true });
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("PI_OFFLINE", "");
	// Global free view: the view whose transitions flapped live.
	writeFileSync(
		resolve(home, ".pi/free.json"),
		JSON.stringify({ free_only: true }),
	);
	writeFileSync(resolve(agentDir, "auth.json"), "{}");
	return agentDir;
}

type Factory = (pi: ExtensionAPI) => void | Promise<void>;

/** Boot one Pi session over `agentDir` with a single extension factory. */
async function boot(agentDir: string, factory: Factory) {
	const settingsManager = SettingsManager.inMemory({});
	const runtime = await ModelRuntime.create({
		authPath: resolve(agentDir, "auth.json"),
		modelsPath: resolve(agentDir, "models.json"),
		modelsStorePath: resolve(agentDir, "models-store.json"),
	});
	const loader = new DefaultResourceLoader({
		cwd: home as string,
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		extensionFactories: [factory],
		agentsFilesOverride: () => ({ agentsFiles: [] }),
	});
	await loader.reload();
	expect(loader.getExtensions().errors).toEqual([]);
	const { session } = await createAgentSession({
		cwd: home as string,
		agentDir,
		resourceLoader: loader,
		settingsManager,
		modelRuntime: runtime,
		sessionManager: SessionManager.inMemory(home as string),
	});
	sessions.push(session);
	await session.bindExtensions({});
	return runtime;
}

/**
 * Sample the provider's visible ids on every macrotask while `work` runs and
 * return the distinct consecutive states from the first non-empty one (the
 * provider is legitimately absent before it registers and, on an empty
 * store, until its first publication).
 */
async function sampleWhile(
	getRuntime: () => ModelRuntime | undefined,
	providerId: string,
	work: () => Promise<unknown>,
): Promise<string[]> {
	const seen: string[] = [];
	const sample = () =>
		seen.push(
			(getRuntime()?.getAvailableSnapshot() ?? [])
				.filter((model) => model.provider === providerId)
				.map((model) => model.id)
				.join(","),
		);
	let next: ReturnType<typeof setImmediate> | undefined;
	const tick = () => {
		sample();
		next = setImmediate(tick);
	};
	tick();
	try {
		await work();
	} finally {
		clearImmediate(next);
	}
	sample();
	const start = seen.findIndex((ids) => ids !== "");
	if (start === -1) return [];
	return seen
		.slice(start)
		.filter((ids, i, all) => i === 0 || ids !== all[i - 1]);
}

/** Every Pi transition the startup nudge and its retries go through. */
async function transitions(runtime: ModelRuntime, providerId: string) {
	await runtime.refresh({ allowNetwork: true, providers: [providerId] });
	await runtime.refresh({ allowNetwork: false });
	await runtime.refresh({ allowNetwork: true, force: true });
	await new Promise((r) => setTimeout(r, 50));
}

it("llm7 keeps exactly its free selectors through every startup transition, in a fresh and a restored session", async () => {
	const agentDir = pinHome();
	vi.resetModules();
	const { default: llm7 } = await import("../providers/llm7/llm7.ts");

	// Session 1: empty store, refreshes persist the free-view subset.
	let runtime: ModelRuntime | undefined;
	const first = await sampleWhile(
		() => runtime,
		"llm7",
		async () => {
			runtime = await boot(agentDir, llm7);
			await transitions(runtime, "llm7");
		},
	);
	// Session 2: same store — the offline restore now carries the subset.
	vi.resetModules();
	const { default: llm7Again } = await import("../providers/llm7/llm7.ts");
	let runtime2: ModelRuntime | undefined;
	const second = await sampleWhile(
		() => runtime2,
		"llm7",
		async () => {
			runtime2 = await boot(agentDir, llm7Again);
			await transitions(runtime2, "llm7");
		},
	);

	// Once visible, never anything but the free selectors: no empty gap
	// (restored session), no paid flash (either session).
	expect({ first, second }).toEqual({
		first: ["default,fast"],
		second: ["default,fast"],
	});
});

function cfg(id: string, input: number): ProviderModelConfig {
	return {
		id,
		name: `Model ${id}`,
		reasoning: false,
		input: ["text"],
		cost: { input, output: input, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32_000,
		maxTokens: 4_096,
	};
}

it("a shared native OpenAI provider never shows paid models and restores a non-empty free view offline", async () => {
	const agentDir = pinHome();
	const PROVIDER = "visible-stable";
	// The network boundary: zero-cost models with ordinary names beside a
	// priced sibling (the classifier sees pricing only with the sibling).
	const catalog = [cfg("alpha", 0), cfg("beta", 0), cfg("gamma", 2)];
	let online = true;
	const fetchModels = vi.fn(async () => {
		if (!online) throw new Error("offline");
		return catalog;
	});
	const makeFactory = async () => {
		vi.resetModules();
		const { registerNativeOpenAIProvider, createNativeApiKeyAuth } =
			await import("../lib/native-provider.ts");
		return (pi: ExtensionAPI) => {
			const getApiKey = () => "probe-only";
			registerNativeOpenAIProvider(pi, {
				providerId: PROVIDER,
				name: "Visible Stable",
				baseUrl: "https://example.invalid/v1",
				auth: createNativeApiKeyAuth({
					name: "Visible Stable",
					prompt: "key",
					source: "test",
					getApiKey,
				}),
				getApiKey,
				getShowPaid: () => false,
				fetchModels,
			});
		};
	};

	let runtime: ModelRuntime | undefined;
	const factory = await makeFactory();
	const first = await sampleWhile(
		() => runtime,
		PROVIDER,
		async () => {
			runtime = await boot(agentDir, factory);
			await transitions(runtime, PROVIDER);
		},
	);
	expect(fetchModels).toHaveBeenCalled();

	// Next startup with the network down: only the store can answer, and it
	// must answer with the free models it persisted, not an empty view.
	online = false;
	const factory2 = await makeFactory();
	let runtime2: ModelRuntime | undefined;
	const second = await sampleWhile(
		() => runtime2,
		PROVIDER,
		async () => {
			runtime2 = await boot(agentDir, factory2);
			await transitions(runtime2, PROVIDER);
		},
	);
	// Fresh session: no paid flash on any refresh. Offline restore: the
	// persisted free models, never an empty view, never a paid one.
	expect({ first, second }).toEqual({
		first: ["alpha,beta"],
		second: ["alpha,beta"],
	});
});
