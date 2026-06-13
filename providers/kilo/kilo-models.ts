/**
 * Kilo model fetching and mapping (OpenRouter-compatible format).
 */

import { applyHidden } from "../../config.ts";
import { PROVIDER_KILO } from "../../constants.ts";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { fetchOpenRouterCompatibleModels } from "../model-fetcher.ts";

const KILO_API_BASE = process.env.KILO_API_URL || "https://api.kilo.ai";
export const KILO_GATEWAY_BASE = `${KILO_API_BASE}/api/gateway`;

// =============================================================================
// Fetch
// =============================================================================

export async function fetchKiloModels(options?: {
	token?: string;
	freeOnly?: boolean;
}): Promise<ProviderModelConfig[]> {
	const models = await fetchOpenRouterCompatibleModels({
		baseUrl: KILO_GATEWAY_BASE,
		apiKey: options?.token,
		freeOnly: options?.freeOnly,
	});

	return applyHidden(models, PROVIDER_KILO);
}
