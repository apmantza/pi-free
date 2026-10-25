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
};
let home: string;
let runtime: ModelRuntime;
let session: Awaited<ReturnType<typeof createAgentSession>>["session"];
let requests: RequestRecord[];
let upstream: http.Server | undefined;
let relayRequests: RequestRecord[];
let resetRelay: (() => void) | undefined;

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
			const headers = new Headers(
				init?.headers ?? (input instanceof Request ? input.headers : undefined),
			);
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
				await runtime
					.streamSimple(
						model,
						{
							messages: [
								{ role: "user", content: "hello", timestamp: Date.now() },
							],
						},
						{ maxTokens: 1 },
					)
					.result();
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
