/**
 * Generic OpenAI-compatible provider factory
 *
 * Creates provider extensions for any OpenAI-compatible API endpoint.
 * Used to easily add new providers without duplicating boilerplate.
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { createLogger } from "../lib/logger.ts";
import {
	createReRegister,
	type StoredModels,
	setupProvider,
} from "../provider-helper.ts";

export interface OpenAIProviderConfig {
	/** Unique provider identifier (e.g., "groq", "together") */
	providerId: string;
	/** Environment variable name for the API key */
	apiKeyEnvVar: string;
	/** API base URL */
	baseUrl: string;
	/** Human-readable name for the provider */
	displayName: string;
	/** Website URL for users to get an API key */
	keyWebsite: string;
	/** Whether this provider has a free tier */
	hasFreeTier: boolean;
	/** Hardcoded models (when models.dev doesn't have data) */
	models: ProviderModelConfig[];
	/** Additional headers to include in requests */
	headers?: Record<string, string>;
	/** Whether to show a ToS notice */
	showTosNotice?: boolean;
	/** Terms of service URL */
	tosUrl?: string;
}

/**
 * Create an OpenAI-compatible provider extension
 */
export function createOpenAIProvider(config: OpenAIProviderConfig) {
	const {
		providerId,
		apiKeyEnvVar,
		baseUrl,
		displayName,
		keyWebsite,
		hasFreeTier,
		models: hardcodedModels,
		headers = {},
		showTosNotice = false,
		tosUrl,
	} = config;

	const _logger = createLogger(providerId);

	return async (pi: ExtensionAPI) => {
		// Get API key from environment or config
		const apiKey = process.env[apiKeyEnvVar];

		// Inject into process.env so Pi's apiKey lookup finds it
		if (apiKey) {
			process.env[apiKeyEnvVar] = apiKey;
		} else if (!hasFreeTier) {
			_logger.warn(
				`No API key found — set ${apiKeyEnvVar} or add ${apiKeyEnvVar.toLowerCase()}_api_key to ~/.pi/free.json. Get a key at ${keyWebsite}`,
			);
			return;
		}

		// Filter to free models if no API key
		let models = hardcodedModels;
		if (!apiKey && hasFreeTier) {
			models = models.filter((m) => (m.cost?.input ?? 0) === 0);
		}

		if (models.length === 0 && !hasFreeTier) {
			_logger.warn(`No models available for ${displayName}`);
			return;
		}

		// Shared model storage
		const stored: StoredModels = { free: models, all: models };

		// Register provider
		pi.registerProvider(providerId, {
			baseUrl,
			apiKey: apiKeyEnvVar,
			api: "openai-completions" as const,
			headers: {
				"User-Agent": "pi-free-providers",
				...headers,
			},
			models,
		});

		// Wire up shared boilerplate
		const reRegister = createReRegister(pi, {
			providerId,
			baseUrl,
			apiKey: apiKeyEnvVar,
			headers,
		});

		setupProvider(
			pi,
			{
				providerId,
				tosUrl: showTosNotice ? tosUrl : undefined,
				hasKey: !!apiKey,
				initialShowPaid: !!apiKey, // If they have a key, show all by default
				reRegister: (m) => {
					stored.free = m;
					stored.all = m;
					reRegister(m);
				},
			},
			stored,
		);
	};
}
