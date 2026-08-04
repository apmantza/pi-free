/**
 * Kilo Provider Extension
 *
 * Provides access to 300+ AI models via the Kilo Gateway (OpenRouter-compatible).
 * Registered as a native pi-ai `Provider` (createProvider object form) so Pi owns
 * credential refresh, background model refresh, and offline initialization:
 *
 *   - The factory is synchronous and network-free — it builds the provider object
 *     and registers it. Models load via `refreshModels` (offline init from the
 *     native models store, then a background fetch), so Kilo no longer owns any of
 *     Pi's startup critical path.
 *   - Native `auth` (API key + OAuth device flow) persisted to auth.json.
 *   - Free/paid filtering stays on pi-free's re-registration toggle so it keeps
 *     composing with the global /toggle-free system.
 *
 * Run /login kilo or use /toggle-kilo to access paid models.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getKiloApiKey, getKiloShowPaid, PROVIDER_KILO } from "../../config.ts";
import { URL_KILO_TOS } from "../../constants.ts";
import { registerWithGlobalToggle } from "../../lib/registry.ts";
import {
	registerNativeProvider,
	registerNativeProviderRefresh,
	registerNativeProviderToggle,
} from "../../lib/native-provider.ts";
import { createLogger } from "../../lib/logger.ts";
import { logWarning } from "../../lib/util.ts";
import { isCurrentModelOAuth } from "../../provider-helper.ts";
import { createKiloProvider } from "./kilo-provider.ts";

// =============================================================================
// XML leak detection and auto-retry
// =============================================================================

const _logger = createLogger("kilo");

// NOTE: the "<invoke" / "<antml:tool_use>" needles are built via concatenation
// purely so this source file does not contain a literal token that the agent
// harness's own XML framing would treat as a tool-call boundary. Behavior is
// identical to a plain string literal.
const XML_LEAK_NEEDLES: readonly string[] = [
	"<tool>",
	"<tool_call>",
	"<function_call>",
	"<" + "invoke",
	"<" + String.fromCharCode(97) + "ntml:tool_use>",
];
/**
 * Detect when a model outputs raw XML tool calls instead of using
 * native function calling. This happens when gateways don't pass
 * tool definitions to certain models (e.g., step-3.7-flash via Kilo).
 */
function detectXmlToolLeak(text: string): boolean {
	// Use simple string searches instead of regex to avoid ReDoS risks.
	const lower = text.toLowerCase();
	return XML_LEAK_NEEDLES.some((needle) => lower.includes(needle));
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

export default async function kiloProvider(pi: ExtensionAPI) {
	const { provider, stored } = createKiloProvider();

	// Register the native provider. The factory performs NO network I/O: models
	// load via refreshModels (offline init from the store, then a background
	// fetch), so Kilo no longer owns any of Pi's startup critical path.
	registerNativeProvider(pi, provider);

	// Re-registration invalidates Pi's availability snapshot while preserving the
	// complete catalog and native auth on the same provider object.
	const reRegister = () => {
		registerNativeProvider(pi, provider);
	};

	const hasKiloKey = !!getKiloApiKey();
	registerWithGlobalToggle(PROVIDER_KILO, stored, reRegister, hasKiloKey, {
		native: true,
		invalidate: reRegister,
	});

	registerNativeProviderToggle(pi, {
		providerId: PROVIDER_KILO,
		stored,
		getShowPaid: getKiloShowPaid,
		reRegister,
	});

	// ToS notice on provider selection
	let tosShown = false;
	pi.on("model_select", async (_event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_KILO) return;
		if (tosShown) return;
		tosShown = true;
		if (isCurrentModelOAuth(ctx)) return;
		const paidCount = stored.all.length - stored.free.length;
		if (paidCount > 0) {
			_logger.debug("Free-model terms notice", {
				provider: PROVIDER_KILO,
				freeModelCount: stored.free.length,
				paidModelCount: paidCount,
				termsUrl: URL_KILO_TOS,
			});
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

	registerNativeProviderRefresh(pi, PROVIDER_KILO);
}
