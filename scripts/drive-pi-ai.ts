/**
 * Drive pi-ai against a registered provider model — the same code path Pi
 * uses at runtime — so provider implementations can be debugged and verified
 * without clicking through the TUI.
 *
 * The model comes from Pi's native models store (~/.pi/agent/models-store.json),
 * which is exactly what a running session serves, including the api/provider/
 * baseUrl/compat stamping that registerNativeOpenAIProvider applies. Models
 * are additionally re-stamped with gateway compat (supportsDeveloperRole:false)
 * so stores written by older builds behave like freshly refreshed ones.
 *
 * The credential resolves like Pi does: stored credential from
 * ~/.pi/agent/auth.json first (api_key values directly; oauth access tokens
 * best-effort as bearer), then the <PROVIDER>_API_KEY environment variable.
 *
 * Usage (via tsx, which is already a dev dependency):
 *   npx tsx scripts/drive-pi-ai.ts --list
 *   npx tsx scripts/drive-pi-ai.ts --provider requesty
 *   npx tsx scripts/drive-pi-ai.ts --provider tokenrouter --model qwen3.8-max-free
 *   npx tsx scripts/drive-pi-ai.ts --provider zenmux --model glm --effort low --simple
 *   npx tsx scripts/drive-pi-ai.ts --provider kilo --model claude --prompt "2+2?"
 *
 * Flags:
 *   --list            List providers and models from the store, then exit.
 *   --provider <id>   Provider id in the store (required unless --list).
 *   --model <substr>  Substring match on model id; defaults to the first model.
 *   --effort <level>  Reasoning level passed to streamSimple (off/minimal/low/medium/high/xhigh).
 *   --prompt <text>   Final user message; default "Now say ok."
 *   --simple          Single user turn only — skip the tool-call history replay.
 *   --max-events <n>  Safety cap on streamed events (default 4000).
 *
 * Exit codes: 0 on a completed stream, 1 on an error event or setup failure.
 */

import fs from "node:fs";
import path from "node:path";

interface StoreModel {
	id: string;
	provider: string;
	api?: string;
	baseUrl?: string;
	name?: string;
	reasoning?: boolean;
	compat?: Record<string, unknown>;
	[key: string]: unknown;
}

/** A parsed JSON document as read from Pi's stores. */
type JsonDocument =
	| Record<string, unknown>
	| unknown[]
	| string
	| number
	| boolean
	| null
	| undefined;

function readJson(filePath: string): JsonDocument {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8")) as JsonDocument;
	} catch {
		return undefined;
	}
}

function homeFile(...segments: string[]): string {
	const home = process.env.USERPROFILE || process.env.HOME || "";
	return path.join(home, ...segments);
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
	const args: Record<string, string | boolean> = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith("--")) continue;
		const key = arg.slice(2);
		if (key === "list" || key === "simple") {
			args[key] = true;
			continue;
		}
		const value = argv[i + 1];
		if (value === undefined || value.startsWith("--")) {
			args[key] = true;
		} else {
			args[key] = value;
			i++;
		}
	}
	return args;
}

function listProviders(store: Record<string, { models?: StoreModel[] }>): void {
	const ids = Object.keys(store).sort();
	for (const id of ids) {
		const models = store[id]?.models ?? [];
		console.log(`${id}: ${models.length} models`);
		for (const model of models.slice(0, 5)) {
			console.log(`    ${model.id}`);
		}
		if (models.length > 5) console.log(`    … and ${models.length - 5} more`);
	}
}

/** Stored credential first (Pi's order), then the ambient env key. */
function resolveApiKey(providerId: string): string | undefined {
	const auth = readJson(homeFile(".pi", "agent", "auth.json")) as
		| Record<string, { type?: string; key?: string; access?: string }>
		| undefined;
	const credential = auth?.[providerId];
	if (credential?.type === "api_key" && credential.key) return credential.key;
	// OAuth credentials vary per provider (kilo/cline map access tokens to
	// bearer); best-effort pass-through so the harness stays generic.
	if (credential?.type === "oauth" && credential.access) return credential.access;
	const envKey = `${providerId.replaceAll("-", "_").toUpperCase()}_API_KEY`;
	return process.env[envKey];
}

/**
 * Re-stamp gateway compat on a restored model. Stores written before the
 * developer-role fix lack compat entirely; re-stamping is idempotent for
 * fresh entries and keeps old stores on the same wire behavior as pi-ai's
 * detection would produce for new ones.
 */
function withGatewayCompat(model: StoreModel): StoreModel {
	return {
		...model,
		compat: { ...(model.compat ?? {}), supportsDeveloperRole: false },
	};
}

