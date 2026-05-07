/**
 * Model name enhancement helper
 * Adds Coding Index scores to model names for display in /model
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { enhanceModelNameWithCodingIndex } from "../provider-failover/benchmark-lookup.ts";

/**
 * Enhance model names with Coding Index scores
 * Use this before registering providers to show CI in /model list
 */
export function enhanceModelsWithCodingIndex(
	models: ProviderModelConfig[],
): ProviderModelConfig[] {
	return models.map((m) => ({
		...m,
		name: enhanceModelNameWithCodingIndex(m.name, m.id),
	}));
}
