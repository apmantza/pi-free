/**
 * Provider Factory
 *
 * Extracts the common boilerplate pattern repeated across providers:
 *   - API key check and env injection
 *   - SHOW_PAID flag check
 *   - Model fetching with error handling
 *   - Provider registration
 *   - setupProvider wiring
 *
 * Usage:
 *   export default createProvider(pi, {
 *     providerId: PROVIDER_NVIDIA,
 *     baseUrl: BASE_URL_NVIDIA,
 *     apiKeyEnvVar: "NVIDIA_API_KEY",
 *     fetchModels: fetchNvidiaModels,
 *     showPaidFlag: "NVIDIA_SHOW_PAID",
 *   });
 */

import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import {
	FIREWORKS_API_KEY,
	FIREWORKS_SHOW_PAID,
	MISTRAL_API_KEY,
	MISTRAL_SHOW_PAID,
	NVIDIA_API_KEY,
	NVIDIA_SHOW_PAID,
	OLLAMA_API_KEY,
	OLLAMA_SHOW_PAID,
	OPENCODE_API_KEY,
	ZEN_SHOW_PAID,
} from "./config.ts";
import { createLogger } from "./lib/logger.ts";
import { logWarning } from "./lib/util.ts";
import {
	createReRegister,
	type StoredModels,
	setupProvider,
} from "./provider-helper.ts";

const _logger = createLogger("provider-factory");

// =============================================================================
// Types
// =============================================================================

export interface ProviderDefinition {
	/** Provider identifier (e.g., "nvidia", "fireworks") */
	providerId: string;
	/** Base URL for the API */
	baseUrl: string;
	/** Environment variable name for the API key */
	apiKeyEnvVar: string;
	/** Config key for the API key (e.g., "nvidia_api_key") */
	apiKeyConfigKey: string;
	/** Function to fetch models */
	fetchModels: () => Promise<ProviderModelConfig[]>;
	/** SHOW_PAID flag name (e.g., "NVIDIA_SHOW_PAID") - if set, provider requires this to be true */
	showPaidFlag?: string;
	/** ToS URL to show on first use */
	tosUrl?: string;
	/** Whether this provider has a free tier (free + paid models). Default: false */
	hasFreeTier?: boolean;
	/** Additional headers to include in requests */
	extraHeaders?: Record<string, string>;
	/** Optional hook to modify request payload before sending */
	beforeProviderRequest?: (
		payload: Record<string, unknown>,
	) => Record<string, unknown> | undefined;
	/** Optional flag to indicate paid mode (for error handling) */
	isPaidMode?: boolean;
}

// =============================================================================
// Config value getters (dynamic lookup)
// =============================================================================

// Map config key names to their values
const API_KEY_GETTERS: Record<string, () => string | undefined> = {
	nvidia_api_key: () => NVIDIA_API_KEY,
	fireworks_api_key: () => FIREWORKS_API_KEY,
	ollama_api_key: () => OLLAMA_API_KEY,
	mistral_api_key: () => MISTRAL_API_KEY,
	opencode_api_key: () => OPENCODE_API_KEY,
};

const SHOW_PAID_GETTERS: Record<string, () => boolean> = {
	NVIDIA_SHOW_PAID: () => NVIDIA_SHOW_PAID,
	FIREWORKS_SHOW_PAID: () => FIREWORKS_SHOW_PAID,
	OLLAMA_SHOW_PAID: () => OLLAMA_SHOW_PAID,
	MISTRAL_SHOW_PAID: () => MISTRAL_SHOW_PAID,
	ZEN_SHOW_PAID: () => ZEN_SHOW_PAID,
};

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a provider with minimal boilerplate.
 *
 * Handles:
 *   - API key check and env injection
 *   - SHOW_PAID flag check (if applicable)
 *   - Model fetching with error handling
 *   - Provider registration with OpenAI-compatible API
 *   - setupProvider wiring for commands and events
 *
 * For providers with OAuth or custom session logic, don't use this factory.
 */
export async function createProvider(
	pi: ExtensionAPI,
	def: ProviderDefinition,
): Promise<void> {
	// 1. Get API key from config
	const getApiKey = API_KEY_GETTERS[def.apiKeyConfigKey];
	if (!getApiKey) {
		_logger.error(`Unknown API key config: ${def.apiKeyConfigKey}`);
		return;
	}
	const apiKey = getApiKey();

	// 2. Inject into process.env so Pi's apiKey lookup finds it
	if (apiKey) {
		process.env[def.apiKeyEnvVar] = apiKey;
	}

	// 3. Check key exists
	if (!apiKey) {
		_logger.warn(
			`No API key found — set ${def.apiKeyEnvVar} or add ${def.apiKeyConfigKey} to ~/.pi/free.json`,
		);
		return;
	}

	// 4. Check paid flag (if applicable)
	if (def.showPaidFlag) {
		const getShowPaid = SHOW_PAID_GETTERS[def.showPaidFlag];
		if (getShowPaid && !getShowPaid()) {
			_logger.info(
				`${def.providerId} disabled. Set ${def.showPaidFlag}=true to enable.`,
			);
			return;
		}
	}

	// 5. Fetch models
	let models: ProviderModelConfig[] = [];
	try {
		models = await def.fetchModels();
	} catch (error) {
		logWarning(def.providerId, "Failed to fetch models", error);
		return;
	}

	if (models.length === 0) {
		_logger.warn(`No models available for ${def.providerId}`);
		return;
	}

	// 6. Build storage (free/all or single set)
	const stored: StoredModels = def.hasFreeTier
		? {
				free: models.filter((m) => (m.cost?.input ?? 0) === 0),
				all: models,
			}
		: { free: models, all: models };

	// 7. Register provider
	pi.registerProvider(def.providerId, {
		baseUrl: def.baseUrl,
		apiKey: def.apiKeyEnvVar,
		api: "openai-completions" as const,
		headers: {
			"User-Agent": "pi-free-providers",
			...def.extraHeaders,
		},
		models,
	});

	// 8. Setup boilerplate
	const config = {
		providerId: def.providerId,
		baseUrl: def.baseUrl,
		apiKey: def.apiKeyEnvVar,
	};

	const reRegister = createReRegister(pi, config);

	setupProvider(
		pi,
		{
			providerId: def.providerId,
			tosUrl: def.tosUrl,
			initialShowPaid: def.isPaidMode ?? !!def.showPaidFlag,
			reRegister: (m: ProviderModelConfig[]) => {
				stored.free = m;
				stored.all = m;
				reRegister(m);
			},
		},
		stored,
	);

	// 9. Optional: before_provider_request hook
	if (def.beforeProviderRequest) {
		const hook = def.beforeProviderRequest;
		(pi.on as (event: string, handler: (e: unknown) => unknown) => void)(
			"before_provider_request",
			(event: unknown) => {
				const evt = event as { type: string; payload: unknown };
				const payload = evt.payload as Record<string, unknown>;
				return hook(payload);
			},
		);
	}
}
