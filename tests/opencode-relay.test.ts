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
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import {
	isRetryableAssistantError,
	normalizeContext,
	type Api,
	type AssistantMessage,
	type Model,
} from "@earendil-works/pi-ai/compat";
import { classifyErrorMessage } from "../lib/auto-fallback/classifier.ts";
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
	getOpenCodeRelayFailure,
	resetOpenCodeRelayForTest,
	resolveBunCommand,
	OPENCODE_RELAY_PATH_RE,
} = await import("../lib/opencode-relay.js");

const BUN_AVAILABLE = spawnSync("bun", ["--version"]).status === 0;
mkdirSync(".smoke-artifacts", { recursive: true });
const fixtures = mkdtempSync(join(process.cwd(), ".smoke-artifacts/oc-relay-"));
afterAll(() => rmSync(fixtures, { recursive: true, force: true }));

const FREE_LIMIT_BODY = JSON.stringify({
	type: "FreeUsageLimitError",
	message: "Free usage limit reached.",
});

function freeTurn(): Promise<AssistantMessage> {
	const model = {
		id: "relay-failure",
		name: "relay failure",
		provider: "opencode-free",
		api: "openai-completions",
		baseUrl: "https://opencode.ai/inference/v1",
		reasoning: false,
		input: ["text"],
		contextWindow: 10000,
		maxTokens: 100,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	} as Model<Api>;
	return createOpenCodeStreamSimple(createOpenCodeSessionTracker(), {
		anonymous: true,
	})(
		model,
		normalizeContext({
			messages: [{ role: "user", content: "hi", timestamp: 0 }],
		}),
		{ maxTokens: 10 },
	).result();
}

/** The upstream hop is the only fixture; loopback still reaches a real relay child. */
function stubDirectLane(status: number, body: string) {
	const realFetch = globalThis.fetch;
	const direct = vi.fn(
		async () =>
			new Response(body, {
				status,
				headers: { "content-type": "application/json" },
			}),
	);
	vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
		new URL(input instanceof Request ? input.url : String(input)).hostname ===
		"127.0.0.1"
			? realFetch(input, init)
			: direct(),
	);
	return direct;
}

/** A relay child that binds, waits, then reports its port and answers every request. */
function startStubRelay(delayMs: number, status: number, body: string) {
	const stub = join(mkdtempSync(join(fixtures, "stub-")), "relay.mjs");
	writeFileSync(
		stub,
		[
			`import http from "node:http";`,
			`const server = http.createServer((_req, res) => {`,
			`  res.writeHead(${status}, { "content-type": "application/json" });`,
			`  res.end(${JSON.stringify(body)});`,
			`});`,
			`server.listen(0, "127.0.0.1", () => {`,
			`  setTimeout(() => console.log("PORT=" + server.address().port), ${delayMs});`,
			`});`,
		].join("\n"),
	);
	return getOpenCodeRelay({
		bunCommand: process.execPath,
		childArgs: [stub],
	});
}

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

