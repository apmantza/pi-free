/**
 * Tests for the opencode-free bun TLS relay (lib/opencode-relay.ts).
 *
 * The recurrence this module guards: upstream gates the anonymous free lane
 * on the caller's TLS fingerprint, so any node-side client (curl, fetch,
 * replay of a captured CLI request) receives 429 FreeUsageLimitError. The
 * relay defers the hop to bun's TLS stack on a loopback child.
 */
import { spawnSync } from "node:child_process";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import {
	normalizeContext,
	type Api,
	type Model,
} from "@earendil-works/pi-ai/compat";
import {
	createOpenCodeSessionTracker,
	createOpenCodeStreamSimple,
} from "../providers/opencode-session.ts";
import { join } from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";

// Env must be set before the module under test reads it at import.
process.env.PI_FREE_OPENCODE_RELAY_UPSTREAM = "https://upstream-mock.test";

import type { OpenCodeRelay } from "../lib/opencode-relay.js";
const {
	getOpenCodeRelay,
	getOpenCodeRelayBaseUrl,
	resetOpenCodeRelayForTest,
	OPENCODE_RELAY_PATH_RE,
} = await import("../lib/opencode-relay.js");

const BUN_AVAILABLE = spawnSync("bun", ["--version"]).status === 0;
mkdirSync(".smoke-artifacts", { recursive: true });
const fixtures = mkdtempSync(join(process.cwd(), ".smoke-artifacts/oc-relay-"));
afterAll(() => rmSync(fixtures, { recursive: true, force: true }));

describe("opencode-relay URL mapping", () => {
	const PORT = 12345;

	it("maps allowlisted opencode.ai https URLs to the loopback relay", () => {
		expect(
			getOpenCodeRelayBaseUrl("https://opencode.ai/inference/v1", PORT),
		).toBe("http://127.0.0.1:12345/inference/v1");
		expect(getOpenCodeRelayBaseUrl("https://opencode.ai/zen/v1", PORT)).toBe(
			"http://127.0.0.1:12345/zen/v1",
		);
		expect(getOpenCodeRelayBaseUrl("https://opencode.ai/zen/v1/", PORT)).toBe(
			"http://127.0.0.1:12345/zen/v1",
		);
	});

	it("never maps the Go lane or foreign hosts through the relay", () => {
		// The Go keyed lane must never traverse the anonymous relay: it has its
		// own credential and needs no TLS fingerprint help.
		expect(
			getOpenCodeRelayBaseUrl("https://opencode.ai/zen/go/v1", PORT),
		).toBeUndefined();
		expect(
			getOpenCodeRelayBaseUrl("https://example.com/inference/v1", PORT),
		).toBeUndefined();
		expect(
			getOpenCodeRelayBaseUrl("http://opencode.ai/inference/v1", PORT),
		).toBeUndefined();
	});

	it("allowlist regex matches only free-lane v1 roots", () => {
		expect(OPENCODE_RELAY_PATH_RE.test("/zen/v1/chat/completions")).toBe(true);
		expect(OPENCODE_RELAY_PATH_RE.test("/inference/v1/chat/completions")).toBe(
			true,
		);
		expect(OPENCODE_RELAY_PATH_RE.test("/zen/go/v1/chat/completions")).toBe(
			false,
		);
		expect(OPENCODE_RELAY_PATH_RE.test("/v1/chat/completions")).toBe(false);
		expect(OPENCODE_RELAY_PATH_RE.test("/inference/v2/x")).toBe(false);
	});
});

