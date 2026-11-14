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
import {
	chmodSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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
	vi.unstubAllGlobals();
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

// ---------------------------------------------------------------------------
// #690: state the native lifecycle reads must be the CURRENT state, judged by
// the provider that owns it. Same real loader / session / models store /
// refresh dispatcher; only HTTP (the host network boundary) is substituted.
// ---------------------------------------------------------------------------

type HttpCall = {
	url: string;
	model?: string | undefined;
	auth?: string | undefined;
};

/**
 * Stub the network boundary: a Routeway-shaped catalog and chat probe.
 * `net.online = false` fails the catalog, so only Pi's store can answer.
 */
function stubRoutewayHttp(): { calls: HttpCall[]; net: { online: boolean } } {
	const calls: HttpCall[] = [];
	const net = { online: true };
	vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
		const url = String(input instanceof Request ? input.url : input);
		const headers = new Headers(init?.headers);
		const body =
			typeof init?.body === "string"
				? (JSON.parse(init.body) as { model?: string })
				: {};
		calls.push({
			url,
			model: body.model,
			auth: headers.get("authorization") ?? undefined,
		});
		if (url === "https://api.routeway.ai/v1/models" && net.online) {
			const price = (usd: number) => ({ price_per_million_t: usd });
			return Response.json({
				data: [
					{
						id: "free-a",
						name: "Free A",
						type: "chat.completions",
						pricing: { input: price(0), output: price(0) },
					},
					{
						id: "paid-b",
						name: "Paid B",
						type: "chat.completions",
						pricing: { input: price(1), output: price(2) },
					},
				],
			});
		}
		if (url === "https://api.routeway.ai/v1/chat/completions") {
			return Response.json({ choices: [] });
		}
		return new Response("unavailable", { status: 503 });
	});
	return { calls, net };
}

const probesOf = (calls: HttpCall[]) =>
	calls
		.filter((call) => call.url.endsWith("/chat/completions"))
		.map((call) => `${call.model} ${call.auth}`);

async function until(check: () => boolean, ms = 3_000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!check() && Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 10));
	}
}

it("routeway's session-start auto-probe checks the free models fetched or restored this session, not the empty list from registration (#690)", async () => {
	// Recurrence: registerNativeAvailabilityProbe captured `handle.stored.free`
	// by reference at registration; every restore/refresh replaces that array,
	// so the auto-probe always judged the initial [] and never probed.
	const agentDir = pinHome();
	vi.stubEnv("ROUTEWAY_API_KEY", "env-key");
	const { calls, net } = stubRoutewayHttp();

	// Session 1: the catalog arrives from the network after session_start.
	vi.resetModules();
	const { default: routeway } =
		await import("../providers/routeway/routeway.ts");
	const runtime = await boot(agentDir, routeway);
	await runtime.refresh({ allowNetwork: true, providers: ["routeway"] });
	await until(() => probesOf(calls).length > 0);
	const fetched = probesOf(calls);

	// Session 2, offline, probe cache cleared: only the store restore can
	// supply the free list, and it lands after session_start.
	net.online = false;
	calls.length = 0;
	rmSync(resolve(home as string, ".pi/probe-cache.json"), { force: true });
	vi.resetModules();
	const { default: routewayAgain } =
		await import("../providers/routeway/routeway.ts");
	await boot(agentDir, routewayAgain);
	await until(() => probesOf(calls).length > 0);
	expect({ fetched, restored: probesOf(calls) }).toEqual({
		fetched: ["free-a Bearer env-key"],
		restored: ["free-a Bearer env-key"],
	});
});

it("/probe-routeway probes with the credential current when it runs, logged in after startup (#690)", async () => {
	// Recurrence: the probe was registered only when a key existed at startup
	// and used that captured key, so a /login during the session left
	// `/probe-routeway` unregistered (or probing with a stale key).
	const agentDir = pinHome();
	const { calls } = stubRoutewayHttp();
	vi.resetModules();
	const { default: routeway } =
		await import("../providers/routeway/routeway.ts");
	const runtime = await boot(agentDir, routeway);
	const session = sessions.at(-1) as unknown as {
		prompt(text: string): Promise<void>;
		extensionRunner: { getCommand(name: string): unknown };
	};
	// Registered keyless: otherwise the prompt would go to a chat model.
	expect(session.extensionRunner.getCommand("probe-routeway")).toBeDefined();
	const login = (key: string) =>
		runtime.login("routeway", "api_key", {
			prompt: async () => key,
			notify: () => {},
		} as unknown as Parameters<ModelRuntime["login"]>[2]);

	// A catalog lands under one key, then the key goes away.
	await login("first-key");
	await runtime.refresh({ allowNetwork: true, providers: ["routeway"] });
	await new Promise((r) => setTimeout(r, 100));
	await runtime.logout("routeway");
	await session.prompt("/probe-routeway");
	// Keyless, neither the command nor this keyless session's auto-probe
	// sends a probe (no "Bearer undefined" once the catalog is there).
	const keyless = probesOf(calls);

	calls.length = 0;
	await login("logged-in-key");
	await session.prompt("/probe-routeway");
	expect({ keyless, loggedIn: probesOf(calls).sort() }).toEqual({
		keyless: [],
		loggedIn: ["free-a Bearer logged-in-key", "paid-b Bearer logged-in-key"],
	});
});

