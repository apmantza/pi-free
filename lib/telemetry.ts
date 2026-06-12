/**
 * Model Telemetry — tracks real-world performance of free models.
 *
 * Hooks into Pi's turn_end event to capture token usage, latency, and
 * success/failure per model. Persists to ~/.pi/free-telemetry.json.
 *
 * Provides a real-world performance signal alongside static CI benchmarks.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger } from "./logger.ts";

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

const TELEMETRY_DIR = join(homedir(), ".pi");
const TELEMETRY_FILE = process.env.PI_FREE_TELEMETRY_FILE
	? process.env.PI_FREE_TELEMETRY_FILE
	: join(TELEMETRY_DIR, "free-telemetry.json");
const MAX_RECENT_CALLS = 50;

// In-flight tracking: keyed by "provider/model", value is start timestamp
const _inFlight = new Map<string, number>();

class Lock {
	private promise: Promise<void> = Promise.resolve();

	async acquire(): Promise<() => void> {
		let release: () => void;
		const newPromise = new Promise<void>((resolve) => {
			release = resolve;
		});
		const previous = this.promise;
		this.promise = previous.then(() => newPromise);
		await previous;
		return release!;
	}
}

const _telemetryLock = new Lock();

// =============================================================================
// Storage
// =============================================================================

function ensureDir(): void {
	if (!existsSync(TELEMETRY_DIR)) {
		mkdirSync(TELEMETRY_DIR, { recursive: true });
	}
}

function loadStore(): TelemetryStore {
	try {
		if (!existsSync(TELEMETRY_FILE)) {
			return { models: {}, lastUpdated: Date.now() };
		}
		const raw = readFileSync(TELEMETRY_FILE, "utf-8");
		return JSON.parse(raw) as TelemetryStore;
	} catch (err) {
		_logger.warn("Failed to load telemetry store, resetting", {
			error: String(err),
		});
		return { models: {}, lastUpdated: Date.now() };
	}
}

function saveStore(store: TelemetryStore): void {
	try {
		ensureDir();
		store.lastUpdated = Date.now();
		writeFileSync(TELEMETRY_FILE, JSON.stringify(store, null, 2), "utf-8");
	} catch (err) {
		_logger.warn("Failed to save telemetry store", {
			error: String(err),
		});
	}
}

// =============================================================================
// Entry management
// =============================================================================

function deriveModelTelemetry(
	_modelKey: string,
	entries: TelemetryEntry[],
): ModelTelemetry {
	const recent = entries.slice(-MAX_RECENT_CALLS);
	const totalCalls = entries.length;
	const successCalls = entries.filter((e) => e.success).length;
	const errorCalls = totalCalls - successCalls;

	const stats = entries.reduce(
		(acc, e) => {
			acc.totalTokens += e.totalTokens;
			acc.totalPromptTokens += e.promptTokens;
			acc.totalCompletionTokens += e.completionTokens;
			acc.totalLatencyMs += e.latencyMs;
			acc.totalCost += e.cost;
			return acc;
		},
		{
			totalTokens: 0,
			totalPromptTokens: 0,
			totalCompletionTokens: 0,
			totalLatencyMs: 0,
			totalCost: 0,
		},
	);

	const totalSuccessEntries = entries.filter((e) => e.success);
	const totalTokensFromSuccessful = totalSuccessEntries.reduce(
		(s, e) => s + e.totalTokens,
		0,
	);
	const totalLatencyFromSuccessful = totalSuccessEntries.reduce(
		(s, e) => s + e.latencyMs,
		0,
	);

	return {
		totalCalls,
		successCalls,
		errorCalls,
		totalTokens: stats.totalTokens,
		totalPromptTokens: stats.totalPromptTokens,
		totalCompletionTokens: stats.totalCompletionTokens,
		totalLatencyMs: stats.totalLatencyMs,
		totalCost: stats.totalCost,
		avgLatencyMs:
			totalSuccessEntries.length > 0
				? Math.round(totalLatencyFromSuccessful / totalSuccessEntries.length)
				: 0,
		avgTokensPerSecond:
			totalLatencyFromSuccessful > 0
				? parseFloat(
						(
							totalTokensFromSuccessful /
							(totalLatencyFromSuccessful / 1000)
						).toFixed(1),
					)
				: 0,
		successRate:
			totalCalls > 0
				? parseFloat(((successCalls / totalCalls) * 100).toFixed(1))
				: 0,
		recentCalls: recent,
	};
}

async function addEntry(entry: TelemetryEntry): Promise<void> {
	const release = await _telemetryLock.acquire();
	try {
		const store = loadStore();
		const modelKey = `${entry.provider}/${entry.model}`;

		const existing: TelemetryEntry[] =
			store.models[modelKey]?.recentCalls ?? [];
		existing.push(entry);

		// Keep only last MAX_RECENT_CALLS * 2 in raw storage (we derive stats from these)
		const pruned = existing.slice(-MAX_RECENT_CALLS * 2);

		store.models[modelKey] = deriveModelTelemetry(modelKey, pruned);
		saveStore(store);
	} finally {
		release();
	}
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get telemetry for all tracked models.
 */
export function getAllTelemetry(): Record<string, ModelTelemetry> {
	const store = loadStore();
	return store.models;
}

/**
 * Get telemetry for a specific provider/model combination.
 */
export function getModelTelemetry(
	provider: string,
	model: string,
): ModelTelemetry | null {
	const store = loadStore();
	return store.models[`${provider}/${model}`] ?? null;
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
	const store = loadStore();
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
	_inFlight.set(key, Date.now());
}

/**
 * Record a completed model call with its usage data.
 * Call this from turn_end when the message is an AssistantMessage.
 *
 * @param provider - The provider ID
 * @param model - The model ID
 * @param usage - Token usage { input, output, totalTokens }
 * @param cost - Cost in USD
 * @param success - Whether the call succeeded
 * @param stopReason - The stop reason (e.g. "stop", "error")
 * @param errorMessage - Error message if failed
 */
export async function recordModelCall(
	provider: string,
	model: string,
	usage: { input: number; output: number; totalTokens: number },
	cost: number,
	success: boolean,
	stopReason?: string,
	errorMessage?: string,
): Promise<void> {
	const key = `${provider}/${model}`;
	const startTime = _inFlight.get(key) ?? Date.now();
	const latencyMs = Date.now() - startTime;
	_inFlight.delete(key);

	const totalTokens = usage.totalTokens || usage.input + usage.output;
	const tokensPerSecond =
		latencyMs > 0
			? parseFloat((totalTokens / (latencyMs / 1000)).toFixed(1))
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
	const release = await _telemetryLock.acquire();
	try {
		const store: TelemetryStore = { models: {}, lastUpdated: Date.now() };
		saveStore(store);
	} finally {
		release();
	}
}

/**
 * Get the path to the telemetry file.
 */
export function getTelemetryPath(): string {
	return TELEMETRY_FILE;
}
