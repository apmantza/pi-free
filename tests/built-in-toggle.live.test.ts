/**
 * LIVE integration test for built-in provider endpoint refreshes.
 *
 * Skipped unless PI_FREE_LIVE_TESTS=1 — hits the real OpenCode Zen
 * endpoint with real network I/O (no fetch mocks), so it is
 * nondeterministic by nature and belongs outside the default CI suite:
 *
 *   PI_FREE_LIVE_TESTS=1 npx vitest run tests/built-in-toggle.live.test.ts
 *
 * Only Pi's ExtensionAPI surface is simulated; catalog fetching, mapping,
 * merging, free/paid classification, and toggle wiring are the production
 * code paths.
 */
import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import type { ProviderModelConfig } from "../lib/types.ts";
import { setupBuiltInProviderToggles } from "../lib/built-in-toggle.ts";

const LIVE = process.env.PI_FREE_LIVE_TESTS === "1";

function waitForRefresh(
	registerProvider: ReturnType<typeof vi.fn>,
	baselineCount: number,
	timeoutMs = 20_000,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const poll = () => {
			const last = registerProvider.mock.calls.at(-1)?.[1] as
				| { models?: unknown[] }
				| undefined;
			if ((last?.models?.length ?? 0) > baselineCount) return resolve();
			if (Date.now() - started > timeoutMs) {
				return reject(
					new Error(
						`endpoint refresh did not grow the catalog within ${timeoutMs}ms`,
					),
				);
			}
			setTimeout(poll, 100);
		};
		poll();
	});
}

describe.skipIf(!LIVE)("built-in toggle live endpoint refresh", () => {
	it("refreshes opencode-free from the live Zen endpoint", async () => {
		const registerProvider = vi.fn();
		const pi = {
			registerProvider,
			registerCommand: vi.fn(),
			on: vi.fn(),
			setModel: vi.fn(),
		} as unknown as ExtensionAPI;

		setupBuiltInProviderToggles(pi);
		const handler = (
			pi.on as unknown as ReturnType<typeof vi.fn>
		).mock.calls.find((c) => c[0] === "session_start")?.[1] as (
			e: unknown,
			ctx: unknown,
		) => Promise<void>;

		const baseline = [
			{
				provider: "opencode",
				id: "seed-model",
				name: "Seed Model",
				api: "openai-completions",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
				baseUrl: "https://opencode.ai/zen/v1",
			},
		] as unknown as Model<Api>[];

		await handler({}, { modelRegistry: { getAvailable: () => baseline } });
		await waitForRefresh(registerProvider, 1);

		const lastModels = registerProvider.mock.calls.at(-1)?.[1]
			.models as ProviderModelConfig[];
		expect(lastModels.length).toBeGreaterThan(0);
		console.log(
			`[live] opencode-free: ${lastModels.length} models, e.g. ${lastModels
				.slice(0, 5)
				.map((m) => m.id)
				.join(", ")}`,
		);
	}, 30_000);
});
