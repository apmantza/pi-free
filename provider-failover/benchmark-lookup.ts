/**
 * Benchmark lookup logic — extracted from hardcoded-benchmarks.ts
 * for maintainability (the data file is ~10k lines of JSON-like entries).
 *
 * This module re-exports everything consumers currently import from
 * hardcoded-benchmarks, so you can switch imports to this file without
 * breaking anything.
 *
 * ENHANCED: Added debug logging and provider-specific normalizers
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	HARDCODED_BENCHMARKS,
	type HardcodedBenchmark,
} from "./hardcoded-benchmarks.ts";

// Re-export the type and data so callers can migrate imports here
export { HARDCODED_BENCHMARKS, type HardcodedBenchmark };

// =============================================================================
// Debug Logging
// =============================================================================

const LOG_DIR = join(homedir(), ".pi");
const LOG_FILE = join(LOG_DIR, "modelmatch.log");
let debugEnabled = true;

/**
 * Enable/disable debug logging
 */
export function setDebugLogging(enabled: boolean): void {
	debugEnabled = enabled;
}

/**
 * Log a message to the modelmatch.log file
 */
function logDebug(entry: {
	provider?: string;
	modelId: string;
	modelName: string;
	action: "attempt" | "match" | "miss" | "normalized";
	strategy?: string;
	normalizedId?: string;
	matchKey?: string;
	codingIndex?: number;
	details?: string;
}): void {
	if (!debugEnabled) return;

	try {
		// Ensure log directory exists
		if (!existsSync(LOG_DIR)) {
			mkdirSync(LOG_DIR, { recursive: true });
		}

		// Initialize log file with header if it doesn't exist
		if (!existsSync(LOG_FILE)) {
			writeFileSync(
				LOG_FILE,
				"timestamp|provider|modelId|modelName|action|strategy|normalizedId|matchKey|codingIndex|details\n",
			);
		}

		const timestamp = new Date().toISOString();
		const line = [
			timestamp,
			entry.provider || "unknown",
			entry.modelId,
			entry.modelName,
			entry.action,
			entry.strategy || "",
			entry.normalizedId || "",
			entry.matchKey || "",
			entry.codingIndex !== undefined ? entry.codingIndex.toFixed(1) : "",
			entry.details || "",
		]
			.map((f) => f.replaceAll(/[\\|]/g, "\\$&")) // Escape backslashes and pipes
			.join("|");

		appendFileSync(LOG_FILE, `${line}\n`);
	} catch {
		// Silently fail - don't break functionality for logging issues
	}
}

/**
 * Get the path to the log file for user reference
 */
export function getMatchLogPath(): string {
	return LOG_FILE;
}

/**
 * Clear the match log
 */
export function clearMatchLog(): void {
	try {
		if (existsSync(LOG_FILE)) {
			writeFileSync(
				LOG_FILE,
				"timestamp|provider|modelId|modelName|action|strategy|normalizedId|matchKey|codingIndex|details\n",
			);
		}
	} catch {
		// Ignore errors
	}
}

// =============================================================================
// Provider-Specific Normalizers
// =============================================================================

/**
 * Apply provider-specific ID normalization to handle naming conventions
 */
