/**
 * Tests for the kiro-auth dispatch + legacy OAuthLoginCallbacks
 * translation logic.
 *
 * The post-Phase-F fix to `kiro-auth.ts` makes `loginKiro` dispatch to
 * either `loginKiroDesktop` (the new Web Portal flow) or the legacy
 * `runDeviceCodeFlow` based on `getKiroAuthMethod()`. These tests
 * pin that contract so a future refactor can't silently send users
 * to the wrong flow.
 *
 * The follow-up fix (after the user's "No pending authentication
 * state found" report) updates `loginKiro` to take the legacy
 * `OAuthLoginCallbacks` shape that Pi's `adaptOAuth` actually
 * passes (instead of the new `AuthInteraction` shape that the
 * functions internally use). The test file was updated to use the
 * legacy shape to match the real call site.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OAuthLoginCallbacks } from "@earendil-works/pi-ai/compat";

// Mock the config getter so we control the dispatch decision.
const mockGetKiroAuthMethod = vi.hoisted(() =>
	vi.fn((): "idc" | "web-portal" | "kiro-cli" => "web-portal"),
);

// Mock the kiro-desktop-auth module so loginKiroDesktop is a spy.
const mockLoginKiroDesktop = vi.hoisted(() =>
	vi.fn(async (_interaction?: unknown) => ({
		type: "oauth",
		access: "aoa-test-access",
		refresh: "rt-test-refresh",
		expires: Date.now() + 3600 * 1000,
		clientId: "arn:aws:sso::123:application/test",
		clientSecret: "",
		region: "us-east-1",
		authMethod: "web-portal",
	})),
);

vi.mock("../config.ts", () => ({
	getKiroAuthMethod: () => mockGetKiroAuthMethod(),
}));

vi.mock("../providers/kiro/kiro-desktop-auth.ts", () => ({
	loginKiroDesktop: mockLoginKiroDesktop,
}));

// Stub the runDeviceCodeFlow's transitive deps so the idc path
// doesn't make real network calls when our test forces the idc
// branch. The simplest way is to mock globalThis.fetch.
beforeEach(() => {
	vi.clearAllMocks();
	mockGetKiroAuthMethod.mockReturnValue("web-portal");
	mockLoginKiroDesktop.mockClear();
	globalThis.fetch = vi
		.fn()
		.mockResolvedValue(
			new Response("{}", { status: 500 }),
		) as unknown as typeof fetch;
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

/**
 * Build a mock `OAuthLoginCallbacks` — the legacy shape that Pi's
 * `adaptOAuth` actually passes. Each callback is a vi.fn() that
 * captures its argument so the test can assert on it.
 */
function makeLegacyCallbacks() {
	return {
		onAuth: vi.fn(),
		onDeviceCode: vi.fn(),
		onPrompt: vi.fn().mockResolvedValue(""),
		onProgress: vi.fn(),
		onManualCodeInput: vi.fn().mockResolvedValue(""),
		onSelect: vi.fn().mockResolvedValue(undefined),
		signal: new AbortController().signal,
	} as unknown as OAuthLoginCallbacks & {
		onAuth: ReturnType<typeof vi.fn>;
		onDeviceCode: ReturnType<typeof vi.fn>;
		onPrompt: ReturnType<typeof vi.fn>;
		onProgress: ReturnType<typeof vi.fn>;
		onManualCodeInput: ReturnType<typeof vi.fn>;
		onSelect: ReturnType<typeof vi.fn>;
	};
}

describe("kiro-auth — loginKiro dispatch", () => {
	it("dispatches to loginKiroDesktop when getKiroAuthMethod returns 'web-portal'", async () => {
		mockGetKiroAuthMethod.mockReturnValue("web-portal");
		mockLoginKiroDesktop.mockResolvedValueOnce({
			type: "oauth",
			access: "aoa-from-web-portal",
			refresh: "rt-from-web-portal",
			expires: Date.now() + 3600 * 1000,
			clientId: "arn:aws:sso::123:application/wp",
			clientSecret: "",
			region: "us-east-1",
			authMethod: "web-portal",
		});
		const { kiroOAuthAuth } = await import("../providers/kiro/kiro-auth.ts");
		// kiroOAuthAuth.login is declared as taking the new
		// ProviderAuthInteraction in pi-ai's OAuthAuth interface, but
		// our actual implementation takes the legacy OAuthLoginCallbacks
		// (matching the Cline provider pattern). Cast through unknown
		// to call it with the legacy shape.
		type LegacyLogin = (cb: OAuthLoginCallbacks) => Promise<unknown>;
		const loginFn = kiroOAuthAuth.login as unknown as LegacyLogin;
		const cred = (await loginFn(makeLegacyCallbacks())) as unknown as {
			authMethod: string;
			access: string;
		};
		expect(mockLoginKiroDesktop).toHaveBeenCalledTimes(1);
		expect(cred.authMethod).toBe("web-portal");
		expect(cred.access).toBe("aoa-from-web-portal");
	});

	it("falls through to the legacy idc flow when getKiroAuthMethod returns 'idc'", async () => {
		mockGetKiroAuthMethod.mockReturnValue("idc");
		// Make the device code endpoint fail fast so the idc path errors
		// out (we're only verifying the dispatch went the right way).
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(
				new Response("{}", { status: 500 }),
			) as unknown as typeof fetch;

		const { kiroOAuthAuth } = await import("../providers/kiro/kiro-auth.ts");
		type LegacyLogin = (cb: OAuthLoginCallbacks) => Promise<unknown>;
		const loginFn = kiroOAuthAuth.login as unknown as LegacyLogin;
		try {
			await loginFn(makeLegacyCallbacks());
		} catch {
			// Expected — the idc flow's network call failed.
		}
		expect(mockLoginKiroDesktop).not.toHaveBeenCalled();
	});

	it("falls through to the legacy idc flow when getKiroAuthMethod returns 'kiro-cli' (Phase G, not yet implemented)", async () => {
		mockGetKiroAuthMethod.mockReturnValue("kiro-cli");
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(
				new Response("{}", { status: 500 }),
			) as unknown as typeof fetch;

		const { kiroOAuthAuth } = await import("../providers/kiro/kiro-auth.ts");
		type LegacyLogin = (cb: OAuthLoginCallbacks) => Promise<unknown>;
		const loginFn = kiroOAuthAuth.login as unknown as LegacyLogin;
		try {
			await loginFn(makeLegacyCallbacks());
		} catch {
			// Expected — the idc flow's network call failed.
		}
		expect(mockLoginKiroDesktop).not.toHaveBeenCalled();
	});

	it("the public kiroOAuthAuth.loginLabel is generic ('Sign in with Kiro'), not idc-specific", async () => {
		const { kiroOAuthAuth } = await import("../providers/kiro/kiro-auth.ts");
		// The label is what users see in Pi's /login prompt. It must
		// not mention 'AWS Builder ID' specifically because the new
		// web-portal flow supports BuilderId, Google, Github, and AWSIdC.
		expect(kiroOAuthAuth.loginLabel).toBe("Sign in with Kiro");
		expect(kiroOAuthAuth.name).toBe("Kiro");
	});
});

