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

/** Structured failure classification derived from status codes / error text (M2, #437). */
export type ErrorClass = "401" | "403" | "429" | "5xx" | "network" | "other";

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
	/** HTTP status code when the failure came from a provider response. */
	statusCode?: number;
	/** Structured failure classification (derived when not supplied). */
	errorClass?: ErrorClass;
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

/** Latency samples above this threshold are discarded as implausible. */
const MAX_SANE_LATENCY_MS = 10 * 60 * 1000; // 10 minutes

// In-flight tracking: keyed by a unique call id, value is
// { key: "provider/model", startTime: timestamp }.
// Entries are reaped after 1 hour (the matching recordModelCall never fired,
// e.g. the agent was killed mid-call).
interface InFlightEntry {
	key: string;
	startTime: number;
}
const _inFlight = new Map<string, InFlightEntry>();
const _IN_FLIGHT_TTL_MS = 60 * 60 * 1000;

let _callIdCounter = 0;

function reapStaleInFlight(now: number): void {
	for (const [id, entry] of _inFlight) {
		if (now - entry.startTime > _IN_FLIGHT_TTL_MS) {
			_logger.info("Reaped stale in-flight telemetry entry", {
				callId: id,
				key: entry.key,
				ageMs: Math.round(now - entry.startTime),
			});
			_inFlight.delete(id);
		}
	}
}

// =============================================================================
// Key construction — single source of truth for provider/model keys
// =============================================================================

function telemetryKey(provider: string, model: string): string {
	return `${provider}/${model}`;
}

// =============================================================================
// Storage
// =============================================================================

// Debounce disk writes so a chatty session does not perform one synchronous
// writeFileSync per turn_end. The in-memory cache stays fresh (load() returns
// the latest state immediately), so /free-telemetry always shows current data;
// only the disk flush is coalesced. clearTelemetry() calls flush() to make the
// explicit user action durable right away.
const TELEMETRY_WRITE_DEBOUNCE_MS = 1500;
const _store = createJSONStore<TelemetryStore>(
	TELEMETRY_FILE,
	{ models: {}, lastUpdated: Date.now() },
	{ debounceMs: TELEMETRY_WRITE_DEBOUNCE_MS },
);

// =============================================================================
// Entry management
// =============================================================================

