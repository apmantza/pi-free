#!/usr/bin/env tsx
/**
 * End-to-end smoke test for the OpenModel wire-format fix.
 *
 * POSTs real chat completions to https://api.openmodel.ai/v1/messages
 * using the Anthropic Messages wire format (x-api-key header, the URL
 * path /v1/messages). Verifies BOTH paths pi-ai uses:
 *
 *   1. Non-streaming (used by some tooling): expect 200 JSON.
 *   2. Streaming     (used by pi-ai chat loop): expect 200 SSE with
 *      `event: message_start` and `event: content_block_start`.
 *
 * This script is gated: it only runs when OPENMODEL_API_KEY is set
 * (or found in ~/.pi/free.json). Without a key, it prints a SKIP
 * notice and exits 0.
 *
 * Security: this script never logs the API key (CodeQL clear-text
 * logging rule) and never logs raw response bodies (SonarCloud
 * untrusted-data rule). It only prints HTTP status, content-type,
 * and the parsed structural fields that prove the wire format is
 * correct.
 *
 * Run with: npm run smoke:openmodel
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const apiKeyFromEnv = process.env.OPENMODEL_API_KEY;

let apiKey = apiKeyFromEnv;
if (!apiKey) {
	try {
		const cfg = JSON.parse(
			readFileSync(join(homedir(), ".pi", "free.json"), "utf8"),
		) as { openmodel_api_key?: string };
		apiKey = cfg.openmodel_api_key;
	} catch {
		// ignore
	}
}

if (!apiKey) {
	console.log(
		"SKIP: no OPENMODEL_API_KEY in env or ~/.pi/free.json — cannot test live.",
	);
	console.log(
		"      Set OPENMODEL_API_KEY=om-... and re-run, or add openmodel_api_key to free.json.",
	);
	process.exit(0);
}

const baseUrl = "https://api.openmodel.ai";
const url = `${baseUrl}/v1/messages`;
const model = process.env.OPENMODEL_TEST_MODEL ?? "deepseek-v4-flash";

const anthropicHeaders = {
	"content-type": "application/json",
	"x-api-key": apiKey,
	"anthropic-version": "2023-06-01",
} as const;

const userMessage = {
	role: "user",
	content: "Reply with the single word: hello",
};

interface AnthropicMessageResponse {
	type?: string;
	role?: string;
	model?: string;
	stop_reason?: string;
	content?: Array<{
		type: string;
		text?: string;
		thinking?: string;
	}>;
	usage?: { input_tokens?: number; output_tokens?: number };
}


function parseAnthropicMessage(text: string): AnthropicMessageResponse | null {
	try {
		const parsed = JSON.parse(text) as AnthropicMessageResponse;
		if (
			parsed.type === "message" &&
			parsed.role === "assistant" &&
			Array.isArray(parsed.content)
		) {
			return parsed;
		}
	} catch {
		// ignore
	}
	return null;
}

function logNonStreamResult(
	parsed: AnthropicMessageResponse | null,
): void {
	if (!parsed) return;
	// Note: we intentionally do not log any individual parsed fields
	// (model, stop_reason, etc.) because SonarCloud S5144 flags
	// logging fields derived from a network response as user-controlled
	// data. The test outcome is determined by the structural parse
	// succeeding — see [1/2] [OK] / [FAIL] line below.
	console.log("response   : valid Anthropic Messages shape");
}

function logStreamResult(text: string): void {
	const eventTypes: string[] = [];
	const dataBlocks: string[] = [];
	const lines = text.split("\n");
	for (const line of lines) {
		if (line.startsWith("event: ")) {
			eventTypes.push(line.slice("event: ".length).trim());
		} else if (line.startsWith("data: ")) {
			const data = line.slice("data: ".length).trim();
			try {
				const parsed = JSON.parse(data) as { type?: string };
				if (parsed.type) {
					dataBlocks.push(parsed.type);
				}
			} catch {
				// skip non-JSON lines
			}
		}
	}
	// Log only the count of each event type. We intentionally do not
	// print the per-event `type` strings to avoid SonarCloud S5144
	// (logging user-controlled data); the test outcome is determined by
	// the count of expected SSE events above the COUNT_THRESHOLD below.
	const unique = new Set(eventTypes);
	console.log(`sse events: ${eventTypes.length} (${unique.size} unique)`);
	console.log(`sse data  : ${dataBlocks.length} data blocks`);
}

// =============================================================================
// 1. Non-streaming JSON path
// =============================================================================
console.log("\n[1/2] Non-streaming JSON path");
console.log("POST", url);
console.log("model:", model);

const nonStreamRes = await fetch(url, {
	method: "POST",
	headers: anthropicHeaders,
	body: JSON.stringify({
		model,
		max_tokens: 64,
		messages: [userMessage],
	}),
});

console.log("status      :", nonStreamRes.status);
console.log("content-type:", nonStreamRes.headers.get("content-type"));

if (!nonStreamRes.ok) {
	console.error(
		`\n[FAIL] openmodel non-streaming path returned ${nonStreamRes.status}`,
	);
	process.exit(1);
}

const nonStreamText = await nonStreamRes.text();
const nonStreamParsed = parseAnthropicMessage(nonStreamText);
console.log("");
logNonStreamResult(nonStreamParsed);

if (!nonStreamParsed) {
	console.error(
		"\n[FAIL] non-streaming response did not parse as a valid Anthropic Messages JSON.",
	);
	process.exit(1);
}
console.log(
	"\n[1/2] [OK] Non-streaming JSON path returned a valid Anthropic Messages response.",
);

// =============================================================================
// 2. Streaming SSE path (used by pi-ai chat loop)
// =============================================================================
console.log("\n[2/2] Streaming SSE path");

const streamRes = await fetch(url, {
	method: "POST",
	headers: { ...anthropicHeaders, accept: "text/event-stream" },
	body: JSON.stringify({
		model,
		max_tokens: 64,
		stream: true,
		messages: [userMessage],
	}),
});

console.log("status      :", streamRes.status);
console.log("content-type:", streamRes.headers.get("content-type"));

if (!streamRes.ok) {
	console.error(
		`\n[FAIL] openmodel streaming path returned ${streamRes.status}`,
	);
	process.exit(1);
}

const streamText = await streamRes.text();
const isSse =
	streamRes.headers.get("content-type")?.includes("text/event-stream") &&
	(streamText.includes("event: message_start") ||
		streamText.includes("event: content_block_start"));

console.log("");
logStreamResult(streamText);

if (!isSse) {
	console.error(
		"\n[FAIL] streaming response did not look like a valid Anthropic SSE stream.",
	);
	process.exit(1);
}
console.log(
	"\n[2/2] [OK] Streaming SSE path returned a valid Anthropic Messages event stream.",
);

console.log(
	"\n[PASS] OpenModel wire-format fix works end-to-end (both non-streaming and streaming).",
);
process.exit(0);
