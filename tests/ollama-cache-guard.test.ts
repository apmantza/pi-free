/**
 * #607: live cache writers must go through the poisoning guard.
 *
 * `saveProviderCacheGuarded` (shrink + never-empty rules, pinned by
 * tla/CacheGuard.tla) had zero production callers while three live
 * writers overwrote the cache unconditionally: the native refresh, the
 * `/ollama-cloud-refresh` command, and the legacy post-probe refresh.
 * Each test below seeds a healthy 60-model cache, drives the real path
 * with a stubbed 3-model fetch (transient shrink), and pins retention.
 * Temp HOME + dynamic imports isolate the real disk cache per test.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchWithRetry = vi.hoisted(() => vi.fn());
const mockFetchWithTimeout = vi.hoisted(() => vi.fn());

vi.mock("../lib/util.ts", async (importOriginal) => {
	const original = await importOriginal<typeof import("../lib/util.ts")>();
	return {
		...original,
		fetchWithRetry: (...args: unknown[]) => mockFetchWithRetry(...args),
		fetchWithTimeout: (...args: unknown[]) => mockFetchWithTimeout(...args),
		withSignal: (init: RequestInit, signal?: AbortSignal) => {
			if (signal) init.signal = signal;
			return init;
		},
	};
});

function seedModel(id: string) {
	return {
		id,
		name: id,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32_000,
		maxTokens: 16_384,
	};
}

function sixtyModels(): Array<ReturnType<typeof seedModel>> {
	return Array.from({ length: 60 }, (_, i) => seedModel(`model-${i}`));
}

function threeModels(): Array<ReturnType<typeof seedModel>> {
	return [seedModel("new-1"), seedModel("new-2"), seedModel("new-3")];
}

let tempDir = "";

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "pi-free-cache-guard-"));
	vi.stubEnv("HOME", tempDir);
	vi.stubEnv("USERPROFILE", tempDir);
	vi.stubEnv("OLLAMA_API_KEY", "test-key");
	vi.resetModules();
	mockFetchWithRetry.mockReset();
	mockFetchWithTimeout.mockReset();
});

afterEach(() => {
	vi.unstubAllEnvs();
});

async function loadCacheHarness() {
	const cache = await import("../lib/provider-cache.ts");
	const { PROVIDER_OLLAMA } = await import("../constants.ts");
	return { ...cache, PROVIDER_OLLAMA };
}

function piMock() {
	return {
		registerProvider: vi.fn(),
		registerCommand: vi.fn(),
		on: vi.fn(),
	};
}

function refreshContext(): {
	allowNetwork: boolean;
	signal: AbortSignal;
	publish: (p: { update?: () => void }) => Promise<boolean>;
} {
	return {
		allowNetwork: true,
		signal: new AbortController().signal,
		publish: async ({ update }) => {
			update?.();
			return true;
		},
	};
}

describe("ollama cache poisoning guard (#607)", () => {
	it("post-probe refresh retains cache and live list on a shrink", async () => {
		const { saveProviderCache, loadProviderCache, PROVIDER_OLLAMA } =
			await loadCacheHarness();
		const seeded = sixtyModels();
		// One model probes broken so the re-fetch path runs.
		seeded[0] = seedModel("bad-model");
		await saveProviderCache(PROVIDER_OLLAMA, seeded);

		mockFetchWithTimeout.mockImplementation(
			async (url: string, init?: { body?: string }) => {
				if (String(url).endsWith("/chat/completions")) {
					const model = JSON.parse(String(init?.body ?? "{}")).model;
					return { status: model === "bad-model" ? 403 : 200 };
				}
				// /api/show per-model details (identical shape for every id).
				return {
					ok: true,
					status: 200,
					json: async () => ({
						details: {
							parent_model: "",
							format: "gguf",
							family: "test",
							families: ["test"],
							parameter_size: "7B",
							quantization_level: "Q4_0",
						},
						model_info: {},
						capabilities: ["tools"],
						modified_at: new Date().toISOString(),
					}),
				};
			},
		);
		mockFetchWithRetry.mockImplementation(async () => ({
			ok: true,
			status: 200,
			statusText: "OK",
			json: async () => ({
				data: [{ id: "new-1" }, { id: "new-2" }, { id: "new-3" }],
			}),
		}));

		const { runOllamaProbe } = await import("../providers/ollama/ollama.ts");
		const applyModels = vi.fn();
		const notFound = await runOllamaProbe("test-key", seeded, applyModels, {
			useCache: false,
		});

		expect(notFound).toContain("bad-model");
		// Pre-fix the 3-model re-fetch poisoned the cache and replaced
		// the live list.
		expect(loadProviderCache(PROVIDER_OLLAMA)?.length).toBe(60);
		expect(applyModels).not.toHaveBeenCalled();
	});

	it("native refresh retains the cache on a transient shrink", async () => {
		const { saveProviderCache, loadProviderCache, PROVIDER_OLLAMA } =
			await loadCacheHarness();
		await saveProviderCache(PROVIDER_OLLAMA, sixtyModels());

		const { registerOllamaProvider } =
			await import("../providers/ollama/ollama-provider.ts");
		const pi = piMock();
		registerOllamaProvider(pi as never, {
			fallbackModels: [],
			fetchModels: async () => threeModels(),
			probeModels: async () => [],
		});
		const provider = pi.registerProvider.mock.calls[0]![0] as {
			refreshModels: (context: unknown) => Promise<void>;
		};
		await provider.refreshModels(refreshContext());

		// Pre-fix the unguarded save poisoned the cache to the 3-model fetch.
		expect(loadProviderCache(PROVIDER_OLLAMA)?.length).toBe(60);
	});

	it("/ollama-cloud-refresh retains cache and live list on a shrink", async () => {
		const { saveProviderCache, loadProviderCache, PROVIDER_OLLAMA } =
			await loadCacheHarness();
		await saveProviderCache(PROVIDER_OLLAMA, sixtyModels());

		const { registerOllamaProvider } =
			await import("../providers/ollama/ollama-provider.ts");
		const pi = piMock();
		registerOllamaProvider(pi as never, {
			fallbackModels: [],
			fetchModels: async () => threeModels(),
			probeModels: async () => [],
		});
		const registrationsBefore = pi.registerProvider.mock.calls.length;
		const command = pi.registerCommand.mock.calls.find(
			(call: unknown[]) => call[0] === "ollama-cloud-refresh",
		)![1] as {
			handler: (args: string, ctx: unknown) => Promise<void>;
		};
		const notify = vi.fn();
		await command.handler("", { ui: { notify } });

		// Pre-fix the cache was poisoned AND the live list re-registered small.
		expect(loadProviderCache(PROVIDER_OLLAMA)?.length).toBe(60);
		expect(pi.registerProvider.mock.calls.length).toBe(registrationsBefore);
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining("keeping the cached"),
			expect.anything(),
		);
	});
});

/**
 * #690: the shrink rule judged every shrink against whatever entry was on
 * disk, and a refused write keeps that entry's timestamp, so a real catalog
 * shrink was refused forever. Live 2026-11-15: Ollama Cloud lists 24 models
 * while a 60-model entry from 2026-10-15 stayed the startup seed and logged
 * "Not caching ollama-cloud: 23 models vs 60 cached (likely transient
 * shrink)" on every refresh. Only an entry within the cache TTL is a healthy
 * baseline.
 */
