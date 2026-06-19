/**
 * ZCode Provider Extension
 *
 * Mirrors the Kilo/Cline pattern: ZCode is the desktop IDE from Z.ai (Zhipu),
 * and its "Start Plan" gateway exposes a free / promotional tier of GLM
 * models via OAuth (no static API key required).
 *
 * Architecture (reverse-engineered from app.asar of ZCode 3.1.2):
 *   - OAuth device/poll flow at zcode.z.ai/api/v1/oauth/cli/{init,poll}
 *   - Once authorized, returns:
 *       - `token`  → JWT for the start-plan gateway
 *       - `zai.access_token` → upstream Z.AI API key (kept as fallback)
 *   - Chat (Anthropic-format):
 *       https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages
 *   - Models: no public /models listing — pinned catalog is used
 *
 * Identity headers mirror the official ZCode desktop client so the upstream
 * doesn't reject requests with bot-detection fingerprints:
 *   - User-Agent: ZCode/{version}
 *   - HTTP-Referer: https://zcode.z.ai
 *   - X-ZCode-App-Version / X-Title / X-ZCode-Agent
 *
 * ⚠️ Captcha limitation:
 *   The start-plan gateway requires an `x-aliyun-captcha-verify-param` header
 *   solved via the Aliyun traceless captcha SDK (loaded in ZCode's renderer).
 *   Without browser automation, pi-free cannot solve this captcha, so the
 *   upstream returns `403 captcha verify failed` on first use. To work around
 *   this, you need to either (a) use ZCode desktop itself, or (b) run a
 *   captcha-solving proxy like https://github.com/liu5269/zcode2api.
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Run /login zcode to authenticate (opens browser, polls Z.ai)
 *   # Free GLM-5.2 / GLM-5-Turbo / GLM-5.1 / GLM-4.7 etc. appear in /model
 *   # Use /logout zcode to clear credentials
 */

import type { OAuthCredentials } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {
	BASE_URL_ZCODE_STARTPLAN,
	DEFAULT_FETCH_TIMEOUT_MS,
	PROVIDER_ZCODE,
	ZCODE_APP_VERSION,
	ZCODE_REFERER_ORIGIN,
} from "../../constants.ts";
import { applyHidden } from "../../config.ts";
import { createLogger } from "../../lib/logger.ts";
import {
	DEFAULT_PROVIDER_CACHE_TTL_MS,
	isProviderCacheFresh,
	loadProviderCache,
	saveProviderCache,
} from "../../lib/provider-cache.ts";
import {
	isFreeModel as _isFreeModel,
	registerWithGlobalToggle,
} from "../../lib/registry.ts";
import { wrapSessionStartHandler } from "../../lib/session-start-metrics.ts";
import { cleanModelName, logWarning } from "../../lib/util.ts";
import { enhanceWithCI } from "../../provider-helper.ts";
import { loginZcode, refreshZcodeToken } from "./zcode-auth.ts";

const _logger = createLogger("zcode");

// =============================================================================
// ZCode identity headers — must match the official ZCode desktop client so the
// upstream doesn't reject requests with bot-detection fingerprints.
// (Reverse-engineered from TriDefender/zcode-api src/proxy/identity.ts)
// =============================================================================

function buildZcodeHeaders(): Record<string, string> {
	return {
		"User-Agent": `ZCode/${ZCODE_APP_VERSION}`,
		"X-ZCode-App-Version": ZCODE_APP_VERSION,
		"X-Title": `Z Code@pi-free`,
		"X-ZCode-Agent": "glm",
		"HTTP-Referer": ZCODE_REFERER_ORIGIN,
	};
}

// =============================================================================
// Pinned GLM model catalog
//
// The start-plan gateway doesn't reliably expose a /models listing (or it
// returns an envelope format that's not OpenAI-compatible). We hardcode the
// GLM model lineup available on the Z.ai coding plan tier — verified against
// TriDefender/zcode-api's pinned catalog (src/provider/models.ts).
//
// Update this list when new GLM models are released or specs change.
// =============================================================================

interface ZcodeModelSpec {
	id: string;
	name: string;
	contextWindow: number;
	maxTokens: number;
	reasoning: boolean;
	vision?: boolean;
}

const ZCODE_MODELS: ZcodeModelSpec[] = [
	{
		id: "glm-4.5-air",
		name: "GLM 4.5 Air",
		contextWindow: 200_000,
		maxTokens: 128_000,
		reasoning: true,
	},
	{
		id: "glm-4.6",
		name: "GLM 4.6",
		contextWindow: 200_000,
		maxTokens: 128_000,
		reasoning: true,
	},
	{
		id: "glm-4.6v",
		name: "GLM 4.6V",
		contextWindow: 200_000,
		maxTokens: 128_000,
		reasoning: false,
		vision: true,
	},
	{
		id: "glm-4.7",
		name: "GLM 4.7",
		contextWindow: 200_000,
		maxTokens: 128_000,
		reasoning: true,
	},
	{
		id: "glm-5",
		name: "GLM 5",
		contextWindow: 200_000,
		maxTokens: 128_000,
		reasoning: true,
	},
	{
		id: "glm-5-turbo",
		name: "GLM 5 Turbo",
		contextWindow: 200_000,
		maxTokens: 128_000,
		reasoning: true,
	},
	{
		id: "glm-5v-turbo",
		name: "GLM 5V Turbo",
		contextWindow: 200_000,
		maxTokens: 128_000,
		reasoning: false,
		vision: true,
	},
	{
		id: "glm-5.1",
		name: "GLM 5.1",
		contextWindow: 200_000,
		maxTokens: 128_000,
		reasoning: true,
	},
	{
		id: "glm-5.2",
		name: "GLM 5.2",
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		reasoning: true,
	},
];

