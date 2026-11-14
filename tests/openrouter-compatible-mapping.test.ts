/**
 * Shared OpenRouter-compatible mapping over live catalog rows (#675).
 *
 * Only HTTP is stubbed: FastRouter's public /models answers two rows captured
 * live on 2026-11-14 (unchanged apart from the dropped `description` prose),
 * and models.dev answers an empty catalog so the values seen are the mapper's
 * own. The same mapper serves Kilo, FastRouter, AMD Token Lab, the built-in
 * OpenRouter refresh, OrcaRouter and AnyAPI.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Live FastRouter /api/v1/models rows (2026-11-14): whisper-1 publishes every
// price as "", kimi-k2.6 publishes `input_cache_write: ""` and
// `top_provider.max_completion_tokens: 0`.
const CATALOG = [
	{
		id: "openai/whisper-1",
		name: "OpenAI: Whisper-1",
		created: 1672531200,
		architecture: {
			modality: "audio->text",
			input_modalities: ["audio"],
			output_modalities: ["text"],
			tokenizer: "",
		},
		pricing: {
			prompt: "",
			completion: "",
			request: "",
			image: "",
			web_search: "",
			citation: "",
			reasoning: "",
			duration: "",
			internal_reasoning: "",
			input_cache_read: "",
			input_cache_write: "",
			prompt_more_than_128k_input: "",
			completion_more_than_128k_input: "",
			prompt_more_than_200k_input: "",
			completion_more_than_200k_input: "",
			prompt_more_than_272k_input: "",
			completion_more_than_272k_input: "",
			prompt_more_than_512k_input: "",
			completion_more_than_512k_input: "",
			web_search_per_1000_requests_low: "",
			web_search_per_1000_requests_medium: "",
			web_search_per_1000_requests_high: "",
			web_search_per_1000_requests: "",
			audio_output_per_minute: "",
			audio_input: "0.0001",
			audio_output: "",
			cached_audio_input: "",
			batchPrice: {},
			flex_service_tier_pricing: {},
			fast_service_tier_pricing: {},
			ultrafast_service_tier_pricing: {},
			priority_service_tier_pricing: {},
			videoCost: null,
			videoCostWithAudio: null,
			imageCost: null,
			priceToShow: {
				prompt: "",
				completion: "",
				request: "",
				image: "",
				web_search: "",
				citation: "",
				reasoning: "",
				duration: "",
				internal_reasoning: "",
				input_cache_read: "",
				input_cache_write: "",
				prompt_more_than_128k_input: "",
				completion_more_than_128k_input: "",
				prompt_more_than_200k_input: "",
				completion_more_than_200k_input: "",
				prompt_more_than_272k_input: "",
				completion_more_than_272k_input: "",
				prompt_more_than_512k_input: "",
				completion_more_than_512k_input: "",
				web_search_per_1000_requests_low: "",
				web_search_per_1000_requests_medium: "",
				web_search_per_1000_requests_high: "",
				web_search_per_1000_requests: "",
				audio_output_per_minute: "",
				audio_input: "0.0001",
				audio_output: "",
				cached_audio_input: "",
				batchPrice: {},
				flex_service_tier_pricing: {},
				fast_service_tier_pricing: {},
				ultrafast_service_tier_pricing: {},
				priority_service_tier_pricing: {},
				videoCost: null,
				videoCostWithAudio: null,
				imageCost: null,
				priceToShow: null,
			},
		},
		top_provider: {
			context_length: 0,
			max_completion_tokens: 0,
			is_moderated: false,
		},
		supported_parameters: [
			"file",
			"model",
			"language",
			"prompt",
			"response_format",
			"temperature",
			"timestamp_granularities",
			"known_speaker_references",
			"chunking_strategy",
			"known_speaker_names",
		],
		models_extra_params: { category: null, sample_code_snippet: null },
		is_active: true,
		creator: "OpenAI",
		expiry_date: "2027-02-26",
		supported_params_details: {
			chunking_strategy: {},
			file: {},
			known_speaker_names: {},
			known_speaker_references: {},
			language: {},
			model: {},
			prompt: {},
			response_format: {},
			temperature: {},
			timestamp_granularities: {},
		},
	},
	{
		id: "moonshotai/kimi-k2.6",
		name: "MoonshotAI: Kimi K2.6",
		created: 1776699402,
		context_length: 262144,
		architecture: {
			modality: "text+image->text",
			input_modalities: ["text", "image"],
			output_modalities: ["text"],
			tokenizer: "Other",
		},
		pricing: {
			prompt: "0.00000075",
			completion: "0.0000035",
			request: "",
			image: "",
			web_search: "",
			citation: "",
			reasoning: "",
			duration: "",
			internal_reasoning: "",
			input_cache_read: "0.00000015",
			input_cache_write: "",
			prompt_more_than_128k_input: "",
			completion_more_than_128k_input: "",
			prompt_more_than_200k_input: "",
			completion_more_than_200k_input: "",
			prompt_more_than_272k_input: "",
			completion_more_than_272k_input: "",
			prompt_more_than_512k_input: "",
			completion_more_than_512k_input: "",
			web_search_per_1000_requests_low: "",
			web_search_per_1000_requests_medium: "",
			web_search_per_1000_requests_high: "",
			web_search_per_1000_requests: "",
			audio_output_per_minute: "",
			audio_input: "",
			audio_output: "",
			cached_audio_input: "",
			batchPrice: {},
			flex_service_tier_pricing: {},
			fast_service_tier_pricing: {},
			ultrafast_service_tier_pricing: {},
			priority_service_tier_pricing: {},
			videoCost: null,
			videoCostWithAudio: null,
			imageCost: null,
			priceToShow: null,
		},
		top_provider: {
			context_length: 262144,
			max_completion_tokens: 0,
			is_moderated: false,
		},
		supported_parameters: [
			"frequency_penalty",
			"include_reasoning",
			"logit_bias",
			"max_tokens",
			"min_p",
			"presence_penalty",
			"reasoning",
			"reasoning_effort",
			"repetition_penalty",
			"response_format",
			"seed",
			"stop",
			"structured_outputs",
			"temperature",
			"tool_choice",
			"tools",
			"top_k",
			"top_p",
		],
		models_extra_params: { category: null, sample_code_snippet: null },
		is_active: true,
		creator: "MoonshotAI",
		supported_params_details: {
			frequency_penalty: {},
			include_reasoning: {},
			logit_bias: {},
			logprobs: {},
			max_tokens: {},
			min_p: {},
			parallel_tool_calls: {},
			presence_penalty: {},
			reasoning: {},
			reasoning_effort: {},
			repetition_penalty: {},
			response_format: {},
			seed: {},
			stop: {},
			structured_outputs: {},
			temperature: {},
			tool_choice: {},
			tools: {},
			top_k: {},
			top_logprobs: {},
			top_p: {},
		},
	},
];

let home: string;

beforeEach(() => {
	mkdirSync(resolve(".smoke-artifacts"), { recursive: true });
	home = mkdtempSync(resolve(".smoke-artifacts", "or-compat-"));
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", resolve(home, ".pi/agent"));
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			if (url.hostname === "models.dev") return Response.json({});
			if (url.hostname === "api.fastrouter.ai")
				return Response.json({ data: CATALOG });
			return new Response(null, { status: 503 });
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	rmSync(home, { recursive: true, force: true });
});

async function fetchCatalog() {
	const { fetchOpenRouterCompatibleModels } =
		await import("../providers/model-fetcher.ts");
	const models = await fetchOpenRouterCompatibleModels({
		providerId: "fastrouter",
		baseUrl: "https://api.fastrouter.ai/api/v1",
	});
	return new Map(
		models.map((m) => [
			m.id,
			m as typeof m & { _pricingKnown?: boolean; _freeKnown?: boolean },
		]),
	);
}

// `Number.parseFloat("")` is NaN: pre-fix 162 of FastRouter's 197 published
// models carried a NaN cache price, which Pi multiplies into usage cost.
it("never publishes a NaN price", async () => {
	for (const model of (await fetchCatalog()).values()) {
		for (const [field, value] of Object.entries(model.cost)) {
			expect(Number.isFinite(value), `${model.id} ${field}`).toBe(true);
		}
	}
});

// An empty or missing token price is unknown, never a known $0 (defect shape
// 15). Pre-fix whisper-1 was stamped `_pricingKnown: true` with NaN costs; it
// stayed out of the free view only because NaN !== 0.
it("stamps empty token prices as unknown pricing", async () => {
	const { isFreeModel } = await import("../lib/registry.ts");
	const catalog = await fetchCatalog();
	const all = [...catalog.values()];
	const whisper = catalog.get("openai/whisper-1")!;
	expect(whisper._pricingKnown).toBe(false);
	expect(whisper.cost).toMatchObject({ input: 0, output: 0 });
	expect(isFreeModel(whisper, all)).toBe(false);
	const kimi = catalog.get("moonshotai/kimi-k2.6")!;
	expect(kimi._pricingKnown).toBe(true);
	expect(kimi.cost).toMatchObject({
		input: 0.00000075,
		output: 0.0000035,
		cacheRead: 0.00000015,
		cacheWrite: 0,
	});
	expect(isFreeModel(kimi, all)).toBe(false);
});

// A published 0 limit means "not published": keeping it gave Pi a 0-token
// output cap (kimi-k2.6) and a 0-token window (whisper-1), and the models.dev
// enrichment only replaces the 4096 fallback, never a 0.
it("treats zero limits as absent", async () => {
	const catalog = await fetchCatalog();
	expect(catalog.get("moonshotai/kimi-k2.6")).toMatchObject({
		contextWindow: 262144,
		maxTokens: 4096,
	});
	expect(catalog.get("openai/whisper-1")).toMatchObject({
		contextWindow: 4096,
		maxTokens: 4096,
	});
});
