/**
 * #504: drive Pi's real loader, session, credential store and refresh dispatcher.
 * Only HTTP is mocked (host boundary); direct callback tests missed auth errors
 * raised by Pi before our refreshModels callback ever ran. No child processes.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";

let home: string;
let session:
	| Awaited<ReturnType<typeof createAgentSession>>["session"]
	| undefined;

afterEach(async () => {
	session?.dispose();
	session = undefined;
	const { flushLogsSync } = await import("../lib/logger.ts");
	flushLogsSync();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	if (home) rmSync(home, { recursive: true, force: true });
});

it.each(["absent", "environment", "stored-go", "stored-free"])(
	"refreshes through Pi without manufacturing a missing-key error (%s)",
	async (credential) => {
		vi.resetModules();
		const artifacts = resolve(".smoke-artifacts");
		mkdirSync(artifacts, { recursive: true });
		home = mkdtempSync(resolve(artifacts, "built-in-runtime-"));
		const agentDir = resolve(home, ".pi/agent");
		mkdirSync(agentDir, { recursive: true });
		vi.stubEnv("HOME", home);
		vi.stubEnv("USERPROFILE", home);
		vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
		vi.stubEnv("PI_OFFLINE", "");
		vi.stubEnv(
			"OPENCODE_API_KEY",
			credential === "environment" ? "probe-only" : undefined,
		);
		vi.stubEnv("OPENROUTER_API_KEY", undefined);
		writeFileSync(
			resolve(home, ".pi/free.json"),
			JSON.stringify({ free_only: false }),
		);
		const auth = credential.startsWith("stored-")
			? {
					[credential === "stored-go" ? "opencode-go" : "opencode-free"]: {
						type: "api_key",
						key: "probe-only",
					},
				}
			: {};
		writeFileSync(resolve(agentDir, "auth.json"), JSON.stringify(auth));
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL | Request) => {
				const url = input instanceof Request ? input.url : String(input);
				// Pi explicitly supports a missing remote overlay (404); the direct
				// OpenCode endpoint still supplies a valid public catalog below.
				if (url.startsWith("https://pi.dev/"))
					return new Response(null, { status: 404 });
				return Response.json({ data: [{ id: "gpt-5" }] });
			}),
		);

		const { setupBuiltInProviderToggles } =
			await import("../lib/built-in-toggle.ts");
		const { beginStartup, getStartupSummary } =
			await import("../lib/startup-timing.ts");
		beginStartup();
		const settingsManager = SettingsManager.inMemory({});
		const runtime = await ModelRuntime.create({
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
		// Wait for actual detached work, not a guessed startup delay.
		await vi.waitFor(() => {
			const tasks = getStartupSummary().detachedSessionWork;
			for (const id of ["opencode-free", "opencode-go", "openrouter"]) {
				expect(
					tasks.some((task) => task.label === `built-in-toggle-refresh-${id}`),
				).toBe(true);
			}
		});

		// Same dispatcher used by Pi's interactive refresh coordinator.
		const result = await runtime.refresh({
			allowNetwork: true,
			force: true,
			providers: ["opencode-free", "opencode-go"],
		});
		expect(
			[...result.errors].map(([id, error]) => [id, error.message]),
		).toEqual([]);
		expect(result.aborted).toBe(false);
		const available = runtime
			.getAvailableSnapshot()
			.map((model) => model.provider);
		if (credential === "absent") {
			expect(available).not.toContain("opencode-free");
			expect(available).not.toContain("opencode-go");
		} else {
			expect(available).toContain("opencode-free");
			if (credential !== "stored-free")
				expect(available).toContain("opencode-go");
		}
	},
);