/** Normalize NVIDIA model IDs by stripping org prefixes like meta/, mistralai/ */
function normalizeNvidia(ctx: {
	normalized: string;
	strategies: string[];
}): void {
	const prefixMatch = ctx.normalized.match(
		/^(meta|mistralai|microsoft|qwen|nvidia|ibm|google|ai21labs|bigcode|databricks|deepseek-ai|01-ai|adept|aisingapore|baai|bytedance|luma|stabilityai|fireworks|upstage|voyage|snowflake|recursal|kdan|unity|cloudflare|fblgit|nttdata|dito|nousresearch|espressomodels|ftmsh|huggingface|isolationai|pinglab|functionnetwork|huggingfaceh4|mcw|shutterstock)[^/]*\//,
	);
	if (prefixMatch) {
		ctx.normalized = ctx.normalized.replaceAll(/^[^/]+\//g, "");
		ctx.strategies.push("strip-nvidia-prefix");
	}
}

/** Normalize Cloudflare model IDs by stripping @cf/namespace/ prefix */
function normalizeCloudflare(ctx: {
	normalized: string;
	strategies: string[];
}): void {
	if (ctx.normalized.startsWith("@cf/")) {
		ctx.normalized = ctx.normalized.replaceAll(/^@cf\/[^/]+\//g, "");
		ctx.strategies.push("strip-cf-namespace");
	}
}

/** Strip OpenRouter's :free suffix from model IDs */
function normalizeFreeSuffix(ctx: {
	normalized: string;
	strategies: string[];
}): void {
	if (ctx.normalized.includes(":free")) {
		ctx.normalized = ctx.normalized.replaceAll(/:free$/g, "");
		ctx.strategies.push("strip-free-suffix");
	}
}

/** Handle Ollama model:tag format by replacing colons with dashes */
function normalizeOllama(ctx: {
	normalized: string;
	strategies: string[];
}): void {
	if (ctx.normalized.includes(":")) {
		ctx.normalized = ctx.normalized.replaceAll(/:/g, "-");
		ctx.strategies.push("ollama-colon-to-dash");
	}
}

/** Strip Groq-specific numeric suffixes (-32768) and -versatile */
function normalizeGroq(ctx: {
	normalized: string;
	strategies: string[];
}): void {
	if (/-\d+$/.test(ctx.normalized)) {
		ctx.normalized = ctx.normalized.replaceAll(/-\d+$/g, "");
		ctx.strategies.push("strip-groq-numeric-suffix");
	}
	if (ctx.normalized.includes("-versatile")) {
		ctx.normalized = ctx.normalized.replaceAll(/-versatile$/g, "");
		ctx.strategies.push("strip-groq-versatile");
	}
}

/** Normalize Cerebras llama format (llama3.1-8b -> llama-3.1-8b) and add -instruct */
function normalizeCerebras(ctx: {
	normalized: string;
	strategies: string[];
}): void {
	if (/^llama\d/.test(ctx.normalized)) {
		ctx.normalized = ctx.normalized.replaceAll(/^llama(\d)/g, "llama-$1");
		ctx.strategies.push("cerebras-llama-dash");
	}
	if (
		/^llama-[\d.]+-\d+b$/.test(ctx.normalized) &&
		!ctx.normalized.includes("instruct")
	) {
		ctx.normalized = ctx.normalized.replaceAll(
			/^(llama-[\d.]+-\d+b)/g,
			"$1-instruct",
		);
		ctx.strategies.push("add-instruct-suffix");
	}
}

/** Strip Mistral's -latest suffix */
function normalizeMistral(ctx: {
	normalized: string;
	strategies: string[];
}): void {
	if (ctx.normalized.includes("-latest")) {
		ctx.normalized = ctx.normalized.replaceAll(/-latest$/g, "");
		ctx.strategies.push("strip-mistral-latest");
	}
}

/** Strip generic suffixes (dates, versions, preview, fp*) that aren't in benchmarks */
function stripCommonSuffixes(ctx: {
	normalized: string;
	strategies: string[];
}): void {
	const suffixesToStrip = [
		/-\d{8}$/g, // Date suffixes like -20250514
		/-v\d+(\.\d+)?$/g, // Version suffixes like -v1.1
		/-\d{3,}$/g, // Numeric suffixes like -001, -2603
		/-it$/g, // -it (Gemma convention)
		/-fp\d+$/g, // -fp8, -fp16
		/-bf\d+$/g, // -bf16
		/-preview$/g, // -preview
		/-exp$/g, // -exp (experimental)
		/-instruct-0\.\d+$/g, // HuggingFace revision tags
	];
	for (const pattern of suffixesToStrip) {
		if (pattern.test(ctx.normalized)) {
			ctx.normalized = ctx.normalized.replaceAll(pattern, "");
			ctx.strategies.push(
				`strip-${pattern.source.replace(/[\\^$.*+?()[\]{}|]/g, "").slice(0, 10)}`,
			);
		}
	}
}

function applyProviderNormalization(
	modelId: string,
	provider?: string,
): { normalized: string; strategy: string } {
	const ctx: { normalized: string; strategies: string[] } = {
		normalized: modelId.toLowerCase(),
		strategies: [],
	};

	if (provider === "nvidia") normalizeNvidia(ctx);
	if (provider === "cloudflare") normalizeCloudflare(ctx);
	// Strip generic org/ prefix (e.g., "google/", "mistralai/") before everything
	const stripped = ctx.normalized.replace(/^[^/]+\//, "");
	if (stripped !== ctx.normalized) {
		ctx.normalized = stripped;
		ctx.strategies.push("strip-org-prefix");
	}

	normalizeFreeSuffix(ctx);
	// Also strip -free suffix (used by ZenMux, etc.)
	if (ctx.normalized.endsWith("-free")) {
		ctx.normalized = ctx.normalized.replaceAll(/-free$/g, "");
		ctx.strategies.push("strip-free-suffix");
	}

	if (provider === "ollama" || provider === "ollama-cloud")
		normalizeOllama(ctx);
	if (provider === "groq") normalizeGroq(ctx);
	if (provider === "cerebras") normalizeCerebras(ctx);
	if (provider === "mistral") normalizeMistral(ctx);
	stripCommonSuffixes(ctx);

	return {
		normalized: ctx.normalized,
		strategy: ctx.strategies.join(","),
	};
}

// =============================================================================
// Prefix fallback helpers
// =============================================================================

/**
 * Segments that indicate a variant of the same base model
 * (effort level, reasoning mode, date, preview) — NOT a fundamentally different model.
 * Used to filter prefix matches so we don't cross model boundaries
 * (e.g. gpt-4o → gpt-4o-mini is wrong, but gpt-4o → gpt-4o-aug-24 is fine).
 */
const VARIANT_QUALIFIER_SEGMENTS = new Set([
	"reasoning",
	"non-reasoning",
	"high",
	"low",
	"medium",
	"xhigh",
	"preview",
	"adaptive",
	"fast",
	"instruct",
	"chat",
]);

/**
 * Check if a segment is a variant qualifier rather than a different model identifier.
 * Accepts effort levels, reasoning modes, date codes, size specifiers, and version numbers.
 */
function isVariantQualifier(segment: string): boolean {
	if (VARIANT_QUALIFIER_SEGMENTS.has(segment)) return true;
	// Date codes like "0528", "20250514"
	if (/^\d{4,8}$/.test(segment)) return true;
	// Month names (from date suffixes like "may-25", "mar-24")
	if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/.test(segment))
		return true;
	// Size specifiers like "70b", "8b", "a35b", "a3b" (MoE notation)
	if (/^a?\d+(\.\d+)?b$/i.test(segment)) return true;
	// Version numbers like "v3.2", "v2.5", "v1"
	if (/^v\d+(\.\d+)?$/.test(segment)) return true;
	// Two-digit year like "25", "24"
	if (/^\d{2}$/.test(segment)) return true;
	// Special variant suffixes
	if (
		segment === "speciale" ||
		segment === "chatgpt" ||
		segment === "latest" ||
		segment === "instruct" ||
		segment === "chat"
	)
		return true;
	return false;
}

/**
 * Normalize model ID by reordering size tokens to match AA convention.
 * Converts "70b-instruct" → "instruct-70b", "405b-chat" → "chat-405b".
 * AA uses instruct-70b order while providers often use 70b-instruct.
 */
function normalizeSizeTokenOrder(id: string): string {
	// Convert "70b-instruct" → "instruct-70b", "405b-chat" → "chat-405b"
	const suffixes = new Set(["instruct", "chat"]);
	const parts = id.split("-");
	for (let i = 0; i < parts.length - 1; i++) {
		const lower = parts[i].toLowerCase();
		if (lower.endsWith("b") && suffixes.has(parts[i + 1].toLowerCase())) {
			// Validate the part before 'b' is a number
			const num = lower.slice(0, -1);
			if (num.length > 0 && !Number.isNaN(Number.parseFloat(num))) {
				[parts[i], parts[i + 1]] = [parts[i + 1], parts[i]];
				break;
			}
		}
	}
	return parts.join("-");
}

/**
 * Extract the base model ID from a provider model ID.
 * Strips ALL provider prefixes ("openai/", "@cf/meta/", "@cf/qwen/"), :free suffix, date suffixes, and version suffixes.
 */
function extractBaseModelId(modelId: string): string {
	return modelId
		.toLowerCase()
		.replaceAll(/^.*\//g, "") // Strip ALL path prefixes - keep only last segment
		.replaceAll(/:free$/g, "") // Strip :free suffix
		.replaceAll(/-\d{8}$/g, "") // Strip date suffixes like -20250514
		.replaceAll(/-v\d+(\.\d+)?$/g, "") // Strip version suffixes like -v1.1
		.replaceAll(/-\d{3,}$/g, "") // Strip numeric suffixes like -001, -2603
		.replaceAll(/-it$/g, "") // Strip -it suffix (Gemma convention for "instruct")
		.replaceAll(/-fp\d+$/g, "") // Strip -fp8, -fp16 suffixes
		.replaceAll(/-bf\d+$/g, "") // Strip -bf16 suffixes
		.trim();
}

/**
 * Find the best benchmark variant by prefix matching.
 * Given a base model ID, finds all benchmark keys that are variants of it
 * (same base model with effort/reasoning/date qualifiers) and returns the
 * variant with the highest codingIndex.
 */
function findBestVariantByPrefix(
	baseId: string,
	provider?: string,
	originalId?: string,
): HardcodedBenchmark | null {
	const prefixKey = baseId + "-";
	const candidates: { key: string; data: HardcodedBenchmark }[] = [];

	for (const [key, data] of Object.entries(HARDCODED_BENCHMARKS) as [
		string,
		HardcodedBenchmark,
	][]) {
		// Exact match
		if (key === baseId) {
			if (data.codingIndex !== undefined) {
				logDebug({
					provider,
					modelId: originalId || baseId,
					modelName: "",
					action: "match",
					strategy: "exact-prefix-match",
					matchKey: key,
					codingIndex: data.codingIndex,
				});
				return data;
			}
			continue;
		}

		// Prefix match: key starts with baseId + "-"
		if (key.startsWith(prefixKey)) {
			// Check that the first segment after the prefix is a qualifier
			// (prevents gpt-4o → gpt-4o-mini cross-model matches)
			const remainder = key.slice(prefixKey.length);
			const firstSegment = remainder.split("-")[0]!;
			if (isVariantQualifier(firstSegment)) {
				candidates.push({ key, data });
			}
		}
	}

	if (candidates.length === 0) return null;

	// Pick the candidate with the highest codingIndex
	candidates.sort((a, b) => {
		const ciA = a.data.codingIndex ?? -1;
		const ciB = b.data.codingIndex ?? -1;
		return ciB - ciA;
	});

	// Only return if the best candidate has a codingIndex
	if (candidates[0]!.data.codingIndex !== undefined) {
		logDebug({
			provider,
			modelId: originalId || baseId,
			modelName: "",
			action: "match",
			strategy: "variant-prefix-match",
			normalizedId: baseId,
			matchKey: candidates[0]!.key,
			codingIndex: candidates[0]!.data.codingIndex,
			details: `${candidates.length} candidates`,
		});
		return candidates[0]!.data;
	}

	return null;
}

// =============================================================================
// Variant alias mappings
// =============================================================================

const MODEL_VARIANTS: Record<string, string[]> = {
	"gpt-4o-aug-24": ["gpt-4o", "gpt-4-o"],
	"gpt-4": ["gpt-4", "gpt4"],
	"claude-3.5-sonnet-oct-24": [
		"claude-3.5-sonnet",
		"claude-3-5-sonnet",
		"sonnet-3.5",
	],
	"claude-3-opus": ["claude-3-opus", "opus-3"],
	"llama-3.1-instruct-405b": ["llama-3.1-405b", "llama3.1-405b", "llama-405b"],
	"llama-3.1-instruct-70b": ["llama-3.1-70b", "llama3.1-70b", "llama-70b"],
	"gemini-1.5-pro": ["gemini-1.5-pro", "gemini1.5-pro", "gemini-pro-1.5"],
	"qwen2.5-instruct-72b": ["qwen2.5-72b", "qwen-2.5-72b"],
	"deepseek-v3.2-non-reasoning": ["deepseek-v3", "deepseekv3", "deepseek-chat"],
	"mimo-v2-pro": ["mimo-v2-pro", "mimo-v2-pro-free", "mimo-pro"],
	"mimo-v2-omni": ["mimo-v2-omni", "mimo-v2-omni-free", "mimo-omni"],
	"mimo-v2-flash": ["mimo-v2-flash", "mimo-v2-flash-free", "mimo-flash"],
	"big-pickle": ["big-pickle", "bigpickle"],
	"minimax-m2.5": ["minimax-m2.5", "minimax-m2.5-free", "minimax-m25"],
	"nvidia-nemotron-3-super-120b-a12b-reasoning": [
		"nemotron-3-super",
		"nemotron-3-super-free",
		"nemotron-super",
		"nemotron-3",
	],
	"glm-4.6v-non-reasoning": [
		"glm-4.6v",
		"glm-4.6v-flash",
		"glm-4.6v-flash-free",
	],
	"glm-4.7-flash-non-reasoning": ["glm-4.7-flash", "glm-4.7-flash-free"],
	"mistral-small-4-non-reasoning": [
		"mistral-small-24b",
		"mistral-small-24b-instruct",
		"mistral-small-24b-2501",
	],
	"qwen2.5-coder-instruct-7b": ["qwen2.5-7b", "qwen2.5-7b-instruct"],
	"llama-3.2-instruct-3b": ["llama-3.2-3b", "llama-3.2-3b-instruct"],
	"llama-3.2-instruct-1b": ["llama-3.2-1b", "llama-3.2-1b-instruct"],
};

// =============================================================================
// Strategy steps
// =============================================================================

function tryDirectSubstringMatch(
	search: string,
	provider: string | undefined,
	modelId: string,
	modelName: string,
): HardcodedBenchmark | null {
	for (const [key, data] of Object.entries(HARDCODED_BENCHMARKS) as [
		string,
		HardcodedBenchmark,
	][]) {
		if (search.includes(key.toLowerCase())) {
			logDebug({
				provider,
				modelId,
				modelName,
				action: "match",
				strategy: "direct-substring",
				matchKey: key,
				codingIndex: data.codingIndex,
			});
			return data;
		}
	}
	return null;
}

function tryVariantAliasMatch(
	search: string,
	provider: string | undefined,
	modelId: string,
	modelName: string,
): HardcodedBenchmark | null {
	for (const [canonical, names] of Object.entries(MODEL_VARIANTS)) {
		if (names.some((n) => search.includes(n.toLowerCase()))) {
			const data = HARDCODED_BENCHMARKS[canonical];
			if (data) {
				logDebug({
					provider,
					modelId,
					modelName,
					action: "match",
					strategy: "variant-alias",
					matchKey: canonical,
					codingIndex: data.codingIndex,
				});
				return data;
			}
		}
	}
	return null;
}

function tryProviderNormalizedMatch(
	modelId: string,
	provider: string | undefined,
	modelName: string,
): { result: HardcodedBenchmark | null; normalized: string } {
	const { normalized, strategy } = applyProviderNormalization(
		modelId,
		provider,
	);

	if (normalized === modelId.toLowerCase()) {
		return { result: null, normalized };
	}

	logDebug({
		provider,
		modelId,
		modelName,
		action: "normalized",
		strategy,
		normalizedId: normalized,
	});

	for (const [key, data] of Object.entries(HARDCODED_BENCHMARKS) as [
		string,
		HardcodedBenchmark,
	][]) {
		if (normalized.includes(key.toLowerCase())) {
			logDebug({
				provider,
				modelId,
				modelName,
				action: "match",
				strategy: `provider-normalized:${strategy}`,
				matchKey: key,
				codingIndex: data.codingIndex,
			});
			return { result: data, normalized };
		}
	}

	return { result: null, normalized };
}

function tryPrefixFallback(
	normalizedId: string,
	provider: string | undefined,
	modelId: string,
	modelName: string,
): HardcodedBenchmark | null {
	const baseId = extractBaseModelId(normalizedId);
	if (!baseId) return null;

	const best = findBestVariantByPrefix(baseId, provider, modelId);
	if (best) return best;

	// Try with word-order normalization
	// (e.g., llama-3.3-70b-instruct → llama-3.3-instruct-70b)
	const reordered = normalizeSizeTokenOrder(baseId);
	if (reordered === baseId) return null;

	logDebug({
		provider,
		modelId,
		modelName,
		action: "normalized",
		strategy: "size-token-reorder",
		normalizedId: reordered,
	});

	return findBestVariantByPrefix(reordered, provider, modelId);
}

// =============================================================================
// Main lookup
// =============================================================================

export function findHardcodedBenchmark(
	modelName: string,
	modelId: string,
	provider?: string,
): HardcodedBenchmark | null {
	const search = `${modelName} ${modelId}`.toLowerCase();

	logDebug({ provider, modelId, modelName, action: "attempt" });

	// 1. Direct substring match
	const direct = tryDirectSubstringMatch(search, provider, modelId, modelName);
	if (direct) return direct;

	// 2. Variant alias matching
	const variant = tryVariantAliasMatch(search, provider, modelId, modelName);
	if (variant) return variant;

	// 3. Provider-specific normalization
	const { result: normalizedResult, normalized } = tryProviderNormalizedMatch(
		modelId,
		provider,
		modelName,
	);
	if (normalizedResult) return normalizedResult;

	// 4. Prefix fallback with base model extraction
	const prefix = tryPrefixFallback(normalized, provider, modelId, modelName);
	if (prefix) return prefix;

	// No match found
	logDebug({
		provider,
		modelId,
		modelName,
		action: "miss",
		strategy: "all-strategies-failed",
		normalizedId: normalized,
		details: `Final normalized: ${normalized}`,
	});

	return null;
}

/**
 * Get score from hardcoded data
 */
export function getHardcodedScore(
	modelName: string,
	modelId: string,
	provider?: string,
): number | null {
	const benchmark = findHardcodedBenchmark(modelName, modelId, provider);
	return benchmark?.codingIndex ?? null;
}

/**
 * Enhance model name with Coding Index score
 * Returns model name with CI score appended if available
 */
export function enhanceModelNameWithCodingIndex(
	modelName: string,
	modelId: string,
	provider?: string,
): string {
	const benchmark = findHardcodedBenchmark(modelName, modelId, provider);
	if (benchmark?.codingIndex !== undefined) {
		return `${modelName} [CI: ${benchmark.codingIndex.toFixed(1)}]`;
	}
	return modelName;
}

// =============================================================================
// Stats and Reporting
// =============================================================================

/**
 * Get statistics about model matching from the current session
 * Note: This reads the log file and computes stats
 */
interface LogStats {
	totalAttempts: number;
	matches: number;
	misses: number;
	byProvider: Record<
		string,
		{ attempts: number; matches: number; misses: number }
	>;
}

function parseLogLine(stats: LogStats, line: string): void {
	if (!line.trim()) return;
	const parts = line.split("|");
	if (parts.length < 5) return;

	const provider = parts[1] || "unknown";
	const action = parts[4];

	if (!stats.byProvider[provider]) {
		stats.byProvider[provider] = { attempts: 0, matches: 0, misses: 0 };
	}

	if (action === "attempt") {
		stats.totalAttempts++;
		stats.byProvider[provider].attempts++;
	} else if (action === "match") {
		stats.matches++;
		stats.byProvider[provider].matches++;
	} else if (action === "miss") {
		stats.misses++;
		stats.byProvider[provider].misses++;
	}
}

function computeMatchRate(stats: LogStats): number {
	const total = stats.matches + stats.misses;
	return total > 0 ? Math.round((stats.matches / total) * 100) : 0;
}

export function getMatchingStats(): {
	totalAttempts: number;
	matches: number;
	misses: number;
	matchRate: number;
	byProvider: Record<
		string,
		{ attempts: number; matches: number; misses: number }
	>;
} {
	const stats: LogStats = {
		totalAttempts: 0,
		matches: 0,
		misses: 0,
		byProvider: {},
	};

	try {
		if (!existsSync(LOG_FILE)) {
			return { ...stats, matchRate: 0 };
		}

		const content = readFileSync(LOG_FILE, "utf-8");
		for (const line of content.split("\n").slice(1)) {
			parseLogLine(stats, line);
		}
	} catch {
		// Return empty stats on error
	}

	return { ...stats, matchRate: computeMatchRate(stats) };
}

// Need to import readFileSync for stats
import { readFileSync } from "node:fs";
