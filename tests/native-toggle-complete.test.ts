/**
 * Toggle completeness honesty (Toggle.tla NoSubsetAsAll).
 *
 * A restored free-view subset lands in stored.all; flipping to "all"
 * before any network fetch then presents the subset as the whole catalog
 * ("0 paid hidden" — nothing is hidden, the paid catalog was never
 * fetched). The toggle must say so, and the refresh lifecycle must track
 * whether stored.all is a complete published catalog.
 *
 * Mocks stop at honest seams; the refresh store harness mirrors
 * tests/native-openai-provider.test.ts.
 */
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveModelView = vi.hoisted(() =>
	vi.fn((_providerId: string) => "free"),
);
const mockSetModelViewOverride = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../config.ts", () => ({
	applyHidden: (models: unknown[]) => models,
	isOhMyPiCompat: () => false,
	setModelViewOverride: mockSetModelViewOverride,
}));
vi.mock("../lib/registry.ts", () => ({
	getGlobalFreeOnly: () => true,
	resolveModelView: (...args: [string]) => mockResolveModelView(...args),
	isFreeModel: (m: { name: string }) => /free/i.test(m.name),
	registerWithGlobalToggle: vi.fn(),
}));
vi.mock("../provider-helper.ts", () => ({
	enhanceWithCI: (models: ProviderModelConfig[]) => models,
}));
vi.mock("../lib/logger.ts", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));
vi.mock("../lib/session-start-metrics.ts", () => ({
	wrapSessionStartHandler: (_id: string, handler: unknown) => handler,
	trackDetachedSessionStart: vi.fn(),
}));

import {
	createNativeOpenAIProvider,
	registerNativeProviderToggle,
} from "../lib/native-provider.ts";
import type { StoredModels } from "../provider-helper.ts";

function model(id: string, name: string): ProviderModelConfig {
	return {
		id,
		name,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32_000,
		maxTokens: 4_096,
	};
}

const providerOptions = {
	providerId: "tgl",
	name: "Toggle",
	baseUrl: "https://example.test/v1",
	auth: { apiKey: { name: "k", resolve: async () => undefined } },
	getApiKey: () => "ambient-key",
	getShowPaid: () => false,
	fetchModels: async (): Promise<ProviderModelConfig[]> => [],
};

function setupToggle(stored: StoredModels) {
	const notify = vi.fn();
	const pi = { registerCommand: vi.fn() };
	registerNativeProviderToggle(pi as never, {
		providerId: "tgl",
		stored,
		reRegister: vi.fn(),
	});
	const handler = pi.registerCommand.mock.calls[0]![1].handler as (
		args: unknown,
		ctx: unknown,
	) => Promise<void>;
	return { handler, ctx: { ui: { notify } }, notify };
}

beforeEach(() => {
	vi.clearAllMocks();
	mockResolveModelView.mockReturnValue("free");
});

describe("toggle-to-all over a restored subset", () => {
	it("warns honestly instead of reporting paid models hidden", async () => {
		// Recurrence this prevents: restart loads the persisted free-view
		// subset into stored.all; /toggle-x to "all" then displays it as
		// the whole catalog ("0 paid hidden" — Toggle.tla NoSubsetAsAll).
		const stored: StoredModels = {
			all: [model("f1", "F1 free"), model("f2", "F2 free")],
			free: [model("f1", "F1 free"), model("f2", "F2 free")],
			complete: false,
		};
		const { handler, ctx, notify } = setupToggle(stored);

		await handler({}, ctx);

		expect(notify).toHaveBeenCalledOnce();
		const text = notify.mock.calls[0]![0] as string;
		expect(text).toMatch(/not yet fetched/);
		expect(text).not.toMatch(/paid hidden/);
	});

	it("keeps exact counts once a full catalog published", async () => {
		// Guard: the honest branch must not fire on complete data. Passes
		// pre-fix too; pins the no-over-warning direction.
		const stored: StoredModels = {
			all: [
				model("f1", "F1 free"),
				model("f2", "F2 free"),
				model("p1", "P1"),
				model("p2", "P2"),
			],
			free: [model("f1", "F1 free"), model("f2", "F2 free")],
			complete: true,
		};
		const { handler, ctx, notify } = setupToggle(stored);

		await handler({}, ctx);

		expect(notify).toHaveBeenCalledOnce();
		expect(notify.mock.calls[0]![0]).toBe(
			"tgl: showing all 4 models (2 free, 2 paid)",
		);
	});
});

describe("toggle-to-free over a restored subset", () => {
	it("warns honestly instead of reporting paid models hidden", async () => {
		mockResolveModelView.mockReturnValue("all");
		const stored: StoredModels = {
			all: [model("f1", "F1 free"), model("f2", "F2 free")],
			free: [model("f1", "F1 free"), model("f2", "F2 free")],
			complete: false,
		};
		const { handler, ctx, notify } = setupToggle(stored);

		await handler({}, ctx);

		expect(notify).toHaveBeenCalledOnce();
		const text = notify.mock.calls[0]![0] as string;
		expect(text).toMatch(/not yet fetched/);
		expect(text).not.toMatch(/paid hidden/);
	});
});

describe("stored completeness tracking", () => {
	it("marks stored incomplete after a restore-only refresh", async () => {
		// Recurrence: every session start overwrites stored.all with the
		// persisted (possibly free-only) subset; until a network generation
		// publishes, stored.all is not the catalog.
		const { store } = (() => {
			let entry: unknown = {
				models: [
					{
						...model("f1", "F1 free"),
						provider: "tgl",
						api: "openai-completions",
						baseUrl: "https://example.test/v1",
					},
				],
				checkedAt: Date.now(),
			};
			return {
				store: {
					read: async () => entry,
					write: async (next: unknown) => {
						entry = next;
					},
					delete: async () => {
						entry = undefined;
					},
				},
			};
		})();
		const handle = createNativeOpenAIProvider(providerOptions as never);

		await handle.provider.refreshModels?.({
			store,
			allowNetwork: false,
		} as never);

		expect(handle.stored.all).toHaveLength(1);
		expect(handle.stored.complete).toBe(false);
	});

	it("marks stored complete after a network fetch publishes", async () => {
		const { store } = (() => {
			let entry: unknown;
			return {
				store: {
					read: async () => entry,
					write: async (next: unknown) => {
						entry = next;
					},
					delete: async () => {
						entry = undefined;
					},
				},
			};
		})();
		const handle = createNativeOpenAIProvider({
			...providerOptions,
			allowUnauthenticated: true,
			getApiKey: () => undefined,
			fetchModels: async () => [model("f1", "F1 free"), model("p1", "P1")],
		} as never);

		await handle.provider.refreshModels?.({
			store,
			allowNetwork: true,
		} as never);

		expect(handle.stored.all).toHaveLength(2);
		expect(handle.stored.complete).toBe(true);
	});
});
