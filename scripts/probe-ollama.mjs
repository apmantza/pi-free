#!/usr/bin/env node
/**
 * Probe Ollama Cloud models for 403 "access denied" errors.
 *
 * Usage:
 *   OLLAMA_API_KEY=xxx node scripts/probe-ollama.mjs
 *
 * This tests every model returned by GET /v1/models with a minimal
 * POST /v1/chat/completions request. Any model that 403s is reported
 * and can be added to OLLAMA_KNOWN_403_MODELS in providers/ollama/ollama.ts.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function getApiKey() {
	if (process.env.OLLAMA_API_KEY) return process.env.OLLAMA_API_KEY;
	try {
		const config = JSON.parse(
			readFileSync(join(homedir(), ".pi", "free.json"), "utf8"),
		);
		if (config.ollama_api_key) return config.ollama_api_key;
	} catch {}
	return null;
}

const API_KEY = getApiKey();
if (!API_KEY) {
	console.error(
		"OLLAMA_API_KEY not found. Set env var or add ollama_api_key to ~/.pi/free.json",
	);
	process.exit(1);
}

const BASE_URL = "https://ollama.com/v1";

async function fetchModels() {
	const res = await fetch(`${BASE_URL}/models`, {
		headers: { Authorization: `Bearer ${API_KEY}` },
	});
	if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`);
	const json = await res.json();
	return json.data.map((m) => m.id);
}

async function probeModel(modelId) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 10000);
	try {
		const res = await fetch(`${BASE_URL}/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: modelId,
				messages: [{ role: "user", content: "hi" }],
				max_tokens: 1,
			}),
			signal: controller.signal,
		});
		return res.status;
	} catch (err) {
		if (err.name === "AbortError") return "TIMEOUT";
		return `ERR: ${err.message}`;
	} finally {
		clearTimeout(timeout);
	}
}

async function main() {
	const models = await fetchModels();
	console.log(`Probing ${models.length} models…\n`);

	const broken = [];
	const batchSize = 20;

	for (let i = 0; i < models.length; i += batchSize) {
		const batch = models.slice(i, i + batchSize);
		const results = await Promise.all(
			batch.map(async (id) => {
				const status = await probeModel(id);
				const ok = status !== 403;
				return { id, status, ok };
			}),
		);

		for (const r of results) {
			const icon = r.ok ? "✅" : "❌";
			process.stdout.write(`${icon} ${r.id} → ${r.status}\n`);
			if (!r.ok) broken.push(r.id);
		}
	}

	console.log(`\n${"=".repeat(60)}`);
	if (broken.length === 0) {
		console.log("All models are accessible — no 403s found!");
	} else {
		console.log(`Found ${broken.length} broken model(s):`);
		for (const id of broken) console.log(`  "${id}",`);
		console.log(
			`\nCopy these into OLLAMA_KNOWN_403_MODELS in providers/ollama/ollama.ts`,
		);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
