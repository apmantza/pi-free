/**
 * Kilo Provider Extension
 *
 * Provides access to 300+ AI models via the Kilo Gateway (OpenRouter-compatible).
 * Fetches ALL models at startup (like Cline/OpenRouter), defaults to free-only view.
 * Run /login kilo or use /toggle-kilo to access paid models.
 *
 * Responds to global free-only filter for free/paid model filtering.
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Free models visible immediately; /login kilo for paid access
 */

import type { Api, Model, OAuthCredentials } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {
	getKiloFreeOnly,
	getKiloShowPaid,
	PROVIDER_KILO,
	saveConfig,
} from "../../config.ts";
import { URL_KILO_TOS } from "../../constants.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
import { wrapSessionStartHandler } from "../../lib/session-start-metrics.ts";
import { cleanModelName, logWarning } from "../../lib/util.ts";
import {
	createCtxReRegister,
	createReRegister,
	enhanceWithCI,
	type StoredModels,
} from "../../provider-helper.ts";
import { loginKilo, refreshKiloToken } from "./kilo-auth.ts";
import { fetchKiloModels, KILO_GATEWAY_BASE } from "./kilo-models.ts";

/** Kilo Gateway compat overrides, borrowed from pi-kilo-provider. */
const KILO_COMPAT = {
	supportsStore: false,
	supportsDeveloperRole: false,
	supportsReasoningEffort: false,
	supportsUsageInStreaming: false,
	supportsStrictMode: false,
	thinkingFormat: "openrouter" as const,
	maxTokensField: "max_tokens" as const,
};

// =============================================================================
// XML leak detection and auto-retry
// =============================================================================

/**
 * Detect when a model outputs raw XML tool calls instead of using
 * native function calling. This happens when gateways don't pass
 * tool definitions to certain models (e.g., step-3.7-flash via Kilo).
 *
 * Pattern: <tool><name>tool_name</name><param>...</param></tool>
 */
function detectXmlToolLeak(text: string): boolean {
	// Use simple string searches instead of regex to avoid ReDoS risks.
	const lower = text.toLowerCase();
	return (
		lower.includes("<tool>") ||
		lower.includes("<tool_call>") ||
		lower.includes("<function_call>") ||
		lower.includes("<invoke") ||
		lower.includes("<antml:tool_use>")
	);
}

function findTag(
	text: string,
	tag: string,
	start = 0,
): { start: number; end: number; content: string } | null {
	const open = `<${tag}>`;
	const close = `</${tag}>`;
	const openIdx = text.indexOf(open, start);
	if (openIdx === -1) return null;
	const contentStart = openIdx + open.length;
	const closeIdx = text.indexOf(close, contentStart);
	if (closeIdx === -1) return null;
	return {
		start: openIdx,
		end: closeIdx + close.length,
		content: text.slice(contentStart, closeIdx),
	};
}

/**
 * Parse XML tool calls and convert to pi's tool call format.
 * Returns null if parsing fails.
 *
 * Uses simple string scanning instead of regex with backreferences
 * to avoid super-linear backtracking (ReDoS).
 */
