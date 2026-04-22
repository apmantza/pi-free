/**
 * Provider Factory
 *
 * Extracts the common boilerplate pattern repeated across providers:
 *   - API key check
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
	getModalApiKey,
	getNvidiaApiKey,
	getNvidiaShowPaid,
	getOpencodeApiKey,
} from "./config.ts";
import { createLogger } from "./lib/logger.ts";
import { logWarning } from "./lib/util.ts";
import {
	createReRegister,
	enhanceWithCI,
	type StoredModels,
	setupProvider,
} from "./provider-helper.ts";

const _logger = createLogger("provider-factory");

// =============================================================================
// Types
// =============================================================================

export interface ProviderDefinition {
	/** Provider identifier (e.g., "nvidia", "modal") */
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
	/** Whether to skip creating a toggle command (e.g., for single-model providers). Default: false */
	skipToggle?: boolean;
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

const API_KEY_GETTERS: Record<string, () => string | undefined> = {
	nvidia_api_key: getNvidiaApiKey,
	opencode_api_key: getOpencodeApiKey,
	modal_api_key: getModalApiKey,
};

const SHOW_PAID_GETTERS: Record<string, () => boolean> = {
	NVIDIA_SHOW_PAID: getNvidiaShowPaid,
};

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a provider with minimal boilerplate.
 *
 * Handles:
 *   - API key check
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

	// 2. Check key exists
	if (!apiKey) {
		_logger.warn(
			`No API key found — set ${def.apiKeyEnvVar} or add ${def.apiKeyConfigKey} to ~/.pi/free.json`,
		);
		return;
	}

	// 3. Check paid flag (if applicable)
	if (def.showPaidFlag) {
		const getShowPaid = SHOW_PAID_GETTERS[def.showPaidFlag];
		if (getShowPaid && !getShowPaid()) {
			_logger.info(
				`${def.providerId} disabled. Set ${def.showPaidFlag}=true to enable.`,
			);
			return;
		}
	}

	// 4. Fetch models
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

	// 5. Build storage (free/all or single set)
	const stored: StoredModels = def.hasFreeTier
		? {
				free: models.filter((m) => (m.cost?.input ?? 0) === 0),
				all: models,
			}
		: { free: models, all: models };

	// 6. Register provider (pass literal key so we don't mutate process.env)
	pi.registerProvider(def.providerId, {
		baseUrl: def.baseUrl,
		apiKey,
		api: "openai-completions" as const,
		headers: {
			"User-Agent": "pi-free-providers",
			...def.extraHeaders,
		},
		models: enhanceWithCI(models),
	});

	// 7. Setup boilerplate
	const config = {
		providerId: def.providerId,
		baseUrl: def.baseUrl,
		apiKey,
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
			skipToggle: def.skipToggle,
		},
		stored,
	);

	// 8. Optional: before_provider_request hook
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
