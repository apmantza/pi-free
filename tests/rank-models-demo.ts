/**
 * Demo: Show capability ranking for available models
 * Run with: npx tsx tests/rank-models-demo.ts
 */

import {
	calculateCapability,
	generateCapabilityMessage,
	initCapabilityRanking,
	rankByCapability,
} from "../provider-failover/capability-ranking.ts";

// Mock some typical free/paid models from different providers
const MOCK_MODELS = [
	// Ultra tier
	{
		id: "gpt-4o",
		name: "GPT-4o",
		provider: "openai",
		cost: { input: 2.5, output: 10 },
		contextWindow: 128000,
		reasoning: false,
		input: ["text", "image"] as ("text" | "image")[],
	},
	{
		id: "claude-3-5-sonnet-20241022",
		name: "Claude 3.5 Sonnet",
		provider: "anthropic",
		cost: { input: 3, output: 15 },
		contextWindow: 200000,
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
	},
	{
		id: "llama-3.1-405b",
		name: "Llama 3.1 405B",
		provider: "fireworks",
		cost: { input: 1, output: 3 },
		contextWindow: 131072,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
	},

	// High tier
	{
		id: "gpt-4",
		name: "GPT-4 Turbo",
		provider: "openai",
		cost: { input: 10, output: 30 },
		contextWindow: 128000,
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
	},
	{
		id: "claude-3-opus",
		name: "Claude 3 Opus",
		provider: "anthropic",
		cost: { input: 15, output: 75 },
		contextWindow: 200000,
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
	},
	{
		id: "llama-3.1-70b",
		name: "Llama 3.1 70B",
		provider: "openrouter",
		cost: { input: 0, output: 0 },
		contextWindow: 128000,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
	},
	{
		id: "llama-3.3-70b",
		name: "Llama 3.3 70B Instruct",
		provider: "kilo",
		cost: { input: 0, output: 0 },
		contextWindow: 131072,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
	},
	{
		id: "qwen2.5-72b",
		name: "Qwen 2.5 72B",
		provider: "openrouter",
		cost: { input: 0, output: 0 },
		contextWindow: 32768,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
	},
	{
		id: "deepseek-v3",
		name: "DeepSeek V3",
		provider: "fireworks",
		cost: { input: 0.27, output: 1.1 },
		contextWindow: 163840,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
	},

	// Medium tier
	{
		id: "gpt-3.5-turbo",
		name: "GPT-3.5 Turbo",
		provider: "openai",
		cost: { input: 0.5, output: 1.5 },
		contextWindow: 16385,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
	},
	{
		id: "claude-3-haiku",
		name: "Claude 3 Haiku",
		provider: "anthropic",
		cost: { input: 0.25, output: 1.25 },
		contextWindow: 200000,
		reasoning: false,
		input: ["text", "image"] as ("text" | "image")[],
	},
	{
		id: "mixtral-8x22b",
		name: "Mixtral 8x22B",
		provider: "openrouter",
		cost: { input: 0, output: 0 },
		contextWindow: 65536,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
	},
	{
		id: "mimo-v2-pro",
		name: "MiMo V2 Pro",
		provider: "kilo",
		cost: { input: 0, output: 0 },
		contextWindow: 128000,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
	},

	// Low tier
	{
		id: "llama-3-8b",
		name: "Llama 3 8B",
		provider: "fireworks",
		cost: { input: 0.12, output: 0.42 },
		contextWindow: 8192,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
	},
	{
		id: "gemma-3-4b",
		name: "Gemma 3 4B",
		provider: "kilo",
		cost: { input: 0, output: 0 },
		contextWindow: 32768,
		reasoning: false,
		input: ["text", "image"] as ("text" | "image")[],
	},
];

