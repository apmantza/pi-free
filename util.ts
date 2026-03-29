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
