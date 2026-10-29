// Field recurrence: exhausted Infron TPM errors left a run idle despite an explicit retry delay.
// Drive real Pi loader/AgentSession/ModelRuntime; only the HTTP boundary is replaced.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	createAgentSession,
	createAgentSessionRuntime,
	createAgentSessionServices,
	createAgentSessionFromServices,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const reportedError =
	'Retry failed after 3 attempts: 429: {"message":"TPM rate limit exceeded (1M tokens per minute). Please try again after 11 seconds. (request id: fixture)","type":"rate_limit_error","param":"","code":"tpm_rate_limit_exceeded"}';
let home: string;
let session: Awaited<ReturnType<typeof createAgentSession>>["session"];
let runtime: ModelRuntime;
let owner: Awaited<ReturnType<typeof createAgentSessionRuntime>>;
let settingsManager: SettingsManager;
let requests: number;
let error: string;
let followUpError: string | undefined;
let failures: number;
let notices: string[];
let noticeAt: number;

beforeEach(async () => {
	vi.resetModules();
	mkdirSync(resolve(".smoke-artifacts"), { recursive: true });
	home = mkdtempSync(resolve(".smoke-artifacts/infron-retry-"));
	const agentDir = resolve(home, ".pi/agent");
	mkdirSync(agentDir, { recursive: true });
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	writeFileSync(
		resolve(home, ".pi/free.json"),
		JSON.stringify({ free_only: false }),
	);
	writeFileSync(
		resolve(agentDir, "auth.json"),
		JSON.stringify({ infron: { type: "api_key", key: "fixture" } }),
	);
	requests = 0;
	error = reportedError;
	followUpError = undefined;
	failures = 1;
	notices = [];
	noticeAt = 0;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request) => {
			if (
				String(input instanceof Request ? input.url : input).endsWith("/models")
			) {
				return Response.json({
					data: [
						{
							id: "deepseek/deepseek-v4-flash:free",
							category_type: "LLM",
							min_prompt_price: 0,
							min_completion_price: 0,
						},
					],
				});
			}
			requests++;
			// A terminal error frame avoids OpenAI SDK retries, reproducing the final
			// error text seen in the field through Pi's real assistant message path.
			const chunk =
				requests <= failures
					? {
							error: {
								message: requests > 1 && followUpError ? followUpError : error,
							},
						}
					: {
							id: "fixture",
							choices: [
								{
									index: 0,
									delta: { content: "resumed" },
									finish_reason: "stop",
								},
							],
						};
			return new Response(
				`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
				{ headers: { "content-type": "text/event-stream" } },
			);
		}),
	);
	const { default: infron } = await import("../providers/infron/infron.ts");
	settingsManager = SettingsManager.inMemory({
		retry: { enabled: false },
		compaction: { enabled: false },
	});
	runtime = await ModelRuntime.create({
		authPath: resolve(agentDir, "auth.json"),
		modelsPath: resolve(agentDir, "models.json"),
		modelsStorePath: resolve(agentDir, "models-store.json"),
	});
	owner = await createAgentSessionRuntime(
		async (options) => {
			const services = await createAgentSessionServices({
				cwd: home,
				agentDir,
				settingsManager,
				modelRuntime: runtime,
				resourceLoaderOptions: {
					noExtensions: true,
					noSkills: true,
					noPromptTemplates: true,
					noThemes: true,
					extensionFactories: [infron],
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
		{ cwd: home, agentDir, sessionManager: SessionManager.inMemory(home) },
	);
	const bind = async (next: typeof session) => {
		session = next;
		await session.bindExtensions({
			uiContext: {
				notify: (message: string) => {
					notices.push(message);
					noticeAt = Date.now();
				},
			} as never,
		});
	};
	owner.setRebindSession(bind);
	await bind(owner.session);
	await runtime.refresh({
		allowNetwork: true,
		force: true,
		providers: ["infron"],
	});
	const model = runtime.getModel("infron", "deepseek/deepseek-v4-flash:free");
	expect(model).toBeDefined();
	await session.setModel(model!);
	vi.useFakeTimers();
});

afterEach(async () => {
	await owner?.dispose();
	(await import("../lib/logger.ts")).flushLogsSync();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	if (home) rmSync(home, { recursive: true, force: true });
});

async function startAtWait(seconds = 11) {
	const run = session.prompt("finish the task");
	await vi.waitFor(() =>
		expect(
			notices.some((message) => message.includes(`${seconds} seconds`)),
			JSON.stringify(session.messages.at(-1)),
		).toBe(true),
	);
	return { run };
}

it.each([11, 86400, 2_147_483])(
	"continues the real failed request only after the advertised %i seconds",
	async (seconds) => {
		error = reportedError.replace("11 seconds", `${seconds} seconds`);
		const { run } = await startAtWait(seconds);
		expect(requests).toBe(1);
		await vi.advanceTimersByTimeAsync(
			noticeAt + seconds * 1_000 - Date.now() - 1,
		);
		expect(requests).toBe(1);
		await vi.advanceTimersByTimeAsync(1);
		await run;
		expect(requests).toBe(2);
		expect(session.messages.at(-1)).toMatchObject({
			role: "assistant",
			stopReason: "stop",
		});
		expect(
			session.messages.filter((message) => message.role === "user"),
		).toHaveLength(1);
	},
);

it.each([
	// Only exhausted retry errors qualify; a raw 429 or an embedded quote must not arm a timer.
	reportedError.replace("Retry failed after 3 attempts: ", ""),
	`Other error: ${reportedError}`,
	reportedError.replace("after 3 attempts", "after 2 attempts"),
	reportedError.replace(": 429:", ": 500:"),
	reportedError.replace("tpm_rate_limit_exceeded", "other_rate_limit"),
	reportedError.replace("11 seconds", "soon"),
	reportedError.replace("11 seconds", "0 seconds"),
	reportedError.replace("11 seconds", "999999999999 seconds"),
])("does not continue an unrecognized or invalid delay: %s", async (text) => {
	error = text;
	const run = session.prompt("finish the task");
	await vi.waitFor(() => expect(requests).toBeGreaterThan(0));
	await vi.runAllTimersAsync();
	await run;
	expect(requests).toBe(1);
	expect(vi.getTimerCount()).toBe(0);
});

it("ignores the same TPM text from another provider", async () => {
	const { provider: _provider, ...model } = session.model!;
	runtime.registerProvider("other", {
		baseUrl: "https://fixture.invalid/v1",
		api: "openai-completions",
		apiKey: "fixture",
		models: [model],
	});
	await session.setModel(runtime.getModel("other", model.id)!);
	await session.prompt("finish the task");
	expect(requests).toBe(1);
	expect(notices).toEqual([]);
});

it("continues beyond three cooldowns when each exhausted retry explicitly asks to wait", async () => {
	// User-requested behavior: the provider's exhausted-retry prefix is the gate, not a local attempt cap.
	failures = 5;
	const { run } = await startAtWait();
	await vi.runAllTimersAsync();
	await run;
	expect(requests).toBe(6);
	expect(session.messages.at(-1)).toMatchObject({ stopReason: "stop" });
});

it.each([
	"Error: Retry failed after 3 times:",
	"Error: Retry failed after 3 attempts:",
])("accepts the displayed exhausted-retry prefix %s", async (prefix) => {
	error = reportedError.replace("Retry failed after 3 attempts:", prefix);
	const { run } = await startAtWait();
	await vi.runAllTimersAsync();
	await run;
	expect(requests).toBe(2);
});

it("arms a fresh cooldown again on a later user turn in the same session", async () => {
	// Recovery must not disable the nudge for later 429s in this session.
	for (let turn = 0; turn < 2; turn++) {
		notices = [];
		failures = requests + 1;
		const before = requests;
		const { run } = await startAtWait();
		expect(requests).toBe(before + 1);
		await vi.advanceTimersByTimeAsync(noticeAt + 11_000 - Date.now() - 1);
		expect(requests).toBe(before + 1);
		await vi.advanceTimersByTimeAsync(1);
		await run;
		expect(requests).toBe(before + 2);
		expect(session.messages.at(-1)).toMatchObject({ stopReason: "stop" });
	}
});

it.each(["Escape", "session replacement"])(
	"releases a day-long cooldown promptly on %s, without advancing its deadline",
	async (action) => {
		// CodeRabbit #645: the old test advanced the entire cooldown, hiding that abort() was stuck.
		error = reportedError.replace("11 seconds", "86400 seconds");
		const { run } = await startAtWait(86400);
		const started = Date.now();
		let stopped = false;
		const previous = session;
		const abort = (
			action === "Escape" ? session.abort() : owner.newSession()
		).then(() => {
			stopped = true;
		});
		try {
			await vi.waitFor(() => expect(stopped).toBe(true), { timeout: 200 });
			expect(Date.now() - started).toBeLessThan(86400_000);
			expect(requests).toBe(1);
			expect(
				previous.messages.some((message) => message.role === "custom"),
			).toBe(false);
		} finally {
			await vi.runAllTimersAsync();
			await Promise.all([run, abort]);
		}
	},
);

it("clears an armed nudge when Pi's own retry succeeds after the cooldown", async () => {
	// Moving the wait into the active message hook must not replay after host retry recovery.
	settingsManager.setRetryEnabled(true);
	const { run } = await startAtWait();
	await vi.runAllTimersAsync();
	await run;
	expect(requests).toBe(2);
	expect(session.messages.at(-1)).toMatchObject({ stopReason: "stop" });
	expect(session.messages.some((message) => message.role === "custom")).toBe(
		false,
	);
});

it("does not carry a ready TPM nudge into a different error from Pi's retry", async () => {
	// A later nonqualifying failure must supersede the earlier cooled-down TPM failure.
	settingsManager.setRetryEnabled(true);
	failures = 2;
	followUpError = "401 unauthorized fixture";
	const { run } = await startAtWait();
	await vi.runAllTimersAsync();
	await run;
	expect(requests).toBe(2);
	expect(session.messages.at(-1)).toMatchObject({
		stopReason: "error",
		errorMessage: followUpError,
	});
	expect(session.messages.some((message) => message.role === "custom")).toBe(
		false,
	);
});

it("cancels a pending wait when the selected model changes", async () => {
	const { run } = await startAtWait();
	await session.setModel({ ...session.model!, id: "other-model" });
	await run;
	await vi.runAllTimersAsync();
	expect(requests).toBe(1);
});