async function main() {
	console.log("🏆 Model Capability Ranking Demo\n");

	// Initialize (loads/creates benchmark cache)
	await initCapabilityRanking();

	console.log("📊 Calculating capabilities for all models...\n");

	// Calculate capabilities
	const ranked = MOCK_MODELS.map((model) => ({
		...model,
		capabilities: calculateCapability(model),
	})).sort((a, b) => b.capabilities.score - a.capabilities.score);

	// Group by tier
	const byTier: Record<string, typeof ranked> = {};
	for (const model of ranked) {
		const tier = model.capabilities.tier;
		if (!byTier[tier]) byTier[tier] = [];
		byTier[tier].push(model);
	}

	// Display by tier
	const tierOrder = ["ultra", "high", "medium", "low", "minimal"];
	for (const tier of tierOrder) {
		const models = byTier[tier] || [];
		if (models.length === 0) continue;

		console.log(`\n${tier.toUpperCase()} TIER (${models.length} models)`);
		console.log("═".repeat(60));

		for (const m of models) {
			const cost = m.cost.input === 0 ? "FREE" : `$${m.cost.input}/M tokens`;
			const source = m.capabilities.estimatedParams
				? `~${m.capabilities.estimatedParams}B params`
				: "heuristic";

			console.log(`  ${m.name}`);
			console.log(
				`    Score: ${m.capabilities.score} | Provider: ${m.provider}`,
			);
			console.log(
				`    Context: ${(m.contextWindow / 1000).toFixed(0)}k | Cost: ${cost}`,
			);
			console.log(
				`    Source: ${source} | ${m.reasoning ? "🧠 Reasoning" : ""} ${m.input.includes("image") ? "👁️ Vision" : ""}`,
			);
			console.log();
		}
	}

	// Demo: Show failover options for a specific model
	console.log("\n\n🔄 FAILOVER DEMO");
	console.log("═".repeat(60));

	const currentModel = ranked[0]; // Best model
	console.log(`\nCurrent: ${currentModel.name} @ ${currentModel.provider}`);
	console.log(
		`Tier: ${currentModel.capabilities.tier} | Score: ${currentModel.capabilities.score}`,
	);

	const alternatives = rankByCapability(
		currentModel,
		ranked.filter((m) => m.provider !== currentModel.provider),
	);

	console.log(`\n📍 EQUAL OR BETTER alternatives:`);
	if (alternatives.equalOrBetter.length === 0) {
		console.log("  (none found)");
	} else {
		for (const alt of alternatives.equalOrBetter.slice(0, 3)) {
			const msg = generateCapabilityMessage(
				{ name: currentModel.name, capabilities: currentModel.capabilities },
				{
					name: `${alt.name} @ ${alt.provider}`,
					capabilities: alt.capabilities,
				},
			);
			console.log(`  ✓ ${msg}`);
		}
	}

	console.log(`\n⚠️  MINOR DOWNGRADES (allowed by default):`);
	if (alternatives.minorDowngrade.length === 0) {
		console.log("  (none found)");
	} else {
		for (const alt of alternatives.minorDowngrade.slice(0, 3)) {
			const msg = generateCapabilityMessage(
				{ name: currentModel.name, capabilities: currentModel.capabilities },
				{
					name: `${alt.name} @ ${alt.provider}`,
					capabilities: alt.capabilities,
				},
			);
			console.log(`  ⚠️ ${msg}`);
		}
	}

	console.log(`\n⬇️  MAJOR DOWNGRADES (blocked by default):`);
	if (alternatives.majorDowngrade.length === 0) {
		console.log("  (none found)");
	} else {
		for (const alt of alternatives.majorDowngrade.slice(0, 3)) {
			const msg = generateCapabilityMessage(
				{ name: currentModel.name, capabilities: currentModel.capabilities },
				{
					name: `${alt.name} @ ${alt.provider}`,
					capabilities: alt.capabilities,
				},
			);
			console.log(`  🚫 ${msg}`);
		}
	}

	console.log("\n\n✅ Demo complete!");
}

main().catch(console.error);
