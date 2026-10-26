/**
 * #635: callback-only relay tests missed Pi's model.api === extension.api gate.
 * Drive the real loader, provider registration, refresh and ModelRuntime stream.
 * Only HTTP/process boundaries are fixtures; no registry or stream mocks.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { resolve } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const hasBun = spawnSync("bun", ["--version"]).status === 0;
const realFetch = globalThis.fetch;
const ids = [
	"glm-5.3-flash-free",
	"future-discovered-free",
	"mimo-v2.6-flash-free",
	"grok-4.7",
	"claude-haiku-5-5",
	"gemini-3.8-flash",
];
type RequestRecord = {
	path: string;
	token: string | null;
	client: string | null;
	requestId?: string | null;
	payload?: unknown;
};
let home: string;
let runtime: ModelRuntime;
let session: Awaited<ReturnType<typeof createAgentSession>>["session"];
let requests: RequestRecord[];
let upstream: http.Server | undefined;
let relayRequests: RequestRecord[];
let resetRelay: (() => void) | undefined;

// Inspect only system/developer locations, never a user quoting the envelope.
function wireSystemText(payload: unknown): string {
	const body = payload as Record<string, unknown>;
	const direct =
		body.system ??
		body.system_instruction ??
		body.systemInstruction ??
		body.instructions;
	if (direct !== undefined) return JSON.stringify(direct);
	const messages = (body.messages ?? body.input ?? []) as {
		role?: string;
		content?: unknown;
	}[];
	return JSON.stringify(
		messages.filter(
			(message) => message.role === "system" || message.role === "developer",
		),
	);
}

beforeEach(async () => {
	vi.resetModules();
	mkdirSync(resolve(".smoke-artifacts"), { recursive: true });
	home = mkdtempSync(resolve(".smoke-artifacts", "dispatch-"));
	const agentDir = resolve(home, ".pi/agent");
	mkdirSync(agentDir, { recursive: true });
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("PI_OFFLINE", "");
	vi.stubEnv("OPENCODE_API_KEY", undefined);
	vi.stubEnv("OPENROUTER_API_KEY", undefined);
	vi.stubEnv("PI_FREE_OPENCODE_RELAY", "0");
	writeFileSync(
		resolve(home, ".pi/free.json"),
		JSON.stringify({ free_only: false }),
	);
	writeFileSync(
		resolve(agentDir, "auth.json"),
		JSON.stringify({
			opencode: { type: "api_key", key: "stored-capture-fixture" },
			"opencode-free": { type: "api_key", key: "stored-free-fixture" },
			"opencode-go": { type: "api_key", key: "stored-go-fixture" },
		}),
	);
	requests = [];
	relayRequests = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			if (url.hostname === "127.0.0.1") return realFetch(input, init);
			if (url.hostname === "pi.dev") return new Response(null, { status: 404 });
			if (url.pathname.endsWith("/models"))
				return Response.json({ data: ids.map((id) => ({ id })) });
			const request = new Request(input, init);
			const headers = request.headers;
			const payload: unknown = await request.json();
			requests.push({
				path: url.pathname,
				token:
					(
						headers.get("authorization") ??
						headers.get("x-api-key") ??
						headers.get("x-goog-api-key") ??
						url.searchParams.get("key")
					)?.replace(/^Bearer /, "") ?? null,
				client: headers.get("x-opencode-client"),
				requestId: headers.get("x-opencode-request"),
				payload,
			});
			// A terminal HTTP boundary result is sufficient: assertions inspect the
			// actual wire path/auth emitted by Pi, not a fabricated stream callback.
			return Response.json(
				{ error: { message: "local boundary fixture" } },
				{ status: 400 },
			);
		}),
	);
	const { setupBuiltInProviderToggles } =
		await import("../lib/built-in-toggle.ts");
	const { beginStartup, getStartupSummary } =
		await import("../lib/startup-timing.ts");
	({ resetOpenCodeRelayForTest: resetRelay } =
		await import("../lib/opencode-relay.ts"));
	beginStartup();
	const settingsManager = SettingsManager.inMemory({});
	runtime = await ModelRuntime.create({
		authPath: resolve(agentDir, "auth.json"),
		modelsPath: resolve(agentDir, "models.json"),
		modelsStorePath: resolve(agentDir, "models-store.json"),
	});
	const loader = new DefaultResourceLoader({
		cwd: home,
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		extensionFactories: [setupBuiltInProviderToggles],
		agentsFilesOverride: () => ({ agentsFiles: [] }),
	});
	await loader.reload();
	expect(loader.getExtensions().errors).toEqual([]);
	({ session } = await createAgentSession({
		cwd: home,
		agentDir,
		resourceLoader: loader,
		settingsManager,
		modelRuntime: runtime,
		sessionManager: SessionManager.inMemory(home),
	}));
	await session.bindExtensions({});
	await vi.waitFor(() => {
		const tasks = getStartupSummary().detachedSessionWork;
		for (const id of ["opencode-free", "opencode-go", "openrouter"]) {
			expect(
				tasks.some((task) => task.label === `built-in-toggle-refresh-${id}`),
			).toBe(true);
		}
	});
});

afterEach(async () => {
	resetRelay?.();
	session?.dispose();
	if (upstream) {
		upstream.closeAllConnections();
		await new Promise<void>((done) => upstream!.close(() => done()));
		upstream = undefined;
	}
	(await import("../lib/logger.ts")).flushLogsSync();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	if (home) rmSync(home, { recursive: true, force: true });
});

it("dispatches every registered OpenCode model through its wrapper across refresh and toggle", async () => {
	const { getProviderRegistry } = await import("../lib/registry.ts");
	for (const phase of [
		"captured",
		"offline-refresh",
		"network-refresh",
		"toggle",
	]) {
		if (phase.includes("refresh")) {
			const result = await runtime.refresh({
				allowNetwork: phase === "network-refresh",
				force: true,
				providers: ["opencode-free", "opencode-go"],
			});
			expect([...result.errors]).toEqual([]);
		} else if (phase === "toggle") {
			for (const provider of ["opencode-free", "opencode-go"]) {
				const state = getProviderRegistry().get(provider)!;
				state.reRegister(state.stored.all);
			}
		}
		// Include a model synthesized from /models, not just known GLM ids.
		expect(
			runtime.getModel("opencode-free", "future-discovered-free"),
		).toBeDefined();
		for (const provider of ["opencode-free", "opencode-go"]) {
			expect(runtime.getModels(provider).length).toBeGreaterThan(0);
			for (const model of runtime.getModels(provider)) {
				const id = model.id;
				requests.length = 0;
				const context = {
					systemPrompt: "PI_INSTRUCTIONS_MUST_SURVIVE",
					tools: session.agent.state.tools.map(
						({ name, description, parameters }) => ({
							name,
							description,
							parameters,
						}),
					),
					messages: [
						{ role: "user" as const, content: "hello", timestamp: Date.now() },
					],
				};
				const before = JSON.stringify(context);
				await runtime.streamSimple(model, context, { maxTokens: 1 }).result();
				const wire = JSON.stringify(requests[0]?.payload);
				// #628: Bun alone still429s; the live-proven small env frame is
				// default for every free model, not a copied native agent prompt.
				expect(wire).toContain("PI_INSTRUCTIONS_MUST_SURVIVE");
				expect(
					wireSystemText(requests[0]?.payload).includes(
						"<env>Working directory: .</env>",
					),
				).toBe(provider === "opencode-free");
				expect(wire).toContain('"read"');
				expect(JSON.stringify(context)).toBe(before);
				expect(requests, `${phase}: ${provider}/${id}`).toHaveLength(1);
				expect(requests[0]!.client).toBe("cli");
				expect(requests[0]!.token).toBe(
					provider === "opencode-free" ? "public" : "stored-go-fixture",
				);
				// Grok is Responses despite not having a gpt-* prefix; never
				// replace authoritative catalog wire metadata with id guessing.
				if (provider === "opencode-go") {
					// #635: correct auth alone does not prove Go's wrapper ran;
					// model-level static headers must not reuse a request id.
					const previousRequest = requests[0]!.requestId;
					await runtime
						.streamSimple(
							model,
							{
								messages: [
									{ role: "user", content: "next", timestamp: Date.now() },
								],
							},
							{ maxTokens: 1 },
						)
						.result();
					expect(requests).toHaveLength(2);
					expect(requests[1]!.requestId).toMatch(/^msg_/);
					expect(requests[1]!.requestId).not.toBe(previousRequest);
				}
				if (id === "grok-4.7")
					expect(requests[0]!.path).toMatch(/\/responses$/);
				if (id === "claude-haiku-5-5")
					expect(requests[0]!.path).toMatch(/\/messages$/);
			}
		}
	}
	expect(
		runtime
			.getModels("openrouter")
			.every((model) => model.api !== "opencode-dynamic"),
	).toBe(true);
}, 20000);

// #628: adding a new leading system message can demote Pi's original system
// instructions/tools on protocols with in-place system/tool changes. Merge into
// a copied leading message, preserve sections/text blocks, and never accumulate.
it("preserves rich system messages and tools without mutating or accumulating", async () => {
	for (const id of [
		"glm-5.3-flash-free",
		"grok-4.7",
		"claude-haiku-5-5",
		"gemini-3.8-flash",
	]) {
		const context = {
			messages: [
				{
					role: "system" as const,
					content: [{ type: "text" as const, text: "PI_INITIAL_BLOCK" }],
					sections: { policy: "PI_SECTION_KEEP" },
					toolsAdded: session.agent.state.tools.map(
						({ name, description, parameters }) => ({
							name,
							description,
							parameters,
						}),
					),
					timestamp: 0,
				},
				{ role: "user" as const, content: "hello", timestamp: 1 },
				{ role: "system" as const, content: "PI_LATER_BLOCK", timestamp: 2 },
				{ role: "user" as const, content: "continue", timestamp: 3 },
			],
		};
		const before = JSON.stringify(context);
		const registered = runtime.getModel("opencode-free", id)!;
		// Supported SDK model overrides can enable in-place Anthropic system
		// and tool deltas; Pi's original leading system must stay authoritative.
		const model =
			id === "claude-haiku-5-5"
				? {
						...registered,
						compat: {
							...registered.compat,
							supportsMidConvoSystemMessages: true,
							supportsMidConvoToolChanges: true,
						},
					}
				: registered;
		for (const dispatch of [
			runtime,
			await import("@earendil-works/pi-ai/compat"),
		]) {
			requests.length = 0;
			await dispatch
				.streamSimple(model, context, {
					maxTokens: 1,
					apiKey: "public",
				})
				.result();
			expect(requests).toHaveLength(1);
			const payload = requests[0]!.payload as Record<string, unknown>;
			const wire = JSON.stringify(payload);
			const system = wireSystemText(payload);
			expect(system).toContain("PI_INITIAL_BLOCK");
			expect(system).toContain("PI_SECTION_KEEP");
			expect(system.split("<env>Working directory: .</env>")).toHaveLength(2);
			for (const marker of [
				"PI_INITIAL_BLOCK",
				"PI_SECTION_KEEP",
				"PI_LATER_BLOCK",
				'"read"',
			])
				expect(wire).toContain(marker);
			expect(JSON.stringify(context)).toBe(before);
		}
	}
});

// #635: auxiliary callers use compat's real API registry, not the provider
// callback. Dispatch-tagged models must retain their authoritative wire API.
it("preserves catalog protocols through the real compat dispatcher", async () => {
	const { streamSimple } = await import("@earendil-works/pi-ai/compat");
	for (const provider of ["opencode-free", "opencode-go"]) {
		requests.length = 0;
		const model = runtime.getModel(provider, "grok-4.7")!;
		await streamSimple(
			model,
			{
				messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
			},
			{ apiKey: "stored-go-fixture", maxTokens: 1 },
		).result();
		expect(requests).toHaveLength(1);
		expect(requests[0]!.path).toMatch(/\/responses$/);
		expect(
			wireSystemText(requests[0]!.payload).includes(
				"<env>Working directory: .</env>",
			),
		).toBe(provider === "opencode-free");
		expect(requests[0]!.token).toBe(
			provider === "opencode-free" ? "public" : "stored-go-fixture",
		);
	}
});

// #635: a real Bun process is required to observe the dispatcher reaching the
// actual workaround, not merely constructing/initializing its callback.
it.skipIf(!hasBun)(
	"routes a newly discovered free model through real Bun from ModelRuntime",
	async () => {
		upstream = http.createServer((req, res) => {
			relayRequests.push({
				path: req.url!,
				token: req.headers.authorization?.replace(/^Bearer /, "") ?? null,
				client: String(req.headers["x-opencode-client"] ?? ""),
			});
			res.writeHead(400, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: { message: "local upstream fixture" } }));
		});
		await new Promise<void>((done) => upstream!.listen(0, "127.0.0.1", done));
		const address = upstream.address() as { port: number };
		vi.stubEnv(
			"PI_FREE_OPENCODE_RELAY_UPSTREAM",
			`http://127.0.0.1:${address.port}`,
		);
		vi.stubEnv("PI_FREE_OPENCODE_RELAY", "1");
		const model = runtime.getModel("opencode-free", "future-discovered-free")!;
		await runtime
			.streamSimple(
				model,
				{
					messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
				},
				{ maxTokens: 1 },
			)
			.result();
		expect(relayRequests).toEqual([
			{
				path: "/inference/v1/chat/completions",
				token: "public",
				client: "cli",
			},
		]);
		expect(requests).toHaveLength(0);
	},
);
