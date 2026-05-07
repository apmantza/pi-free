/**
 * LLM7.io Provider Extension
 *
 * LLM7.io is an LLM API gateway that routes requests across multiple
 * providers (OpenAI, Mistral, Google, DeepSeek, Cloudflare, etc.) through
 * a single OpenAI-compatible endpoint.
 *
 * Free tier:
 *   - Free token from https://token.llm7.io/
 *   - 100 req/hr, 20 req/min, 2 req/s
 *   - No credit card required
 *
 * Pro tier ($12/mo):
 *   - Higher rate limits, JSON mode, function calling
 *   - Access to "pro" routing selector
 *
 * Model selectors (not specific model IDs — LLM7 routes randomly):
 *   - "default" — first available free model (free)
 *   - "fast" — lowest latency option (free)
 *   - "pro" — highest quality, longer reasoning (paid)
 *
 * Endpoint:
 *   Chat: https://api.llm7.io/v1/chat/completions
 *
 * Setup:
 *   1. Get free token from https://token.llm7.io/
 *   2. Set LLM7_API_KEY env var (or add to ~/.pi/free.json)
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Set LLM7_API_KEY env var
 *   # Models appear in /model selector as "llm7/default", "llm7/fast", "llm7/pro"
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { getLlm7ApiKey, getLlm7ShowPaid } from "../../config.ts";
import { BASE_URL_LLM7, PROVIDER_LLM7 } from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
import { createReRegister, setupProvider } from "../../provider-helper.ts";

const _logger = createLogger("llm7");

// =============================================================================
// Model Definitions
// =============================================================================

const LLM7_MODELS: ProviderModelConfig[] = [
	{
		id: "default",
		name: "LLM7 Default",
		reasoning: false,
		input: ["text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: 32_000,
		maxTokens: 4_096,
	},
	{
		id: "fast",
		name: "LLM7 Fast",
		reasoning: false,
		input: ["text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: 32_000,
		maxTokens: 4_096,
	},
	{
		id: "pro",
		name: "LLM7 Pro",
		reasoning: false,
		input: ["text"],
		cost: {
			input: 0.3, // Requires $12/mo LLM7 Pro subscription
			output: 0.9,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: 32_000,
		maxTokens: 4_096,
	},
];

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function llm7Provider(pi: ExtensionAPI) {
	const apiKey = getLlm7ApiKey();

	if (!apiKey) {
		_logger.info(
			"[llm7] Skipping — LLM7_API_KEY not set. Get a free token at https://token.llm7.io/",
		);
		return;
	}

	_logger.info("[llm7] Using LLM7_API_KEY");

	const allModels = LLM7_MODELS;
	const freeModels = allModels.filter((m) =>
		isFreeModel({ ...m, provider: PROVIDER_LLM7 }, allModels),
	);

	const stored = { free: freeModels, all: allModels };

	_logger.info(
		`[llm7] Registered ${allModels.length} models (${freeModels.length} free)`,
	);

	// Create re-register function
	const reRegister = createReRegister(pi, {
		providerId: PROVIDER_LLM7,
		baseUrl: BASE_URL_LLM7,
		apiKey,
	});

	// Register with global toggle
	registerWithGlobalToggle(PROVIDER_LLM7, stored, reRegister, true);

	// Setup provider with toggle command
	setupProvider(
		pi,
		{
			providerId: PROVIDER_LLM7,
			initialShowPaid: getLlm7ShowPaid(),
			tosUrl: "https://llm7.io/",
			reRegister: (models, _stored) => {
				if (_stored) {
					stored.free = _stored.free;
					stored.all = _stored.all;
				}
				reRegister(models);
			},
		},
		stored,
	);

	// Initial registration — respect persisted toggle state
	const showPaid = getLlm7ShowPaid();
	const initialModels =
		showPaid && stored.all.length > 0 ? stored.all : freeModels;
	reRegister(initialModels);
}
