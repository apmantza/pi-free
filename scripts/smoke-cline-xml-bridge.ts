#!/usr/bin/env tsx
/**
 * Live smoke test for the Cline XML tool bridge.
 *
 * This intentionally hits the real Cline API and consumes quota/credits.
 * It is not part of the normal test suite; run explicitly with:
 *
 *   npm run smoke:cline
 *
 * Requirements:
 * - Existing Cline OAuth credentials in ~/.pi/agent/auth.json
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Model, OAuthCredentials, ToolCall } from "@earendil-works/pi-ai";
import { Type } from "@earendil-works/pi-ai";
import { BASE_URL_CLINE, PROVIDER_CLINE } from "../constants.ts";
import { refreshClineToken } from "../providers/cline/cline-auth.ts";
import { streamClineXml } from "../providers/cline/cline-xml-bridge.ts";

const AUTH_PATH = path.join(os.homedir(), ".pi", "agent", "auth.json");
const DEFAULT_MODELS = ["xiaomi/mimo-v2.5", "nex-agi/nex-n2-pro:free"];

function readAuthFile(): Record<string, unknown> {
	if (!fs.existsSync(AUTH_PATH)) {
		throw new Error(`Missing auth file: ${AUTH_PATH}`);
	}
	return JSON.parse(fs.readFileSync(AUTH_PATH, "utf8")) as Record<
		string,
		unknown
	>;
}

function getClineCredentials(auth: Record<string, unknown>): OAuthCredentials {
	const entry = auth[PROVIDER_CLINE] as Partial<OAuthCredentials> | undefined;
	if (!entry?.access || !entry.refresh || !entry.expires) {
		throw new Error("Missing Cline OAuth credentials. Run /login cline first.");
	}
	return {
		access: String(entry.access),
		refresh: String(entry.refresh),
		expires: Number(entry.expires),
	};
}

async function refreshAndPersistCredentials(): Promise<OAuthCredentials> {
	const auth = readAuthFile();
	const credentials = getClineCredentials(auth);

	// Force a refresh: the models endpoint can accept stale-looking access tokens,
	// while chat/completions may reject them with a generic "latest version" 401.
	const refreshed = await refreshClineToken({ ...credentials, expires: 0 });
	auth[PROVIDER_CLINE] = {
		...(auth[PROVIDER_CLINE] as Record<string, unknown>),
		...refreshed,
	};
	fs.writeFileSync(AUTH_PATH, `${JSON.stringify(auth, null, 2)}\n`);
	return refreshed;
}

function toApiKey(credentials: OAuthCredentials): string {
	return credentials.access.startsWith("workos:")
		? credentials.access
		: `workos:${credentials.access}`;
}

function buildHeaders(modelId: string): Record<string, string> {
	return {
		"HTTP-Referer": "https://cline.bot",
		"X-Title": "Cline",
		"X-Task-ID": `pi-free-smoke-${modelId.replaceAll("/", "-")}-${Date.now()}`,
		"X-PLATFORM": "Visual Studio Code",
		"X-PLATFORM-VERSION": "1.109.3",
		"X-CLIENT-TYPE": "VSCode Extension",
		"X-CLIENT-VERSION": "3.76.0",
		"X-CORE-VERSION": "3.76.0",
		"X-Is-Multiroot": "false",
	};
}

function buildModel(modelId: string): Model<string> {
	return {
		id: modelId,
		name: modelId,
		api: "cline-xml-tools",
		provider: PROVIDER_CLINE,
		baseUrl: BASE_URL_CLINE,
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 4_096,
	};
}

async function smokeModel(modelId: string, apiKey: string): Promise<void> {
	const stream = streamClineXml(
		buildModel(modelId),
		{
			systemPrompt: "You are a coding agent. Use tools when needed.",
			messages: [
				{
					role: "user",
					content: "Read package.json.",
					timestamp: Date.now(),
				},
			],
			tools: [
				{
					name: "read",
					description: "Read a file from disk",
					parameters: Type.Object({ path: Type.String() }),
				},
			],
		},
		{ apiKey },
		buildHeaders(modelId),
	);

	let toolCall: ToolCall | undefined;
	let error: string | undefined;
	let stopReason: string | undefined;

	for await (const event of stream) {
		if (event.type === "toolcall_end") {
			toolCall = event.toolCall;
		}
		if (event.type === "done") {
			stopReason = event.reason;
		}
		if (event.type === "error") {
			error = event.error.errorMessage ?? "unknown error";
		}
	}

	if (error) throw new Error(`${modelId}: ${error}`);
	if (stopReason !== "toolUse") {
		throw new Error(
			`${modelId}: expected toolUse, got ${stopReason ?? "none"}`,
		);
	}
	if (!toolCall) throw new Error(`${modelId}: no tool call emitted`);
	if (toolCall.name !== "read") {
		throw new Error(`${modelId}: expected read, got ${toolCall.name}`);
	}
	if (toolCall.arguments.path !== "package.json") {
		throw new Error(
			`${modelId}: expected path package.json, got ${JSON.stringify(toolCall.arguments.path)}`,
		);
	}

	console.log(
		`✓ ${modelId}: ${toolCall.name} ${JSON.stringify(toolCall.arguments)} (via Cline read_file XML)`,
	);
}

async function main(): Promise<void> {
	const models =
		process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_MODELS;
	const credentials = await refreshAndPersistCredentials();
	const apiKey = toApiKey(credentials);

	console.log(`Cline XML bridge live smoke: ${models.length} model(s)`);
	for (const modelId of models) {
		await smokeModel(modelId, apiKey);
	}
	console.log("Cline XML bridge live smoke passed.");
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