describe("opencode-relay child lifecycle (stub bun)", () => {
	beforeEach(() => {
		resetOpenCodeRelayForTest();
	});
	afterEach(() => {
		resetOpenCodeRelayForTest();
	});

	it("parses PORT from the child, resolves ready(), and stops the child", async () => {
		const dir = mkdtempSync(join(fixtures, "stub-"));
		const stub = join(dir, "stub-bun.mjs");
		// Ignore the "-e <script>" arg pair and print a fixed port.
		writeFileSync(
			stub,
			[
				`if (process.argv[2] === "-e") process.argv.splice(2, 2);`,
				`console.log("PORT=19853");`,
				`setInterval(() => {}, 1 << 30);`, // stay alive until killed
			].join("\n"),
		);
		const relay = getOpenCodeRelay({
			bunCommand: process.execPath,
			childArgs: [stub, "-e", "unused"],
			idleTtlMs: 60_000,
		});
		// The stub ignores -e, so argv is [stub]; its print gives us the port.
		// The same generation must serve overlapping first turns, not reject
		// the earlier caller as "superseded" while Bun is still starting (#631).
		const [port, concurrentPort] = await Promise.all([
			relay.ready(4000),
			relay.ready(4000),
		]);
		expect(port).toBe(19853);
		expect(concurrentPort).toBe(port);
		relay.stop();
		expect(relay.port()).toBeUndefined();
		await expect(relay.ready(100)).rejects.toThrow(/not running|stopped/);
	});

	// #631: ENOENT used to leave a running-looking singleton; every later
	// anonymous turn then waited the full readiness window before falling back.
	it("fails consecutive readiness calls immediately after missing Bun", async () => {
		const relay = getOpenCodeRelay({
			bunCommand: join(fixtures, "definitely-missing-bun"),
		});
		await expect(relay.ready(4000)).rejects.toThrow(/ENOENT/);
		await expect(relay.ready(20)).rejects.toThrow("not running");
		expect(getOpenCodeRelay()).toBe(relay);
	});

	it("reports unavailability when the bun command cannot spawn", async () => {
		const dir = mkdtempSync(join(fixtures, "stub-"));
		const stub = join(dir, "exiting.mjs");
		writeFileSync(stub, `process.exit(7);`);
		vi.useFakeTimers();
		try {
			const relay = getOpenCodeRelay({
				bunCommand: process.execPath,
				childArgs: [stub, "-e", "unused"],
			});
			// #631: a stream's finally must not resurrect an idle timer after
			// its child exits during acquisition.
			const release = relay.acquire();
			await expect(relay.ready(4000)).rejects.toThrow();
			release();
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});

/**
 * Passthrough + allowlist gate tests run the REAL bun relay script against a
 * local mock upstream. Skip reason named per environment-blocked convention:
 * bun is the mechanism under test, not a dependency we can emulate.
 */
const describeBun = BUN_AVAILABLE ? describe : describe.skip;

describeBun("opencode-relay passthrough (real bun)", () => {
	let upstream: http.Server;
	let upstreamUrl: string;
	let sawMethod: string | undefined;
	let sawPath: string | undefined;
	let sawAuth: string | undefined;
	let sawCliHeader: string | undefined;
	const gzipText = `data: ${"compressed SSE ".repeat(100)}\n\n`;
	const pending = new Map<string, http.ServerResponse>();
	beforeAll(async () => {
		upstream = http.createServer((req, res) => {
			let body = "";
			req.on("data", (c) => (body += c));
			req.on("end", () => {
				sawMethod = req.method;
				sawPath = req.url;
				sawAuth = req.headers.authorization;
				sawCliHeader =
					typeof req.headers["x-opencode-client"] === "string"
						? req.headers["x-opencode-client"]
						: undefined;
				if (req.url?.endsWith("/gzip")) {
					const compressed = gzipSync(gzipText);
					res.writeHead(200, {
						"content-type": "text/event-stream",
						"content-encoding": "gzip",
						"content-length": compressed.length,
					});
					res.end(compressed);
				} else if (body.includes('"model":"relay-lifecycle"')) {
					res.writeHead(200, { "content-type": "text/event-stream" });
					res.write(
						`data: ${JSON.stringify({
							id: "relay-test",
							choices: [
								{
									index: 0,
									delta: { role: "assistant", content: "hello" },
									finish_reason: null,
								},
							],
						})}\n\n`,
					);
					const content = JSON.parse(body).messages.at(-1).content;
					const marker =
						typeof content === "string"
							? content
							: content
									.map((part: { text?: string }) => part.text ?? "")
									.join("");
					pending.set(marker, res);
				} else if (req.url?.endsWith("/streaming")) {
					res.writeHead(200, { "content-type": "text/plain" });
					res.write("chunk-1\n");
					setTimeout(() => {
						res.write("chunk-2\n");
						res.end();
					}, 25);
				} else {
					res.writeHead(200, { "content-type": "application/json" });
					res.end(
						JSON.stringify({
							echo: body,
							client: req.headers["x-opencode-client"],
						}),
					);
				}
			});
		});
		await new Promise<void>((resolve) => {
			upstream.listen(0, "127.0.0.1", () => {
				const { port } = upstream.address() as AddressInfo;
				upstreamUrl = `http://127.0.0.1:${port}`;
				process.env.PI_FREE_OPENCODE_RELAY_UPSTREAM = upstreamUrl;
				resolve();
			});
		});
	}, 5000);
	afterAll(async () => {
		upstream.closeAllConnections();
		await new Promise<void>((resolve) => upstream.close(() => resolve()));
	});

	let relay: OpenCodeRelay | undefined;

	beforeEach(() => {
		resetOpenCodeRelayForTest();
		relay = getOpenCodeRelay({ bunCommand: "bun" });
	});

	afterEach(() => {
		resetOpenCodeRelayForTest();
		for (const response of pending.values()) response.destroy();
		pending.clear();
		vi.useRealTimers();
	});

	// #631: a real parent process is required to prove both event-loop drain
	// and its exit hook. In-process mocks cannot observe an orphan Bun child.
	it.each(["natural", "explicit", "killed"])(
		"stops the child on %s parent exit",
		async (mode) => {
			const home = mkdtempSync(join(fixtures, "parent-"));
			const statePath = join(home, "child.json");
			const entry = pathToFileURL(
				process.env.PI_FREE_RELAY_TEST_ENTRY ??
					join(process.cwd(), "lib/opencode-relay.ts"),
			).href;
			const observe = `require("node:fs").writeFileSync(${JSON.stringify(statePath)}, JSON.stringify({ pid: process.pid, port: server.port }));`;
			const script = `
			const {getOpenCodeRelay, OPENCODE_RELAY_SCRIPT} = await import(${JSON.stringify(entry)});
			// Observe the real child's identity before its readiness publication.
			const childScript = OPENCODE_RELAY_SCRIPT.replace('console.log("PORT=" + server.port);', ${JSON.stringify(observe)} + '\\nconsole.log("PORT=" + server.port);');
			await getOpenCodeRelay({childArgs: ["-e", childScript]}).ready(4000);
			${mode === "explicit" ? "process.exit(0);" : mode === "killed" ? 'process.kill(process.pid, "SIGKILL");' : ""}
		`;
			let pid: number | undefined;
			try {
				const parent = spawnSync(
					process.execPath,
					["--import", "tsx", "--input-type=module", "-e", script],
					{
						env: {
							...process.env,
							HOME: home,
							USERPROFILE: home,
							XDG_DATA_HOME: join(home, "data"),
							XDG_CACHE_HOME: join(home, "cache"),
						},
						encoding: "utf8",
						timeout: 8000,
					},
				);
				const state = JSON.parse(readFileSync(statePath, "utf8")) as {
					pid: number;
					port: number;
				};
				pid = state.pid;
				expect(parent.error, parent.stderr).toBeUndefined();
				if (mode === "killed") expect(parent.status).not.toBe(0);
				else expect(parent.status, parent.stderr).toBe(0);
				await vi.waitFor(async () => {
					await expect(
						fetch(`http://127.0.0.1:${state.port}/nope`, {
							signal: AbortSignal.timeout(250),
						}),
					).rejects.toThrow();
				});
			} finally {
				// Failed pre-fix probes must not themselves leave an orphan process.
				if (pid !== undefined) {
					try {
						process.kill(pid);
					} catch {
						/* already gone */
					}
				}
			}
		},
		15000,
	);

	// #631: an idle stop left the stopped singleton cached forever.
	it("restarts a real relay after idle expiry", async () => {
		resetOpenCodeRelayForTest();
		vi.useFakeTimers();
		const expired = getOpenCodeRelay({ idleTtlMs: 50 });
		await expired.ready(8000);
		await vi.advanceTimersByTimeAsync(51);
		const replacement = getOpenCodeRelay();
		expect(replacement).not.toBe(expired);
		await expect(replacement.ready(8000)).resolves.toBeGreaterThan(0);
	});

	// #631: Bun decoded gzip but kept its encoding header (double decode).
	// Preserve the encoded wire bytes instead of rewriting body metadata.
	it("forwards compressed SSE without mismatched encoding or length", async () => {
		const port = await relay!.ready(8000);
		const response = await fetch(`http://127.0.0.1:${port}/inference/v1/gzip`);
		expect(response.headers.get("content-encoding")).toBe("gzip");
		await expect(response.text()).resolves.toBe(gzipText);
		const wire = await new Promise<Buffer>((resolve, reject) => {
			http
				.get(`http://127.0.0.1:${port}/inference/v1/gzip`, (raw) => {
					const chunks: Buffer[] = [];
					raw.on("data", (chunk: Buffer) => chunks.push(chunk));
					raw.on("end", () => resolve(Buffer.concat(chunks)));
					raw.on("error", reject);
				})
				.on("error", reject);
		});
		expect(wire).toEqual(gzipSync(gzipText));
	});

	// #631: the start-only idle timer killed a live stream. Drive the actual
	// provider stream and real Bun; only the parent's idle clock is virtual.
	it.each(["finish", "abort", "error"])(
		"keeps overlapping streams alive until the last %s",
		async (last) => {
			resetOpenCodeRelayForTest();
			vi.useFakeTimers();
			const active = getOpenCodeRelay({ idleTtlMs: 50 });
			await active.ready(8000);
			const streamSimple = createOpenCodeStreamSimple(
				createOpenCodeSessionTracker(),
				{ anonymous: true },
			);
			const model = {
				id: "relay-lifecycle",
				name: "relay lifecycle",
				provider: "opencode-free",
				api: "openai-completions",
				baseUrl: "https://opencode.ai/inference/v1",
				reasoning: false,
				input: ["text"],
				contextWindow: 10000,
				maxTokens: 100,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			} as Model<Api>;
			const context = normalizeContext({
				messages: [
					{ role: "user", content: "first-stream", timestamp: Date.now() },
				],
			});
			const controller = new AbortController();
			// #635 Windows CI: arrival order is not caller identity. Start the
			// stream that finishes last first, and key responses by request data.
			const second = streamSimple(
				model,
				normalizeContext({
					messages: [
						{ role: "user", content: "second-stream", timestamp: Date.now() },
					],
				}),
				{
					maxTokens: 10,
					signal: controller.signal,
				},
			);
			const first = streamSimple(model, context, { maxTokens: 10 });
			await vi.waitUntil(
				() => pending.has("first-stream") && pending.has("second-stream"),
				{
					timeout: 5000,
					interval: 10,
				},
			);
			const finish = (response: http.ServerResponse) =>
				response.end(
					`data: ${JSON.stringify({
						id: "relay-test",
						choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
					})}\n\ndata: [DONE]\n\n`,
				);
			finish(pending.get("first-stream")!);
			expect((await first.result()).stopReason).toBe("stop");
			// The failure must be midstream, not a race with response startup.
			let receivedText: string | undefined;
			for await (const event of second) {
				if (event.type === "text_delta") {
					receivedText = event.delta;
					break;
				}
			}
			expect(receivedText).toBe("hello");
			await vi.advanceTimersByTimeAsync(51);
			await expect(active.ready(100)).resolves.toBeGreaterThan(0);
			if (last === "abort") controller.abort();
			else if (last === "error") pending.get("second-stream")!.destroy();
			else finish(pending.get("second-stream")!);
			expect((await second.result()).stopReason).toBe(
				last === "abort" ? "aborted" : last === "error" ? "error" : "stop",
			);
			await vi.advanceTimersByTimeAsync(51);
			expect(getOpenCodeRelay()).not.toBe(active);
		},
	);

	it("forwards byte-identical bodies/headers and streams SSE chunks incrementally", async () => {
		const port = await relay!.ready(8000);
		const r = await fetch(
			`http://127.0.0.1:${port}/inference/v1/chat/completions`,
			{
				method: "POST",
				headers: {
					authorization: "Bearer public",
					"x-opencode-client": "cli",
					"content-type": "application/json",
				},
				body: JSON.stringify({ model: "beam-free", max_tokens: 32000 }),
			},
		);
		if (r.status !== 200)
			throw new Error(
				`relay returned status ${r.status}: ${await r.clone().text()}`,
			);
		expect(r.status).toBe(200);
		const out = await r.text();
		if (r.status !== 200)
			throw new Error(`relay returned status ${r.status}: ${out}`);
		expect((JSON.parse(out) as { echo?: string })?.echo).toBe(
			JSON.stringify({ model: "beam-free", max_tokens: 32000 }),
		);
		expect(sawMethod).toBe("POST");
		expect(sawPath).toBe("/inference/v1/chat/completions");
		// The client's headers pass through untouched — Auth: Bearer public and
		// the CLI-fingerprint header are exactly what the free lane expects.
		expect(sawAuth).toBe("Bearer public");
		expect(sawCliHeader).toBe("cli");

		// Streaming: response chunks arrive incrementally, not buffered whole.
		const res = await fetch(`http://127.0.0.1:${port}/inference/v1/streaming`, {
			method: "POST",
			body: "stream-me",
		});
		const reader = res.body!.getReader();
		const first = await reader.read();
		expect(Buffer.from(first.value!).toString()).toContain("chunk-1");
	}, 10_000);

	it("rejects non-allowlisted paths at the relay (fail-closed gate)", async () => {
		const port = await relay!.ready(8000);
		const res = await fetch(`http://127.0.0.1:${port}/admin/secret`, {
			method: "POST",
			body: "x",
		});
		expect(res.status).toBe(404);
	}, 10_000);

	// named recurrence: this asserts that #613's /inference route still passes
	// through the relay untouched — a regression here would strand free turns.
	it("relays both /zen/v1 and /inference/v1 roots", async () => {
		const port = await relay!.ready(8000);
		for (const path of ["/zen/v1/models", "/inference/v1/models"]) {
			const res = await fetch(`http://127.0.0.1:${port}${path}`, {
				method: "GET",
			});
			expect(res.status).toBe(200);
		}
	}, 10_000);
});
