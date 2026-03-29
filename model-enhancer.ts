/**
 * Model name enhancement helper
 * Adds Coding Index scores to model names for display in /model
 */

import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import { enhanceModelNameWithCodingIndex } from "./provider-failover/hardcoded-benchmarks.ts";

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
