/**
 * Tests for the Cline native auth (apiKey + OAuth callback-server flow).
 *
 * Mirrors tests/kilo-auth.test.ts, plus the Cline-specific pieces:
 *   - resolve always succeeds (public catalog) so Pi's refresh() and
 *     availability both work for logged-out users
 *   - toAuth applies the workos: bearer prefix (legacy oauth.getApiKey)
 *   - the login adapter maps the legacy OAuthLoginCallbacks flow onto the
 *     native AuthInteraction exactly as Pi's own adaptOAuth did
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AuthInteraction,
	OAuthCredential,
} from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetClineApiKey = vi.hoisted(() =>
	vi.fn((): string | undefined => undefined),
);

vi.mock("../config.ts", () => ({
	getClineApiKey: () => mockGetClineApiKey(),
}));

vi.mock("../lib/logger.ts", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}));

import {
	clineApiKeyAuth,
	clineAuth,
	clineOAuthAuth,
	loginClineNative,
	readClineCliApiKey,
	refreshClineCredential,
	toApiKey,
} from "../providers/cline/cline-auth.ts";

const authCtx = {
	env: async () => undefined,
	fileExists: async () => false,
};

beforeEach(() => {
	vi.clearAllMocks();
	mockGetClineApiKey.mockReturnValue(undefined);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("provider auth shape", () => {
	it("exposes both apiKey and oauth auth", () => {
		expect(clineAuth.apiKey).toBe(clineApiKeyAuth);
		expect(clineAuth.oauth).toBe(clineOAuthAuth);
		expect(clineApiKeyAuth.name).toBe("Cline API key");
		expect(clineOAuthAuth.name).toBe("Cline");
	});
});

describe("apiKey.resolve", () => {
	it("prefers a natively-stored key", async () => {
		mockGetClineApiKey.mockReturnValue("sk-ambient");
		const result = await clineApiKeyAuth.resolve({
			ctx: authCtx,
			credential: { type: "api_key", key: "sk-stored" },
			signal: new AbortController().signal,
		} as never);
		expect(result).toEqual({
			auth: { apiKey: "sk-stored" },
			source: "stored API key",
		});
	});

	it("falls back to the ambient CLINE_API_KEY / config value", async () => {
		mockGetClineApiKey.mockReturnValue("sk-ambient");
		const result = await clineApiKeyAuth.resolve({
			ctx: authCtx,
			signal: new AbortController().signal,
		} as never);
		expect(result).toEqual({
			auth: { apiKey: "sk-ambient" },
			source: "CLINE_API_KEY",
		});
	});

	it("still resolves (empty auth) when nothing is configured — public catalog", async () => {
		// Cline's model catalog is public: resolving unconfigured keeps Pi's
		// Models.refresh() driving offline init + background catalog refresh for
		// logged-out users (the legacy factory fetched models with no credential).
		mockGetClineApiKey.mockReturnValue(undefined);
		const result = await clineApiKeyAuth.resolve({
			ctx: authCtx,
			signal: new AbortController().signal,
		} as never);
		expect(result).toEqual({
			auth: {},
			source: "public catalog (no account)",
		});
	});

	it("falls back to the Cline CLI durable key when nothing else is set", async () => {
		mockGetClineApiKey.mockReturnValue(undefined);
		const dir = mkdtempSync(join(tmpdir(), "cline-cli-test-"));
		try {
			const providersPath = join(dir, "providers.json");
			writeFileSync(
				providersPath,
				JSON.stringify({
					providers: {
						"cline-pass": { settings: { apiKey: "sk-cli-clinepass" } },
						cline: { settings: { apiKey: "sk-cli-cline" } },
					},
				}),
				"utf8",
			);
			expect(readClineCliApiKey(providersPath)).toBe("sk-cli-clinepass");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("prefers a cline entry when cline-pass is absent", () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-cli-test-"));
		try {
			const providersPath = join(dir, "providers.json");
			writeFileSync(
				providersPath,
				JSON.stringify({
					providers: { cline: { settings: { apiKey: "sk-cli-cline" } } },
				}),
				"utf8",
			);
			expect(readClineCliApiKey(providersPath)).toBe("sk-cli-cline");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns undefined for missing or malformed CLI files", () => {
		const missing = join(tmpdir(), `missing-providers-${Date.now()}.json`);
		expect(readClineCliApiKey(missing)).toBeUndefined();

		const dir = mkdtempSync(join(tmpdir(), "cline-cli-test-"));
		try {
			const providersPath = join(dir, "providers.json");
			writeFileSync(providersPath, "{not json", "utf8");
			expect(readClineCliApiKey(providersPath)).toBeUndefined();
			// Empty providers map also yields nothing.
			writeFileSync(providersPath, '{"providers":{}}', "utf8");
			expect(readClineCliApiKey(providersPath)).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("apiKey.login", () => {
	it("prompts for a secret key and returns an api_key credential", async () => {
		const interaction = {
			prompt: vi.fn().mockResolvedValue("sk-prompted"),
			notify: vi.fn(),
			signal: new AbortController().signal,
		};
		const cred = await clineApiKeyAuth.login?.(interaction);
		expect(interaction.prompt).toHaveBeenCalledWith(
			expect.objectContaining({ type: "secret" }),
		);
		expect(cred).toEqual({ type: "api_key", key: "sk-prompted" });
	});
});

describe("oauth.toAuth", () => {
	it("derives request auth from the access token with the workos: prefix", async () => {
		const cred: OAuthCredential = {
			type: "oauth",
			refresh: "r",
			access: "access-123",
			expires: Date.now() + 1000,
		};
		expect(await clineOAuthAuth.toAuth(cred)).toEqual({
			apiKey: "workos:access-123",
		});
	});

	it("is idempotent for already-prefixed tokens", () => {
		expect(toApiKey({ access: "workos:abc", refresh: "", expires: 0 })).toBe(
			"workos:abc",
		);
	});
});

describe("oauth.refresh", () => {
	it("returns a still-valid credential unchanged (tagged oauth)", async () => {
		const cred: OAuthCredential = {
			type: "oauth",
			refresh: "r",
			access: "a",
			expires: Date.now() + 10_000,
		};
		await expect(refreshClineCredential(cred)).resolves.toEqual({
			...cred,
			type: "oauth",
		});
	});

	it("exchanges the refresh token when expired", async () => {
		const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				status: 200,
				json: async () => ({
					success: true,
					data: {
						accessToken: "new-access",
						refreshToken: "new-refresh",
						expiresAt,
					},
				}),
			})),
		);
		const cred: OAuthCredential = {
			type: "oauth",
			refresh: "old-refresh",
			access: "old-access",
			expires: Date.now() - 10_000,
		};

		const refreshed = await refreshClineCredential(cred);

		expect(refreshed.type).toBe("oauth");
		expect(refreshed.access).toBe("new-access");
		expect(refreshed.refresh).toBe("new-refresh");
		expect(refreshed.expires).toBeGreaterThan(Date.now());
	});

	it("throws a re-login error when the refresh keeps failing", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: false, status: 401 })),
		);
		const cred: OAuthCredential = {
			type: "oauth",
			refresh: "r",
			access: "a",
			expires: Date.now() - 10_000,
		};
		// The proven flow retries once after 1s before throwing.
		await expect(refreshClineCredential(cred)).rejects.toThrow(
			/run \/login cline/i,
		);
	}, 10_000);
});

describe("oauth login adapter (native AuthInteraction)", () => {
	function stubAuthFetch(): void {
		const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: unknown) => {
				const url = String(input);
				if (url.includes("/auth/authorize")) {
					return {
						ok: true,
						status: 200,
						json: async () => ({
							redirect_url: "https://auth.cline.bot/login",
						}),
					};
				}
				if (url.includes("/auth/token")) {
					return {
						ok: true,
						status: 200,
						json: async () => ({
							success: true,
							data: {
								accessToken: "access-token",
								refreshToken: "refresh-token",
								expiresAt,
							},
						}),
					};
				}
				return { ok: false, status: 404, json: async () => ({}) };
			}),
		);
	}

	it("runs the callback-server flow via notify/prompt and returns an oauth credential", async () => {
		stubAuthFetch();
		const events: Array<{ type: string }> = [];
		const interaction: AuthInteraction = {
			prompt: vi.fn().mockResolvedValue("manual-code-123"),
			notify: (e) => {
				events.push(e);
			},
		};

		const cred = await loginClineNative(interaction);

		expect(cred.type).toBe("oauth");
		expect(cred.access).toBe("access-token");
		expect(cred.refresh).toBe("refresh-token");
		expect(cred.expires).toBeGreaterThan(Date.now());
		// Pi was told the auth url so it can render it (legacy onAuth mapping).
		const authUrl = events.find((e) => e.type === "auth_url");
		expect(authUrl).toBeDefined();
		expect(events.some((e) => e.type === "progress")).toBe(true);
		// Manual code input raced the callback server (legacy onManualCodeInput).
		expect(interaction.prompt).toHaveBeenCalledWith(
			expect.objectContaining({ type: "manual_code" }),
		);
	}, 15_000);
});