function parseXmlToolCalls(
	text: string,
): Array<{ name: string; arguments: Record<string, unknown> }> | null {
	try {
		const calls: Array<{ name: string; arguments: Record<string, unknown> }> =
			[];
		let searchStart = 0;
		while (true) {
			const toolBlock = findTag(text, "tool", searchStart);
			if (!toolBlock) break;
			searchStart = toolBlock.end;

			const nameTag = findTag(toolBlock.content, "name");
			if (!nameTag) continue;
			const name = nameTag.content.trim();
			if (!name) continue;

			const args: Record<string, unknown> = {};
			// Skip the <name>...</name> block we already consumed.
			let paramStart = nameTag.end;
			const paramsText = toolBlock.content;
			while (true) {
				const openIdx = paramsText.indexOf("<", paramStart);
				if (openIdx === -1) break;
				const closeOpenIdx = paramsText.indexOf(">", openIdx);
				if (closeOpenIdx === -1) break;
				const tagName = paramsText.slice(openIdx + 1, closeOpenIdx).trim();
				if (!tagName || tagName.startsWith("/")) {
					paramStart = closeOpenIdx + 1;
					continue;
				}
				const closeTag = `</${tagName}>`;
				const closeIdx = paramsText.indexOf(closeTag, closeOpenIdx + 1);
				if (closeIdx === -1) break;
				const value = paramsText.slice(closeOpenIdx + 1, closeIdx).trim();
				try {
					args[tagName] = JSON.parse(value);
				} catch {
					args[tagName] = value;
				}
				paramStart = closeIdx + closeTag.length;
			}
			calls.push({ name, arguments: args });
		}
		return calls.length > 0 ? calls : null;
	} catch {
		return null;
	}
}

// =============================================================================
// Extension entry point
// =============================================================================
const KILO_PROVIDER_CONFIG = {
	providerId: PROVIDER_KILO,
	baseUrl: KILO_GATEWAY_BASE,
	apiKey: "$KILO_API_KEY",
	headers: {
		"X-KILOCODE-EDITORNAME": "Pi",
	},
};

/** Apply Kilo-specific compat overrides while preserving provider/model values. */
function applyKiloCompat<T extends { compat?: ProviderModelConfig["compat"] }>(
	models: T[],
): T[] {
	return models.map((m) => ({
		...m,
		compat: {
			...KILO_COMPAT,
			...m.compat,
		},
	}));
}