// #654: pure lookup, so the Windows branch is pinned on every platform.
describe("resolveBunCommand", () => {
	const resolveWith = (
		present: string[],
		env: NodeJS.ProcessEnv,
		platform: NodeJS.Platform = "linux",
		hostBun?: string,
	) =>
		resolveBunCommand({
			env,
			platform,
			hostBun,
			exists: (path) => present.includes(path),
		});

	it("lets the explicit override win without checking it exists", () => {
		expect(
			resolveWith(["/path/bun"], {
				PI_FREE_OPENCODE_BUN: "/custom/bun",
				PATH: "/path",
			}),
		).toBe("/custom/bun");
	});

	it("prefers PATH over install locations and the host binary", () => {
		expect(
			resolveWith(
				["/path/bun", "/home/me/.bun/bin/bun"],
				{ PATH: "/path", HOME: "/home/me" },
				"linux",
				"/opt/pi",
			),
		).toBe("/path/bun");
	});

	it("checks BUN_INSTALL before the default home install", () => {
		expect(
			resolveWith(["/custom/bin/bun", "/home/me/.bun/bin/bun"], {
				BUN_INSTALL: "/custom",
				HOME: "/home/me",
			}),
		).toBe("/custom/bin/bun");
		expect(resolveWith(["/home/me/.bun/bin/bun"], { HOME: "/home/me" })).toBe(
			"/home/me/.bun/bin/bun",
		);
	});

	it("does not resolve a bun from a relative PATH entry", () => {
		expect(resolveWith(["bun", "./bun"], { PATH: ":.:" })).toBe("bun");
		expect(resolveWith(["bun.exe"], { PATH: ";.;" }, "win32")).toBe("bun");
	});

	it("skips npm's Windows shim and finds the real bun.exe", () => {
		const npm = "C:\\Users\\me\\AppData\\Roaming\\npm";
		expect(
			resolveWith(
				[`${npm}\\bun.cmd`, `${npm}\\node_modules\\bun\\bin\\bun.exe`],
				{ PATH: npm, APPDATA: "C:\\Users\\me\\AppData\\Roaming" },
				"win32",
			),
		).toBe(`${npm}\\node_modules\\bun\\bin\\bun.exe`);
	});

	it("finds the Windows installer's default location", () => {
		expect(
			resolveWith(
				["C:\\Users\\me\\.bun\\bin\\bun.exe"],
				{ USERPROFILE: "C:\\Users\\me" },
				"win32",
			),
		).toBe("C:\\Users\\me\\.bun\\bin\\bun.exe");
	});

	it("falls back to the Bun host's binary, then to bare bun for a clear ENOENT", () => {
		expect(resolveWith([], { PATH: "/path" }, "linux", "/opt/pi")).toBe(
			"/opt/pi",
		);
		expect(resolveWith([], { PATH: "/path" })).toBe("bun");
	});
});

