/**
 * Main provider failover handler
 * Coordinates error detection, autocompact, and provider switching
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { triggerAutocompact } from "./autocompact.js";
import {
	type ClassifiedError,
	classifyError,
	logErrorClassification,
} from "./errors.js";

export interface FailoverConfig {
	// Provider identifier (e.g., "kilo", "openrouter")
	provider: string;

	// Whether this provider is in paid mode
	isPaidMode: boolean;

	// Whether to attempt autocompact on 429 (free mode only)
	enableAutocompact: boolean;
}

export interface FailoverResult {
	action: "retry" | "autocompact" | "failover" | "fail";
	message: string;
	shouldRetry: boolean;
	retryDelayMs?: number;
}

// Track consecutive failures per provider
const failureCounts = new Map<string, number>();
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Handle provider error with smart failover logic
 */
export async function handleProviderError(
	error: unknown,
	config: FailoverConfig,
	pi: ExtensionAPI,
	ctx: {
		ui: {
			notify: (message: string, type: "info" | "warning" | "error") => void;
		};
		session?: { id?: string };
	},
): Promise<FailoverResult> {
	const { provider, isPaidMode, enableAutocompact } = config;

	// Classify the error
	const classified = classifyError(error);
	logErrorClassification(error, classified);

	// Track failures
	const failureKey = `${provider}`;
	const currentFailures = (failureCounts.get(failureKey) ?? 0) + 1;
	failureCounts.set(failureKey, currentFailures);

	// Check for too many consecutive failures
	if (currentFailures >= MAX_CONSECUTIVE_FAILURES) {
		console.log(
			`[failover] ${provider} has ${currentFailures} consecutive failures, suggesting failover`,
		);
	}

	switch (classified.type) {
		case "rate_limit":
			return handleRateLimit(classified, config, pi, ctx);

		case "capacity":
			return handleCapacityError(classified, config);

		case "auth":
			return handleAuthError(classified, provider);

		case "network":
			return handleNetworkError(classified, provider);

		default:
			return handleUnknownError(classified, provider);
	}
}

/**
 * Handle rate limit (429) error
 * Strategy: Compact → Retry same provider → Failover if still failing
 */
async function handleRateLimit(
	classified: ClassifiedError,
	config: FailoverConfig,
	pi: ExtensionAPI,
	ctx: {
		ui: {
			notify: (message: string, type: "info" | "warning" | "error") => void;
		};
		session?: { id?: string };
	},
): Promise<FailoverResult> {
	const { provider, isPaidMode, enableAutocompact } = config;

	console.log(
		`[failover] Rate limit on ${provider} (paid: ${isPaidMode}, autocompact: ${enableAutocompact})`,
	);

	// Check if we've already tried autocompact for this provider recently
	const failureKey = `${provider}_compact_attempted`;
	const compactAlreadyAttempted = failureCounts.get(failureKey) ?? 0;

	// In free mode with autocompact enabled: Try compact first, then retry same provider
	if (!isPaidMode && enableAutocompact && compactAlreadyAttempted === 0) {
		// Mark that we attempted compact
		failureCounts.set(failureKey, 1);

		const compactResult = await triggerAutocompact(
			pi,
			ctx as unknown as {
				ui: { notify: (m: string, t: "info" | "warning" | "error") => void };
				session?: { id?: string };
			},
			`${provider} rate limit - compacting before retry`,
		);

		if (compactResult.success) {
			return {
				action: "autocompact",
				message: `Rate limit on ${provider}. ${compactResult.message} Please send your message again to retry.`,
				shouldRetry: true,
				retryDelayMs: 2000, // Short delay for compact to take effect
			};
		}
	}

	// If compact was already attempted or failed, or we're in paid mode: Failover
	const waitTime = Math.round((classified.retryAfterMs ?? 60000) / 1000);
	return {
		action: "failover",
		message: `Rate limit on ${provider}. Compact+retry failed. Hopping to backup provider or wait ${waitTime}s.`,
		shouldRetry: false,
		retryDelayMs: classified.retryAfterMs,
	};
}

/**
 * Handle capacity error (provider overloaded)
 */
function handleCapacityError(
	classified: ClassifiedError,
	config: FailoverConfig,
): FailoverResult {
	const { provider } = config;

	console.log(`[failover] Capacity error on ${provider}`);

	return {
		action: "failover",
		message: `${provider} is at capacity. Try again in ${Math.round((classified.retryAfterMs ?? 30000) / 1000)}s or switch providers.`,
		shouldRetry: true,
		retryDelayMs: classified.retryAfterMs ?? 30000,
	};
}

/**
 * Handle authentication error
 */
function handleAuthError(
	_classified: ClassifiedError,
	provider: string,
): FailoverResult {
	console.log(`[failover] Auth error on ${provider}`);

	return {
		action: "fail",
		message: `Authentication failed for ${provider}. Check your API key with /login ${provider} or set ${provider.toUpperCase()}_API_KEY.`,
		shouldRetry: false,
	};
}

/**
 * Handle network error
 */
function handleNetworkError(
	classified: ClassifiedError,
	provider: string,
): FailoverResult {
	console.log(`[failover] Network error on ${provider}`);

	return {
		action: "retry",
		message: `Network error connecting to ${provider}. Retrying...`,
		shouldRetry: true,
		retryDelayMs: classified.retryAfterMs ?? 5000,
	};
}

/**
 * Handle unknown/unclassified error
 */
function handleUnknownError(
	classified: ClassifiedError,
	provider: string,
): FailoverResult {
	console.log(`[failover] Unknown error on ${provider}: ${classified.message}`);

	return {
		action: classified.retryable ? "retry" : "fail",
		message: `Error from ${provider}: ${classified.message.slice(0, 100)}`,
		shouldRetry: classified.retryable,
		retryDelayMs: classified.retryAfterMs ?? 10000,
	};
}

/**
 * Reset failure count for a provider (call on successful request)
 */
export function resetFailureCount(provider: string): void {
	failureCounts.delete(provider);
}

/**
 * Get current failure count for a provider
 */
export function getFailureCount(provider: string): number {
	return failureCounts.get(provider) ?? 0;
}

/**
 * Check if provider should be considered exhausted
 */
export function isProviderExhausted(provider: string): boolean {
	return getFailureCount(provider) >= MAX_CONSECUTIVE_FAILURES;
}
