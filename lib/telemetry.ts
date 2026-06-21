/**
 * Model Telemetry — tracks real-world performance of free models.
 *
 * Hooks into Pi's turn_end event to capture token usage, latency, and
 * success/failure per model. Persists to ~/.pi/free-telemetry.json.
 *
 * Provides a real-world performance signal alongside static CI benchmarks.
 */

import { createLogger } from "./logger.ts";
import { resolveSafeDataFile } from "./paths.ts";
import { createJSONStore } from "./json-persistence.ts";

const _logger = createLogger("telemetry");

// =============================================================================
// Types
// =============================================================================

export interface TelemetryEntry {
	timestamp: number;
	provider: string;
	model: string;
	success: boolean;
	latencyMs: number;
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	tokensPerSecond: number;
	cost: number;
	stopReason?: string;
	error?: string;
}

export interface ModelTelemetry {
	/** Total calls tracked for this model. */
	totalCalls: number;
	/** Successful calls. */
	successCalls: number;
	/** Failed calls. */
	errorCalls: number;
	/** Total tokens consumed (input + output). */
	totalTokens: number;
	/** Total prompt (input) tokens. */
	totalPromptTokens: number;
	/** Total completion (output) tokens. */
	totalCompletionTokens: number;
	/** Sum of all latencies in ms (for avg calculation). */
	totalLatencyMs: number;
	/** Sum of all costs. */
	totalCost: number;

	// Derived (computed on read)
	avgLatencyMs: number;
	avgTokensPerSecond: number;
	successRate: number;

	/** Recent calls (last 50). */
	recentCalls: TelemetryEntry[];
}

export interface TelemetryStore {
	/** Keyed by "provider/model" */
	models: Record<string, ModelTelemetry>;
	/** When the store was last updated. */
	lastUpdated: number;
}

// =============================================================================
// Constants
// =============================================================================

const TELEMETRY_FILE = resolveSafeDataFile(
	process.env.PI_FREE_TELEMETRY_FILE,
	"free-telemetry.json",
);
const MAX_RECENT_CALLS = 50;

// In-flight tracking: keyed by "provider/model", value is start timestamp.
// TTL: 1 hour — anything older is stale (the matching recordModelCall
// never fired, e.g. the agent was killed mid-call) and gets reaped
// on the next startModelCall/recordModelCall.
const _inFlight = new Map<string, number>();
const _IN_FLIGHT_TTL_MS = 60 * 60 * 1000;

function reapStaleInFlight(now: number): void {
	for (const [key, start] of _inFlight) {
		if (now - start > _IN_FLIGHT_TTL_MS) {
			_inFlight.delete(key);
		}
	}
}

// =============================================================================
// Storage
// =============================================================================

const _store = createJSONStore<TelemetryStore>(TELEMETRY_FILE, {
	models: {},
	lastUpdated: Date.now(),
});

// =============================================================================
// Entry management
// =============================================================================

function deriveModelTelemetry(
	entries: TelemetryEntry[],
): ModelTelemetry {
	const recent = entries.slice(-MAX_RECENT_CALLS);

	let successCalls = 0;
	let totalTokensFromSuccessful = 0;
	let totalLatencyFromSuccessful = 0;
	let totalTokens = 0;
	let totalPromptTokens = 0;
	let totalCompletionTokens = 0;
	let totalLatencyMs = 0;
	let totalCost = 0;

	for (const e of entries) {
		totalTokens += e.totalTokens;
		totalPromptTokens += e.promptTokens;
		totalCompletionTokens += e.completionTokens;
		totalLatencyMs += e.latencyMs;
		totalCost += e.cost;
		if (e.success) {
			successCalls++;
			totalTokensFromSuccessful += e.totalTokens;
			totalLatencyFromSuccessful += e.latencyMs;
		}
	}

	const totalCalls = entries.length;

	return {
		totalCalls,
		successCalls,
		errorCalls: totalCalls - successCalls,
		totalTokens,
		totalPromptTokens,
		totalCompletionTokens,
		totalLatencyMs,
		totalCost,
		avgLatencyMs:
			successCalls > 0
				? Math.round(totalLatencyFromSuccessful / successCalls)
				: 0,
		avgTokensPerSecond:
			totalLatencyFromSuccessful > 0
				? Number.parseFloat(
						(
							totalTokensFromSuccessful /
							(totalLatencyFromSuccessful / 1000)
						).toFixed(1),
				)
				: 0,
		successRate:
			totalCalls > 0
				? Number.parseFloat(((successCalls / totalCalls) * 100).toFixed(1))
				: 0,
		recentCalls: recent,
	};
}

