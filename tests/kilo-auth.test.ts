/**
 * Tests for the Kilo native auth (apiKey + OAuth device flow).
 */

import type {
	AuthInteraction,
	OAuthCredential,
} from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetKiloApiKey = vi.hoisted(() => vi.fn((): string | undefined => undefined));
const mockOpenBrowser = vi.hoisted(() => vi.fn());

vi.mock("../config.ts", () => ({
	getKiloApiKey: () => mockGetKiloApiKey(),
}));

vi.mock("../lib/open-browser.ts", () => ({
	openBrowser: (...args: unknown[]) => mockOpenBrowser(...args),
}));

// Shrink the device-flow poll interval so login tests don't wait seconds.
vi.mock("../constants.ts", async () => {
	const actual = await vi.importActual<Record<string, unknown>>(
		"../constants.ts",
	);
	return {
		...actual,
		KILO_POLL_INTERVAL_MS: 1,
		KILO_TOKEN_EXPIRATION_MS: 365 * 24 * 60 * 60 * 1000,
	};
});

import {
	fetchKiloBalance,
	kiloApiKeyAuth,
	kiloAuth,
	kiloOAuthAuth,
	loginKilo,
	refreshKiloCredential,
} from "../providers/kilo/kilo-auth.ts";

const authCtx = {
	env: async () => undefined,
	fileExists: async () => false,
};

beforeEach(() => {
	vi.clearAllMocks();
	mockGetKiloApiKey.mockReturnValue(undefined);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("provider auth shape", () => {
	it("exposes both apiKey and oauth auth", () => {
		expect(kiloAuth.apiKey).toBe(kiloApiKeyAuth);
		expect(kiloAuth.oauth).toBe(kiloOAuthAuth);
		expect(kiloApiKeyAuth.name).toBe("Kilo API key");
		expect(kiloOAuthAuth.name).toBe("Kilo");
	});
});

describe("apiKey.resolve", () => {
	it("prefers a natively-stored key", async () => {
		mockGetKiloApiKey.mockReturnValue("sk-ambient");
		const result = await kiloApiKeyAuth.resolve({
			ctx: authCtx,
			credential: { type: "api_key", key: "sk-stored" },
		});
		expect(result).toEqual({
			auth: { apiKey: "sk-stored" },
			source: "stored API key",
		});
	});

	it("falls back to the ambient KILO_API_KEY / config value", async () => {
		mockGetKiloApiKey.mockReturnValue("sk-ambient");
		const result = await kiloApiKeyAuth.resolve({ ctx: authCtx });
		expect(result).toEqual({
			auth: { apiKey: "sk-ambient" },
			source: "KILO_API_KEY",
		});
	});

	it("resolves undefined when nothing is configured", async () => {
		mockGetKiloApiKey.mockReturnValue(undefined);
		const result = await kiloApiKeyAuth.resolve({ ctx: authCtx });
		expect(result).toBeUndefined();
	});
});

describe("apiKey.login", () => {
	it("prompts for a secret key and returns an api_key credential", async () => {
		const interaction: AuthInteraction = {
			prompt: vi.fn().mockResolvedValue("sk-prompted"),
			notify: vi.fn(),
		};
		const cred = await kiloApiKeyAuth.login?.(interaction);
		expect(interaction.prompt).toHaveBeenCalledWith(
			expect.objectContaining({ type: "secret" }),
		);
		expect(cred).toEqual({ type: "api_key", key: "sk-prompted" });
	});
});

describe("oauth.toAuth / refresh", () => {
	it("derives request auth from the access token", async () => {
		const cred: OAuthCredential = {
			type: "oauth",
			refresh: "r",
			access: "access-123",
			expires: Date.now() + 1000,
		};
		expect(await kiloOAuthAuth.toAuth(cred)).toEqual({ apiKey: "access-123" });
	});

	it("refresh returns a still-valid credential unchanged", async () => {
		const cred: OAuthCredential = {
			type: "oauth",
			refresh: "r",
			access: "a",
			expires: Date.now() + 10_000,
		};
		await expect(refreshKiloCredential(cred)).resolves.toBe(cred);
	});

	it("refresh throws on an expired credential (re-login path)", async () => {
		const cred: OAuthCredential = {
			type: "oauth",
			refresh: "r",
			access: "a",
			expires: Date.now() - 10_000,
		};
		await expect(refreshKiloCredential(cred)).rejects.toThrow(/expired/i);
	});
});

describe("oauth device-flow login", () => {
	function stubFetch(
		pollResponses: Array<{ status: string; token?: string }>,
	): void {
		let polls = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: unknown, init?: { method?: string }) => {
				const url = String(input);
				const method = init?.method;
				if (method === "POST" && url.includes("/device-auth/codes")) {
					return {
						ok: true,
						status: 200,
						json: async () => ({
							code: "DEV-CODE",
							verificationUrl: "https://kilo.ai/verify",
							expiresIn: 600,
						}),
					};
				}
				// Poll endpoint.
				const resp = pollResponses[Math.min(polls, pollResponses.length - 1)];
				polls++;
				return {
					ok: true,
					status: 200,
					json: async () => resp,
				};
			}),
		);
	}

	it("runs the device flow and returns an oauth credential", async () => {
		stubFetch([{ status: "approved", token: "kilo-token" }]);
		const events: Array<{ type: string }> = [];
		const interaction: AuthInteraction = {
			prompt: vi.fn(),
			notify: (e) => {
				events.push(e);
			},
		};

		const cred = await loginKilo(interaction);

		expect(cred.type).toBe("oauth");
		expect(cred.access).toBe("kilo-token");
		expect(cred.refresh).toBe("kilo-token");
		expect(cred.expires).toBeGreaterThan(Date.now());
		// Pi was told the auth url + device code so it can render them.
		expect(events.some((e) => e.type === "auth_url")).toBe(true);
		expect(events.some((e) => e.type === "device_code")).toBe(true);
		expect(mockOpenBrowser).toHaveBeenCalledWith("https://kilo.ai/verify");
	});

	it("rejects when the user denies authorization", async () => {
		stubFetch([{ status: "denied" }]);
		const interaction: AuthInteraction = { prompt: vi.fn(), notify: vi.fn() };
		await expect(loginKilo(interaction)).rejects.toThrow(/denied/i);
	});
});

describe("balance helper", () => {
	it("returns null on failure", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: false, status: 500 })),
		);
		expect(await fetchKiloBalance("t")).toBeNull();
	});
});
