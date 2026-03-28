import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it } from "vitest";
import {
	getFailureCount,
	handleProviderError,
	isProviderExhausted,
	resetFailureCount,
} from "../provider-failover/index.ts";

describe("Failover Handler", () => {
	beforeEach(() => {
		// Reset state before each test
		resetFailureCount("test-provider");
	});

	describe("handleProviderError", () => {
		it("should classify rate limit and suggest autocompact in free mode", async () => {
			const result = await handleProviderError(
				"429 Rate limit exceeded",
				{
					provider: "test-provider",
					isPaidMode: false,
					enableAutocompact: true,
				},
				{} as unknown as ExtensionAPI,
				{ ui: { notify: () => {} }, session: { id: "test" } },
			);

			expect(result.action).toBe("autocompact");
			expect(result.shouldRetry).toBe(true);
		});

		it("should suggest failover in paid mode on rate limit", async () => {
			const result = await handleProviderError(
				"429 Rate limit exceeded",
				{
					provider: "test-provider",
					isPaidMode: true,
					enableAutocompact: true,
				},
				{} as unknown as ExtensionAPI,
				{ ui: { notify: () => {} }, session: { id: "test" } },
			);

			expect(result.action).toBe("failover");
		});

		it("should handle auth errors as non-retryable", async () => {
			const result = await handleProviderError(
				"401 Invalid API key",
				{
					provider: "test-provider",
					isPaidMode: false,
					enableAutocompact: true,
				},
				{} as unknown as ExtensionAPI,
				{ ui: { notify: () => {} } },
			);

			expect(result.action).toBe("fail");
			expect(result.shouldRetry).toBe(false);
		});

		it("should handle capacity errors with retry", async () => {
			const result = await handleProviderError(
				"503 Service unavailable - no capacity",
				{
					provider: "test-provider",
					isPaidMode: false,
					enableAutocompact: true,
				},
				{} as unknown as ExtensionAPI,
				{ ui: { notify: () => {} } },
			);

			expect(result.action).toBe("failover");
			expect(result.shouldRetry).toBe(true);
		});
	});

	describe("failure tracking", () => {
		it("should track consecutive failures", () => {
			expect(getFailureCount("new-provider")).toBe(0);
		});

		it("should detect exhausted provider", () => {
			// Provider with no failures is not exhausted
			expect(isProviderExhausted("fresh-provider")).toBe(false);
		});

		it("should reset failure count", () => {
			// After a successful request, call resetFailureCount
			resetFailureCount("test-provider");
			expect(getFailureCount("test-provider")).toBe(0);
		});
	});
});
