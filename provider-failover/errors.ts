/**
 * Error classification for provider failover
 * Detects 429 rate limits, capacity errors, and other provider-specific errors
 */

import { getFreeTierUsage, getLimitWarning } from "../free-tier-limits.ts";
import { createLogger } from "../lib/logger.ts";

const _logger = createLogger("failover");

export type ErrorType =
	| "rate_limit" // 429, quota exceeded
	| "capacity" // No capacity, overloaded
	| "auth" // Invalid key, unauthorized
	| "network" // Timeout, connection error
	| "unknown"; // Unclassified

export interface ClassifiedError {
	type: ErrorType;
	provider?: string;
	model?: string;
	statusCode?: number;
	message: string;
	retryable: boolean;
	retryAfterMs?: number; // Server-suggested retry delay
}

// Pattern matching for various provider error messages
const RATE_LIMIT_PATTERNS = [
	/429/i,
	/rate.?limit/i,
	/too.?many.?requests/i,
	/quota.*exceeded/i,
	/insufficient.*quota/i,
	/billing.*quota/i,
	/limit.*exceeded/i,
	/throttled/i,
	/ratelimit/i,
];

const CAPACITY_PATTERNS = [
	/no.*capacity/i,
	/overloaded/i,
	/engine.*overloaded/i,
	/temporarily.*unavailable/i,
	/service.*unavailable/i,
	/503/i,
	/529/i, // Cloudflare origin is overloaded
	/busy/i,
];

const AUTH_PATTERNS = [
	/401/i,
	/403/i,
	/unauthorized/i,
	/invalid.*key/i,
	/invalid.*token/i,
	/authentication/i,
	/api.*key.*invalid/i,
	/key.*not.*valid/i,
	/invalid.*api.*key/i,
	/invalid.*auth/i,
];

const NETWORK_PATTERNS = [
	/timeout/i,
	/etimedout/i,
	/enetunreach/i,
	/econnreset/i,
	/connection.*refused/i,
	/fetch.*failed/i,
	/network.*error/i,
	/abort/i,
	/signal/i,
];

/**
 * Extract HTTP status code from error object or message
 */
function extractStatusCode(error: unknown): number | undefined {
	// Check for statusCode property
	if (
		typeof error === "object" &&
		error !== null &&
		"statusCode" in error &&
		typeof error.statusCode === "number"
	) {
		return error.statusCode;
	}

	// Check for status property
	if (
		typeof error === "object" &&
		error !== null &&
		"status" in error &&
		typeof error.status === "number"
	) {
		return error.status;
	}

	// Extract from message
	const message = String(error);
	const match = message.match(/\b(\d{3})\b/);
	if (match) {
		const code = Number.parseInt(match[1], 10);
		if (code >= 400 && code < 600) return code;
	}

	return undefined;
}

/**
 * Extract retry-after hint from error
 */
function extractRetryAfter(error: unknown): number | undefined {
	const message = String(error);

	// Look for "retry after X seconds/minutes"
	const secondsMatch = message.match(/retry.?after\s+(\d+)\s*s/i);
	if (secondsMatch) {
		return Number.parseInt(secondsMatch[1], 10) * 1000;
	}

	const minutesMatch = message.match(/retry.?after\s+(\d+)\s*m/i);
	if (minutesMatch) {
		return Number.parseInt(minutesMatch[1], 10) * 60 * 1000;
	}

	// Check for retry_after property
	if (
		typeof error === "object" &&
		error !== null &&
		"retry_after" in error &&
		typeof error.retry_after === "number"
	) {
		return error.retry_after * 1000;
	}

	return undefined;
}

/**
 * Classify an error to determine if it's a 429/capacity issue
 */
export function classifyError(error: unknown): ClassifiedError {
	const message = String(error);
	const statusCode = extractStatusCode(error);
	const retryAfterMs = extractRetryAfter(error);

	// Check status code first
	if (statusCode === 429) {
		return {
			type: "rate_limit",
			statusCode,
			message,
			retryable: true,
			retryAfterMs: retryAfterMs ?? 60000, // Default 1 min
		};
	}

	if (statusCode === 503 || statusCode === 529) {
		return {
			type: "capacity",
			statusCode,
			message,
			retryable: true,
			retryAfterMs: retryAfterMs ?? 30000, // Default 30 sec
		};
	}

	if (statusCode === 401 || statusCode === 403) {
		return {
			type: "auth",
			statusCode,
			message,
			retryable: false,
		};
	}

	// Check patterns in message
	if (RATE_LIMIT_PATTERNS.some((p) => p.test(message))) {
		return {
			type: "rate_limit",
			statusCode,
			message,
			retryable: true,
			retryAfterMs: retryAfterMs ?? 60000,
		};
	}

	if (CAPACITY_PATTERNS.some((p) => p.test(message))) {
		return {
			type: "capacity",
			statusCode,
			message,
			retryable: true,
			retryAfterMs: retryAfterMs ?? 30000,
		};
	}

	if (AUTH_PATTERNS.some((p) => p.test(message))) {
		return {
			type: "auth",
			statusCode,
			message,
			retryable: false,
		};
	}

	if (NETWORK_PATTERNS.some((p) => p.test(message))) {
		return {
			type: "network",
			statusCode,
			message,
			retryable: true,
			retryAfterMs: 5000, // Short retry for network
		};
	}

	// Unknown error - assume retryable but with caution
	return {
		type: "unknown",
		statusCode,
		message,
		retryable: statusCode ? statusCode >= 500 : true,
		retryAfterMs: 10000,
	};
}

/**
 * Check if error is specifically a rate limit (429)
 */
export function isRateLimit(error: unknown): boolean {
	return classifyError(error).type === "rate_limit";
}

/**
 * Check if error is capacity-related (provider overloaded)
 */
export function isCapacityError(error: unknown): boolean {
	return classifyError(error).type === "capacity";
}

/**
 * Check if error should trigger autocompact
 * Only rate limits on free providers should trigger autocompact
 */
export function shouldTriggerAutocompact(
	error: unknown,
	_provider: string,
	isPaidMode: boolean,
): boolean {
	const classified = classifyError(error);

	// Only rate limits trigger autocompact
	if (classified.type !== "rate_limit") return false;

	// In paid mode, don't autocompact - just switch provider or retry
	if (isPaidMode) return false;

	// In free mode, autocompact is a good first response
	return true;
}

/**
 * Log error classification for debugging
 */
export function logErrorClassification(
	_error: unknown,
	classified: ClassifiedError,
): void {
	_logger.info(`Error classified: ${classified.type}`, {
		statusCode: classified.statusCode,
		retryable: classified.retryable,
		retryAfterMs: classified.retryAfterMs,
		message: classified.message.slice(0, 100),
	});
}

/**
 * Log free tier usage when rate limit occurs
 * Helps users understand their quota consumption
 */
export function logFreeTierUsage(provider: string): void {
	const usage = getFreeTierUsage(provider);
	const warning = getLimitWarning(provider);

	if (warning) {
		_logger.warn(`Free tier warning: ${warning}`, { provider });
	} else {
		_logger.info(`${provider} usage`, {
			requestsToday: usage.requestsToday,
			limit: usage.limit.description,
		});
	}
}
