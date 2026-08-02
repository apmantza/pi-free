/**
 * Qoder model definitions and cache management.
 *
 * Qoder operates on a credits-based pricing model:
 *   - Community Edition (free): basic models with daily message limits
 *   - Pro / Pro+ / Ultra (paid): premium models via monthly credits
 *
 * The dynamic model list API is currently unavailable (legacy api3 endpoint
 * is decommissioned). We keep a static curated list and classify models as
 * basic (free tier) or premium (paid credits) by model ID.
 *
 * Dynamic model discovery is disabled until Qoder publishes a model-list
 * endpoint on api2-v2. Static models in `staticModels` remain the source of
 * truth; Pi's native models store owns the persisted catalog.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { createLogger } from "../../lib/logger.ts";

const _logger = createLogger("qoder");

export type QoderModelConfig = ProviderModelConfig;

// ─── Cache ───────────────────────────────────────────────────────────────────

const CACHE_PATH = join(homedir(), ".pi", "agent", "qoder-models-cache.json");

const ZERO_COST = Object.freeze({
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
});

// ─── Basic (free-tier) model IDs ─────────────────────────────────────────────
// These are the Qoder-branded router models available on Community Edition.
// Named models (DeepSeek, Qwen, GLM, Kimi, MiniMax) are premium and cost credits.
// This set is the single source of truth for basic-model classification.
const BASIC_MODEL_IDS = new Set([
	"auto",
	"ultimate",
	"performance",
	"efficient",
	"lite",
]);

// ─── Static model list ───────────────────────────────────────────────────────

/**
 * Static model definitions for Qoder.
 * Basic models (free tier) are identified by membership in BASIC_MODEL_IDS.
 * Premium models consume credits and require a paid plan.
 *
 * Model IDs are validated against the live api2-v2 endpoint; invalid IDs
 * (dfmodel, gm51model, qmodel_latest) are excluded here.
 */
export const staticModels: QoderModelConfig[] = [
	{
		id: "auto",
		name: "Qoder Auto",
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		cost: ZERO_COST,
		contextWindow: 180_000,
		maxTokens: 32_768,
	},
	{
		id: "ultimate",
		name: "Qoder Ultimate",
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		cost: ZERO_COST,
		contextWindow: 1_000_000,
		maxTokens: 32_768,
	},
	{
		id: "performance",
		name: "Qoder Performance",
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		cost: ZERO_COST,
		contextWindow: 1_000_000,
		maxTokens: 32_768,
	},
	{
		id: "efficient",
		name: "Qoder Efficient",
		reasoning: false,
		input: ["text", "image"] as ("text" | "image")[],
		cost: ZERO_COST,
		contextWindow: 180_000,
		maxTokens: 32_768,
	},
	{
		id: "lite",
		name: "Qoder Lite",
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: ZERO_COST,
		contextWindow: 180_000,
		maxTokens: 32_768,
	},
	{
		id: "qmodel",
		name: "Qwen3.7 Plus (Qoder)",
		reasoning: false,
		input: ["text", "image"] as ("text" | "image")[],
		cost: ZERO_COST,
		contextWindow: 1_000_000,
		maxTokens: 32_768,
	},
	{
		id: "dmodel",
		name: "DeepSeek V4 Pro (Qoder)",
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		cost: ZERO_COST,
		contextWindow: 1_000_000,
		maxTokens: 32_768,
	},
	{
		id: "kmodel",
		name: "Kimi K2.6 (Qoder)",
		reasoning: false,
		input: ["text", "image"] as ("text" | "image")[],
		cost: ZERO_COST,
		contextWindow: 256_000,
		maxTokens: 32_768,
	},
	{
		id: "mmodel",
		name: "MiniMax M3 (Qoder)",
		reasoning: false,
		input: ["text", "image"] as ("text" | "image")[],
		cost: ZERO_COST,
		contextWindow: 1_000_000,
		maxTokens: 32_768,
	},
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Check if a model is a basic (free-tier) model. */
export function isBasicModel(model: ProviderModelConfig): boolean {
	return BASIC_MODEL_IDS.has(model.id);
}

// ─── Stream metadata cache ───────────────────────────────────────────────────

/**
 * The legacy cache is consulted only for optional stream metadata. It is not a
 * model catalog or freshness source; catalogs are restored/persisted by Pi.
 */
function isCacheStale(): boolean {
	if (!existsSync(CACHE_PATH)) return true;
	try {
		const data = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
		if (!data || typeof data.updatedAt !== "number") return true;
		return Date.now() - data.updatedAt > 3_600_000; // 1 hour
	} catch (err) {
		_logger.warn("Failed to check Qoder cache staleness; treating as stale", {
			error: err instanceof Error ? err.message : String(err),
		});
		return true;
	}
}

/**
 * Get the cached model config for a specific model key.
 * Used to determine per-model settings (reasoning, max tokens, etc.) at stream time.
 */
export function getCachedModelConfig(
	modelKey: string,
): Record<string, unknown> | null {
	if (existsSync(CACHE_PATH) && !isCacheStale()) {
		try {
			const data = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
			if (data?.configs?.[modelKey]) {
				return data.configs[modelKey] as Record<string, unknown>;
			}
		} catch (err) {
			_logger.warn("Failed to read Qoder model config cache", {
				modelKey,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
	return null;
}
