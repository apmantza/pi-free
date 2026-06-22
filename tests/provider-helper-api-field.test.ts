/**
 * Tests for the OpenAICompatibleConfig `api` field.
 *
 * Before the fix, `createReRegister`, `registerOpenAICompatible`, and
 * `createCtxReRegister` all hardcoded `api: "openai-completions"`. This
 * silently broke Anthropic-protocol providers (openmodel) by forcing
 * their requests to the wrong path (`/v1/chat/completions` returns
 * `404 {"code":"NOT_FOUND","msg":"route not found"}` on Anthropic-only
 * gateways). The fix threads an optional `api` field through
 * `OpenAICompatibleConfig` so each provider can declare its wire format.
 *
 * These tests pin the new behavior so it can't regress.
 */

import { describe, expect, it, vi } from "vitest";
import {
	createCtxReRegister,
	createReRegister,
	registerOpenAICompatible,
} from "../provider-helper.ts";

type CapturedCall = {
	method: string;
	args: unknown[];
};

function makeFakePi(): {
	registerProvider: ReturnType<typeof vi.fn>;
	calls: CapturedCall[];
} {
	const calls: CapturedCall[] = [];
	const registerProvider = vi.fn((id, cfg) => {
		calls.push({ method: "registerProvider", args: [id, cfg] });
	});
	return { registerProvider, calls };
}

describe("OpenAICompatibleConfig.api", () => {
	describe("registerOpenAICompatible", () => {
		it("defaults to openai-completions for backward compatibility", () => {
			const { registerProvider } = makeFakePi();
			registerOpenAICompatible(
				{ registerProvider } as never,
				{ providerId: "p1", baseUrl: "https://x", apiKey: "k1" },
				[],
			);
			const cfg = registerProvider.mock.calls[0][1] as { api: string };
			expect(cfg.api).toBe("openai-completions");
		});

		it("passes through anthropic-messages when configured", () => {
			const { registerProvider } = makeFakePi();
			registerOpenAICompatible(
				{ registerProvider } as never,
				{
					providerId: "openmodel",
					baseUrl: "https://api.openmodel.ai",
					apiKey: "om-xxx",
					api: "anthropic-messages",
				},
				[],
			);
			const cfg = registerProvider.mock.calls[0][1] as { api: string };
			expect(cfg.api).toBe("anthropic-messages");
		});
	});

	describe("createReRegister", () => {
		it("defaults to openai-completions", () => {
			const { registerProvider, calls } = makeFakePi();
			const reRegister = createReRegister({ registerProvider } as never, {
				providerId: "p2",
				baseUrl: "https://x",
				apiKey: "k2",
			});
			reRegister([]);
			const cfg = calls[0].args[1] as { api: string };
			expect(cfg.api).toBe("openai-completions");
		});

		it("passes through anthropic-messages (openmodel fix)", () => {
			const { registerProvider, calls } = makeFakePi();
			const reRegister = createReRegister({ registerProvider } as never, {
				providerId: "openmodel",
				baseUrl: "https://api.openmodel.ai",
				apiKey: "om-xxx",
				api: "anthropic-messages",
			});
			reRegister([]);
			const cfg = calls[0].args[1] as { api: string };
			expect(cfg.api).toBe("anthropic-messages");
		});
	});

	describe("createCtxReRegister", () => {
		it("passes through anthropic-messages when configured", () => {
			const registerProvider = vi.fn();
			const ctx = { modelRegistry: { registerProvider } };
			const reRegister = createCtxReRegister(ctx as never, {
				providerId: "openmodel",
				baseUrl: "https://api.openmodel.ai",
				apiKey: "om-xxx",
				api: "anthropic-messages",
			});
			reRegister([]);
			const cfg = registerProvider.mock.calls[0][1] as { api: string };
			expect(cfg.api).toBe("anthropic-messages");
		});
	});

	describe("preserves User-Agent + custom headers", () => {
		it("User-Agent always set, custom headers merged", () => {
			const { registerProvider, calls } = makeFakePi();
			registerOpenAICompatible(
				{ registerProvider } as never,
				{
					providerId: "p3",
					baseUrl: "https://x",
					apiKey: "k3",
					api: "anthropic-messages",
					headers: { "X-Custom": "yes" },
				},
				[],
			);
			const cfg = calls[0].args[1] as {
				headers: Record<string, string>;
			};
			expect(cfg.headers["User-Agent"]).toBe("pi-free-providers");
			expect(cfg.headers["X-Custom"]).toBe("yes");
		});
	});
});
