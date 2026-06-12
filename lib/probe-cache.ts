/**
 * Provider model probe cache.
 *
 * Stores the last successful accessibility probe per provider/model so
 * background cleanup can avoid spending quota on the same checks every session.
 */

import { createJSONStore } from "./json-persistence.ts";
import { createLogger } from "./logger.ts";
import { PI_DATA_DIR } from "./paths.ts";

const _logger = createLogger("probe-cache");

export const DEFAULT_PROBE_TTL_MS = 24 * 60 * 60 * 1000;

export type ProbeStatus = "ok" | "broken";

export interface ModelProbeResult {
	modelId: string;
	status: ProbeStatus;
}

interface ModelProbeEntry {
	lastProbedAt: string;
	status: ProbeStatus;
}

interface ProviderProbeCache {
	provider: string;
	models: Record<string, ModelProbeEntry>;
}

interface ProbeCacheData {
	providers: Record<string, ProviderProbeCache>;
}

const CACHE_FILE = `${PI_DATA_DIR}/probe-cache.json`;
const _cache = createJSONStore<ProbeCacheData>(CACHE_FILE, { providers: {} });

export function getModelsDueForProbe(
	providerId: string,
	modelIds: string[],
	ttlMs = DEFAULT_PROBE_TTL_MS,
): string[] {
	const provider = _cache.load().providers[providerId];
	const now = Date.now();

	return modelIds.filter((modelId) => {
		const entry = provider?.models[modelId];
		if (!entry) return true;

		// Broken models are normally hidden immediately. If a user later unhides one,
		// re-check it instead of letting a stale broken cache suppress cleanup.
		if (entry.status === "broken") return true;

		const lastProbedAt = Date.parse(entry.lastProbedAt);
		if (!Number.isFinite(lastProbedAt)) return true;

		return now - lastProbedAt >= ttlMs;
	});
}

export async function recordModelProbeResults(
	providerId: string,
	results: ModelProbeResult[],
): Promise<void> {
	if (results.length === 0) return;

	await _cache.update((data) => {
		const provider = (data.providers[providerId] ??= {
			provider: providerId,
			models: {},
		});
		const lastProbedAt = new Date().toISOString();

		for (const result of results) {
			provider.models[result.modelId] = {
				lastProbedAt,
				status: result.status,
			};
		}

		return data;
	});
	_logger.debug(`Recorded ${results.length} probe results for ${providerId}`);
}
