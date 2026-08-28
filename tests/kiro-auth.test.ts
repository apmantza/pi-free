/**
 * Tests for the kiro-auth dispatch logic.
 *
 * The post-Phase-F fix to `kiro-auth.ts` makes `loginKiro` dispatch to
 * either `loginKiroDesktop` (the new Web Portal flow) or the legacy
 * `runDeviceCodeFlow` based on `getKiroAuthMethod()`. These tests
 * pin that contract so a future refactor can't silently send users
 * to the wrong flow.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthInteraction } from "@earendil-works/pi-ai";

// Mock the config getter so we control the dispatch decision.
const mockGetKiroAuthMethod = vi.hoisted(() =>
	vi.fn((): "idc" | "web-portal" | "kiro-cli" => "web-portal"),
);

// Mock the kiro-desktop-auth module so loginKiroDesktop is a spy.
const mockLoginKiroDesktop = vi.hoisted(() =>
	vi.fn(async (_interaction: AuthInteraction) => ({
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
// branch. The simplest way is to mock the underlying tryRegister-
// AndAuthorize via the global fetch.
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

function makeInteraction() {
	const controller = new AbortController();
	return {
		notify: vi.fn(),
		prompt: vi.fn().mockResolvedValue(""),
		signal: controller.signal,
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
		const cred = (await kiroOAuthAuth.login!(makeInteraction())) as unknown as {
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
		try {
			await kiroOAuthAuth.login!(makeInteraction());
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
		try {
			await kiroOAuthAuth.login!(makeInteraction());
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
