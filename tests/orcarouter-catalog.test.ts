/**
 * OrcaRouter catalog through the real native refresh (#675).
 *
 * Only HTTP is stubbed: OrcaRouter's /v1/models answers rows captured live on
 * 2026-11-14 (unchanged apart from the dropped `description` prose), and
 * models.dev answers an empty catalog so the limits seen are the mapper's own.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Live /v1/models rows (2026-11-14).
const CATALOG = [
	{
		id: "openai/gpt-5.5",
		object: "model",
		created: 1626777600,
		owned_by: "OpenAI",
		supported_endpoint_types: ["openai", "openai-response"],
		endpoint_capabilities: ["chat_completions", "openai_responses"],
		name: "OpenAI: GPT-5.5",
		max_completion_tokens: 128000,
		architecture: {
			input_modalities: ["file", "image", "text"],
			output_modalities: null,
		},
		top_provider: { context_length: 0, max_completion_tokens: 128000 },
		pricing: {
			prompt: "0.0000050000",
			completion: "0.0000300000",
			prompt_per_million: "5.000000",
			completion_per_million: "30.000000",
			input_cache_read: "0.0000005000",
			tiers: [
				{
					max_input_tokens: 272000,
					prompt: "0.0000050000",
					completion: "0.0000300000",
					input_cache_read: "0.0000005000",
				},
				{
					max_input_tokens: 0,
					prompt: "0.0000100000",
					completion: "0.0000450000",
					input_cache_read: "0.0000010000",
				},
			],
		},
		supported_parameters: [
			"include_reasoning",
			"max_completion_tokens",
			"max_tokens",
			"reasoning",
			"response_format",
			"seed",
			"stream",
			"structured_outputs",
			"tool_choice",
			"tools",
		],
	},
	{
		id: "grok/grok-4.6",
		object: "model",
		created: 1626777600,
		owned_by: "xAI",
		supported_endpoint_types: ["openai", "openai-response"],
		endpoint_capabilities: ["chat_completions", "openai_responses"],
		name: "SpaceXAI: Grok 4.6",
		context_length: 500000,
		architecture: {
			modality: "text+image+file->text",
			input_modalities: ["text", "image", "file"],
			output_modalities: ["text"],
		},
		top_provider: { context_length: 500000, max_completion_tokens: 0 },
		pricing: {
			prompt: "0.0000020000",
			completion: "0.0000060000",
			prompt_per_million: "2.000000",
			completion_per_million: "6.000000",
			input_cache_read: "0.0000005000",
			tiers: [
				{
					max_input_tokens: 200000,
					prompt: "0.0000020000",
					completion: "0.0000060000",
					input_cache_read: "0.0000005000",
				},
				{
					max_input_tokens: 0,
					prompt: "0.0000040000",
					completion: "0.0000120000",
					input_cache_read: "0.0000010000",
				},
			],
		},
		supported_parameters: [
			"frequency_penalty",
			"include_reasoning",
			"logprobs",
			"max_tokens",
			"presence_penalty",
			"reasoning",
			"reasoning_effort",
			"response_format",
			"seed",
			"stop",
			"structured_outputs",
			"temperature",
			"tool_choice",
			"tools",
			"top_logprobs",
			"top_p",
		],
	},
	{
		id: "google/gemini-robotics-er-1.6-preview",
		object: "model",
		created: 1626777600,
		owned_by: "Google",
		supported_endpoint_types: ["openai", "gemini"],
		endpoint_capabilities: ["chat_completions", "gemini_generate"],
		max_completion_tokens: 65536,
		architecture: {
			input_modalities: ["text", "image", "video", "audio"],
			output_modalities: null,
		},
		top_provider: { context_length: 0, max_completion_tokens: 65536 },
		pricing: {
			prompt: "0.0000010000",
			completion: "0.0000050000",
			prompt_per_million: "1.000000",
			completion_per_million: "5.000000",
		},
		supported_parameters: [
			"max_tokens",
			"response_format",
			"seed",
			"stop",
			"structured_outputs",
			"temperature",
			"tool_choice",
			"tools",
			"top_p",
			"include_reasoning",
			"reasoning",
		],
	},
	{
		id: "google/gemini-3-pro-image-preview",
		object: "model",
		created: 1626777600,
		owned_by: "Google",
		supported_endpoint_types: ["gemini"],
		endpoint_capabilities: ["gemini_generate"],
		name: "Google: Nano Banana Pro (Gemini 3 Pro Image Preview)",
		context_length: 65536,
		architecture: {
			modality: "text+image->text+image",
			input_modalities: ["image", "text"],
			output_modalities: ["image", "text"],
		},
		top_provider: { context_length: 65536, max_completion_tokens: 0 },
		pricing: { request: "0.240000" },
		supported_parameters: [
			"max_tokens",
			"response_format",
			"seed",
			"stop",
			"structured_outputs",
			"temperature",
			"top_p",
		],
	},
	{
		id: "grok/grok-imagine-image",
		object: "model",
		created: 1626777600,
		owned_by: "xAI",
		supported_endpoint_types: ["gemini"],
		endpoint_capabilities: ["gemini_generate"],
		architecture: {
			input_modalities: ["text", "image"],
			output_modalities: null,
		},
		pricing: { request: "0.200000" },
		supported_parameters: ["n", "response_format"],
	},
	{
		id: "openai/tts-1",
		object: "model",
		created: 1626777600,
		owned_by: "custom",
		supported_endpoint_types: ["openai"],
		endpoint_capabilities: ["audio_speech"],
		architecture: { input_modalities: ["text"], output_modalities: null },
		pricing: {
			prompt: "0.0000150000",
			completion: "0.0000150000",
			prompt_per_million: "15.000000",
			completion_per_million: "15.000000",
		},
		supported_parameters: ["response_format", "speed", "voice"],
	},
	{
		id: "openai/gpt-4o-mini-tts",
		object: "model",
		created: 1626777600,
		owned_by: "OpenAI",
		supported_endpoint_types: ["openai"],
		endpoint_capabilities: ["audio_speech"],
		architecture: { input_modalities: ["text"], output_modalities: null },
		pricing: {
			prompt: "0.0000006000",
			completion: "0.0000120000",
			prompt_per_million: "0.600000",
			completion_per_million: "12.000000",
		},
		supported_parameters: [
			"instructions",
			"response_format",
			"speed",
			"stream_format",
			"voice",
		],
	},
	{
		id: "google/gemini-2.5-flash-preview-tts",
		object: "model",
		created: 1626777600,
		owned_by: "Google",
		supported_endpoint_types: ["openai"],
		endpoint_capabilities: ["audio_speech"],
		architecture: { input_modalities: ["text"], output_modalities: null },
		pricing: {
			prompt: "0.0000005000",
			completion: "0.0000100000",
			prompt_per_million: "0.500000",
			completion_per_million: "10.000000",
		},
		supported_parameters: ["voice"],
	},
	{
		id: "deepseek/deepseek-v4-flash-free",
		object: "model",
		created: 1626777600,
		owned_by: "DeepSeek",
		supported_endpoint_types: ["openai"],
		endpoint_capabilities: ["chat_completions"],
		name: "DeepSeek: DeepSeek V4 Flash (Free)",
		pricing: { request: "0.000000" },
	},
	{
		id: "deepseek/deepseek-v4.1-flash-free",
		object: "model",
		created: 1626777600,
		owned_by: "DeepSeek",
		supported_endpoint_types: ["openai"],
		endpoint_capabilities: ["chat_completions"],
		name: "DeepSeek: DeepSeek V4.1 Flash (Free)",
		pricing: {
			prompt: "0.0000000000",
			completion: "0.0000000000",
			prompt_per_million: "0.000000",
			completion_per_million: "0.000000",
		},
	},
	{
		id: "tencent/hy3-free",
		object: "model",
		created: 1626777600,
		owned_by: "Tencent",
		supported_endpoint_types: [],
		name: "Tencent: Hy3 (Free)",
		pricing: { request: "0.000000" },
	},
	{
		id: "z-ai/glm-5.3-flash-free",
		object: "model",
		created: 1626777600,
		owned_by: "z-ai",
		supported_endpoint_types: ["openai", "anthropic"],
		endpoint_capabilities: ["chat_completions", "anthropic_messages"],
		name: "Z.ai: GLM 5.3 Flash (Free)",
		pricing: { request: "0.000000" },
	},
	{
		id: "orcarouter/free",
		object: "model",
		created: 0,
		owned_by: "orcarouter",
		supported_endpoint_types: [
			"openai",
			"openai-response",
			"anthropic",
			"gemini",
		],
	},
	{
		id: "orcarouter/fusion",
		object: "model",
		created: 0,
		owned_by: "orcarouter",
		supported_endpoint_types: [
			"openai",
			"openai-response",
			"anthropic",
			"gemini",
		],
		context_length: 1000000,
	},
	{
		id: "codex-auto-review",
		object: "model",
		created: 1626777600,
		owned_by: "custom",
		supported_endpoint_types: [],
		pricing: {
			prompt: "0.0000002000",
			completion: "0.0000012000",
			prompt_per_million: "0.200000",
			completion_per_million: "1.200000",
			input_cache_read: "0.0000000200",
			tiers: [
				{
					max_input_tokens: 272000,
					prompt: "0.0000002000",
					completion: "0.0000012000",
					input_cache_read: "0.0000000200",
				},
				{
					max_input_tokens: 0,
					prompt: "0.0000004000",
					completion: "0.0000018000",
					input_cache_read: "0.0000000400",
				},
			],
		},
	},
];

let home: string;

beforeEach(() => {
	mkdirSync(resolve(".smoke-artifacts"), { recursive: true });
	home = mkdtempSync(resolve(".smoke-artifacts", "orcarouter-"));
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", resolve(home, ".pi/agent"));
	vi.stubEnv("ORCAROUTER_API_KEY", "sk-orca-test");
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			if (url.hostname === "models.dev") return Response.json({});
			if (url.hostname === "api.orcarouter.ai" && url.pathname === "/v1/models")
				return Response.json({ object: "list", data: CATALOG });
			return new Response(null, { status: 503 });
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	rmSync(home, { recursive: true, force: true });
});

async function refresh() {
	const { createNativeOpenAIProvider } =
		await import("../lib/native-provider.ts");
	const { orcarouterProviderOptions } =
		await import("../providers/orcarouter/orcarouter.ts");
	let persisted: unknown;
	const store = {
		read: async () => persisted,
		write: async (next: unknown) => {
			persisted = next;
		},
		delete: async () => {
			persisted = undefined;
		},
	};
	const handle = createNativeOpenAIProvider(orcarouterProviderOptions);
	await handle.provider.refreshModels?.({ store, allowNetwork: true } as never);
	return handle.stored;
}

// Pre-fix the free view held the paid request-priced image generators
// (gemini-3-pro-image-preview at $0.24/request, grok-imagine-image at $0.20):
// they reached the chat catalog through the `gemini` endpoint type and their
// token cost defaulted to 0 under a `_pricingKnown: true` stamp.
it("shows only the documented free models in the free view", async () => {
	const stored = await refresh();
	expect(stored.free.map((m) => m.id).sort()).toEqual([
		"deepseek/deepseek-v4-flash-free",
		"deepseek/deepseek-v4.1-flash-free",
		"orcarouter/free",
		"tencent/hy3-free",
		"z-ai/glm-5.3-flash-free",
	]);
});

// The catalog's `endpoint_capabilities` names what each model serves. TTS
// rows (`audio_speech`) and Gemini-native image generators (`gemini_generate`
// only) cannot answer /chat/completions, which is all pi-free sends. Pre-fix
// they reached the picker because `supported_endpoint_types` lists `openai`
// for TTS and `gemini` for the image models. Rows with chat_completions stay,
// including the vision-input robotics model; rows publishing no capability
// keep the existing fallback (the gateway's own router and free models).
it("publishes only models that serve chat completions", async () => {
	const ids = (await refresh()).all.map((m) => m.id).sort();
	expect(ids).toEqual([
		"codex-auto-review",
		"deepseek/deepseek-v4-flash-free",
		"deepseek/deepseek-v4.1-flash-free",
		"google/gemini-robotics-er-1.6-preview",
		"grok/grok-4.6",
		"openai/gpt-5.5",
		"orcarouter/free",
		"orcarouter/fusion",
		"tencent/hy3-free",
		"z-ai/glm-5.3-flash-free",
	]);
});

// grok/grok-4.6 publishes `top_provider.max_completion_tokens: 0` and gpt-5.5
// publishes `top_provider.context_length: 0` with no top-level context. The
// mapper kept those zeros (`??` only skips null), so Pi saw a 0-token output
// cap and a 0-token window instead of a fallback models.dev can replace.
it("never publishes a zero output limit or context window", async () => {
	// Chat models: every published entry carries both limits.
	const all = (await refresh()).all as {
		id: string;
		maxTokens: number;
		contextWindow: number;
	}[];
	const byId = new Map(all.map((m) => [m.id, m]));
	expect(byId.get("grok/grok-4.6")?.maxTokens).toBe(4096);
	expect(byId.get("openai/gpt-5.5")?.contextWindow).toBe(4096);
	expect(byId.get("openai/gpt-5.5")?.maxTokens).toBe(128000);
	for (const model of all) {
		expect(model.maxTokens, model.id).toBeGreaterThan(0);
		expect(model.contextWindow, model.id).toBeGreaterThan(0);
	}
});

// A per-request price is not a token price. Mapped beside its priced
// siblings, the live gemini-3-pro-image-preview row ($0.24/request) must not
// read as a known $0 token price, or Route A classifies it free if it ever
// passes the endpoint gate (it did pre-fix).
it("does not read a per-request price as a known $0 token price", async () => {
	const { mapOrcaRouterModel } =
		await import("../providers/orcarouter/orcarouter.ts");
	const { isFreeModel } = await import("../lib/registry.ts");
	const mapped = CATALOG.map((row) => mapOrcaRouterModel(row));
	const image = mapped.find(
		(m) => m.id === "google/gemini-3-pro-image-preview",
	)!;
	expect(image._pricingKnown).toBe(false);
	expect(isFreeModel(image, mapped)).toBe(false);
});
