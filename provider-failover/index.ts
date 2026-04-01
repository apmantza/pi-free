/**
 * Main provider failover handler
 * Coordinates error detection and provider switching
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createLogger } from "../lib/logger.ts";
import {
	type ClassifiedError,
	classifyError,
	logErrorClassification,
} from "./errors.js";

const _logger = createLogger("failover");

export interface FailoverConfig {
	// Provider identifier (e.g., "kilo", "openrouter")
	provider: string;

	// Whether this provider is in paid mode
	isPaidMode: boolean;
}

export interface FailoverResult {
	action: "retry" | "fail";
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
	_pi: ExtensionAPI,
	ctx: {
		ui: {
			notify: (message: string, type: "info" | "warning" | "error") => void;
		};
		session?: { id?: string };
	},
): Promise<FailoverResult> {
	const { provider, isPaidMode } = config;

	// Classify the error
	const classified = classifyError(error);
	logErrorClassification(error, classified);

	// Track failures
	const failureKey = `${provider}`;
	const currentFailures = (failureCounts.get(failureKey) ?? 0) + 1;
	failureCounts.set(failureKey, currentFailures);

	// Check for too many consecutive failures
	if (currentFailures >= MAX_CONSECUTIVE_FAILURES) {
		_logger.info(`${provider} has ${currentFailures} consecutive failures`);
	}

	switch (classified.type) {
		case "rate_limit":
			return handleRateLimit(classified, provider, isPaidMode, ctx);

		case "capacity":
			return handleCapacityError(classified, provider);

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
 */
function handleRateLimit(
	classified: ClassifiedError,
	provider: string,
	isPaidMode: boolean,
	_ctx: {
		ui: {
			notify: (message: string, type: "info" | "warning" | "error") => void;
		};
	},
): FailoverResult {
	_logger.info(`Rate limit on ${provider}`, { isPaidMode });

	const waitTime = Math.round((classified.retryAfterMs ?? 60000) / 1000);

	return {
		action: "fail",
		message: `Rate limit on ${provider}. Wait ${waitTime}s or switch providers manually with /model.`,
		shouldRetry: false,
		retryDelayMs: classified.retryAfterMs,
	};
}

/**
 * Handle capacity error (provider overloaded)
 */
function handleCapacityError(
	classified: ClassifiedError,
	provider: string,
): FailoverResult {
	_logger.info(`Capacity error on ${provider}`);

	return {
		action: "retry",
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
	_logger.info(`Auth error on ${provider}`);

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
	_logger.info(`Network error on ${provider}`);

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
	_logger.info(`Unknown error on ${provider}`, { message: classified.message });

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