function deriveModelTelemetry(entries: TelemetryEntry[]): ModelTelemetry {
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
			successCalls > 0 ? Math.round(totalLatencyFromSuccessful / successCalls) : 0,
		avgTokensPerSecond:
			totalLatencyFromSuccessful > 0
				? Number.parseFloat(
						(totalTokensFromSuccessful / (totalLatencyFromSuccessful / 1000)).toFixed(
							1,
						),
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
		const modelKey = telemetryKey(entry.provider, entry.model);

		const existing: TelemetryEntry[] = store.models[modelKey]?.recentCalls ?? [];
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
	return _store.load().models[telemetryKey(provider, model)] ?? null;
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
 * Mark a model call as started and return a unique call id.
 * Pass this id to {@link recordModelCall} to pair the start/end correctly.
 */
export function startModelCall(provider: string, model: string): string {
	// Monotonic clock for latency measurement (immune to NTP skew / system
	// suspend); wall clock only for the human-readable call id correlation tag.
	const start = performance.now();
	const ts = Date.now();
	reapStaleInFlight(start);
	const callId = `${telemetryKey(provider, model)}:${ts}:${++_callIdCounter}`;
	_inFlight.set(callId, {
		key: telemetryKey(provider, model),
		startTime: start,
	});
	return callId;
}

/** Options for {@link recordModelCall} */
export interface RecordModelCallOptions {
	success: boolean;
	stopReason?: string;
	errorMessage?: string;
	/** HTTP status code observed on the provider response. */
	statusCode?: number;
	/** Structured failure class; derived from the message when omitted. */
	errorClass?: ErrorClass;
}

/**
 * Derive a structured {@link ErrorClass} from a status code and/or error
 * message. Best-effort classification used to turn opaque "failed" telemetry
 * entries into incident-relevant buckets (Cline workos: 401 vs 403-vs-headers
 * vs gateway 5xx). Numeric status codes win when present; otherwise the error
 * text is scanned for embedded statuses or network-failure fingerprints.
 */
export function classifyError(
	message: string | undefined,
	statusCode?: number,
): ErrorClass | undefined {
	if (!message && statusCode === undefined) return undefined;
	if (statusCode !== undefined) {
		if (statusCode === 401) return "401";
		if (statusCode === 403) return "403";
		if (statusCode === 429) return "429";
		if (statusCode >= 500 && statusCode < 600) return "5xx";
		// A non-failure status (e.g. 200) carries no class unless the message
		// itself describes a failure.
		if (!message) return undefined;
	}
	if (message) {
		// A fetch-level network failure (TypeError in browsers, node-style
		// undici/fetch errors) is distinct from an HTTP status failure.
		if (
			/Failed to fetch|fetch failed|network error|ECONN|ENOTFOUND|EHOST|EAI_AGAIN|ETIMEDOUT|socket hang up|underlying connection|unexpected end of file/i.test(
				message,
			)
		) {
			return "network";
		}
		if (/\b401\b/.test(message)) return "401";
		if (/\b403\b/.test(message)) return "403";
		if (/\b429\b/.test(message)) return "429";
		if (/\b5\d\d\b/.test(message)) return "5xx";
	}
	return "other";
}

/**
 * Record a completed model call with its usage data.
 * Call this from turn_end when the message is an AssistantMessage.
 *
 * @param callId - The call id returned by {@link startModelCall}, or undefined
 *   if no matching start was recorded.
 * @param provider - The provider ID
 * @param model - The model ID
 * @param usage - Token usage { input, output, totalTokens }
 * @param cost - Cost in USD
 * @param options - Options object ({@link RecordModelCallOptions})
 */
export async function recordModelCall(
	callId: string | undefined,
	provider: string,
	model: string,
	usage: { input: number; output: number; totalTokens: number },
	cost: number,
	options: RecordModelCallOptions,
): Promise<void> {
	const { success, stopReason, errorMessage, statusCode, errorClass } = options;
	// Wall clock for the stored entry timestamp; monotonic clock for the
	// elapsed-latency measurement so NTP adjustments or system suspend cannot
	// corrupt the recorded duration.
	const now = Date.now();
	const end = performance.now();

	let latencyMs: number;
	if (callId && _inFlight.has(callId)) {
		const entry = _inFlight.get(callId)!;
		latencyMs = Math.round(end - entry.startTime);
		_inFlight.delete(callId);
	} else {
		// No matching start — record 0 latency rather than a bogus value.
		latencyMs = 0;
		_logger.info("recordModelCall: no matching startModelCall", {
			callId: callId ?? "(none)",
			provider,
			model,
		});
	}

	// Discard implausibly long latency samples (e.g. system was suspended).
	if (latencyMs > MAX_SANE_LATENCY_MS) {
		_logger.info("Discarding implausible latency sample", {
			callId,
			provider,
			model,
			latencyMs,
			thresholdMs: MAX_SANE_LATENCY_MS,
		});
		latencyMs = 0;
	}

	const totalTokens = usage.totalTokens || usage.input + usage.output;
	const tokensPerSecond =
		latencyMs > 0
			? Number.parseFloat((totalTokens / (latencyMs / 1000)).toFixed(1))
			: 0;
	const derivedErrorClass =
		errorClass ??
		(errorMessage ? classifyError(errorMessage, statusCode) : undefined);

	const entry: TelemetryEntry = {
		timestamp: now,
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
		...(statusCode !== undefined ? { statusCode } : {}),
		...(derivedErrorClass ? { errorClass: derivedErrorClass } : {}),
	};

	await addEntry(entry);

	_logger.info(`Telemetry: ${telemetryKey(provider, model)}`, {
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
	// Explicit user action (/clear-free-telemetry) — flush the debounced
	// write so the clear is durable immediately rather than after the debounce.
	await _store.flush();
}

/**
 * Get the path to the telemetry file.
 */
export function getTelemetryPath(): string {
	return TELEMETRY_FILE;
}

/** Per-provider aggregation of telemetry failure classes (M2, #437). */
export interface ProviderErrorCounts {
	/** 401 + 403 (auth failures). */
	authFailures: number;
	"401": number;
	"403": number;
	"429": number;
	"5xx": number;
	network: number;
	other: number;
}

/**
 * Aggregate failure classes per provider from recorded telemetry entries.
 * Status codes/classes only — never error bodies or messages.
 */
export function getProviderErrorCounts(): ReadonlyMap<
	string,
	ProviderErrorCounts
> {
	const counts = new Map<string, ProviderErrorCounts>();
	const bump = (provider: string, errorClass: ErrorClass): void => {
		let entry = counts.get(provider);
		if (!entry) {
			entry = {
				authFailures: 0,
				"401": 0,
				"403": 0,
				"429": 0,
				"5xx": 0,
				network: 0,
				other: 0,
			};
			counts.set(provider, entry);
		}
		entry[errorClass] += 1;
		if (errorClass === "401" || errorClass === "403") entry.authFailures += 1;
	};

	for (const telemetry of Object.values(_store.load().models)) {
		for (const entry of telemetry.recentCalls) {
			if (entry.errorClass) bump(entry.provider, entry.errorClass);
		}
	}
	return counts;
}