describe("opencode-relay child lifecycle (stub bun)", () => {
	beforeEach(() => {
		resetOpenCodeRelayForTest();
	});
	afterEach(() => {
		resetOpenCodeRelayForTest();
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	// #654: the 429 was all a user saw, and it reads as an exhausted quota.
	it("explains the upstream 429 when Bun cannot start, keeping its classification", async () => {
		getOpenCodeRelay({ bunCommand: join(fixtures, "definitely-missing-bun") });
		const direct = stubDirectLane(429, FREE_LIMIT_BODY);
		const message = await freeTurn();
		expect(direct).toHaveBeenCalledOnce();
		expect(message.errorMessage).toContain(`429: ${FREE_LIMIT_BODY}`);
		expect(message.errorMessage).toContain("ENOENT");
		expect(message.errorMessage).toContain("PI_FREE_OPENCODE_BUN");
		// Pi must not start retrying a limit error, and auto-fallback still switches.
		expect(isRetryableAssistantError(message)).toBe(false);
		expect(classifyErrorMessage(message.errorMessage)).toBe("recoverable");
	});

	it("does not blame Bun when the user turned the relay off", async () => {
		vi.stubEnv("PI_FREE_OPENCODE_RELAY", "0");
		stubDirectLane(429, FREE_LIMIT_BODY);
		const message = await freeTurn();
		expect(message.errorMessage).toContain("FreeUsageLimitError");
		expect(message.errorMessage).not.toContain("PI_FREE_OPENCODE_BUN");
	});

	it("does not blame Bun for an unrelated upstream error", async () => {
		getOpenCodeRelay({ bunCommand: join(fixtures, "definitely-missing-bun") });
		stubDirectLane(400, JSON.stringify({ error: { message: "bad request" } }));
		const message = await freeTurn();
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).not.toContain("PI_FREE_OPENCODE_BUN");
	});

	// A real limit reached through a working relay is honest upstream truth.
	it("does not blame Bun when the 429 came through a running relay", async () => {
		startStubRelay(0, 429, FREE_LIMIT_BODY);
		const direct = stubDirectLane(500, "{}");
		const message = await freeTurn();
		expect(direct).not.toHaveBeenCalled();
		expect(message.errorMessage).toContain("FreeUsageLimitError");
		expect(message.errorMessage).not.toContain("PI_FREE_OPENCODE_BUN");
	});

	// A cold start past the old 2 s window sent the turn to the direct lane's 429.
	it("waits for a slow Bun start instead of falling through to the direct lane", async () => {
		const body = JSON.stringify({ error: { message: "reached-the-relay" } });
		startStubRelay(2500, 400, body);
		const direct = stubDirectLane(429, FREE_LIMIT_BODY);
		const message = await freeTurn();
		expect(direct).not.toHaveBeenCalled();
		expect(message.errorMessage).toContain("reached-the-relay");
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

	// A hung start charged the whole readiness window on every later turn, and
	// the child survived: a host binary that ignores BUN_BE_BUN never binds.
	it("retires a start that misses the readiness window", async () => {
		const stub = join(mkdtempSync(join(fixtures, "stub-")), "hung.mjs");
		writeFileSync(stub, `setInterval(() => {}, 1 << 30);`);
		const relay = getOpenCodeRelay({
			bunCommand: process.execPath,
			childArgs: [stub],
		});
		await expect(relay.ready(50)).rejects.toThrow("did not become ready");
		await expect(relay.ready(4000)).rejects.toThrow("not running");
		expect(getOpenCodeRelayFailure()).toContain("did not become ready");
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
				if (req.url?.endsWith("/slow-first-byte")) {
					setTimeout(() => {
						res.writeHead(200, { "content-type": "text/event-stream" });
						res.end("late");
					}, 14_000);
				} else if (req.url?.endsWith("/slow-gap")) {
					res.writeHead(200, { "content-type": "text/event-stream" });
					res.write("early,");
					setTimeout(() => res.end("late"), 14_000);
				} else if (req.url?.endsWith("/gzip")) {
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
		vi.unstubAllEnvs();
	});

	// Bun.serve closes a connection idle for 10 s by default, swept up to a few
	// seconds late. A slow model is silent that long before its first byte and
	// between chunks.
	it("keeps a response open through 14 s of upstream silence", async () => {
		const port = await relay!.ready(8000);
		const [firstByte, gap] = await Promise.all(
			["slow-first-byte", "slow-gap"].map(async (path) => {
				const response = await fetch(
					`http://127.0.0.1:${port}/inference/v1/${path}`,
				);
				return response.text();
			}),
		);
		expect(firstByte).toBe("late");
		expect(gap).toBe("early,late");
	}, 20_000);

	// #654: npm's global bin holds a bun.cmd shim that Node cannot spawn without
	// a shell, so the terminal finds Bun while the relay gets ENOENT.
	it("starts from Bun's install location when PATH holds only npm's shim", async () => {
		const realBun = spawnSync("bun", ["-e", "console.log(process.execPath)"], {
			encoding: "utf8",
		}).stdout.trim();
		const home = mkdtempSync(join(fixtures, "install-"));
		const npmBin = join(home, "npm");
		const isWindows = process.platform === "win32";
		const bunBin = isWindows
			? join(npmBin, "node_modules", "bun", "bin")
			: join(home, "bun-install", "bin");
		mkdirSync(bunBin, { recursive: true });
		mkdirSync(npmBin, { recursive: true });
		if (isWindows) copyFileSync(realBun, join(bunBin, "bun.exe"));
		else symlinkSync(realBun, join(bunBin, "bun"));
		writeFileSync(join(npmBin, "bun.cmd"), "@echo off\r\n");
		vi.stubEnv("PATH", npmBin);
		vi.stubEnv("APPDATA", home);
		vi.stubEnv(
			"BUN_INSTALL",
			isWindows ? undefined : join(home, "bun-install"),
		);
		resetOpenCodeRelayForTest();
		await expect(getOpenCodeRelay().ready(8000)).resolves.toBeGreaterThan(0);
	}, 20_000);

	// Pi's standalone builds are Bun-compiled, so they carry the relay's runtime.
	// Without BUN_BE_BUN the binary would run its own entry and never bind.
	it("runs the relay from a Bun-compiled host binary", async () => {
		const dir = mkdtempSync(join(fixtures, "compiled-"));
		const entry = join(dir, "entry.ts");
		writeFileSync(entry, `console.log("compiled-app-entry");`);
		const built = spawnSync(
			"bun",
			["build", "--compile", entry, "--outfile", join(dir, "app")],
			{ encoding: "utf8" },
		);
		expect(built.status, built.stderr).toBe(0);
		resetOpenCodeRelayForTest();
		const hosted = getOpenCodeRelay({
			bunCommand: join(dir, process.platform === "win32" ? "app.exe" : "app"),
		});
		await expect(hosted.ready(8000)).resolves.toBeGreaterThan(0);
	}, 20_000);

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