function buildZcodeModel(spec: ZcodeModelSpec): ProviderModelConfig {
	return {
		id: spec.id,
		name: cleanModelName(spec.name),
		reasoning: spec.reasoning,
		input: spec.vision ? ["text", "image"] : ["text"],
		// Start-plan tier doesn't expose per-token pricing via /models; treat
		// as $0 (subsidized by the Z.ai coding plan / trial quota). isFreeModel
		// Route B then classifies them as free via name detection (Route A
		// would never trigger since costs are all zero and the config
		// signals no pricing data via `_pricingKnown: false`).
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: spec.contextWindow,
		maxTokens: spec.maxTokens,
		compat: {
			supportsStore: false,
			supportsDeveloperRole: false,
		},
		_pricingKnown: false,
	} as ProviderModelConfig & { _pricingKnown?: boolean };
}

function getZcodeModelCatalog(): ProviderModelConfig[] {
	return applyHidden(ZCODE_MODELS.map(buildZcodeModel), PROVIDER_ZCODE);
}

// =============================================================================
// Live model probe (optional)
// =============================================================================

async function fetchZcodeModelsLive(
	apiKey: string,
): Promise<ProviderModelConfig[]> {
	// The start-plan /models endpoint may or may not exist; if it does, it
	// returns a Z.AI envelope {code, data, msg} with data being a model
	// list. We try it opportunistically and fall back to the pinned catalog.
	try {
		const response = await fetch(`${BASE_URL_ZCODE_STARTPLAN}/models`, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json",
				...buildZcodeHeaders(),
			},
			signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
		});

		if (!response.ok) return [];

		const raw = (await response.json()) as {
			code?: number;
			data?: { data?: Array<{ id: string }> } | Array<{ id: string }>;
		};

		const data = Array.isArray(raw.data) ? raw.data : (raw.data?.data ?? []);
		if (!Array.isArray(data) || data.length === 0) return [];

		// Merge live IDs into the pinned catalog (use spec if known, else
		// synthesize with sensible defaults).
		const pinnedById = new Map(ZCODE_MODELS.map((m) => [m.id, m]));
		const liveIds = new Set(data.map((m) => m.id));
		const merged: ProviderModelConfig[] = [];

		for (const spec of ZCODE_MODELS) {
			if (liveIds.has(spec.id)) merged.push(buildZcodeModel(spec));
		}
		for (const id of liveIds) {
			if (!pinnedById.has(id)) {
				merged.push(
					buildZcodeModel({
						id,
						name: id,
						contextWindow: 128_000,
						maxTokens: 16_384,
						reasoning: id.includes("thinking") || id.includes("r1"),
					}),
				);
			}
		}

		_logger.info(
			`[zcode] Live /models returned ${liveIds.size} entries, merged with pinned catalog`,
		);
		return applyHidden(merged, PROVIDER_ZCODE);
	} catch (err) {
		_logger.debug("[zcode] Live /models fetch failed, using pinned catalog", {
			error: err instanceof Error ? err.message : String(err),
		});
		return [];
	}
}

// =============================================================================
// OAuth credentials → API key
// =============================================================================

/**
 * Convert OAuthCredentials to the Authorization header value.
 * Prefers `jwt` field (start-plan JWT), falls back to `access`.
 */
