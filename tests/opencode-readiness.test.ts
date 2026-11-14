/**
 * Selecting a free OpenCode model reports a known problem before the first 429:
 * a relay that cannot start, or a route that never uses the relay.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	getOpenCodeRelay,
	getOpenCodeRelayFailure,
	resetOpenCodeRelayForTest,
} from "../lib/opencode-relay.ts";
import { setupOpenCodeReadiness } from "../lib/opencode-readiness.ts";
import { prewarmOpenCodeRelay } from "../providers/opencode-session.ts";

const hasBun = spawnSync("bun", ["--version"]).status === 0;
mkdirSync(".smoke-artifacts", { recursive: true });
const fixtures = mkdtempSync(resolve(".smoke-artifacts", "oc-readiness-"));
afterAll(() => rmSync(fixtures, { recursive: true, force: true }));

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const paid = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 };
const model = (provider: string, id: string, cost = zero) =>
	({ provider, id, name: id, cost }) as ExtensionContext["model"];

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

function setup() {
	const handlers = new Map<string, Handler>();
	setupOpenCodeReadiness({
		on: (name: string, handler: Handler) => handlers.set(name, handler),
	} as unknown as ExtensionAPI);
	const notify = vi.fn();
	const ctxFor = (selected: ExtensionContext["model"]) =>
		({
			model: selected,
			ui: { notify, setStatus: vi.fn() },
		}) as unknown as ExtensionContext;
	return {
		notify,
		sessionStart: (selected: ExtensionContext["model"]) =>
			handlers.get("session_start")!({}, ctxFor(selected)),
		select: (selected: ExtensionContext["model"]) =>
			handlers.get("model_select")!({ model: selected }, ctxFor(undefined)),
		shutdown: (reason: string) =>
			handlers.get("session_shutdown")!({ reason }, ctxFor(undefined)),
	};
}

const settled = () => new Promise((done) => setImmediate(done));

beforeEach(() => {
	resetOpenCodeRelayForTest();
	vi.stubEnv("PI_FREE_OPENCODE_BUN", join(fixtures, "definitely-missing-bun"));
});

afterEach(() => {
	resetOpenCodeRelayForTest();
	vi.unstubAllEnvs();
});

it("warns once when the selected opencode-free model cannot use the relay", async () => {
	const { notify, sessionStart, select } = setup();
	await sessionStart(model("opencode-free", "glm-5.3-flash-free"));
	await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
	const [message, type] = notify.mock.calls[0]!;
	expect(type).toBe("warning");
	expect(message).toContain("ENOENT");
	expect(message).toContain("PI_FREE_OPENCODE_BUN");

	select(model("opencode-free", "big-pickle"));
	await settled();
	expect(notify).toHaveBeenCalledOnce();
});

it("checks the relay when the user switches to opencode-free mid-session", async () => {
	const { notify, sessionStart, select } = setup();
	await sessionStart(model("kilo", "some-model"));
	await settled();
	expect(notify).not.toHaveBeenCalled();
	expect(getOpenCodeRelayFailure()).toBeUndefined();

	select(model("opencode-free", "glm-5.3-flash-free"));
	await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
});

it("stays quiet when the user turned the relay off", async () => {
	vi.stubEnv("PI_FREE_OPENCODE_RELAY", "0");
	const { notify, select } = setup();
	select(model("opencode-free", "glm-5.3-flash-free"));
	await settled();
	expect(notify).not.toHaveBeenCalled();
	expect(getOpenCodeRelayFailure()).toBeUndefined();
});

it("warns once about a free model on the built-in opencode provider", async () => {
	const { notify, sessionStart, select } = setup();
	await sessionStart(model("opencode", "glm-5.3-flash-free"));
	await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
	expect(notify.mock.calls[0]![0]).toContain("opencode-free");
	// This route never uses the relay, so selecting it must not start one.
	expect(getOpenCodeRelayFailure()).toBeUndefined();

	select(model("opencode", "big-pickle"));
	await settled();
	expect(notify).toHaveBeenCalledOnce();
});

it("does not warn about a paid built-in model or the keyed Go provider", async () => {
	const { notify, select } = setup();
	select(model("opencode", "claude-opus-5-5", paid));
	select(model("opencode-go", "glm-5.3-flash"));
	await settled();
	expect(notify).not.toHaveBeenCalled();
	expect(getOpenCodeRelayFailure()).toBeUndefined();
});

it.skipIf(!hasBun)(
	"leaves a running relay ready before the first turn",
	async () => {
		vi.stubEnv("PI_FREE_OPENCODE_BUN", undefined);
		await expect(prewarmOpenCodeRelay()).resolves.toBeUndefined();
		// Read synchronously: a relay created here could not have a port yet.
		expect(getOpenCodeRelay().port()).toBeGreaterThan(0);
	},
);

// Each Pi /reload loads pi-free afresh (jiti moduleCache:false) and starts a new
// relay, so the outgoing instance must stop its own Bun child at shutdown
// instead of leaving it for the 5-minute idle timeout (2026-11-14 probe).
it.skipIf(!hasBun)(
	"stops the session's Bun child at session_shutdown",
	async () => {
		vi.stubEnv("PI_FREE_OPENCODE_BUN", undefined);
		const answers = (port: number) =>
			fetch(`http://127.0.0.1:${port}/nope`, {
				signal: AbortSignal.timeout(500),
			}).then(
				() => true,
				() => false,
			);
		const { notify, sessionStart, shutdown } = setup();
		await sessionStart(model("opencode-free", "glm-5.3-flash-free"));
		const port = await getOpenCodeRelay().ready(8000);
		expect(await answers(port)).toBe(true);
		await shutdown("reload");
		await vi.waitFor(async () => expect(await answers(port)).toBe(false));
		expect(notify).not.toHaveBeenCalled();
	},
	20_000,
);