describe("ollama cache shrink against a stale entry (#690)", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	async function seedStaleSixty() {
		const harness = await loadCacheHarness();
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-15T09:00:00Z"));
		await harness.saveProviderCache(harness.PROVIDER_OLLAMA, sixtyModels());
		vi.setSystemTime(new Date("2026-11-15T09:00:00Z"));
		return harness;
	}

	it("native refresh replaces a stale entry with the smaller live list", async () => {
		const { loadProviderCache, PROVIDER_OLLAMA } = await seedStaleSixty();
		const { registerOllamaProvider } =
			await import("../providers/ollama/ollama-provider.ts");
		const pi = piMock();
		registerOllamaProvider(pi as never, {
			fallbackModels: [],
			fetchModels: async () => threeModels(),
			probeModels: async () => [],
		});
		const provider = pi.registerProvider.mock.calls[0]![0] as {
			refreshModels: (context: unknown) => Promise<void>;
		};
		await provider.refreshModels(refreshContext());

		expect(loadProviderCache(PROVIDER_OLLAMA)?.map((m) => m.id)).toEqual([
			"new-1",
			"new-2",
			"new-3",
		]);
	});

	it("/ollama-cloud-refresh applies the smaller live list over a stale entry", async () => {
		const { loadProviderCache, PROVIDER_OLLAMA } = await seedStaleSixty();
		const { registerOllamaProvider } =
			await import("../providers/ollama/ollama-provider.ts");
		const pi = piMock();
		registerOllamaProvider(pi as never, {
			fallbackModels: [],
			fetchModels: async () => threeModels(),
			probeModels: async () => [],
		});
		const registrationsBefore = pi.registerProvider.mock.calls.length;
		const command = pi.registerCommand.mock.calls.find(
			(call: unknown[]) => call[0] === "ollama-cloud-refresh",
		)![1] as {
			handler: (args: string, ctx: unknown) => Promise<void>;
		};
		const notify = vi.fn();
		await command.handler("", { ui: { notify } });

		expect(loadProviderCache(PROVIDER_OLLAMA)).toHaveLength(3);
		expect(pi.registerProvider.mock.calls.length).toBe(registrationsBefore + 1);
		expect(notify).toHaveBeenCalledWith(
			"Registered 3 Ollama Cloud models (refresh complete)",
			"info",
		);
	});
});