async function addEntry(entry: TelemetryEntry): Promise<void> {
	await _store.update((store) => {
		const modelKey = `${entry.provider}/${entry.model}`;

		const existing: TelemetryEntry[] =
			store.models[modelKey]?.recentCalls ?? [];
		existing.push(entry);

		// Keep only last MAX_RECENT_CALLS * 2 in raw storage (we derive stats from these)
		const pruned = existing.slice(-MAX_RECENT_CALLS * 2);

		return {
			...store,
			models: {
				...store.models,
				[modelKey]: deriveModelTelemetry(pruned),
			},
			lastUpdated: Date.now(),
		};
	});
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get telemetry for all tracked models.
 */
export function getAllTelemetry(): Record<string, ModelTelemetry> {
	return _store.load().models;
}

/**
 * Get telemetry for a specific provider/model combination.
 */
export function getModelTelemetry(
	provider: string,
	model: string,
): ModelTelemetry | null {
	return _store.load().models[`${provider}/${model}`] ?? null;
}

/**
 * Format a model's telemetry as a human-readable string (for status bar / /model list).
 * Returns undefined if no telemetry data is available.
 */
export function formatModelTelemetry(
	provider: string,
	model: string,
): string | undefined {
	const telemetry = getModelTelemetry(provider, model);
	if (!telemetry || telemetry.totalCalls === 0) return undefined;

	const parts: string[] = [];
	if (telemetry.totalCalls > 0) {
		parts.push(`${telemetry.totalCalls} calls`);
	}
	if (telemetry.successRate > 0) {
		parts.push(`${telemetry.successRate}% ok`);
	}
	if (telemetry.avgLatencyMs > 0) {
		parts.push(`${telemetry.avgLatencyMs}ms`);
	}
	if (telemetry.avgTokensPerSecond > 0) {
		parts.push(`${telemetry.avgTokensPerSecond} tok/s`);
	}

	return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * Get telemetry summary for a provider (all models combined).
 */
export function getProviderTelemetry(provider: string): {
	totalCalls: number;
	totalCost: number;
	models: number;
} {
	const store = _store.load();
	let totalCalls = 0;
	let totalCost = 0;
	let models = 0;

	for (const [key, data] of Object.entries(store.models)) {
		if (key.startsWith(`${provider}/`)) {
			totalCalls += data.totalCalls;
			totalCost += data.totalCost;
			models++;
		}
	}

	return { totalCalls, totalCost, models };
}

/**
 * Mark a model call as started (records the start timestamp).
 * Call this from before_agent_start or model_select.
 */
export function startModelCall(provider: string, model: string): void {
	const key = `${provider}/${model}`;
	const now = Date.now();
	reapStaleInFlight(now);
	_inFlight.set(key, now);
}

/** Options for {@link recordModelCall} */
export interface RecordModelCallOptions {
	success: boolean;
	stopReason?: string;
	errorMessage?: string;
}

/**
 * Record a completed model call with its usage data.
 * Call this from turn_end when the message is an AssistantMessage.
 *
 * @param provider - The provider ID
 * @param model - The model ID
 * @param usage - Token usage { input, output, totalTokens }
 * @param cost - Cost in USD
 * @param options - Options object ({@link RecordModelCallOptions})
 */
export async function recordModelCall(
	provider: string,
	model: string,
	usage: { input: number; output: number; totalTokens: number },
	cost: number,
	options: RecordModelCallOptions,
): Promise<void> {
	const { success, stopReason, errorMessage } = options;
	const key = `${provider}/${model}`;
	const startTime = _inFlight.get(key) ?? Date.now();
	const latencyMs = Date.now() - startTime;
	_inFlight.delete(key);

	const totalTokens = usage.totalTokens || usage.input + usage.output;
	const tokensPerSecond =
		latencyMs > 0
			? Number.parseFloat((totalTokens / (latencyMs / 1000)).toFixed(1))
			: 0;

	const entry: TelemetryEntry = {
		timestamp: Date.now(),
		provider,
		model,
		success,
		latencyMs,
		promptTokens: usage.input,
		completionTokens: usage.output,
		totalTokens,
		tokensPerSecond,
		cost,
		stopReason,
		...(errorMessage ? { error: errorMessage } : {}),
	};

	await addEntry(entry);

	_logger.info(`Telemetry: ${provider}/${model}`, {
		latencyMs,
		totalTokens,
		tokensPerSecond,
		success,
		cost,
	});
}

/**
 * Clear all telemetry data.
 */
export async function clearTelemetry(): Promise<void> {
	await _store.update(() => ({
		models: {},
		lastUpdated: Date.now(),
	}));
}

/**
 * Get the path to the telemetry file.
 */
export function getTelemetryPath(): string {
	return TELEMETRY_FILE;
}
