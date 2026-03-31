/**
 * Kilo model fetching and mapping (OpenRouter-compatible format).
 */

import { applyHidden } from "../config.ts";
import { fetchOpenRouterCompatibleModels } from "./model-fetcher.ts";

const KILO_API_BASE = process.env.KILO_API_URL || "https://api.kilo.ai";
export const KILO_GATEWAY_BASE = `${KILO_API_BASE}/api/gateway`;

// =============================================================================
// Fetch
// =============================================================================

export async function fetchKiloModels(options?: {
	token?: string;
	freeOnly?: boolean;
}): Promise<ReturnType<typeof fetchOpenRouterCompatibleModels>> {
	const models = await fetchOpenRouterCompatibleModels({
		baseUrl: KILO_GATEWAY_BASE,
		apiKey: options?.token,
		freeOnly: options?.freeOnly,
	});

	return applyHidden(models);
}
