/**
 * `/toggle-openrouter`: a filter-only free view over Pi's BUILT-IN OpenRouter
 * provider (Standing Invariants, the exception to "never override a provider
 * native to Pi").
 *
 * Recurrences this prevents:
 * - #681 removed pi-free's OpenRouter override because it froze Pi's catalog,
 *   endpoints and refresh. A free view that fetches, wraps requests, sets an
 *   apiKey (defect shape 9, #504) or survives "off" brings that back.
 * - OpenRouter lists $0 routers (`openrouter/auto`, `openrouter/fusion`, …)
 *   that bill the routed model; zero cost alone shows paid models as free
 *   (the #675 shape).
 * - /reload keeps Pi's ModelRuntime, and a session switch may too: an overlay
 *   that outlives its session hides paid models after the user chose "all".
 *
 * Drives pi-free's real entry through Pi's real loader, session runtime,
 * ModelRuntime and request path. Only HTTP (the host boundary) is stubbed;
 * no credentialed call leaves the process.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";

const STORED_KEY = "stored-openrouter-fixture";
const PAID_ROUTERS = [
	"openrouter/auto",
	"openrouter/fusion",
	"openrouter/pareto-code",
];

let home: string | undefined;
let owner: Awaited<ReturnType<typeof createAgentSessionRuntime>> | undefined;
let requests: { host: string; path: string; authorization: string | null }[];
let notices: string[];

afterEach(async () => {
	owner?.session.dispose();
	owner = undefined;
	(await import("../lib/logger.ts")).flushLogsSync();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	if (home) rmSync(home, { recursive: true, force: true });
	home = undefined;
});

async function boot(
	freeJson: Record<string, unknown>,
	modelsJson?: Record<string, unknown>,
) {
	vi.resetModules();
	mkdirSync(resolve(".smoke-artifacts"), { recursive: true });
	home = mkdtempSync(resolve(".smoke-artifacts", "openrouter-view-"));
	const agentDir = resolve(home, ".pi/agent");
	mkdirSync(agentDir, { recursive: true });
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("PI_OFFLINE", "");
	vi.stubEnv("OPENROUTER_API_KEY", undefined);
	vi.stubEnv("OPENROUTER_SHOW_PAID", undefined);
	vi.stubEnv("PI_FREE_ONLY", undefined);
	writeFileSync(resolve(home, ".pi/free.json"), JSON.stringify(freeJson));
	writeFileSync(
		resolve(agentDir, "auth.json"),
		JSON.stringify({ openrouter: { type: "api_key", key: STORED_KEY } }),
	);
	if (modelsJson)
		writeFileSync(resolve(agentDir, "models.json"), JSON.stringify(modelsJson));
	requests = [];
	notices = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const request = new Request(input, init);
			const url = new URL(request.url);
			requests.push({
				host: url.hostname,
				path: url.pathname,
				authorization: request.headers.get("authorization"),
			});
			// Terminal boundary result: assertions read the wire request Pi built.
			return Response.json(
				{ error: { message: "local boundary fixture" } },
				{ status: 400 },
			);
		}),
	);
	const paths = {
		authPath: resolve(agentDir, "auth.json"),
		modelsPath: resolve(agentDir, "models.json"),
		modelsStorePath: resolve(agentDir, "models-store.json"),
	};
	// Pi's own catalog with no extension loaded: the reference every view is
	// judged against (same store, same host build).
	const native = await ModelRuntime.create(paths);
	// Pi loads extensions with jiti `moduleCache: false`: every load (startup,
	// /reload, session switch) gets a fresh pi-free module graph.
	const piFreeEntry = async (
		pi: Parameters<typeof import("../index.ts").default>[0],
	) => {
		vi.resetModules();
		const { default: entry } = await import("../index.ts");
		await entry(pi);
	};
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
	});
	// One ModelRuntime shared across session replacement: the strongest
	// shape, since an overlay that is not torn down survives the switch.
	const runtime = await ModelRuntime.create(paths);
	owner = await createAgentSessionRuntime(
		async (options) => {
			const services = await createAgentSessionServices({
				cwd: home as string,
				agentDir,
				settingsManager,
				modelRuntime: runtime,
				resourceLoaderOptions: {
					noExtensions: true,
					noSkills: true,
					noPromptTemplates: true,
					noThemes: true,
					extensionFactories: [piFreeEntry],
					agentsFilesOverride: () => ({ agentsFiles: [] }),
				},
			});
			expect(services.resourceLoader.getExtensions().errors).toEqual([]);
			const result = await createAgentSessionFromServices({
				services,
				sessionManager: options.sessionManager,
				...(options.sessionStartEvent
					? { sessionStartEvent: options.sessionStartEvent }
					: {}),
			});
			return { ...result, services, diagnostics: services.diagnostics };
		},
		{
			cwd: home,
			agentDir,
			sessionManager: SessionManager.inMemory(home),
		},
	);
	const bind = async (next: NonNullable<typeof owner>["session"]) => {
		await next.bindExtensions({
			uiContext: {
				notify: (message: string) => notices.push(message),
			} as never,
		});
	};
	owner.setRebindSession(bind);
	await bind(owner.session);
	return { native, runtime };
}

function chatIds(runtime: ModelRuntime): string[] {
	return runtime
		.getModels("openrouter")
		.map((model) => model.id)
		.sort();
}

function nonChat(runtime: ModelRuntime): string[] {
	return (["image", "classifier"] as const)
		.flatMap((type) =>
			runtime
				.getModelsOfType(type, "openrouter")
				.map((model) => `${type}:${model.id}`),
		)
		.sort();
}

function expectNative(native: ModelRuntime, runtime: ModelRuntime): void {
	expect(chatIds(runtime)).toEqual(chatIds(native));
	expect(nonChat(runtime)).toEqual(nonChat(native));
	// No pi-free registration at all: Pi's provider is exactly its own.
	expect(runtime.getRegisteredProviderIds()).not.toContain("openrouter");
}

function expectFreeView(native: ModelRuntime, runtime: ModelRuntime): void {
	const nativeChat = native.getModels("openrouter");
	const visible = runtime.getModels("openrouter");
	const nativeIds = new Set(nativeChat.map((model) => model.id));
	expect(visible.length).toBeGreaterThan(0);
	expect(visible.length).toBeLessThan(nativeChat.length);
	for (const model of visible) {
		expect(nativeIds.has(model.id), model.id).toBe(true);
		expect([model.cost.input, model.cost.output], model.id).toEqual([0, 0]);
	}
	// Every model OpenRouter publishes as `:free` stays visible.
	const published = nativeChat
		.filter((model) => model.id.endsWith(":free"))
		.map((model) => model.id);
	expect(published.length).toBeGreaterThan(0);
	expect(visible.map((model) => model.id)).toEqual(
		expect.arrayContaining(published),
	);
	// $0 routers bill the routed model: never shown as free.
	for (const id of PAID_ROUTERS) {
		expect(nativeIds.has(id), `${id} in Pi's catalog`).toBe(true);
		expect(runtime.getModel("openrouter", id), id).toBeUndefined();
	}
	// Filter-only: Pi's own model metadata passes through untouched.
	for (const model of visible) {
		const original = nativeChat.find((entry) => entry.id === model.id)!;
		expect({ ...model, headers: undefined }, model.id).toEqual({
			...original,
			headers: undefined,
		});
	}
	expect(nonChat(runtime)).toEqual(nonChat(native));
	// No auth, endpoint, header, stream or refresh override: models only.
	expect(
		Object.keys(runtime.getRegisteredProviderConfig("openrouter") ?? {}),
	).toEqual(["models"]);
}

/** One request through Pi's real dispatcher; returns the wire auth seen. */
async function wireAuth(runtime: ModelRuntime, id: string) {
	const model = runtime.getModel("openrouter", id);
	expect(model, id).toBeDefined();
	requests.length = 0;
	await runtime
		.streamSimple(
			model!,
			{
				messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
			},
			{ maxTokens: 1 },
		)
		.result();
	// pi-free's own detached startup work (opencode-free refresh) shares the
	// stub; judge only requests to this model's host.
	const host = new URL(model!.baseUrl).hostname;
	const sent = requests.filter((request) => request.host === host);
	expect(sent).toHaveLength(1);
	return sent[0]!;
}

