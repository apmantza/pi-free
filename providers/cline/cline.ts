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
// Context shaping — preserve full conversation with tool calls/results
// =============================================================================

function extractText(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (Array.isArray(content)) {
		return (content as any[])
			.filter((p: any) => p?.type === "text" && typeof p?.text === "string")
			.map((p: any) => p.text)
			.join("\n\n")
			.trim();
	}
	return "";
}

/**
 * Format messages for Cline's API while preserving the full conversation
 * history including tool calls and results.
 *
 * Strategy:
 * 1. First user message gets wrapped in <task> (Cline-trained models expect this)
 * 2. Subsequent messages are sent with proper role alternation
 * 3. Tool calls stay in assistant messages (not collapsed)
 * 4. Tool results are sent as "tool" role messages
 *
 * This matches how Cline's native SDK sends messages to the API.
 */
function shapeMessagesForCline(messages: any[]): any[] {
	const shaped: any[] = [];
	let firstUserFound = false;

	for (const msg of messages) {
		const role = msg?.role ?? "user";
		const content = msg?.content;

		// Skip empty messages
		if (!content) continue;

		// System messages: extract text and include
		if (role === "system") {
			const text = extractText(content);
			if (text) shaped.push({ role: "system", content: text });
			continue;
		}

		// First user message: wrap in <task> for Cline-trained models
		if (role === "user" && !firstUserFound) {
			firstUserFound = true;
			const text = extractText(content);
			if (text) {
				shaped.push({
					role: "user",
					content: [{ type: "text", text: `<task>\n${text}\n</task>` }],
				});
			}
			continue;
		}

		// Tool messages: send as-is with tool role
		if (role === "tool") {
			// Tool messages from Pi come as { role: "tool", content: [...] }
			// or { role: "tool", content: "text" }
			shaped.push({ role: "tool", content });
			continue;
		}

		// Assistant and remaining user messages: send as-is
		// This preserves tool-call blocks in assistant messages
		if (role === "assistant" || role === "user") {
			shaped.push({ role, content });
		}
	}

	return shaped;
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
			api: "openai-completions" as const,
			authHeader: false,
			headers: buildClineHeaders(),
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

	pi.on("context", (event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_CLINE) return;
		const sourceMessages = Array.isArray(event.messages) ? event.messages : [];
		return { messages: shapeMessagesForCline(sourceMessages) };
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