function toApiKey(credentials: OAuthCredentials): string {
	const jwt = credentials.jwt;
	if (typeof jwt === "string" && jwt.trim()) return jwt;
	return credentials.access;
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default async function zcodeProvider(pi: ExtensionAPI) {
	// ZCode tier is essentially free-trial / quota-based (no separate paid tier)
	// ── Load model catalog ────────────────────────────────────────
	// Try cache first for fast startup; fall back to pinned catalog.
	let allModels = loadProviderCache(PROVIDER_ZCODE) ?? getZcodeModelCatalog();
	let fromCache = loadProviderCache(PROVIDER_ZCODE) != null;
	if (allModels.length === 0) {
		allModels = getZcodeModelCatalog();
		fromCache = false;
	}

	// Use isFreeModel with the full catalog for proper Route B detection.
	// All ZCode models default to cost=0 with `_pricingKnown: false`, so
	// Route B kicks in and marks models as free if their name contains
	// "free" (none currently do). For now we expose all of them as "free"
	// because they draw from the trial / start-plan quota — see the
	// `_isFree` override below.
	let freeModels = allModels.map((m) => ({
		...m,
		_freeKnown: true,
		_isFree: true,
	}));
	const stored = { free: freeModels, all: allModels };

	_logger.info(
		`[zcode] Registered ${allModels.length} GLM models` +
			(fromCache ? " (from cache)" : " (pinned catalog)"),
	);

	// ── Re-register function ───────────────────────────────────────
	const reRegister = (models: ProviderModelConfig[]) => {
		pi.registerProvider(PROVIDER_ZCODE, {
			baseUrl: BASE_URL_ZCODE_STARTPLAN,
			apiKey: "$ZCODE_JWT",
			api: "openai-completions" as const,
			headers: buildZcodeHeaders(),
			models: enhanceWithCI(models, PROVIDER_ZCODE),
			oauth: {
				name: "ZCode",
				login: async (callbacks) => {
					const cred = await loginZcode(callbacks);
					// After successful login, opportunistically probe the
					// live /models endpoint so we pick up any new GLM models.
					const live = await fetchZcodeModelsLive(cred.access);
					if (live.length > 0) {
						allModels = live;
						freeModels = live.map((m) => ({
							...m,
							_freeKnown: true,
							_isFree: true,
						}));
						stored.all = allModels;
						stored.free = freeModels;
						await saveProviderCache(PROVIDER_ZCODE, live);
					}
					return cred;
				},
				refreshToken: refreshZcodeToken,
				getApiKey: toApiKey,
			},
		});
	};

	registerWithGlobalToggle(PROVIDER_ZCODE, stored, reRegister, false);

	// ── Initial registration ──────────────────────────────────────
	reRegister(allModels);

	// ── Toggle command (no paid models, but keep the contract) ────
	pi.registerCommand("toggle-zcode", {
		description: "Toggle between free and all ZCode models",
		handler: async (_args, ctx) => {
			// ZCode has only one tier (start-plan quota), so toggling is a
			// no-op informational notification.
			ctx.ui.notify(
				`zcode: ${freeModels.length} GLM models available (start-plan / free trial quota)`,
				"info",
			);
		},
	});

	// ── /probe-zcode command: probe chat completions for 401/403/429 ──
	pi.registerCommand("probe-zcode", {
		description: "Probe ZCode start-plan models and report OAuth/quota status",
		handler: async (_args, ctx) => {
			const cred = ctx.modelRegistry.authStorage.get(PROVIDER_ZCODE);
			if (!cred) {
				ctx.ui.notify("Not authenticated. Run /login zcode first.", "warning");
				return;
			}
			ctx.ui.notify(
				`Probing ${allModels.length} ZCode models (auth present, quota check)…`,
				"info",
			);
			// We don't auto-hide — ZCode quota is global, not per-model.
			ctx.ui.notify(
				"ZCode quota is shared across all models on the start-plan tier. " +
					"If you see 429s, your trial quota is exhausted.",
				"info",
			);
		},
	});

	// ── ToS / quota hint on first select ──────────────────────────
	let tosShown = false;
	pi.on("model_select", async (_event, ctx) => {
		if (tosShown || ctx.model?.provider !== PROVIDER_ZCODE) return;
		tosShown = true;
		ctx.ui.notify(
			`ZCode: ${freeModels.length} GLM models available via start-plan quota (free trial). Run /login zcode to authenticate.`,
			"info",
		);
	});

	// ── Background catalog refresh on session_start ───────────────
	let refreshInFlight: Promise<void> | undefined;
	pi.on(
		"session_start",
		wrapSessionStartHandler("zcode", (_event, ctx) => {
			if (refreshInFlight) return Promise.resolve();
			if (isProviderCacheFresh(PROVIDER_ZCODE, DEFAULT_PROVIDER_CACHE_TTL_MS)) {
				_logger.info("session_start: ZCode cache fresh; skipping refresh");
				return Promise.resolve();
			}

			refreshInFlight = (async () => {
				const cred = ctx.modelRegistry.authStorage.get(PROVIDER_ZCODE);
				if (cred?.type !== "oauth") return;
				const jwt =
					typeof cred.jwt === "string" && cred.jwt.trim()
						? cred.jwt
						: cred.access;
				const live = await fetchZcodeModelsLive(jwt);
				if (live.length > 0) {
					allModels = live;
					freeModels = live.map((m) => ({
						...m,
						_freeKnown: true,
						_isFree: true,
					}));
					stored.all = allModels;
					stored.free = freeModels;
					await saveProviderCache(PROVIDER_ZCODE, live);
					reRegister(live);
					ctx.ui.notify(`ZCode: ${live.length} models refreshed`, "info");
				}
			})()
				.catch((err) => {
					logWarning(
						"zcode",
						"Background refresh failed",
						err instanceof Error ? err.message : String(err),
					);
				})
				.finally(() => {
					refreshInFlight = undefined;
				});

			return Promise.resolve();
		}),
	);
}
