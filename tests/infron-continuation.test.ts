// #646: UI retry summaries are not assistant errors. Drive real HTTP failures,
// Pi retries, settlement and active-run cancellation; only HTTP is replaced.
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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

/** Body Infron actually returns for a TPM limit, as an HTTP 429 JSON error. */
function tpmError(seconds: number) {
	return {
		message: `TPM rate limit exceeded (1M tokens per minute). Please try again after ${seconds} seconds. (request id: fixture)`,
		type: "rate_limit_error",
		param: "",
		code: "tpm_rate_limit_exceeded",
	};
}
type Failure = { status: number; body: unknown };
let home: string;
let session: Awaited<ReturnType<typeof createAgentSession>>["session"];
let owner: Awaited<ReturnType<typeof createAgentSessionRuntime>>;
let runtime: ModelRuntime;
let settingsManager: SettingsManager;
let failures: Failure[];
let requests: number[];
let notices: string[];
let noticeAt: number;
let retryEnds: { attempt: number; success: boolean; at: number }[];
let changeModelAfterArming: boolean;
let onCooldownNotice: (() => void) | undefined;
let breakCooldownNotice: boolean;
let holdFirstResponse: Promise<void> | undefined;

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
	failures = [20, 17, 12, 3].map((seconds) => ({
		status: 429,
		body: tpmError(seconds),
	}));
	requests = [];
	notices = [];
	noticeAt = 0;
	retryEnds = [];
	changeModelAfterArming = false;
	onCooldownNotice = undefined;
	breakCooldownNotice = false;
	holdFirstResponse = undefined;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request) => {
			const url = input instanceof Request ? input.url : String(input);
			if (url.endsWith("/models"))
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
			requests.push(Date.now());
			if (requests.length === 1) await holdFirstResponse;
			const failure = failures[requests.length - 1];
			if (failure)
				return typeof failure.body === "string"
					? new Response(failure.body, { status: failure.status })
					: Response.json(failure.body, { status: failure.status });
			return new Response(
				'data: {"id":"fixture","choices":[{"index":0,"delta":{"content":"resumed"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
				{ headers: { "content-type": "text/event-stream" } },
			);
		}),
	);
	const { default: infron } = await import("../providers/infron/infron.ts");
	settingsManager = SettingsManager.inMemory({
		retry: {
			enabled: true,
			maxRetries: 3,
			baseDelayMs: 1,
			provider: { maxRetries: 0 },
		},
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
					extensionFactories: [
						infron,
						(pi) => {
							pi.on("agent_before_settle", async (event, ctx) => {
								if (changeModelAfterArming && event.continue) {
									await pi.setModel({ ...ctx.model!, id: "other-model" });
								}
							});
						},
					],
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
		session.subscribe((event) => {
			if (event.type === "auto_retry_end")
				retryEnds.push({
					attempt: event.attempt,
					success: event.success,
					at: Date.now(),
				});
		});
		await session.bindExtensions({
			uiContext: {
				notify: (message: string) => {
					if (breakCooldownNotice && message.startsWith("Infron TPM limit:"))
						throw new Error("host UI is down");
					notices.push(message);
					noticeAt = Date.now();
					if (message.startsWith("Infron TPM limit:")) onCooldownNotice?.();
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
	// Dynamic provider registration completes after refresh() resolves (the
	// nudge path exists for exactly this); wait for the model instead of
	// asserting on the first tick, which raced under full-suite load.
	await vi.waitFor(
		() =>
			expect(
				runtime.getModel("infron", "deepseek/deepseek-v4-flash:free"),
			).toBeDefined(),
		{ timeout: 4000 },
	);
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

/**
 * Prompt until Pi has exhausted its retries on the advertised delay and the
 * cooldown notice is out, i.e. the automatic continuation is parked in its
 * wait. Returns the still-pending run so the caller controls the clock.
 */
async function startAtWait(seconds = 3) {
	const run = session.prompt("finish the task");
	await vi.waitFor(
		() =>
			expect(
				notices.some((message) => message.includes(`${seconds} seconds`)),
				JSON.stringify(session.messages.at(-1)),
			).toBe(true),
		{ timeout: 1000 },
	);
	return { run };
}

it("waits for actual retry exhaustion, then uses the last HTTP 429 delay (20/17/12/3)", async () => {
	// Exact live recurrence: four raw assistant 429s, then a UI-only three-retry summary.
	const { run } = await startAtWait();
	expect(requests).toHaveLength(4);
	expect(retryEnds).toEqual([
		{ attempt: 3, success: false, at: expect.any(Number) },
	]);
	expect(noticeAt).toBeGreaterThanOrEqual(retryEnds[0]!.at);
	const errors = session.sessionManager
		.getEntries()
		.flatMap((entry) =>
			entry.type === "message" &&
			entry.message.role === "assistant" &&
			entry.message.stopReason === "error"
				? [entry.message]
				: [],
		);
	expect(errors).toHaveLength(4);
	for (const message of errors) {
		expect(message).toMatchObject({
			errorMessage: expect.stringMatching(/^429/),
		});
		expect(JSON.stringify(message)).not.toContain("Retry failed after");
	}
	await vi.advanceTimersByTimeAsync(noticeAt + 3000 - Date.now() - 1);
	expect(requests).toHaveLength(4);
	await vi.advanceTimersByTimeAsync(1);
	await run;
	expect(requests).toHaveLength(5);
	expect(session.messages.at(-1)).toMatchObject({
		role: "assistant",
		stopReason: "stop",
	});
	expect(
		session.messages.filter((message) => message.role === "user"),
	).toHaveLength(1);
});

it("does not add a cooldown or nudge when Pi's retry recovers", async () => {
	failures = failures.slice(0, 2);
	const run = session.prompt("finish the task");
	await vi.runAllTimersAsync();
	await run;
	expect(requests).toHaveLength(3);
	expect(notices).toEqual([]);
	expect(session.messages.some((message) => message.role === "custom")).toBe(
		false,
	);
	expect(retryEnds).toEqual([
		{ attempt: 2, success: true, at: expect.any(Number) },
	]);
});

it.each([
	{ status: 500, body: tpmError(3) },
	{ status: 429, body: { ...tpmError(3), code: "other_rate_limit" } },
	{ status: 429, body: { ...tpmError(3), code: undefined } },
	{
		status: 429,
		body: {
			message:
				'"code":"tpm_rate_limit_exceeded" Please try again after 3 seconds.',
			code: "other_rate_limit",
		},
	},
	{ status: 429, body: null },
	{ status: 429, body: { ...tpmError(3), message: "Please try again soon." } },
	{ status: 429, body: tpmError(0) },
	{ status: 429, body: tpmError(999999999999) },
	{
		status: 429,
		body: "not JSON: tpm_rate_limit_exceeded Please try again after 3 seconds.",
	},
])("does not continue a nonqualifying HTTP failure: %j", async (failure) => {
	settingsManager.setRetryEnabled(false);
	failures = [failure];
	const run = session.prompt("finish the task");
	await vi.runAllTimersAsync();
	await run;
	expect(requests).toHaveLength(1);
	expect(notices).toEqual([]);
});

it("does not continue a final non-TPM error after earlier TPM retries", async () => {
	failures[3] = { status: 401, body: { message: "unauthorized fixture" } };
	const run = session.prompt("finish the task");
	await vi.runAllTimersAsync();
	await run;
	expect(requests).toHaveLength(4);
	expect(notices).toEqual([]);
});

it.each([86400, 2_147_483])(
	"preserves the full advertised %i-second delay",
	async (seconds) => {
		settingsManager.setRetryEnabled(false);
		failures = [{ status: 429, body: tpmError(seconds) }];
		const { run } = await startAtWait(seconds);
		await vi.advanceTimersByTimeAsync(
			noticeAt + seconds * 1000 - Date.now() - 1,
		);
		expect(requests).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		await run;
		expect(requests).toHaveLength(2);
	},
);

it.each(["Escape", "session replacement", "model change"])(
	"cancels the final cooldown promptly on %s",
	async (action) => {
		// Cancel the native continuation's active run, never wait for its remote deadline.
		failures[3] = { status: 429, body: tpmError(86400) };
		const { run } = await startAtWait(86400);
		let stopped = false;
		const stop = (
			action === "Escape"
				? session.abort()
				: action === "session replacement"
					? owner.newSession()
					: session.setModel({ ...session.model!, id: "other-model" })
		).then(() => {
			stopped = true;
		});
		let finished = false;
		void run.then(() => {
			finished = true;
		});
		try {
			await vi.waitFor(
				() => {
					expect(stopped).toBe(true);
					expect(finished).toBe(true);
				},
				{ timeout: 200 },
			);
			expect(requests).toHaveLength(4);
		} finally {
			await vi.runAllTimersAsync();
			await Promise.all([run, stop]);
		}
	},
);

it("does not retry a late failure from a model the user already left", async () => {
	// A model_select can precede the old in-flight request's message_end; event cancellation alone is insufficient.
	settingsManager.setRetryEnabled(false);
	let release!: () => void;
	holdFirstResponse = new Promise<void>((done) => {
		release = done;
	});
	const run = session.prompt("finish the task");
	await vi.waitFor(() => expect(requests).toHaveLength(1));
	await session.setModel({ ...session.model!, id: "other-model" });
	release();
	await vi.runAllTimersAsync();
	await run;
	expect(requests).toHaveLength(1);
	expect(notices).toEqual([]);
});

it("suppresses an armed continuation when a later boundary handler changes the model", async () => {
	// A supported sibling boundary actor can change identity after our draft but before agent_start.
	changeModelAfterArming = true;
	const run = session.prompt("finish the task");
	await vi.runAllTimersAsync();
	await run;
	expect(requests).toHaveLength(4);
	expect(session.model?.id).toBe("other-model");
	expect(notices).toEqual([]);
});

it("holds the cooldown when the host notification callback throws", async () => {
	// Recurrence this prevents: a throwing host UI made agent_start reject before the
	// timer/abort listener existed, so the nudge skipped the cooldown and hit the
	// rate-limited endpoint immediately (review of #650, probe A).
	failures[3] = { status: 429, body: tpmError(3) };
	breakCooldownNotice = true;
	const run = session.prompt("finish the task");
	await vi.waitFor(() => expect(requests.length).toBeGreaterThanOrEqual(4), {
		timeout: 1000,
	});
	let finished = false;
	void run.then(() => {
		finished = true;
	});
	await vi.advanceTimersByTimeAsync(2000);
	expect(requests).toHaveLength(4);
	expect(finished).toBe(false);
	await vi.advanceTimersByTimeAsync(1000);
	await run;
	expect(requests).toHaveLength(5);
	await session.prompt("/free-infron-retry");
	expect(notices.at(-1)).toContain("notify-failed: 1");
});

it("cancels when a host notification callback submits input before timer setup completes", async () => {
	// Independent review: synchronous UI callbacks can cancel before ticket.finish is published.
	failures[3] = { status: 429, body: tpmError(86400) };
	let input: Promise<void> | undefined;
	onCooldownNotice = () => {
		input = session.prompt("replacement from host callback", {
			streamingBehavior: "steer",
		});
	};
	const { run } = await startAtWait(86400);
	let finished = false;
	void run.then(() => {
		finished = true;
	});
	try {
		await input;
		await vi.waitFor(() => expect(finished).toBe(true), { timeout: 200 });
		expect(requests).toHaveLength(4);
	} finally {
		await vi.runAllTimersAsync();
		await run;
	}
});

it("cancels automatic continuation on new input without erasing user intent", async () => {
	// The active automatic request must stop, but Pi must retain the user's steering message.
	failures[3] = { status: 429, body: tpmError(86400) };
	const { run } = await startAtWait(86400);
	const input = session.prompt("do the replacement task", {
		streamingBehavior: "steer",
	});
	let finished = false;
	void run.then(() => {
		finished = true;
	});
	try {
		await vi.waitFor(() => expect(finished).toBe(true), { timeout: 200 });
		await input;
		expect(requests).toHaveLength(4);
		const preserved =
			session.getSteeringMessages().includes("do the replacement task") ||
			session.messages.some(
				(message) =>
					message.role === "user" &&
					JSON.stringify(message.content).includes("do the replacement task"),
			);
		expect(preserved).toBe(true);
	} finally {
		await vi.runAllTimersAsync();
		await run;
	}
});

it("continues after every exhausted group without a nudge cap", async () => {
	failures = Array.from({ length: 20 }, () => ({
		status: 429,
		body: tpmError(1),
	}));
	const run = session.prompt("finish the task");
	await vi.runAllTimersAsync();
	await run;
	expect(requests).toHaveLength(21);
	expect(retryEnds.filter((event) => !event.success)).toHaveLength(5);
	expect(
		notices.filter((message) => message.includes("1 seconds")),
	).toHaveLength(5);
	await session.prompt("/free-infron-retry");
	expect(notices.at(-1)).toContain("observed: 20");
	expect(notices.at(-1)).toContain("continuation-armed: 5");
	(await import("../lib/logger.ts")).flushLogsSync();
	const log = readFileSync(resolve(home, ".pi/free.log"), "utf8");
	expect(
		log
			.split("\n")
			.filter(
				(line) =>
					line.includes("[infron-retry]") &&
					line.includes('"decision":"observed"'),
			),
	).toHaveLength(1);
});

it("uses a fresh cooldown on a later user turn", async () => {
	for (let turn = 0; turn < 2; turn++) {
		notices = [];
		const previous = requests.length;
		failures.length = previous;
		failures.push(
			...[20, 17, 12, 3].map((seconds) => ({
				status: 429,
				body: tpmError(seconds),
			})),
		);
		const { run } = await startAtWait();
		await vi.advanceTimersByTimeAsync(noticeAt + 3000 - Date.now());
		await run;
		expect(requests).toHaveLength(previous + 5);
	}
});

it("exposes why a live Infron error was skipped without printing its payload", async () => {
	settingsManager.setRetryEnabled(false);
	failures = [
		{
			status: 429,
			body: { message: "private fixture body", code: "other_rate_limit" },
		},
	];
	const run = session.prompt("finish the task");
	await vi.runAllTimersAsync();
	await run;
	await session.prompt("/free-infron-retry");
	expect(notices.at(-1)).toContain("Infron retry lifecycle v2");
	expect(notices.at(-1)).toContain("unrecognized-error: 1");
	expect(notices.at(-1)).not.toContain("private fixture body");
	expect(requests).toHaveLength(1);
});

it("ignores the same HTTP TPM response from another provider", async () => {
	const { provider: _provider, ...model } = session.model!;
	runtime.registerProvider("other", {
		baseUrl: "https://fixture.invalid/v1",
		api: "openai-completions",
		apiKey: "fixture",
		models: [model],
	});
	await session.setModel(runtime.getModel("other", model.id)!);
	const run = session.prompt("finish the task");
	await vi.runAllTimersAsync();
	await run;
	expect(requests).toHaveLength(4);
	expect(notices).toEqual([]);
});
