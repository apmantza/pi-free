/**
 * An offline store restore must never downgrade a catalog a network
 * generation already published in this session.
 *
 * Recurrence this prevents (live, CommandCode 2026-10-16): session-start
 * refresh fetched 92 models under the global free view, so #519 persisted
 * only the 1 free model to Pi's store; `/toggle-commandcode` then re-registered
 * the provider, Pi answered every registerProvider with a global
 * `allowNetwork:false` refresh (model-runtime.registerNativeProvider), the
 * restore applied the 1-model disk snapshot and `stored.all` collapsed from 92
 * to 1 — the toast said "showing all 92 models" while the picker offered the
 * free model alone, until the next network refresh.
 *
 * Any provider whose free view is much smaller than its catalog (kilo 16/398,
 * cline 22/470, requesty 12/769) shows the same collapse on either
 * /toggle-<provider> or /toggle-free.
 */
import type {
	ModelsStoreEntry,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveModelView = vi.hoisted(() =>
	vi.fn((_providerId: string): "free" | "all" => "free"),
);

vi.mock("../config.ts", () => ({
	saveConfig: vi.fn(async () => undefined),
	isOhMyPiCompat: () => false,
	applyHidden: (models: unknown[]) => models,
	// #603: the toggle flips the effective view inside config.
	toggleModelViewOverride: async (providerId: string) =>
		mockResolveModelView(providerId) === "free" ? "all" : "free",
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
}));

import {
	createNativeOpenAIProvider,
	registerNativeProviderToggle,
} from "../lib/native-provider.ts";
import type { StoredModels } from "../provider-helper.ts";

const PROVIDER = "restore-clobber";

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

const freeModel = model("free-1", "Free one");
const fullCatalog = [
	freeModel,
	...Array.from({ length: 91 }, (_, i) => model(`paid-${i}`, `Paid ${i}`)),
];

function diskShape(m: ProviderModelConfig) {
	return {
		...m,
		provider: PROVIDER,
		api: "openai-completions" as const,
		baseUrl: "https://example.test/v1",
	};
}

/** Pi's store, as the runtime hands it to refreshModels: snapshot in, persist out. */
function makePiStore() {
	let models: unknown[] = [];
	const publish = vi.fn(
		async (publication: {
			persist?: { models: readonly unknown[]; checkedAt: number };
			update?: () => void;
		}) => {
			if (publication.persist) models = [...publication.persist.models];
			publication.update?.();
			return true;
		},
	);
	return {
		publish,
		snapshot: (): ModelsStoreEntry =>
			({ models, checkedAt: Date.now() }) as unknown as ModelsStoreEntry,
		diskIds: () => models.map((m) => (m as ProviderModelConfig).id),
	};
}

function makeProvider() {
	return createNativeOpenAIProvider({
		providerId: PROVIDER,
		name: "Restore Clobber",
		baseUrl: "https://example.test/v1",
		auth: { apiKey: { name: "k", resolve: async () => undefined } },
		getApiKey: () => "ambient-key",
		getShowPaid: () => false,
		fetchModels: async () => fullCatalog,
	});
}

const signal = new AbortController().signal;

beforeEach(() => {
	vi.clearAllMocks();
	mockResolveModelView.mockReturnValue("free");
});

describe("offline restore vs a complete in-session catalog", () => {
	it("keeps the catalog when the toggle's re-register triggers an offline refresh", async () => {
		const handle = makeProvider();
		const piStore = makePiStore();

		// 1) Network generation under the free view: memory takes 92, disk 1.
		await handle.provider.refreshModels?.({
			allowNetwork: true,
			credential: { type: "api_key", key: "k" },
			stored: { models: [], checkedAt: Date.now() },
			publish: piStore.publish,
			signal,
		} as unknown as RefreshModelsContext);
		expect(handle.stored.all).toHaveLength(92);
		expect(handle.stored.complete).toBe(true);
		expect(piStore.diskIds()).toEqual(["free-1"]);

		// 2) /toggle-<provider> flips to all and re-registers; Pi's offline
		//    refresh hands back the 1-model snapshot the same view persisted.
		mockResolveModelView.mockReturnValue("all");
		await handle.provider.refreshModels?.({
			allowNetwork: false,
			credential: { type: "api_key", key: "k" },
			stored: piStore.snapshot(),
			publish: piStore.publish,
			signal,
		} as unknown as RefreshModelsContext);

		// The "all" view the user just selected must still offer the catalog
		// fetched in this session, not the free subset on disk.
		expect(handle.provider.getModels()).toHaveLength(92);
		expect(handle.stored.complete).toBe(true);
	});

	it("still restores the disk snapshot when no network generation published", async () => {
		// Guard against a blanket "never restore": a fresh session (complete
		// undefined) must take the store catalog, and an offline restore is
		// what makes the picker non-empty before the first network refresh.
		const handle = makeProvider();
		const piStore = makePiStore();
		await piStore.publish({
			persist: { models: [diskShape(freeModel)], checkedAt: Date.now() },
		});

		await handle.provider.refreshModels?.({
			allowNetwork: false,
			credential: { type: "api_key", key: "k" },
			stored: piStore.snapshot(),
			publish: piStore.publish,
			signal,
		} as unknown as RefreshModelsContext);

		expect(handle.provider.getModels().map((m) => m.id)).toEqual(["free-1"]);
		expect(handle.stored.complete).toBe(false);
	});

	it("reports the preserved catalog honestly to the toggle notify", async () => {
		// The toggle's message is the only place the user learns whether the
		// flip exposed the catalog; it reads the same stored record.
		const handle = makeProvider();
		const piStore = makePiStore();
		await handle.provider.refreshModels?.({
			allowNetwork: true,
			credential: { type: "api_key", key: "k" },
			stored: { models: [], checkedAt: Date.now() },
			publish: piStore.publish,
			signal,
		} as unknown as RefreshModelsContext);

		const notify = vi.fn();
		const pi = { registerCommand: vi.fn() };
		registerNativeProviderToggle(pi as never, {
			providerId: PROVIDER,
			stored: handle.stored,
			setShowPaid: handle.setShowPaid,
			reRegister: () => {},
		});
		const handler = pi.registerCommand.mock.calls[0]![1].handler as (
			args: unknown,
			ctx: unknown,
		) => Promise<void>;

		await handler({}, { ui: { notify } });

		expect(notify.mock.calls[0]![0]).toMatch(/showing all 92 models/);
	});

	it("pins the shared helper directly: restore is skipped only when complete", async () => {
		const { refreshNativeProviderModels } =
			await import("../lib/native-provider.ts");
		const stored = {
			free: [],
			all: [diskShape(freeModel)],
			complete: true,
		} as unknown as StoredModels;
		const onRestore = vi.fn();

		await refreshNativeProviderModels(
			PROVIDER,
			{
				allowNetwork: false,
				stored: {
					models: [diskShape(freeModel)],
					checkedAt: Date.now(),
				},
				signal,
			} as unknown as RefreshModelsContext,
			onRestore,
			async () => [],
			vi.fn(),
			stored,
		);

		expect(onRestore).not.toHaveBeenCalled();
		expect(stored.complete).toBe(true);
	});
});
