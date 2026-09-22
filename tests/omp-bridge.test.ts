/**
 * Legacy-host provider bridge (#543, #557).
 *
 * Recurrence this prevents: the bridge discriminator sniffed
 * `pi.registerProvider.length`, but stock Pi's extension-facing
 * `registerProvider(providerOrName, config)` overload ALSO has `.length 2`
 * (it dispatches on `typeof providerOrName`), so the arity check routed the
 * standard host down the legacy `(id, config)` path — regressing every
 * supported host while trying to fix Oh My Pi. Mocks (`vi.fn()`, length 0)
 * masked it, and the bridge shipped with 0% coverage.
 *
 * The rule is now explicit: a host exposing `registerNativeProvider` speaks
 * native objects; otherwise the legacy bridge is opt-in only
 * (`oh_my_pi_compat` / `OH_MY_PI_COMPAT`). Stock Pi keeps the native
 * single-arg call byte-for-byte.
 */
import type { Provider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIsOhMyPiCompat = vi.hoisted(() => vi.fn(() => false));

vi.mock("../config.ts", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		isOhMyPiCompat: () => mockIsOhMyPiCompat(),
	};
});

vi.mock("../lib/logger.ts", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

import {
	registerNativeProvider,
	shouldUseLegacyProviderBridge,
} from "../lib/native-provider.ts";

function makeProvider(): Provider {
	return {
		id: "probe-provider",
		name: "Probe",
		baseUrl: "https://example.invalid/v1",
		auth: {},
		getModels: () => [
			{ id: "probe-a", name: "Probe A" },
			{ id: "probe-b", name: "Probe B" },
		],
		filterModels: (models: unknown[]) => models,
		refreshModels: async () => {},
		stream: (() => {}) as never,
		streamSimple: (() => {}) as never,
	} as unknown as Provider;
}

/** Stock-Pi-shaped host: dual (providerOrName, config) overload, length 2. */
function makeStockPi() {
	const registerProvider = vi.fn(
		(_providerOrName: unknown, _config?: unknown) => {},
	);
	return {
		pi: { registerProvider } as unknown as ExtensionAPI,
		registerProvider,
	};
}

/** Legacy-only host: two-arg registration, no native capability. */
function makeLegacyPi() {
	const registerProvider = vi.fn((_id: string, _config: unknown) => {});
	return {
		pi: { registerProvider } as unknown as ExtensionAPI,
		registerProvider,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockIsOhMyPiCompat.mockReturnValue(false);
});

describe("shouldUseLegacyProviderBridge (#557)", () => {
	it("is false on a stock-shaped host even though registerProvider.length is 2", () => {
		const { pi, registerProvider } = makeStockPi();
		// The production path this guards: the dual overload has length 2.
		expect(registerProvider.length).toBe(2);
		expect(shouldUseLegacyProviderBridge(pi)).toBe(false);
	});

	it("is false on a legacy host unless the compat flag opts in", () => {
		const { pi } = makeLegacyPi();
		expect(shouldUseLegacyProviderBridge(pi)).toBe(false);
	});

	it("is true on a legacy host once the compat flag opts in", () => {
		mockIsOhMyPiCompat.mockReturnValue(true);
		const { pi } = makeLegacyPi();
		expect(shouldUseLegacyProviderBridge(pi)).toBe(true);
	});

	it("is false when the host exposes registerNativeProvider, flag or not", () => {
		mockIsOhMyPiCompat.mockReturnValue(true);
		const pi = {
			registerProvider: vi.fn(),
			registerNativeProvider: vi.fn(),
		} as unknown as ExtensionAPI;
		expect(shouldUseLegacyProviderBridge(pi)).toBe(false);
	});
});

describe("registerNativeProvider (#557)", () => {
	it("passes the Provider object through untouched on stock Pi (flag off)", () => {
		const { pi, registerProvider } = makeStockPi();
		const provider = makeProvider();

		registerNativeProvider(pi, provider);

		expect(registerProvider).toHaveBeenCalledTimes(1);
		expect(registerProvider).toHaveBeenCalledWith(provider);
	});

	it("passes the Provider object through on a legacy host with the flag off (status quo: native default)", () => {
		const { pi, registerProvider } = makeLegacyPi();
		const provider = makeProvider();

		registerNativeProvider(pi, provider);

		expect(registerProvider).toHaveBeenCalledTimes(1);
		expect(registerProvider).toHaveBeenCalledWith(provider);
	});

	it("bridges to (id, config) on a legacy host with the flag on", () => {
		mockIsOhMyPiCompat.mockReturnValue(true);
		const { pi, registerProvider } = makeLegacyPi();

		registerNativeProvider(pi, makeProvider());

		expect(registerProvider).toHaveBeenCalledTimes(1);
		const [id, config] = registerProvider.mock.calls[0] as [
			string,
			Record<string, unknown>,
		];
		expect(id).toBe("probe-provider");
		expect(config.api).toBe("openai-completions");
		expect(config.baseUrl).toBe("https://example.invalid/v1");
		expect(config.models).toHaveLength(2);
		// No auth anywhere: inert sentinel satisfies the host's registration
		// gate without putting a real credential anywhere.
		expect(config.apiKey).toBe("placeholder");
		expect(config.oauth).toBeUndefined();
	});

	it("fetchDynamicModels delegates to refreshModels and retains on failure", async () => {
		mockIsOhMyPiCompat.mockReturnValue(true);
		const { pi, registerProvider } = makeLegacyPi();
		const provider = makeProvider();
		const refreshModels = vi.fn(async () => {});
		provider.refreshModels = refreshModels as never;

		registerNativeProvider(pi, provider);

		const [, config] = registerProvider.mock.calls[0] as [
			string,
			{ fetchDynamicModels: () => Promise<unknown[]> },
		];
		await expect(config.fetchDynamicModels()).resolves.toHaveLength(2);
		expect(refreshModels).toHaveBeenCalledTimes(1);

		refreshModels.mockRejectedValueOnce(new Error("network down"));
		await expect(config.fetchDynamicModels()).resolves.toHaveLength(2);
	});
});