async function command(name: string): Promise<void> {
	await owner!.session.prompt(`/${name}`);
}

it("default free view shows exactly Pi's free OpenRouter models and keeps Pi's native auth", async () => {
	const { native, runtime } = await boot({ free_only: true });
	expectFreeView(native, runtime);
	const free = runtime
		.getModels("openrouter")
		.find((model) => model.id.endsWith(":free"))!;
	const wire = await wireAuth(runtime, free.id);
	// Pi resolved the user's stored OpenRouter credential itself.
	expect(wire.authorization).toBe(`Bearer ${STORED_KEY}`);
	expect(
		requests.every((request) => !request.path.endsWith("/models/user")),
	).toBe(true);
});

it("/toggle-openrouter restores Pi's native provider and back, with auth unchanged", async () => {
	const { native, runtime } = await boot({ free_only: true });
	expectFreeView(native, runtime);

	await command("toggle-openrouter");
	expectNative(native, runtime);
	expect(notices.at(-1)).toContain(
		`showing all ${native.getModels("openrouter").length}`,
	);
	// A paid model is Pi's own again and still uses Pi's credential path.
	expect((await wireAuth(runtime, "openrouter/auto")).authorization).toBe(
		`Bearer ${STORED_KEY}`,
	);

	await command("toggle-openrouter");
	expectFreeView(native, runtime);
	expect(notices.at(-1)).toContain(
		`showing ${runtime.getModels("openrouter").length} free`,
	);
});

