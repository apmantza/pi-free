/**
 * Cline model fetching.
 *
 * Fetches Cline's own model catalog from api.cline.bot instead of OpenRouter.
 * Cline also exposes a recommended/free-to-try list; those models may have
 * non-zero list pricing in the catalog, so we mark exact recommended-free IDs
 * as zero-cost for pi-free's free-model filter.
 */

import { applyHidden } from "../../config.ts";
import {
	BASE_URL_CLINE,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_CLINE,
} from "../../constants.ts";
import type { ProviderModelConfig } from "../../lib/types.ts";
import { cleanModelName, fetchWithRetry } from "../../lib/util.ts";

interface ClineRaw {
	id: string;
	name?: string;
	description?: string | null;
	context_length?: number | null;
	supported_parameters?: string[] | null;
	architecture?: {
		modality?: string | string[] | null;
		input_modalities?: string[] | null;
		output_modalities?: string[] | null;
	} | null;
	top_provider?: {
		max_completion_tokens?: number | null;
		context_length?: number | null;
	} | null;
	pricing?: {
		prompt?: string | null;
		completion?: string | null;
		input_cache_read?: string | null;
		input_cache_write?: string | null;
	} | null;
}

interface ClineRecommendedModel {
	id: string;
	name?: string;
	description?: string;
	tags?: string[];
}

interface ClineRecommendedModelsResponse {
	recommended?: ClineRecommendedModel[];
	free?: ClineRecommendedModel[];
}

const VS_CODE_VERSION = "1.109.3";
const CLINE_EXTENSION_VERSION = "3.76.0";

function buildClineFetchHeaders(): Record<string, string> {
	return {
		Accept: "application/json",
		"Content-Type": "application/json",
		"User-Agent": `Cline/${CLINE_EXTENSION_VERSION}`,
		"X-PLATFORM": "Visual Studio Code",
		"X-PLATFORM-VERSION": VS_CODE_VERSION,
		"X-CLIENT-TYPE": "VSCode Extension",
		"X-CLIENT-VERSION": CLINE_EXTENSION_VERSION,
		"X-CORE-VERSION": CLINE_EXTENSION_VERSION,
	};
}

function extractNameFromId(id: string): string {
	const part = id.split("/")[1] ?? id;
	return part
		.split(/[-_]/)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}

/**
 * Parse pricing string to cost per million tokens.
 * Cline returns pricing as string per token (e.g. "0.0001" or "0").
 */
function parsePricing(pricingStr: string | null | undefined): number {
	if (!pricingStr || pricingStr === "0") return 0;
	const parsed = Number.parseFloat(pricingStr);
	return Number.isNaN(parsed) ? 0 : parsed * 1_000_000;
}

function modalityIncludes(
	modality: string | string[] | null | undefined,
	needle: string,
): boolean {
	if (Array.isArray(modality)) return modality.includes(needle);
	return typeof modality === "string" && modality.includes(needle);
}

function hasTextOutput(info: ClineRaw): boolean {
	const outputMods = info.architecture?.output_modalities;
	if (Array.isArray(outputMods) && outputMods.length > 0) {
		return outputMods.includes("text");
	}
	return modalityIncludes(info.architecture?.modality, "text");
}

function supportsImages(info: ClineRaw): boolean {
	const inputMods = info.architecture?.input_modalities;
	if (Array.isArray(inputMods) && inputMods.includes("image")) return true;
	return modalityIncludes(info.architecture?.modality, "image");
}

