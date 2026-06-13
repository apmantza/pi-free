/**
 * Model name enhancement helper
 * Adds Coding Index scores to model names for display in /model
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { enhanceModelNameWithCodingIndex } from "../provider-failover/benchmark-lookup.ts";

interface ModelsDevEnrichedMetadata {
	modelsDev?: Parameters<typeof enhanceModelNameWithCodingIndex>[3];
}

/**
 * Enhance model names with Coding Index scores
 * Use this before registering providers to show CI in /model list
 */
export function enhanceModelsWithCodingIndex(
	models: Array<ProviderModelConfig & ModelsDevEnrichedMetadata>,
): ProviderModelConfig[] {
	return models.map((m) => ({
		...m,
		name: enhanceModelNameWithCodingIndex(
			m.name,
			m.id,
			undefined,
			m.modelsDev,
		),
	}));
}
