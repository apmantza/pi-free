/**
 * Cline Provider Extension
 *
 * Provides access to Cline's free models (via their OpenRouter gateway).
 * Free model list is fetched from Cline's GitHub source — no account needed to browse.
 * Run /login cline to authenticate and make API calls.
 *
 * Auth flow based on pi-cline's proven implementation.
 *
 * Responds to global free-only filter (though Cline only provides free models without auth).
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Models appear immediately; run /login cline to start chatting
 */

import type { OAuthCredentials } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { getClineShowPaid } from "../../config.ts";
import { BASE_URL_CLINE, PROVIDER_CLINE } from "../../constants.ts";
import {
	DEFAULT_PROVIDER_CACHE_TTL_MS,
	isProviderCacheFresh,
	loadProviderCache,
	saveProviderCache,
} from "../../lib/provider-cache.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
import { wrapSessionStartHandler } from "../../lib/session-start-metrics.ts";
import { createToggleState } from "../../lib/toggle-state.ts";
import { logWarning } from "../../lib/util.ts";
import { enhanceWithCI } from "../../provider-helper.ts";
import { loginCline, refreshClineToken } from "./cline-auth.ts";
import { fetchClineModels } from "./cline-models.ts";
import { streamClineXml } from "./cline-xml-bridge.ts";

// =============================================================================
// Cline API headers (must match real Cline VS Code extension exactly)
// =============================================================================

const VS_CODE_VERSION = "1.109.3";
const CLINE_EXTENSION_VERSION = "3.76.0";
let _currentTaskId = generateUlid();

function generateUlid(): string {
	const CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
	const now = Date.now();
	let ts = "";
	let t = now;
	for (let i = 0; i < 10; i++) {
		ts = CHARS[t % 32] + ts;
		t = Math.floor(t / 32);
	}
	const rand = new Uint8Array(16);
	crypto.getRandomValues(rand);
	let r = "";
	for (let i = 0; i < 16; i++) r += CHARS[rand[i] % 32];
	return ts + r;
}

function buildClineHeaders(): Record<string, string> {
	return {
		"HTTP-Referer": "https://cline.bot",
		"X-Title": "Cline",
		"X-Task-ID": _currentTaskId,
		"X-PLATFORM": "Visual Studio Code",
		"X-PLATFORM-VERSION": VS_CODE_VERSION,
		"X-CLIENT-TYPE": "VSCode Extension",
		"X-CLIENT-VERSION": CLINE_EXTENSION_VERSION,
		"X-CORE-VERSION": CLINE_EXTENSION_VERSION,
		"X-Is-Multiroot": "false",
	};
}

function toApiKey(credentials: OAuthCredentials): string {
	const token = credentials.access;
	return token.startsWith("workos:") ? token : `workos:${token}`;
}

// =============================================================================
// Extension entry point
// =============================================================================

export default async function clineProvider(pi: ExtensionAPI) {
	let allModels: ProviderModelConfig[];
	const cachedModels = loadProviderCache(PROVIDER_CLINE);
	if (cachedModels && cachedModels.length > 0) {
		allModels = cachedModels;
	} else {
		allModels = await fetchClineModels(false).catch((err) => {
			logWarning("cline", "Failed to fetch models at startup", err);
			return [];
		});
		if (allModels.length > 0) {
			saveProviderCache(PROVIDER_CLINE, allModels).catch((err) => {
				logWarning("cline", "Failed to save model cache", err);
			});
		}
	}
	let freeModels = allModels.filter((m) =>
		isFreeModel({ ...m, provider: PROVIDER_CLINE }, allModels),
	);
	const stored = { free: freeModels, all: allModels };
	const toggleState = createToggleState({
		providerId: PROVIDER_CLINE,
		initialShowPaid: getClineShowPaid(),
		initialModels: stored,
	});

	const reRegister = (m: typeof allModels) => {
		pi.registerProvider(PROVIDER_CLINE, {
			baseUrl: BASE_URL_CLINE,
			api: "cline-xml-tools" as const,
			authHeader: false,
			headers: buildClineHeaders(),
			streamSimple: (model, context, options) =>
				streamClineXml(model as any, context, options, buildClineHeaders()),
			models: enhanceWithCI(m),
			oauth: {
				name: "Cline",
				login: loginCline,
				refreshToken: refreshClineToken,
				getApiKey: toApiKey,
			},
		});
	};

	const applyModelList = (models: ProviderModelConfig[]) => {
		allModels = models;
		freeModels = allModels.filter((m) =>
			isFreeModel({ ...m, provider: PROVIDER_CLINE }, allModels),
		);
		stored.all = allModels;
		stored.free = freeModels;
		toggleState.setModels(stored);
		toggleState.applyCurrent(reRegister);
	};

	registerWithGlobalToggle(PROVIDER_CLINE, stored, (m) => reRegister(m), false);
	toggleState.applyCurrent(reRegister);

	pi.registerCommand("toggle-cline", {
		description: "Toggle between free and all Cline models",
		handler: (_args, ctx) => {
			const applied = toggleState.toggle(reRegister);
			const freeCount = stored.free.length;
			const paidCount = stored.all.length - freeCount;

			if (applied.mode === "all") {
				ctx.ui.notify(
					`cline: showing all ${stored.all.length} models (${freeCount} free, ${paidCount} paid)`,
					"info",
				);
			} else {
				ctx.ui.notify(
					`cline: showing ${freeCount} free models (${paidCount} paid hidden)`,
					"info",
				);
			}
			return Promise.resolve();
		},
	});

	// ── Status bar for provider selection ─────────────────────────

	pi.on("model_select", (_event, ctx) => {
		if (_event.model?.provider !== PROVIDER_CLINE) {
			ctx.ui.setStatus(`${PROVIDER_CLINE}-status`, undefined);
			return;
		}

		const free = stored.free.length;
		const total = stored.all.length;
		const paid = total - free;
		const mode = toggleState.getCurrentMode();
		let status: string;
		if (paid === 0) {
			status = `cline: ${free} free models`;
		} else if (mode === "all") {
			status = `cline: ${total} models (free + paid)`;
		} else {
			status = `cline: ${free} free \u00b7 ${paid} paid`;
		}
		ctx.ui.setStatus(`${PROVIDER_CLINE}-status`, status);
	});

	pi.on("before_agent_start", (_event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_CLINE) return;
		_currentTaskId = generateUlid();
		toggleState.applyCurrent(reRegister);
	});

	let refreshInFlight: Promise<void> | undefined;
	pi.on(
		"session_start",
		wrapSessionStartHandler("cline", () => {
			if (refreshInFlight) return Promise.resolve();
			if (isProviderCacheFresh(PROVIDER_CLINE, DEFAULT_PROVIDER_CACHE_TTL_MS)) {
				return Promise.resolve();
			}

			refreshInFlight = fetchClineModels(false)
				.then(async (fresh) => {
					if (fresh.length === 0) return;
					await saveProviderCache(PROVIDER_CLINE, fresh);
					applyModelList(fresh);
				})
				.catch((err) => {
					logWarning("cline", "Failed to refresh models at session start", err);
				})
				.finally(() => {
					refreshInFlight = undefined;
				});
			return Promise.resolve();
		}),
	);
}
