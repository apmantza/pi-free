/**
 * AMD Token Lab catalog and request-shape tests.
 *
 * Only HTTP is stubbed: Token Lab's keyed /models answers the rows captured
 * live on 2026-11-14, and models.dev answers with its real DeepSeek entry.
 * The request body is built by pi-ai's real OpenAI-completions stream.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import type { Model } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// models.dev's real deepseek provider (2026-11-14), trimmed to the one entry
// whose enrichment stamped DeepSeek's proxy format on Token Lab's ids.
const MODELS_DEV = {
	deepseek: {
		id: "deepseek",
		env: ["DEEPSEEK_API_KEY"],
		npm: "@ai-sdk/openai-compatible",
		api: "https://api.deepseek.com",
		name: "DeepSeek",
		doc: "https://api-docs.deepseek.com/quick_start/pricing",
		models: {
			"deepseek-v4-flash": {
				id: "deepseek-v4-flash",
				name: "DeepSeek V4 Flash",
				description:
					"October 17 update of DeepSeek V4.1 Flash with improved reasoning, coding, agentic tasks, and visual understanding",
				family: "deepseek-flash",
				attachment: true,
				reasoning: true,
				reasoning_options: [
					{
						type: "toggle",
					},
					{
						type: "effort",
						values: ["low", "high", "max"],
					},
				],
				tool_call: true,
				interleaved: {
					field: "reasoning_content",
				},
				structured_output: true,
				temperature: true,
				knowledge: "2025-05",
				release_date: "2026-10-17",
				last_updated: "2026-10-17",
				modalities: {
					input: ["text", "image"],
					output: ["text"],
				},
				open_weights: true,
				limit: {
					context: 1048576,
					output: 393216,
				},
				status: "deprecated",
				cost: {
					input: 0.15,
					output: 0.6,
					reasoning: 0.6,
					cache_read: 0.003,
				},
				canonical_model_id: "deepseek/deepseek-v4.1-flash-1017",
			},
		},
	},
};

// Live /v1/models rows (2026-11-14), unchanged.
const CATALOG = [
	{
		id: "Clef",
		name: "Clef",
		description: "Dynamic aux-router service managed by Model Ops",
		context_length: 0,
		supported_parameters: [],
		architecture: {
			input_modalities: ["text", "image"],
			output_modalities: ["decision"],
			tokenizer: "GPT",
		},
		object: "model",
		owned_by: "amd",
	},
	{
		id: "d3",
		name: "d3",
		description: "Dynamic aux-router service managed by Model Ops",
		context_length: 0,
		supported_parameters: [],
		architecture: {
			input_modalities: ["text", "image"],
			output_modalities: ["decision"],
			tokenizer: "GPT",
		},
		object: "model",
		owned_by: "amd",
	},
	{
		id: "d3-flash",
		name: "d3-flash",
		description: "Dynamic aux-router service managed by Model Ops",
		context_length: 0,
		supported_parameters: [],
		architecture: {
			input_modalities: ["text", "image"],
			output_modalities: ["decision"],
			tokenizer: "GPT",
		},
		object: "model",
		owned_by: "amd",
	},
	{
		id: "DeepSeek-V4.1-Flash",
		name: "DeepSeek-V4.1-Flash",
		description: "Dynamic sglang-router service managed by Model Ops",
		context_length: 1048576,
		supported_parameters: [
			"temperature",
			"max_tokens",
			"top_p",
			"stream",
			"response_format",
			"tools",
			"tool_choice",
			"reasoning_effort",
		],
		architecture: {
			input_modalities: ["text", "image"],
			output_modalities: ["text"],
			tokenizer: "GPT",
		},
		object: "model",
		owned_by: "amd",
	},
	{
		id: "DeepSeek-V4-Flash",
		name: "DeepSeek-V4-Flash",
		description: "Dynamic sglang-router service managed by Model Ops",
		context_length: 1048576,
		supported_parameters: [
			"temperature",
			"max_tokens",
			"top_p",
			"stream",
			"response_format",
			"tools",
			"tool_choice",
			"reasoning_effort",
		],
		architecture: {
			input_modalities: ["text"],
			output_modalities: ["text"],
			tokenizer: "GPT",
		},
		object: "model",
		owned_by: "amd",
	},
	{
		id: "Gemma-4-31B-IT",
		name: "Gemma 4 31B",
		description: "Dynamic sglang-router service managed by Model Ops",
		context_length: 262144,
		supported_parameters: [
			"temperature",
			"max_tokens",
			"top_p",
			"stream",
			"response_format",
			"tools",
			"tool_choice",
			"reasoning_effort",
		],
		architecture: {
			input_modalities: ["text", "image"],
			output_modalities: ["text"],
			tokenizer: "GPT",
		},
		object: "model",
		owned_by: "amd",
	},
	{
		id: "MiniCPM5-2B",
		name: "MiniCPM5-2B",
		description: "Dynamic vllm-router service managed by Model Ops",
		context_length: 131072,
		supported_parameters: [
			"temperature",
			"max_tokens",
			"top_p",
			"stream",
			"response_format",
			"tools",
			"tool_choice",
			"reasoning_effort",
		],
		architecture: {
			input_modalities: ["text"],
			output_modalities: ["text"],
			tokenizer: "GPT",
		},
		object: "model",
		owned_by: "amd",
	},
	{
		id: "MiniCPM-V-4.7-1B",
		name: "MiniCPM-V-4.7-1B",
		description: "Dynamic vllm-router service managed by Model Ops",
		context_length: 262144,
		supported_parameters: [
			"temperature",
			"max_tokens",
			"top_p",
			"stream",
			"response_format",
			"tools",
			"tool_choice",
			"reasoning_effort",
		],
		architecture: {
			input_modalities: ["text", "image"],
			output_modalities: ["text"],
			tokenizer: "GPT",
		},
		object: "model",
		owned_by: "amd",
	},
	{
		id: "MiniCPM-V-4.7-35B-A3B",
		name: "MiniCPM-V-4.7-35B-A3B",
		description: "Dynamic vllm-router service managed by Model Ops",
		context_length: 262144,
		supported_parameters: [
			"temperature",
			"max_tokens",
			"top_p",
			"stream",
			"response_format",
			"tools",
			"tool_choice",
			"reasoning_effort",
		],
		architecture: {
			input_modalities: ["text", "image"],
			output_modalities: ["text"],
			tokenizer: "GPT",
		},
		object: "model",
		owned_by: "amd",
	},
	{
		id: "Qwen3.8-27B",
		name: "Qwen3.8-27B",
		description: "Dynamic sglang-router service managed by Model Ops",
		context_length: 262144,
		supported_parameters: [
			"temperature",
			"max_tokens",
			"top_p",
			"stream",
			"response_format",
			"tools",
			"tool_choice",
			"reasoning_effort",
		],
		architecture: {
			input_modalities: ["text", "image"],
			output_modalities: ["text"],
			tokenizer: "GPT",
		},
		object: "model",
		owned_by: "amd",
	},
];

let home: string;
let bodies: Record<string, unknown>[];

beforeEach(() => {
	mkdirSync(resolve(".smoke-artifacts"), { recursive: true });
	home = mkdtempSync(resolve(".smoke-artifacts", "amd-tokenlab-"));
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", resolve(home, ".pi/agent"));
	bodies = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			if (url.hostname === "models.dev") return Response.json(MODELS_DEV);
			if (url.hostname !== "api.tokenlab.amd.com")
				return new Response(null, { status: 503 });
			if (url.pathname === "/v1/models")
				return Response.json({ data: CATALOG });
			bodies.push(JSON.parse(String(init?.body ?? "{}")));
			return Response.json({ error: { message: "boundary" } }, { status: 400 });
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	rmSync(home, { recursive: true, force: true });
});

async function catalog() {
	const { fetchAmdTokenlabModels } =
		await import("../providers/amd-tokenlab/amd-tokenlab-models.ts");
	return fetchAmdTokenlabModels("tl-test");
}

// The catalog lists three aux routers (output "decision", context 0) beside
// the chat models; publishing them would offer unusable models in the picker.
// The free view is what pi-free shows by default: a $0-everywhere catalog
// reads as "pricing unexposed" there, which emptied it when the authoritative
// free stamp was missing (live log, 2026-11-14: "persisting 0/7 models").
it("publishes the chat models in the default free view and drops the routers", async () => {
	vi.stubEnv("AMD_TOKENLAB_API_KEY", "tl-test");
	const { createNativeOpenAIProvider } =
		await import("../lib/native-provider.ts");
	const { amdTokenlabProviderOptions } =
		await import("../providers/amd-tokenlab/amd-tokenlab.ts");
	let persisted: { models: { id: string; input: string[] }[] } | undefined;
	const store = {
		read: async () => persisted,
		write: async (next: typeof persisted) => {
			persisted = next;
		},
		delete: async () => {
			persisted = undefined;
		},
	};
	const handle = createNativeOpenAIProvider(amdTokenlabProviderOptions);
	await handle.provider.refreshModels?.({ store, allowNetwork: true } as never);

	const chatIds = CATALOG.filter((row) =>
		row.architecture.output_modalities.includes("text"),
	)
		.map((row) => row.id)
		.sort();
	expect(chatIds).toHaveLength(7);
	expect(handle.stored.all.map((m) => m.id).sort()).toEqual(chatIds);
	expect(handle.stored.free.map((m) => m.id).sort()).toEqual(chatIds);
	expect(persisted?.models.map((m) => m.id).sort()).toEqual(chatIds);
	expect(
		persisted?.models.find((m) => m.id === "Gemma-4-31B-IT")?.input,
	).toEqual(["text", "image"]);
});

// Live 2026-11-14: enrichment stamped DeepSeek's proxy format on the DeepSeek
// ids, and Token Lab answered every DeepSeek turn with 400 '"thinking" is not
// supported on /v1/chat/completions ... Use "reasoning_effort"'.
it("controls thinking with reasoning_effort only, for every model and level", async () => {
	const { normalizeContext, streamSimpleOpenAICompletions } =
		await import("@earendil-works/pi-ai/compat");
	const { BASE_URL_AMD_TOKENLAB } = await import("../constants.ts");
	for (const published of await catalog()) {
		for (const reasoningEffort of [undefined, "high"] as const) {
			bodies.length = 0;
			const model = {
				...published,
				api: "openai-completions",
				provider: "amd-tokenlab",
				baseUrl: BASE_URL_AMD_TOKENLAB,
			} as unknown as Model<"openai-completions">;
			await streamSimpleOpenAICompletions(
				model,
				normalizeContext({
					messages: [{ role: "user", content: "hi", timestamp: 0 }],
				}),
				{
					apiKey: "tl-test",
					maxTokens: 16,
					...(reasoningEffort && { reasoning: reasoningEffort }),
				},
			).result();
			expect(bodies, published.id).toHaveLength(1);
			expect(
				bodies[0],
				`${published.id} ${reasoningEffort}`,
			).not.toHaveProperty("thinking");
			expect(
				bodies[0]!.reasoning_effort,
				`${published.id} ${reasoningEffort}`,
			).toBe(reasoningEffort ?? "none");
		}
	}
});
