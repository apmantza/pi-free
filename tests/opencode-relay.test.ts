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
} from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
		const dir = mkdtempSync(join(tmpdir(), "oc-relay-stub-"));
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
		const port = await relay.ready(4000);
		expect(port).toBe(19853);
		relay.stop();
		await expect(relay.ready(100)).rejects.toThrow(/not running|stopped/);
	});

	it("reports unavailability when the bun command cannot spawn", async () => {
		const dir = mkdtempSync(join(tmpdir(), "oc-relay-stub-"));
		const stub = join(dir, "exiting.mjs");
		writeFileSync(stub, `process.exit(7);`);
		const relay = getOpenCodeRelay({
			bunCommand: process.execPath,
			childArgs: [stub, "-e", "unused"],
		});
		await expect(relay.ready(4000)).rejects.toThrow();
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
				if (req.url?.endsWith("/streaming")) {
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
		await new Promise<void>((resolve) => upstream.close(() => resolve()));
	});

	let relay: OpenCodeRelay | undefined;

	beforeAll(async () => {
		relay = getOpenCodeRelay({ bunCommand: "bun" });
	}, 5000);

	afterAll(() => {
		relay?.stop();
	});

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