export default async function kiloProvider(pi: ExtensionAPI) {
	// Try to fetch ALL models at startup (like Cline/OpenRouter)
	// If no API key, this will return free models only
	let allModels: ProviderModelConfig[] = [];
	let freeModels: ProviderModelConfig[] = [];

	try {
		// Fetch all models (returns free-only if no auth, all if auth available)
		allModels = await fetchKiloModels({ freeOnly: false });
		// Derive free list using isFreeModel with allModels for detection
		freeModels = allModels.filter((m) =>
			isFreeModel({ ...m, provider: PROVIDER_KILO }, allModels),
		);
	} catch (error) {
		logWarning("kilo", "Failed to fetch models at startup", error);
		// Fallback: try to fetch just free models
		try {
			freeModels = await fetchKiloModels({ freeOnly: true });
		} catch (e) {
			logWarning("kilo", "Failed to fetch free models", e);
		}
	}

	// State tracking
	const kiloShowPaid = getKiloShowPaid();
	const kiloFreeOnly = getKiloFreeOnly();
	let showPaidModels = kiloShowPaid;
	let currentModels = kiloShowPaid && !kiloFreeOnly ? allModels : freeModels;

	// Shared model storage for global toggle
	const stored: StoredModels = { free: freeModels, all: allModels };

	// Create re-register function
	const baseReRegister = createReRegister(pi, {
		...KILO_PROVIDER_CONFIG,
	});
	const reRegister = (models: ProviderModelConfig[]) =>
		baseReRegister(applyKiloCompat(models));

	// Register with global toggle system
	registerWithGlobalToggle(
		PROVIDER_KILO,
		stored,
		reRegister,
		!!process.env.KILO_API_KEY,
	);

	// OAuth config for Kilo
	const oauthConfig = {
		name: "Kilo",
		login: async (callbacks: any) => {
			const cred = await loginKilo(callbacks);
			try {
				// Fetch all models with the new token
				const newModels = await fetchKiloModels({
					token: cred.access,
					freeOnly: false,
				});
				allModels = newModels;
				stored.all = allModels;
				freeModels = allModels.filter((m) =>
					isFreeModel({ ...m, provider: PROVIDER_KILO }, allModels),
				);
				stored.free = freeModels;

				// Update global toggle registration with new lists
				const baseGlobalReRegister = createReRegister(pi, {
					...KILO_PROVIDER_CONFIG,
				});
				const globalReRegister = (models: ProviderModelConfig[]) =>
					baseGlobalReRegister(applyKiloCompat(models));
				registerWithGlobalToggle(PROVIDER_KILO, stored, globalReRegister, true);

				// If paid mode is enabled, show all models
				if (showPaidModels && !kiloFreeOnly) {
					currentModels = allModels;
					globalReRegister(allModels);
				}
			} catch (error) {
				logWarning("kilo", "Failed to fetch models after login", error);
			}
			return cred;
		},
		refreshToken: refreshKiloToken,
		getApiKey: (cred: OAuthCredentials) => cred.access,
		modifyModels: (models: Model<Api>[], _cred: OAuthCredentials) => {
			if (!showPaidModels || kiloFreeOnly || allModels.length === 0) {
				return models;
			}
			const template = models.find((m) => m.provider === PROVIDER_KILO);
			if (!template) return models;
			const nonKilo = models.filter((m) => m.provider !== PROVIDER_KILO);
			const fullModels = applyKiloCompat(
				allModels.map((m) => ({
					...template,
					id: m.id,
					name: cleanModelName(m.name),
					reasoning: m.reasoning,
					input: m.input,
					cost: m.cost,
					contextWindow: m.contextWindow,
					maxTokens: m.maxTokens,
				})),
			);
			return [...nonKilo, ...fullModels] as Model<"openai-completions">[];
		},
	};

	// Register initial provider (default to free models)
	const modelsWithCompat = applyKiloCompat(currentModels);
	pi.registerProvider(PROVIDER_KILO, {
		baseUrl: KILO_GATEWAY_BASE,
		apiKey: "$KILO_API_KEY",
		api: "openai-completions" as const,
		headers: {
			"X-KILOCODE-EDITORNAME": "Pi",
			"User-Agent": "pi-free-providers",
		},
		models: enhanceWithCI(modelsWithCompat),
		oauth: oauthConfig,
	});

	// Registration complete - models registered silently (use LOG_LEVEL=info to see details)

	// Per-provider toggle command
	pi.registerCommand("toggle-kilo", {
		description: "Toggle between free and all Kilo models",
		handler: async (_args, ctx) => {
			showPaidModels = !showPaidModels;
			saveConfig({ kilo_show_paid: showPaidModels });

			// Determine which models to show
			const modelsToShow =
				showPaidModels && allModels.length > 0 ? allModels : freeModels;

			currentModels = modelsToShow;
			reRegister(modelsToShow);

			const freeCount = freeModels.length;
			const paidCount = allModels.length - freeCount;

			if (showPaidModels && allModels.length > 0) {
				ctx.ui.notify(
					`kilo: showing all ${allModels.length} models (${freeCount} free, ${paidCount} paid)`,
					"info",
				);
			} else {
				ctx.ui.notify(
					`kilo: showing ${freeCount} free models (${paidCount} paid hidden)`,
					"info",
				);
			}
		},
	});

	// ToS notice on provider selection
	let tosShown = false;
	pi.on("model_select", async (_event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_KILO) return;

		// ToS notice (once)
		if (tosShown) return;
		tosShown = true;
		const cred = ctx.modelRegistry.authStorage.get(PROVIDER_KILO);
		if (cred?.type === "oauth") return;
		const paidCount = allModels.length - freeModels.length;
		if (paidCount > 0) {
			ctx.ui.notify(
				`Kilo: ${freeModels.length} free models shown. Use /toggle-kilo or /login kilo for ${paidCount} paid models. Terms: ${URL_KILO_TOS}`,
				"info",
			);
		}
	});

	// ── XML leak detection and auto-retry ─────────────────────────
	//
	// When a model outputs raw XML tool calls (<tool><name>...</name></tool>)
	// instead of native function calling, detect it and rewrite the message
	// to force the model to use proper tool calling on the next turn.

	let xmlLeakRetryCount = 0;
	const MAX_XML_LEAK_RETRIES = 2;

	(pi as any).on("message_end", (event: any, ctx: any) => {
		if (ctx.model?.provider !== PROVIDER_KILO) return;

		const msg = event.message;
		if (msg.role !== "assistant") return;

		// Extract text content from the message
		let text = "";
		if (typeof msg.content === "string") {
			text = msg.content;
		} else if (Array.isArray(msg.content)) {
			text = msg.content
				.filter((p: any) => p?.type === "text" && typeof p?.text === "string")
				.map((p: any) => p.text)
				.join("\n");
		}

		if (!text || !detectXmlToolLeak(text)) {
			xmlLeakRetryCount = 0; // Reset on clean response
			return;
		}

		// XML leak detected
		if (xmlLeakRetryCount >= MAX_XML_LEAK_RETRIES) {
			xmlLeakRetryCount = 0;
			logWarning("kilo", "XML tool leak persisted after retries, giving up");
			return;
		}

		xmlLeakRetryCount++;
		logWarning(
			"kilo",
			`XML tool leak detected (attempt ${xmlLeakRetryCount}/${MAX_XML_LEAK_RETRIES}), rewriting message`,
		);

		// Try to parse the XML tool calls
		const parsedCalls = parseXmlToolCalls(text);
		if (parsedCalls && parsedCalls.length > 0) {
			// We parsed the tool calls - convert to proper toolCall format
			const toolCalls = parsedCalls.map((call, i) => ({
				type: "toolCall" as const,
				id: `xml_leak_${Date.now()}_${i}`,
				name: call.name,
				arguments: call.arguments,
			}));

			return {
				...msg,
				content: [
					{
						type: "text",
						text:
							text.replace(/<tool>[\s\S]*?<\/tool>/g, "").trim() ||
							"(parsed tool calls)",
					},
					...toolCalls,
				],
			};
		}

		// Can't parse - add a correction message to force retry
		// We rewrite the message to include a note about using proper tool calling
		return {
			...msg,
			content: [
				{
					type: "text",
					text: `${text}\n\n---\n[SYSTEM: You outputted XML tool calls instead of using the function calling API. Please use the native tool/function calling format with JSON arguments, not XML tags like <tool>.]`,
				},
			],
		};
	});

	// Refresh models on session start if authenticated
	let refreshInFlight: Promise<void> | undefined;
	pi.on(
		"session_start",
		wrapSessionStartHandler("kilo", (_event, ctx) => {
			const cred = ctx.modelRegistry.authStorage.get(PROVIDER_KILO);
			if (cred?.type !== "oauth" || refreshInFlight) return Promise.resolve();

			refreshInFlight = fetchKiloModels({ token: cred.access, freeOnly: false })
				.then((newModels) => {
					allModels = newModels;
					stored.all = allModels;
					freeModels = allModels.filter((m) =>
						isFreeModel({ ...m, provider: PROVIDER_KILO }, allModels),
					);
					stored.free = freeModels;

					// Update global toggle registration
					const baseCtxReRegister = createCtxReRegister(ctx as any, {
						...KILO_PROVIDER_CONFIG,
					});
					const ctxReRegister = (models: ProviderModelConfig[]) =>
						baseCtxReRegister(applyKiloCompat(models));
					registerWithGlobalToggle(PROVIDER_KILO, stored, ctxReRegister, true);

					// Apply current view mode
					if (showPaidModels && !getKiloFreeOnly()) {
						ctxReRegister(allModels);
					}
				})
				.catch((error) => {
					logWarning(
						"kilo",
						"Failed to refresh models at session start",
						error instanceof Error ? error.message : String(error),
					);
				})
				.finally(() => {
					refreshInFlight = undefined;
				});
			return Promise.resolve();
		}),
	);
}
