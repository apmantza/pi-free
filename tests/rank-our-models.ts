/**
 * Test: Rank all pi-free-providers models by capability
 * Shows how our models would be ranked for failover decisions
 */

import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import {
	calculateCapability,
	generateCapabilityMessage,
	rankByCapability,
} from "../provider-failover/capability-ranking.ts";

// Collect all static models from our providers
const ALL_MODELS: Array<ProviderModelConfig & { provider: string }> = [
	// === ZEN (OpenCode) - Free models ===
	{
		provider: "zen",
		id: "big-pickle",
		name: "Big Pickle",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0 },
		contextWindow: 200000,
		maxTokens: 128000,
	},
	{
		provider: "zen",
		id: "trinity-large-preview-free",
		name: "Trinity Large Preview Free",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		provider: "zen",
		id: "minimax-m2.5-free",
		name: "MiniMax M2.5 Free",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0 },
		contextWindow: 200000,
		maxTokens: 16384,
	},
	{
		provider: "zen",
		id: "mimo-v2-pro-free",
		name: "MiMo V2 Pro Free",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		provider: "zen",
		id: "mimo-v2-flash-free",
		name: "MiMo V2 Flash Free",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		provider: "zen",
		id: "mimo-v2-omni-free",
		name: "MiMo V2 Omni Free",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	// Zen paid models
	{
		provider: "zen",
		id: "claude-3-5-haiku",
		name: "Claude 3.5 Haiku",
		reasoning: false,
		input: ["text"],
		cost: { input: 1, output: 4 },
		contextWindow: 200000,
		maxTokens: 4096,
	},
	{
		provider: "zen",
		id: "claude-haiku-4-5",
		name: "Claude Haiku 4.5",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.8, output: 3.2 },
		contextWindow: 200000,
		maxTokens: 8192,
	},
	{
		provider: "zen",
		id: "claude-opus-4-5",
		name: "Claude Opus 4.5",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 15, output: 75 },
		contextWindow: 200000,
		maxTokens: 4096,
	},
	{
		provider: "zen",
		id: "claude-sonnet-4-5",
		name: "Claude Sonnet 4.5",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 3, output: 15 },
		contextWindow: 200000,
		maxTokens: 16384,
	},
	{
		provider: "zen",
		id: "gemini-3-flash",
		name: "Gemini 3 Flash",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.35, output: 0.7 },
		contextWindow: 1000000,
		maxTokens: 8192,
	},
	{
		provider: "zen",
		id: "gemini-3.1-pro",
		name: "Gemini 3.1 Pro",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 1.25, output: 5 },
		contextWindow: 400000,
		maxTokens: 8192,
	},
	{
		provider: "zen",
		id: "minimax-m2.5",
		name: "MiniMax M2.5",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.88, output: 3.52 },
		contextWindow: 200000,
		maxTokens: 16384,
	},

	// === FIREWORKS - Paid (currently only 1 model) ===
	{
		provider: "fireworks",
		id: "accounts/fireworks/routers/kimi-k2p5-turbo",
		name: "Kimi K2.5 Turbo",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0 },
		contextWindow: 262144,
		maxTokens: 131072,
	},
];

function main() {
	console.log("🏆 pi-free-providers Model Capability Ranking\n");
	console.log(`Total models: ${ALL_MODELS.length}\n`);

	// Calculate capabilities
	const ranked = ALL_MODELS.map((model) => ({
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
		console.log("═".repeat(70));

		for (const m of models) {
			const cost = m.cost.input === 0 ? "🆓 FREE" : `💰 $${m.cost.input}/M`;
			const source = m.capabilities.estimatedParams
				? `~${m.capabilities.estimatedParams}B params`
				: "heuristic";

			console.log(`\n  ${m.name}`);
			console.log(`    📊 Score: ${m.capabilities.score} | Tier: ${tier}`);
			console.log(`    🏢 Provider: ${m.provider} | ${cost}`);
			console.log(
				`    📏 Context: ${(m.contextWindow / 1000).toFixed(0)}k tokens`,
			);
			console.log(
				`    🔧 ${source} ${m.reasoning ? "| 🧠 Reasoning" : ""} ${m.input.includes("image") ? "| 👁️ Vision" : ""}`,
			);
		}
	}

	// Demo: Failover analysis for each free model
	console.log("\n\n🔄 FAILOVER ANALYSIS (Free Models Only)");
	console.log("═".repeat(70));

	const freeModels = ranked.filter((m) => m.cost.input === 0);

	for (const current of freeModels.slice(0, 3)) {
		// Top 3 free models
		console.log(`\n📍 Current: ${current.name} @ ${current.provider}`);
		console.log(
			`   Tier: ${current.capabilities.tier} | Score: ${current.capabilities.score}`,
		);

		const alternatives = rankByCapability(
			current,
			ranked.filter(
				(m) => m.provider !== current.provider && m.id !== current.id,
			),
		);

		if (alternatives.equalOrBetter.length > 0) {
			console.log(`   ✅ Equal/Better failover options:`);
			for (const alt of alternatives.equalOrBetter.slice(0, 2)) {
				const msg = generateCapabilityMessage(
					{ name: current.name, capabilities: current.capabilities },
					{ name: alt.name, capabilities: alt.capabilities },
				);
				console.log(`      → ${alt.provider}: ${msg}`);
			}
		} else if (alternatives.minorDowngrade.length > 0) {
			console.log(`   ⚠️  Minor downgrade options:`);
			for (const alt of alternatives.minorDowngrade.slice(0, 2)) {
				const msg = generateCapabilityMessage(
					{ name: current.name, capabilities: current.capabilities },
					{ name: alt.name, capabilities: alt.capabilities },
				);
				console.log(`      → ${alt.provider}: ${msg}`);
			}
		} else {
			console.log(
				`   ⚠️  No good alternatives - would need paid model or manual switch`,
			);
		}
	}

	console.log("\n\n📊 Summary");
	console.log("═".repeat(70));
	console.log(`Total models: ${ALL_MODELS.length}`);
	console.log(`Free models: ${freeModels.length}`);
	console.log(`Paid models: ${ALL_MODELS.length - freeModels.length}`);
	console.log(`\nTier distribution:`);
	for (const tier of tierOrder) {
		const count = byTier[tier]?.length || 0;
		if (count > 0) console.log(`  ${tier}: ${count} models`);
	}

	console.log("\n\n✅ Ranking complete!");
	console.log(
		"\nNote: Scores use LMSYS Elo when available, fallback to heuristics",
	);
	console.log("(context window, reasoning flag, estimated parameters)");
}

main();
