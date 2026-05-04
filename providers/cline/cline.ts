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

import type { OAuthCredentials } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getClineShowPaid } from "../../config.ts";
import { BASE_URL_CLINE, PROVIDER_CLINE } from "../../constants.ts";
import { isFreeModel, registerWithGlobalToggle } from "../../lib/registry.ts";
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
// Context shaping — Cline's API requires a specific message envelope
// =============================================================================

const TASK_PROGRESS_BLOCK = `
# task_progress List (Optional - Plan Mode)

While in PLAN MODE, if you've outlined concrete steps or requirements for the user, you may include a preliminary todo list using the task_progress parameter.

1. To create or update a todo list, include the task_progress parameter in the next tool call
2. Review each item and update its status:
   - Mark completed items with: - [x]
   - Keep incomplete items as: - [ ]
3. Modify the list as needed
4. Ensure the list accurately reflects the current state`;

function buildEnvironmentDetails(): string {
	const cwd = process.cwd();
	return `<environmentDetails>
# Visual Studio Code Visible Files
(No visible files)

# Visual Studio Code Open Tabs
(No open tabs)

# Current Working Directory (${cwd}) Files
(No files)

# Context Window Usage
0 / 204.8K tokens used (0%)

# Current Mode
PLAN MODE
</environmentDetails>`;
}

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

function isClineWrapped(content: unknown): boolean {
	if (!Array.isArray(content)) return false;
	const texts = (content as any[])
		.filter((p: any) => p?.type === "text" && typeof p?.text === "string")
		.map((p: any) => p.text as string);
	return (
		texts.some((t) => /<task>[\s\S]*<\/task>/.test(t)) &&
		texts.some((t) => t.includes("task_progress List")) &&
		texts.some((t) => t.includes("<environmentDetails>"))
	);
}

function extractTaskBody(content: unknown): string {
	if (!Array.isArray(content)) return "";
	for (const p of content as any[]) {
		if (p?.type !== "text" || typeof p?.text !== "string") continue;
		const m = p.text.match(/<task>([\s\S]*?)<\/task>/);
		if (m?.[1]) return m[1].trim();
	}
	return "";
}

function findLastClineWrappedMessage(messages: any[]): {
	index: number;
	transcript: string;
} {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i]?.role !== "user") continue;
		if (!isClineWrapped(messages[i]?.content)) continue;
		return { index: i, transcript: extractTaskBody(messages[i].content) };
	}
	return { index: -1, transcript: "" };
}

function buildTranscriptParts(
	messages: any[],
	startIdx: number,
	baseTranscript: string,
): string[] {
	const parts: string[] = baseTranscript ? [baseTranscript] : [];

	for (let i = startIdx; i < messages.length; i++) {
		const msg = messages[i];
		const role = msg?.role ?? "user";
		if (role === "system") continue;
		if (role === "user" && isClineWrapped(msg?.content)) continue;
		const text = extractText(msg?.content).trim();
		if (!text) continue;

		if (role === "tool") {
			parts.push(`<tool_result>\n${text}\n</tool_result>`);
		} else if (role !== "assistant") {
			parts.push(`[${role}]\n${text}`);
		}
	}

	return parts;
}

function buildCollapsedMessage(messages: any[], transcript: string): any[] {
	const collapsed: any[] = [];
	const systemMsg = messages.find((m: any) => m?.role === "system");
	if (systemMsg) {
		const systemText = extractText(systemMsg.content);
		if (systemText) collapsed.push({ role: "system", content: systemText });
	}

	collapsed.push({
		role: "user",
		content: [
			{ type: "text", text: `<task>\n${transcript}\n</task>` },
			{ type: "text", text: TASK_PROGRESS_BLOCK },
			{ type: "text", text: buildEnvironmentDetails() },
		],
	});

	return collapsed;
}

function shapeMessagesForCline(messages: any[]): any[] {
	const { index: lastWrappedIdx, transcript: baseTranscript } =
		findLastClineWrappedMessage(messages);

	const startIdx = lastWrappedIdx >= 0 ? lastWrappedIdx + 1 : 0;
	const parts = buildTranscriptParts(messages, startIdx, baseTranscript);
	const transcript = parts.join("\n\n").trim() || "(no conversation yet)";

	return buildCollapsedMessage(messages, transcript);
}

// =============================================================================
// Extension entry point
// =============================================================================

export default async function clineProvider(pi: ExtensionAPI) {
	let allModels = await fetchClineModels(false).catch((err) => {
		logWarning("cline", "Failed to fetch models at startup", err);
		return [];
	});
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

	registerWithGlobalToggle(PROVIDER_CLINE, stored, (m) => reRegister(m), false);
	toggleState.applyCurrent(reRegister);

	pi.registerCommand("toggle-cline", {
		description: "Toggle between free and all Cline models",
		handler: async (_args, ctx) => {
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

	pi.on("before_agent_start", async (_event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_CLINE) return;
		_currentTaskId = generateUlid();
		toggleState.applyCurrent(reRegister);
	});

	pi.on("context", async (event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_CLINE) return;
		const sourceMessages = Array.isArray(event.messages) ? event.messages : [];
		return { messages: shapeMessagesForCline(sourceMessages) };
	});

	pi.on("session_start", async (_event, ctx) => {
		try {
			const fresh = await fetchClineModels(false);
			if (fresh.length > 0) {
				allModels = fresh;
				freeModels = allModels.filter((m) =>
					isFreeModel({ ...m, provider: PROVIDER_CLINE }, allModels),
				);
				stored.all = allModels;
				stored.free = freeModels;
				toggleState.setModels(stored);
				toggleState.applyCurrent(reRegister);
				if (ctx.model?.provider === PROVIDER_CLINE) {
					const freeCount = stored.free.length;
					const paidCount = stored.all.length - freeCount;
					ctx.ui.notify(
						`Cline: ${freeCount} free, ${paidCount} paid models available`,
						"info",
					);
				}
			}
		} catch (err) {
			logWarning("cline", "Failed to refresh models at session start", err);
		}
	});
}
