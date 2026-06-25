/**
 * Qoder model definitions and cache management.
 *
 * Qoder provides a static set of models (all at zero cost) with the option
 * to dynamically discover more from the `/algo/api/v2/model/list` endpoint.
 * The dynamic list is cached at `~/.pi/agent/qoder-models-cache.json` with
 * a 1-hour TTL and falls back to the static models on cache miss or API error.
 *
 * ALL Qoder models are free — no pricing data needed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { buildAuthHeaders } from "./cosy.ts";

// ─── Cache ───────────────────────────────────────────────────────────────────

const CACHE_PATH = join(homedir(), ".pi", "agent", "qoder-models-cache.json");

const ZERO_COST = Object.freeze({
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
});

// ─── Static model list ───────────────────────────────────────────────────────

/**
 * Static model definitions for Qoder.
 * All models are free (zero cost) — no paid tier exists.
 * These serve as the fallback when the dynamic API is unreachable.
 */
export const staticModels: ProviderModelConfig[] = [
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
		id: "qmodel_latest",
		name: "Qwen3.7 Max (Qoder)",
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
		id: "dfmodel",
		name: "DeepSeek V4 Flash (Qoder)",
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		cost: ZERO_COST,
		contextWindow: 1_000_000,
		maxTokens: 32_768,
	},
	{
		id: "gm51model",
		name: "GLM 5.1 (Qoder)",
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		cost: ZERO_COST,
		contextWindow: 180_000,
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

// ─── Dynamic model API ───────────────────────────────────────────────────────

interface QoderModelEntry {
	key?: string;
	enable?: boolean;
	display_name?: string;
	max_input_tokens?: number;
	max_output_tokens?: number;
	context_config?: Record<string, { token_count?: number }>;
	is_vl?: boolean;
	is_reasoning?: boolean;
	thinking_config?: { enabled?: { efforts?: unknown } };
	source?: string;
	[key: string]: unknown;
}

// ─── Cache management ────────────────────────────────────────────────────────

function modelEntryToConfig(
	entry: QoderModelEntry,
): ProviderModelConfig | null {
	const key = entry.key;
	if (!key || !entry.enable) return null;

	const display = entry.display_name || key;
	const ctxLen = resolveContextLength(entry);
	const isVL = Boolean(entry.is_vl);
	const isReasoning = Boolean(entry.is_reasoning) || Boolean(entry.thinking_config);
	const input: ("text" | "image")[] = isVL ? ["text", "image"] : ["text"];

	return {
		id: key,
		name: display,
		reasoning: isReasoning,
		input,
		cost: ZERO_COST,
		contextWindow: ctxLen,
		maxTokens: entry.max_output_tokens || 32_768,
	};
}

function resolveContextLength(entry: QoderModelEntry): number {
	let ctxLen = entry.max_input_tokens || 180_000;
	if (entry.context_config && typeof entry.context_config === "object") {
		for (const val of Object.values(entry.context_config)) {
			if (
				val &&
				typeof val === "object" &&
				typeof (val as Record<string, unknown>).token_count === "number"
			) {
				const tc = (val as Record<string, number>).token_count;
				if (tc > ctxLen) ctxLen = tc;
			}
		}
	}
	return ctxLen;
}

/** Get models from cache, falling back to static models. */
export function getCachedModels(): ProviderModelConfig[] {
	if (existsSync(CACHE_PATH)) {
		try {
			const data = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
			if (data && Array.isArray(data.models)) {
				return data.models as ProviderModelConfig[];
			}
		} catch {
			// Fall through to static
		}
	}
	return staticModels;
}

/** Check if the local model cache is stale (>1 hour old). */
export function isCacheStale(): boolean {
	if (!existsSync(CACHE_PATH)) return true;
	try {
		const data = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
		if (!data || typeof data.updatedAt !== "number") return true;
		return Date.now() - data.updatedAt > 3_600_000; // 1 hour
	} catch {
		return true;
	}
}

/**
 * Fetch available models from Qoder's dynamic model list API and cache them.
 * Falls back silently if the API is unreachable.
 */
export async function updateQoderModelsCache(
	authToken: string,
	userID: string,
	name: string,
	email: string,
): Promise<void> {
	const modelListURL = "https://api3.qoder.sh/algo/api/v2/model/list";
	try {
		const headers = buildAuthHeaders(null, modelListURL, {
			userID,
			authToken,
			name,
			email,
		});

		const response = await fetch(modelListURL, {
			method: "GET",
			headers: {
				Accept: "application/json",
				...headers,
			},
		});

		if (!response.ok) return;

		const resData = (await response.json()) as {
			chat?: QoderModelEntry[];
		};
		const chatModels = resData.chat || [];
		if (chatModels.length === 0) return;

		const newModels: ProviderModelConfig[] = [];
		const configs: Record<string, QoderModelEntry> = {};

		for (const entry of chatModels) {
			const model = modelEntryToConfig(entry);
			if (!model) continue;
			configs[model.id] = entry;
			newModels.push(model);
		}

		if (newModels.length === 0) return;

		// Ensure the auto router model is present
		if (!newModels.some((m) => m.id === "auto")) {
			newModels.unshift({
				id: "auto",
				name: "Qoder Auto",
				reasoning: true,
				input: ["text", "image"] as ("text" | "image")[],
				cost: ZERO_COST,
				contextWindow: 180_000,
				maxTokens: 32_768,
			});
		}

		const cacheData = {
			updatedAt: Date.now(),
			models: newModels,
			configs,
		};

		mkdirSync(dirname(CACHE_PATH), { recursive: true });
		writeFileSync(CACHE_PATH, JSON.stringify(cacheData, null, 2), "utf-8");
	} catch {
		// Best-effort
	}
}

/**
 * Get the cached model config for a specific model key.
 * Used to determine per-model settings (reasoning, max tokens, etc.) at stream time.
 */
export function getCachedModelConfig(modelKey: string): QoderModelEntry | null {
	if (existsSync(CACHE_PATH)) {
		try {
			const data = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
			if (data?.configs?.[modelKey]) {
				return data.configs[modelKey] as QoderModelEntry;
			}
		} catch {
			// Fall through
		}
	}
	return null;
}
