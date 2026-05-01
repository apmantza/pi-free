/**
 * Global Provider Registry for pi-free.
 *
 * Decoupled from index.ts so providers can import toggle logic
 * without creating a circular dependency.
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { getFreeOnly, saveConfig } from "../config.ts";
import { createLogger } from "./logger.ts";

const _logger = createLogger("pi-free");

// =============================================================================
// Types
// =============================================================================

interface ProviderEntry {
	id: string;
	stored: { free: ProviderModelConfig[]; all: ProviderModelConfig[] };
	reRegister: (models: ProviderModelConfig[]) => void;
	hasKey: boolean;
}

// =============================================================================
// State
// =============================================================================

const providerRegistry = new Map<string, ProviderEntry>();
let globalFreeOnly = getFreeOnly();

// =============================================================================
// Free-model detection
// =============================================================================

/**
 * Detect if a provider exposes actual per-model pricing.
 *
 * Heuristic: If ALL models have cost === 0, the provider likely doesn't expose
 * real pricing (cost was defaulted to 0). If SOME models have cost > 0, the
 * provider definitely exposes pricing.
 *
 * @param allModels - All models from the provider to check
 * @returns true if pricing appears to be exposed (some costs > 0)
 */
function detectPricingExposed(allModels: ProviderModelConfig[]): boolean {
	if (allModels.length === 0) return false;

	// If ANY model has cost > 0, pricing is definitely exposed
	return allModels.some(
		(m) => (m.cost?.input ?? 0) > 0 || (m.cost?.output ?? 0) > 0,
	);
}

/**
 * Check if a model is free using adaptive Route A/B logic.
 *
 * **Automatic Detection:**
 * The function detects whether the provider exposes pricing by checking if
 * ALL models have cost === 0. If so, it assumes no pricing is exposed and
 * falls back to name-based detection.
 *
 * **Route A (Pricing-Exposed Providers):** Uses ONLY cost-based detection.
 *   - Detected when SOME models have cost > 0
 *   - Free = cost.input === 0 && cost.output === 0
 *   - No fallback to name-based detection
 *
 * **Route B (Non-Pricing-Exposed Providers):** Uses ONLY name-based detection.
 *   - Detected when ALL models have cost === 0 (or no models)
 *   - Free = model name contains "free" (case-insensitive)
 *   - No cost-based detection (avoids marking freemium as free)
 *
 * This automatic detection handles providers without hardcoding - if a provider
 * shows all models as zero cost, we assume pricing isn't exposed and check
 * model names instead.
 *
 * @param model - The model config to check
 * @param allModels - Optional: all models from the same provider for detection
 * @returns true if the model is definitively free per the provider's API
 */
export function isFreeModel(
	model: ProviderModelConfig & { provider?: string },
	allModels?: ProviderModelConfig[],
): boolean {
	return isFreeModelInternal(model, allModels);
}

// Internal implementation to work around TypeScript filter callback issues
function isFreeModelInternal(
	model: ProviderModelConfig & { provider?: string },
	allModels: ProviderModelConfig[] | undefined,
): boolean {
	// Determine if pricing is exposed
	let pricingExposed: boolean;

	if (allModels && allModels.length > 0) {
		// Dynamic detection: check if ALL models have cost === 0
		// If all costs are 0, assume pricing is NOT actually exposed
		pricingExposed = detectPricingExposed(allModels);
	} else {
		// No allModels provided - default to cost-based detection
		// This maintains backward compatibility
		pricingExposed = true;
	}

	// Route A: Pricing-exposed providers - use OR logic
	// Model is free if EITHER cost is zero OR name contains "free"
	if (pricingExposed) {
		const isZeroCost =
			(model.cost?.input ?? 0) === 0 && (model.cost?.output ?? 0) === 0;
		const hasFreeInName = model.name.toLowerCase().includes("free");
		return isZeroCost || hasFreeInName;
	}

	// Route B: Non-pricing-exposed providers - use ONLY name-based detection
	// This handles providers where all costs are defaulted to 0
	return model.name.toLowerCase().includes("free");
}

// =============================================================================
// Registration
// =============================================================================

/** Register a provider with the global free/paid toggle system */
export function registerWithGlobalToggle(
	providerId: string,
	stored: { free: ProviderModelConfig[]; all: ProviderModelConfig[] },
	reRegister: (models: ProviderModelConfig[]) => void,
	hasKey: boolean = false,
): void {
	providerRegistry.set(providerId, {
		id: providerId,
		stored,
		reRegister,
		hasKey,
	});
	_logger.info(
		`[pi-free] Registered ${providerId} with global toggle (${stored.free.length} free, ${stored.all.length} total)`,
	);
}

/** Get current global free-only state */
export function getGlobalFreeOnly(): boolean {
	return globalFreeOnly;
}

/** Access the raw registry (used by /free-providers command) */
export function getProviderRegistry(): ReadonlyMap<string, ProviderEntry> {
	return providerRegistry;
}

// =============================================================================
// Global filter application
// =============================================================================

export function applyGlobalFilter(_pi: ExtensionAPI, freeOnly: boolean): void {
	globalFreeOnly = freeOnly;
	saveConfig({ free_only: freeOnly });

	for (const [providerId, entry] of providerRegistry) {
		try {
			if (freeOnly) {
				// Show only free models
				if (entry.stored.free.length > 0) {
					entry.reRegister(entry.stored.free);
					_logger.info(
						`[pi-free] ${providerId}: filtered to ${entry.stored.free.length} free models`,
					);
				} else {
					_logger.warn(`[pi-free] ${providerId}: no free models available`);
				}
			} else {
				// Show all models (paid + free)
				const allModels =
					entry.stored.all.length > 0 ? entry.stored.all : entry.stored.free;
				if (allModels.length > 0) {
					entry.reRegister(allModels);
					_logger.info(
						`[pi-free] ${providerId}: showing all ${allModels.length} models`,
					);
				}
			}
		} catch (err) {
			_logger.error(
				`[pi-free] Failed to apply filter to ${providerId}`,
				err instanceof Error ? { error: err.message } : { error: String(err) },
			);
		}
	}
}