describe("kiro-auth — legacy OAuthLoginCallbacks translation", () => {
	// These tests pin the bug reported by the user: before this fix,
	// loginKiro expected an AuthInteraction (with .notify / .prompt)
	// but Pi's adaptOAuth passes an OAuthLoginCallbacks (with .onAuth /
	// .onManualCodeInput / etc.). Calling interaction.notify on the
	// legacy object threw "interaction.notify is not a function",
	// which Pi's runtime surfaced as "No pending authentication state
	// found". After the fix, loginKiro translates the legacy callbacks
	// to the new shape internally and calls flow through correctly.

	it("translates onProgress (legacy) → interaction.notify (new)", async () => {
		mockGetKiroAuthMethod.mockReturnValue("web-portal");
		const { kiroOAuthAuth } = await import("../providers/kiro/kiro-auth.ts");
		type LegacyLogin = (cb: OAuthLoginCallbacks) => Promise<unknown>;
		const loginFn = kiroOAuthAuth.login as unknown as LegacyLogin;
		const callbacks = makeLegacyCallbacks();
		await loginFn(callbacks);
		// loginKiro calls notify({ type: "progress", ... }) before
		// dispatching. The translation routes this to onProgress.
		expect(callbacks.onProgress).toHaveBeenCalledWith(
			"Starting Kiro Web Portal login (PKCE + browser redirect)...",
		);
	});

	it("does not throw 'interaction.notify is not a function' when given a legacy callbacks object", async () => {
		// This is the regression test for the user-reported bug.
		// Before the fix, this test would fail with
		// "interaction.notify is not a function" because loginKiro
		// tried to call .notify on an OAuthLoginCallbacks object.
		mockGetKiroAuthMethod.mockReturnValue("web-portal");
		const { kiroOAuthAuth } = await import("../providers/kiro/kiro-auth.ts");
		type LegacyLogin = (cb: OAuthLoginCallbacks) => Promise<unknown>;
		const loginFn = kiroOAuthAuth.login as unknown as LegacyLogin;
		const callbacks = makeLegacyCallbacks();
		await expect(loginFn(callbacks)).resolves.toBeDefined();
	});

	it("forwards onManualCodeInput through to loginKiroDesktop's prompt", async () => {
		// When the web-portal flow reaches ExchangeToken, it asks the
		// user to paste the redirect URL. The new-shape prompt's
		// { type: "manual_code" } gets routed to the legacy
		// onManualCodeInput callback.
		mockGetKiroAuthMethod.mockReturnValue("web-portal");
		mockLoginKiroDesktop.mockImplementation(async (interaction: unknown) => {
			// Simulate loginKiroDesktop calling prompt with a manual_code
			const i = interaction as {
				prompt: (p: { type: string }) => Promise<string>;
			};
			await i.prompt({ type: "manual_code" });
			return {
				type: "oauth",
				access: "aoa",
				refresh: "rt",
				expires: 0,
				clientId: "",
				clientSecret: "",
				region: "us-east-1",
				authMethod: "web-portal",
			};
		});
		const { kiroOAuthAuth } = await import("../providers/kiro/kiro-auth.ts");
		type LegacyLogin = (cb: OAuthLoginCallbacks) => Promise<unknown>;
		const loginFn = kiroOAuthAuth.login as unknown as LegacyLogin;
		const callbacks = makeLegacyCallbacks();
		await loginFn(callbacks);
		// The translation should have routed the manual_code prompt to
		// the legacy onManualCodeInput callback.
		expect(callbacks.onManualCodeInput).toHaveBeenCalled();
	});
});
