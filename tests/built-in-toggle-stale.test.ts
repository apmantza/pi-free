/**
 * Stale-context tests for lib/built-in-toggle.ts (issue #509).
 *
 * Pi invalidates ctx/pi on session replacement or reload; async capture work
 * that was already in flight then throws Pi's stale guard. The detached
 * capture must drop that work quietly (resolve) instead of rejecting, which
 * session-start-metrics would report as
 * `built-in-toggle-capture-opencode-free detached failed`. Likewise the
 * toggle command must not surface an Extension error for a dead session.
 *
 * session-start-metrics is mocked with a spy around the real contract so the
 * test can observe each detached task's outcome directly.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STALE_MESSAGE =
	"This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload().";

interface DetachedOutcome {
	label: string;
	ok: boolean;
	error?: unknown;
}
const detachedOutcomes: DetachedOutcome[] = [];

const mockGetGlobalFreeOnly = vi.fn();
const mockGetModelViewOverride = vi.fn();
const mockSetModelViewOverride = vi.fn();
const mockGetOpencodeFreeShowPaid = vi.fn();
const mockGetOpencodeGoShowPaid = vi.fn();
const mockGetOpenrouterShowPaid = vi.fn();
const mockGetOpencodeApiKey = vi.fn();

/** Per-provider stored pref backing the resolveModelView mock below. */
function mockShowPaidFor(providerId: string): boolean {
	if (providerId === "opencode-free") return mockGetOpencodeFreeShowPaid();
	if (providerId === "opencode-go") return mockGetOpencodeGoShowPaid();
	if (providerId === "openrouter") return mockGetOpenrouterShowPaid();
	return false;
}
const mockSaveConfig = vi.fn();
const mockRegisterWithGlobalToggle = vi.fn();
const mockProviderRegistry = new Map<string, unknown>();

/** Let detached session-start tasks settle (same window as the main suite). */
async function settleDetachedCapture(): Promise<void> {
	for (let i = 0; i < 10; i += 1) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

vi.mock("../lib/session-start-metrics.ts", () => ({
	wrapSessionStartHandler: (
		_label: string,
		handler: (...args: never[]) => unknown,
	) => handler,
	trackDetachedSessionStart: (
		label: string,
		work: PromiseLike<unknown>,
		onError?: (error: unknown) => void,
	) => {
		void Promise.resolve(work).then(
			() => {
				detachedOutcomes.push({ label, ok: true });
			},
			(error: unknown) => {
				detachedOutcomes.push({ label, ok: false, error });
				try {
					onError?.(error);
				} catch {
					// Observability callbacks must not create an unhandled rejection.
				}
			},
		);
	},
}));

vi.mock("../config.ts", () => ({
	getOpencodeApiKey: () => mockGetOpencodeApiKey(),
	getOpencodeFreeShowPaid: () => mockGetOpencodeFreeShowPaid(),
	getOpencodeGoShowPaid: () => mockGetOpencodeGoShowPaid(),
	getOpenrouterShowPaid: () => mockGetOpenrouterShowPaid(),
	setModelViewOverride: (...args: unknown[]) =>
		mockSetModelViewOverride(...args),
	saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
}));

vi.mock("../lib/registry.ts", () => ({
	getGlobalFreeOnly: () => mockGetGlobalFreeOnly(),
	// Mirrors the real resolveModelView over the mocked config getters (the
	// real rule is unit-tested in registry-provider-overrides.test.ts).
	resolveModelView: (providerId: string) =>
		mockGetModelViewOverride(providerId) ??
		(mockShowPaidFor(providerId)
			? "all"
			: mockGetGlobalFreeOnly()
				? "free"
				: "all"),
	getProviderRegistry: () => mockProviderRegistry,
	isFreeModel: () => true,
	registerWithGlobalToggle: (...args: unknown[]) =>
		mockRegisterWithGlobalToggle(...args),
}));

describe("built-in-toggle stale context (#509)", () => {
	let mockPi: ExtensionAPI;
	let handlers: Record<string, Function>;
	let commands: Record<string, Function>;
	let setupBuiltInProviderToggles: (typeof import("../lib/built-in-toggle.ts"))["setupBuiltInProviderToggles"];

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();
		detachedOutcomes.length = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("network disabled in built-in-toggle tests");
			}),
		);
		handlers = {};
		commands = {};
		mockProviderRegistry.clear();
		mockGetGlobalFreeOnly.mockReturnValue(true);
		mockGetModelViewOverride.mockReturnValue(undefined);
		mockGetOpencodeGoShowPaid.mockReturnValue(false);
		mockGetOpenrouterShowPaid.mockReturnValue(false);
		mockGetOpencodeApiKey.mockReturnValue(undefined);

		mockPi = {
			registerCommand: vi.fn((name: string, config: { handler: Function }) => {
				commands[name] = config.handler;
			}),
			registerProvider: vi.fn(),
			setModel: vi.fn(async () => true),
			on: vi.fn((event: string, handler: Function) => {
				handlers[event] = handler;
			}),
		} as unknown as ExtensionAPI;

		({ setupBuiltInProviderToggles } =
			await import("../lib/built-in-toggle.ts"));
	});

	function staleRegistry() {
		const stale = () => {
			throw new Error(STALE_MESSAGE);
		};
		return { getAll: stale, getAvailable: stale };
	}

	function opencodeModels() {
		return [
			{
				provider: "opencode",
				id: "free-model",
				name: "Free Model",
				api: "openai-completions",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
				baseUrl: "https://example.com",
			},
		];
	}

	it("resolves (not rejects) detached captures when the session is replaced mid-capture", async () => {
		setupBuiltInProviderToggles(mockPi);

		// The session is replaced while the detached capture awaits: every
		// lazy ctx.modelRegistry access now throws Pi's stale guard.
		await handlers.session_start!({}, { modelRegistry: staleRegistry() });
		await settleDetachedCapture();

		const captures = detachedOutcomes.filter((o) =>
			o.label.startsWith("built-in-toggle-capture-"),
		);
		expect(captures.length).toBeGreaterThan(0);
		for (const capture of captures) {
			expect(capture.ok).toBe(true);
		}
		expect(
			detachedOutcomes.find(
				(o) => o.label === "built-in-toggle-capture-opencode-free",
			)?.ok,
		).toBe(true);
	});

	it("captures cleanly on the next session_start after a stale capture", async () => {
		setupBuiltInProviderToggles(mockPi);

		await handlers.session_start!({}, { modelRegistry: staleRegistry() });
		await settleDetachedCapture();

		// The live session retries: pending state was cleared, so a fresh
		// capture registers into the current session's registry.
		const registerProvider = vi.fn();
		await handlers.session_start!(
			{},
			{
				modelRegistry: {
					getAvailable: () => opencodeModels(),
					getApiKeyForProvider: async () => undefined,
					registerProvider,
				},
			},
		);
		await settleDetachedCapture();

		expect(registerProvider).toHaveBeenCalledWith(
			"opencode-free",
			expect.objectContaining({
				models: [expect.objectContaining({ id: "free-model" })],
			}),
		);
	});

	it("toggle command ignores a stale command ctx instead of throwing", async () => {
		setupBuiltInProviderToggles(mockPi);

		// No capture has run, so the command goes straight to tryCaptureProvider
		// with the dead session's registry — must resolve, not reject.
		await commands["toggle-opencode-free"]!(
			{},
			{ modelRegistry: staleRegistry() },
		);
	});
});
