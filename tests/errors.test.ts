import { describe, expect, it } from "vitest";
import {
	classifyError,
	isCapacityError,
	isRateLimit,
	shouldTriggerAutocompact,
} from "../provider-failover/errors.ts";

describe("Error Classification", () => {
	describe("classifyError", () => {
		it("should classify 429 status code as rate_limit", () => {
			const error = { statusCode: 429, message: "Too many requests" };
			const result = classifyError(error);

			expect(result.type).toBe("rate_limit");
			expect(result.retryable).toBe(true);
			expect(result.retryAfterMs).toBe(60000);
		});

		it("should classify 503 status code as capacity", () => {
			const error = { statusCode: 503, message: "Service unavailable" };
			const result = classifyError(error);

			expect(result.type).toBe("capacity");
			expect(result.retryable).toBe(true);
			expect(result.retryAfterMs).toBe(30000);
		});

		it("should classify 401/403 as auth errors", () => {
			const error401 = { statusCode: 401, message: "Unauthorized" };
			const error403 = { statusCode: 403, message: "Forbidden" };

			expect(classifyError(error401).type).toBe("auth");
			expect(classifyError(error403).type).toBe("auth");
			expect(classifyError(error401).retryable).toBe(false);
		});

		it("should detect rate limit patterns in message", () => {
			const messages = [
				"Rate limit exceeded",
				"Too many requests",
				"Quota exceeded for this billing period",
				"429: Throttled",
				"You have been ratelimited",
			];

			messages.forEach((msg) => {
				const result = classifyError(msg);
				expect(result.type).toBe("rate_limit");
				expect(result.retryable).toBe(true);
			});
		});

		it("should detect capacity patterns in message", () => {
			const messages = [
				"No capacity available",
				"Engine overloaded",
				"Temporarily unavailable",
				"Service is busy",
			];

			messages.forEach((msg) => {
				const result = classifyError(msg);
				expect(result.type).toBe("capacity");
				expect(result.retryable).toBe(true);
			});
		});

		it("should detect auth patterns in message", () => {
			const messages = [
				"Invalid API key",
				"Authentication failed",
				"Invalid token provided",
				"API key is not valid",
			];

			messages.forEach((msg) => {
				const result = classifyError(msg);
				expect(result.type).toBe("auth");
				expect(result.retryable).toBe(false);
			});
		});

		it("should detect network patterns in message", () => {
			const messages = [
				"Connection timeout",
				"ETIMEDOUT",
				"ECONNRESET",
				"Fetch failed",
				"Network error occurred",
			];

			messages.forEach((msg) => {
				const result = classifyError(msg);
				expect(result.type).toBe("network");
				expect(result.retryable).toBe(true);
			});
		});

		it("should extract retry-after from message", () => {
			const error = "Rate limit. Retry after 120 seconds";
			const result = classifyError(error);

			expect(result.type).toBe("rate_limit");
			expect(result.retryAfterMs).toBe(120000);
		});

		it("should handle unknown errors as retryable", () => {
			const error = "Something unexpected happened";
			const result = classifyError(error);

			expect(result.type).toBe("unknown");
			expect(result.retryable).toBe(true);
		});
	});

	describe("isRateLimit", () => {
		it("should return true for rate limit errors", () => {
			expect(isRateLimit("429 error")).toBe(true);
			expect(isRateLimit("Rate limit exceeded")).toBe(true);
		});

		it("should return false for other errors", () => {
			expect(isRateLimit("Authentication failed")).toBe(false);
			expect(isRateLimit("Network timeout")).toBe(false);
		});
	});

	describe("isCapacityError", () => {
		it("should return true for capacity errors", () => {
			expect(isCapacityError("No capacity available")).toBe(true);
			expect(isCapacityError("Engine overloaded")).toBe(true);
		});

		it("should return false for other errors", () => {
			expect(isCapacityError("Rate limit")).toBe(false);
			expect(isCapacityError("Invalid key")).toBe(false);
		});
	});

	describe("shouldTriggerAutocompact", () => {
		it("should trigger autocompact on rate limit in free mode", () => {
			const error = "429 Too many requests";
			expect(shouldTriggerAutocompact(error, "kilo", false)).toBe(true);
			expect(shouldTriggerAutocompact(error, "openrouter", false)).toBe(true);
		});

		it("should NOT trigger autocompact in paid mode", () => {
			const error = "429 Too many requests";
			expect(shouldTriggerAutocompact(error, "fireworks", true)).toBe(false);
		});

		it("should NOT trigger autocompact for non-rate-limit errors", () => {
			expect(shouldTriggerAutocompact("Auth failed", "kilo", false)).toBe(
				false,
			);
			expect(shouldTriggerAutocompact("Network error", "kilo", false)).toBe(
				false,
			);
		});
	});
});