async function main(): Promise<number> {
	const args = parseArgs(process.argv.slice(2));
	const store = readJson(homeFile(".pi", "agent", "models-store.json")) as
		| Record<string, { models?: StoreModel[] }>
		| undefined;
	if (!store) {
		console.error("No models store at ~/.pi/agent/models-store.json");
		return 1;
	}

	if (args.list) {
		listProviders(store);
		return 0;
	}

	const providerId = typeof args.provider === "string" ? args.provider : "";
	if (!providerId) {
		console.error("Usage: npx tsx scripts/drive-pi-ai.ts --provider <id> [--model <substr>] [--help]");
		console.error("Run with --list to see providers in the store.");
		return 1;
	}
	const providerModels = store[providerId]?.models ?? [];
	if (providerModels.length === 0) {
		console.error(`Provider '${providerId}' has no models in the store.`);
		console.error(`Available: ${Object.keys(store).sort().join(", ")}`);
		return 1;
	}

	const needle = typeof args.model === "string" ? args.model.toLowerCase() : "";
	// Exact id match wins; substring is only the fallback for convenience.
	const base =
		(needle
			? (providerModels.find((m) => m.id.toLowerCase() === needle) ??
				providerModels.find((m) => m.id.toLowerCase().includes(needle)))
			: providerModels[0]) ?? null;
	if (!base) {
		console.error(`No model matching '${needle}' under ${providerId}.`);
		console.error(
			`Sample ids: ${providerModels.slice(0, 8).map((m) => m.id).join(", ")}`,
		);
		return 1;
	}

	const apiKey = resolveApiKey(providerId);
	if (!apiKey) {
		console.error(
			`No credential for '${providerId}' (auth.json or ${providerId.replaceAll("-", "_").toUpperCase()}_API_KEY).`,
		);
		return 1;
	}

	const model = withGatewayCompat(base);
	console.log(
		`model: ${model.provider}/${model.id} | api=${model.api} | reasoning=${String(model.reasoning)} | ctx=${String(model.contextWindow)}`,
	);

	const prompt = typeof args.prompt === "string" ? args.prompt : "Now say ok.";
	const simple = args.simple === true;
	const context = simple
		? {
				systemPrompt: "You are a coding agent.",
				messages: [
					{ role: "user", content: [{ type: "text", text: prompt }] },
				],
			}
		: {
				// Realistic coding-agent turn: tool-call history with replayed
				// thinking, a tool result, and a follow-up user message.
				systemPrompt: "You are a coding agent.",
				messages: [
					{ role: "user", content: [{ type: "text", text: "Read the file then report." }] },
					{
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "I should call the tool." },
							{ type: "toolCall", id: "call_1", name: "read_file", arguments: { path: "a.ts" } },
						],
					},
					{
						role: "toolResult",
						toolCallId: "call_1",
						toolName: "read_file",
						content: [{ type: "text", text: "export const a = 1;" }],
					},
					{ role: "user", content: [{ type: "text", text: prompt }] },
				],
				tools: [
					{
						name: "read_file",
						description: "Read a file from disk.",
						parameters: {
							type: "object",
							properties: { path: { type: "string" } },
							required: ["path"],
						},
					},
				],
			};

	const { lazyOpenAICompletionsApi } = await import("../lib/lazy-compat.ts");
	const api = lazyOpenAICompletionsApi();

	const maxEvents = Number(args["max-events"] ?? 4_000) || 4_000;
	let text = "";
	let thinkingDeltas = 0;
	let toolCalls = 0;
	let usage: unknown;
	const startedAt = Date.now();

	const options: Record<string, unknown> = { apiKey };
	if (typeof args.effort === "string") options.reasoning = args.effort;

	try {
		for await (const event of api.streamSimple(
			model as never,
			context as never,
			options as never,
		)) {
			switch (event.type) {
				case "text_delta":
					text += (event as { delta?: string }).delta ?? "";
					break;
				case "thinking_delta":
					thinkingDeltas++;
					break;
				case "toolcall_end":
					toolCalls++;
					break;
				case "error":
					console.error(
						`ERROR event: ${String((event as { error?: { errorMessage?: string } }).error?.errorMessage ?? "unknown").slice(0, 300)}`,
					);
					return 1;
				default:
					if ((event as { usage?: unknown }).usage) {
						usage = (event as { usage?: unknown }).usage;
					}
			}
			if (text.length + thinkingDeltas > maxEvents) {
				console.error("(event cap reached — aborting stream)");
				break;
			}
		}
	} catch (error) {
		console.error(
			`THREW: ${error instanceof Error ? error.message : String(error)}`,
		);
		return 1;
	}

	const ms = Date.now() - startedAt;
	console.log(
		`SUCCESS in ${ms}ms — text="${text.trim().slice(0, 120)}" thinking-deltas=${thinkingDeltas} toolCalls=${toolCalls}${usage ? ` usage=${JSON.stringify(usage)}` : ""}`,
	);
	return 0;
}

process.exitCode = await main();