function modelFromRecommended(
	model: ClineRecommendedModel,
): ProviderModelConfig & { _pricingKnown?: boolean } {
	const name = model.name?.trim() || extractNameFromId(model.id);
	return {
		id: model.id,
		name: `${cleanModelName(name)} (Cline)`,
		reasoning: false,
		input: ["text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: 1_000_000,
		maxTokens: 65_536,
		_pricingKnown: true,
	};
}

function modelFromCatalog(
	info: ClineRaw,
	freeToTryIds: ReadonlySet<string>,
): ProviderModelConfig & { _pricingKnown?: boolean } {
	const isReasoning = !!(
		info.supported_parameters?.includes("include_reasoning") ||
		info.supported_parameters?.includes("reasoning")
	);
	const isFreeToTry = freeToTryIds.has(info.id);
	const inputCost = isFreeToTry ? 0 : parsePricing(info.pricing?.prompt);
	const outputCost = isFreeToTry ? 0 : parsePricing(info.pricing?.completion);
	const cacheRead = isFreeToTry
		? 0
		: parsePricing(info.pricing?.input_cache_read);
	const cacheWrite = isFreeToTry
		? 0
		: parsePricing(info.pricing?.input_cache_write);
	const isFree = inputCost === 0 && outputCost === 0;
	const cleanName = info.name
		? cleanModelName(info.name)
		: extractNameFromId(info.id);

	return {
		id: info.id,
		name: `${cleanName} (Cline)${isFree ? "" : " 💰"}`,
		reasoning: isReasoning,
		input: supportsImages(info) ? ["text", "image"] : ["text"],
		cost: {
			input: inputCost,
			output: outputCost,
			cacheRead,
			cacheWrite,
		},
		contextWindow:
			info.context_length ?? info.top_provider?.context_length ?? 128_000,
		maxTokens: info.top_provider?.max_completion_tokens ?? 8_192,
		_pricingKnown: info.pricing !== null && info.pricing !== undefined,
	};
}

async function fetchClineRecommendedFreeModels(): Promise<
	ClineRecommendedModel[]
> {
	const response = await fetchWithRetry(
		`${BASE_URL_CLINE}/ai/cline/recommended-models`,
		{ headers: buildClineFetchHeaders() },
		3,
		1000,
		DEFAULT_FETCH_TIMEOUT_MS,
	);

	if (!response.ok) return [];

	const json = (await response.json()) as ClineRecommendedModelsResponse;
	return Array.isArray(json.free) ? json.free.filter((m) => m?.id) : [];
}

async function fetchClineCatalogModels(): Promise<ClineRaw[]> {
	const response = await fetchWithRetry(
		`${BASE_URL_CLINE}/ai/cline/models`,
		{ headers: buildClineFetchHeaders() },
		3,
		1000,
		DEFAULT_FETCH_TIMEOUT_MS,
	);

	if (!response.ok)
		throw new Error(`Failed to fetch Cline models: ${response.status}`);

	const json = (await response.json()) as { data?: ClineRaw[] };
	if (!Array.isArray(json.data)) {
		throw new Error("Invalid Cline models response: missing data array");
	}
	return json.data;
}

/**
 * Fetch models from Cline.
 * @param freeOnly - If true, return only zero-cost/free-to-try models
 */
export async function fetchClineModels(
	freeOnly = false,
): Promise<ProviderModelConfig[]> {
	const [catalogModels, recommendedFreeModels] = await Promise.all([
		fetchClineCatalogModels(),
		fetchClineRecommendedFreeModels().catch(() => []),
	]);
	const recommendedFreeIds = new Set(recommendedFreeModels.map((m) => m.id));

	const models: Array<ProviderModelConfig & { _pricingKnown?: boolean }> = [];
	const seen = new Set<string>();

	for (const info of catalogModels) {
		if (!hasTextOutput(info)) continue;
		const model = modelFromCatalog(info, recommendedFreeIds);
		models.push(model);
		seen.add(model.id);
	}

	// The recommended/free-to-try endpoint can lead the full catalog. Include
	// those exact IDs so newly promoted models (e.g. alibaba/qwen3.7-plus) show up.
	for (const model of recommendedFreeModels) {
		if (seen.has(model.id)) continue;
		models.push(modelFromRecommended(model));
		seen.add(model.id);
	}

	const filtered = freeOnly
		? models.filter((m) => m.cost.input === 0 && m.cost.output === 0)
		: models;

	return applyHidden(filtered, PROVIDER_CLINE);
}

/**
 * Fetch only free models (backward compatibility).
 */
export async function fetchClineFreeModels(): Promise<ProviderModelConfig[]> {
	return fetchClineModels(true);
}