/** A keyed native OpenAI provider over a stubbed catalog fetch. */
async function nativeFactory(
	providerId: string,
	fetchModels: () => Promise<ProviderModelConfig[]>,
): Promise<Factory> {
	vi.resetModules();
	const { registerNativeOpenAIProvider, createNativeApiKeyAuth } =
		await import("../lib/native-provider.ts");
	return (pi: ExtensionAPI) => {
		const getApiKey = () => "probe-only";
		registerNativeOpenAIProvider(pi, {
			providerId,
			name: providerId,
			baseUrl: "https://example.invalid/v1",
			auth: createNativeApiKeyAuth({
				name: providerId,
				prompt: "key",
				source: "test",
				getApiKey,
			}),
			getApiKey,
			getShowPaid: () => false,
			fetchModels,
		});
	};
}

async function persistWarnings(): Promise<string[]> {
	const { flushLogsSync } = await import("../lib/logger.ts");
	flushLogsSync();
	const log = readFileSync(resolve(home as string, ".pi/free.log"), "utf8");
	return log
		.split("\n")
		.filter((l) => l.includes("[WARN]") && l.includes("Failed to persist"));
}

it("a refresh superseded mid-persist is counted as an abort, not warned as a store failure (#690)", async () => {
	// Recurrence (live): "Failed to persist qoder models to store {error:
	// This operation was aborted}" 12 times in 13 s. Pi aborting a superseded
	// generation is a normal transition, not a failure.
	const agentDir = pinHome();
	const PROVIDER = "supersede-probe";
	let runtime: ModelRuntime | undefined;
	let supersedes = 0;
	const factory = await nativeFactory(PROVIDER, async () => {
		if (supersedes < 3) {
			supersedes++;
			// Supersede while this generation's store write is in flight.
			setImmediate(() => {
				void runtime?.refresh({ allowNetwork: true, providers: [PROVIDER] });
			});
		}
		return [cfg("alpha", 0), cfg("gamma", 2)];
	});
	const { getStartupSummary } = await import("../lib/startup-timing.ts");
	runtime = await boot(agentDir, factory);
	await runtime.refresh({ allowNetwork: true, providers: [PROVIDER] });
	await until(() => supersedes >= 3);
	await new Promise((r) => setTimeout(r, 200));
	const aborts =
		getStartupSummary().cacheNetwork.find((e) => e.provider === PROVIDER)
			?.aborts ?? 0;
	expect({
		warned: await persistWarnings(),
		abortsCounted: aborts > 0,
	}).toEqual({ warned: [], abortsCounted: true });
});

it("a real models-store write failure is warned once per provider per session, not per refresh (#690)", async () => {
	// Recurrence: the persist warning fired on every refresh generation, so a
	// store that stays unwritable floods free.log with one line per refresh.
	const agentDir = pinHome();
	const PROVIDER = "store-fail-probe";
	const factory = await nativeFactory(PROVIDER, async () => [
		cfg("alpha", 0),
		cfg("gamma", 2),
	]);
	const runtime = await boot(agentDir, factory);
	await runtime.refresh({ allowNetwork: true, providers: [PROVIDER] });
	// Every later write now fails for real: a read-only store file.
	const storePath = resolve(agentDir, "models-store.json");
	chmodSync(storePath, 0o444);
	try {
		for (let i = 0; i < 3; i++) {
			await runtime.refresh({
				allowNetwork: true,
				providers: [PROVIDER],
				force: true,
			});
		}
	} finally {
		// Writable again so the temp home can be removed on every platform.
		chmodSync(storePath, 0o644);
	}
	expect((await persistWarnings()).length).toBe(1);
});
