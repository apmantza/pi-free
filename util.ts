// =============================================================================
// Shared Utilities
// =============================================================================

/**
 * Log a warning message for provider operations
 */
export function logWarning(
	provider: string,
	message: string,
	error?: unknown,
): void {
	console.warn(`[${provider}] ${message}`, error ?? "");
}

/**
 * Fetch with retry logic
 */
export async function fetchWithRetry(
	url: string,
	options: RequestInit,
	retries = 3,
	delayMs = 1000,
): Promise<Response> {
	let lastError: unknown;

	for (let i = 0; i < retries; i++) {
		try {
			const response = await fetch(url, options);
			if (response.ok) return response;

			// If it's a rate limit, throw immediately
			if (response.status === 429) {
				throw new Error(`Rate limited (429)`);
			}

			// For server errors, retry
			if (response.status >= 500) {
				lastError = new Error(`Server error ${response.status}`);
				if (i < retries - 1) {
					await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
					continue;
				}
			}

			return response; // Return non-ok but non-retryable responses
		} catch (error) {
			lastError = error;
			if (i < retries - 1) {
				await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
			}
		}
	}

	throw lastError;
}

// =============================================================================
// Shared API Response Parsing
// =============================================================================

/**
 * Parse and validate model list API response
 * Shared between Kilo, OpenRouter, and other providers
 */
export async function parseModelResponse<T>(
	response: Response,
	providerName: string,
): Promise<{ data: T[] }> {
	if (!response.ok) {
		throw new Error(
			`Failed to fetch ${providerName} models: ${response.status} ${response.statusText}`,
		);
	}

	const json = (await response.json()) as { data?: T[] };

	if (!json.data || !Array.isArray(json.data)) {
		throw new Error(
			`Invalid ${providerName} models response: missing data array`,
		);
	}

	return { data: json.data };
}

// =============================================================================
// Model Filtering Utilities
// =============================================================================

/**
 * Check if model is usable based on size constraints and naming
 * Used by NVIDIA provider to filter out test/debug models
 */
export function isUsableModel(modelId: string, _minSizeGB?: number): boolean {
	// Filter out models that are likely test or debug models
	if (modelId.includes("test") || modelId.includes("debug")) {
		return false;
	}
	return true;
}