it("/reload and a session switch keep the chosen view and never leak the overlay", async () => {
	const { native, runtime } = await boot({ free_only: true });

	await owner!.session.reload();
	expectFreeView(native, runtime);
	await owner!.newSession();
	expectFreeView(native, runtime);

	await command("toggle-openrouter");
	expectNative(native, runtime);
	await owner!.session.reload();
	expectNative(native, runtime);
	await owner!.newSession();
	expectNative(native, runtime);

	await command("toggle-openrouter");
	await owner!.newSession();
	expectFreeView(native, runtime);

	// Another pi process sharing ~/.pi/free.json chose "all" while this
	// session showed the free view. /reload keeps Pi's ModelRuntime but loads
	// a fresh pi-free that never registered the overlay: only the old
	// session's shutdown can hand OpenRouter back to Pi.
	writeFileSync(
		resolve(home as string, ".pi/free.json"),
		JSON.stringify({
			free_only: true,
			model_view_overrides: { openrouter: "all" },
		}),
	);
	await owner!.session.reload();
	expectNative(native, runtime);
});

it("/toggle-free switches OpenRouter with every other provider", async () => {
	const { native, runtime } = await boot({ free_only: true });
	expectFreeView(native, runtime);
	// /toggle-free runs its fan-out detached; wait on the condition.
	await command("toggle-free");
	await vi.waitFor(() => expectNative(native, runtime));
	await command("toggle-free");
	await vi.waitFor(() => expectFreeView(native, runtime));
});

it.each([
	["global free-only off", { free_only: false }],
	[
		"an explicit all choice",
		{ free_only: true, model_view_overrides: { openrouter: "all" } },
	],
	[
		"a legacy openrouter_show_paid: true",
		{ free_only: true, openrouter_show_paid: true },
	],
])("leaves Pi's provider untouched under %s", async (_label, freeJson) => {
	const { native, runtime } = await boot(freeJson);
	expectNative(native, runtime);
	expect((await wireAuth(runtime, "openrouter/auto")).authorization).toBe(
		`Bearer ${STORED_KEY}`,
	);
});

it("keeps a priced model out of the free view even when its id says :free", async () => {
	// Recurrence: the #675 shape (a priced model stamped free from its label,
	// bai's ended promotions). A user price in models.json stands in for an
	// OpenRouter `:free` id that stops being $0; Pi's catalog carries it.
	const priced = "google/gemma-4-31b-it:free";
	const { native, runtime } = await boot(
		{ free_only: true },
		{
			providers: {
				openrouter: {
					modelOverrides: { [priced]: { cost: { input: 0.1, output: 0.2 } } },
				},
			},
		},
	);
	expect(native.getModel("openrouter", priced)?.cost.input).toBe(0.1);
	expect(runtime.getModel("openrouter", priced)).toBeUndefined();
	expect(
		runtime.getModel("openrouter", "google/gemma-4-26b-a4b-it:free"),
	).toBeDefined();
	await command("toggle-openrouter");
	expectNative(native, runtime);
});
