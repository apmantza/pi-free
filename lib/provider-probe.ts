/**
 * Generic Provider Probe Helper
 *
 * Provides a reusable auto-probe factory for providers whose free model
 * availability may change over time (expired promotions, rate limits,
 * server spin-down).
 *
 * Usage:
 *   const probe = createProviderProbe({
 *     providerId: "deepinfra",
 *     probeModel: async (apiKey, modelId) => { ... return "ok"|"broken"|"unknown"; },
 *   });
 *   const broken = await probe.run(apiKey, models);
 *   // broken is a string[] of model IDs that returned "broken"
 *
 * The helper handles:
 *   - Batching probe requests (default batchSize=5)
 *   - Probe-cache integration (skip recently-probed models, persist results)
 *   - Auto-hiding broken models in config (provider-scoped)
 *   - Re-registration after hiding
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { updateConfig } from "../config.ts";
import { createLogger } from "./logger.ts";
import {
	getModelsDueForProbe,
	recordModelProbeResults,
	type ModelProbeResult,
} from "./probe-cache.ts";

const _logger = createLogger("provider-probe");

// =============================================================================
// Types
// =============================================================================

export type ProbeModelFn = (
	apiKey: string,
	modelId: string,
) => Promise<"ok" | "broken" | "unknown">;

export interface ProviderProbeOptions {
	/** Provider identifier (used for probe-cache key and config hiding). */
	providerId: string;
	/** Provider-specific probe function. */
	probeModel: ProbeModelFn;
	/** Max concurrent probes per batch (default: 5). */
	batchSize?: number;
	/**
	 * Whether broken models should be auto-hidden in config.
	 * Default: true for most providers; false for transient promotions.
	 */
	autoHide?: boolean;
}

export interface ProviderProbe {
	/**
	 * Run the probe against the given models.
	 *
	 * @param apiKey - The provider's API key
	 * @param models - Models to test (typically free models)
	 * @param options.useCache - When true, skip models with fresh probe-cache entries
	 * @param options.onBroken - Optional callback fired per broken model (e.g., for notifications)
	 * @returns Array of broken model IDs
	 */
	run: (
		apiKey: string,
		models: ProviderModelConfig[],
		options?: {
			useCache?: boolean;
			onBroken?: (brokenIds: string[]) => void;
		},
	) => Promise<string[]>;

	/**
	 * Convenience: wire lazy async auto-probe into session_start.
	 * Returns a session_start handler that probes once on first session.
	 */
	autoProbeHandler: (
		apiKey: string,
		models: ProviderModelConfig[],
	) => () => Promise<void>;
}

// =============================================================================
// Factory
// =============================================================================

export function createProviderProbe(
	options: ProviderProbeOptions,
): ProviderProbe {
	const { providerId, probeModel, batchSize = 5, autoHide = true } = options;

	const run: ProviderProbe["run"] = async (
		apiKey,
		models,
		opts = {},
	): Promise<string[]> => {
		const { useCache = false, onBroken } = opts;

		// Determine which models need probing
		const modelIdsToProbe = useCache
			? new Set(
					getModelsDueForProbe(
						providerId,
						models.map((m) => m.id),
					),
				)
			: undefined;
		const probeCandidates = modelIdsToProbe
			? models.filter((m) => modelIdsToProbe.has(m.id))
			: models;

		if (probeCandidates.length === 0) {
			_logger.info(`[probe] ${providerId}: probe cache is fresh`);
			return [];
		}

		_logger.info(
			`[probe] ${providerId}: probing ${probeCandidates.length} models (batch ${batchSize})`,
		);

		// Batch probes
		const broken: string[] = [];
		const cacheableResults: ModelProbeResult[] = [];

		for (let i = 0; i < probeCandidates.length; i += batchSize) {
			const batch = probeCandidates.slice(i, i + batchSize);
			const results = await Promise.all(
				batch.map(async (m) => {
					const status = await probeModel(apiKey, m.id);
					return { id: m.id, status };
				}),
			);
			for (const r of results) {
				if (r.status === "broken") broken.push(r.id);
				if (r.status !== "unknown") {
					cacheableResults.push({ modelId: r.id, status: r.status });
				}
			}
		}

		// Persist probe results to cache
		await recordModelProbeResults(providerId, cacheableResults);

		if (broken.length === 0) {
			_logger.info(`[probe] ${providerId}: all models accessible`);
			return [];
		}

		// Optional auto-hide — use updateConfig for atomic RMW to prevent
		// concurrent probes from clobbering each other's hidden_models.
		if (autoHide) {
			await updateConfig((cfg) => {
				const existingHidden = new Set(cfg.hidden_models ?? []);
				for (const id of broken) existingHidden.add(`${providerId}/${id}`);
				return { hidden_models: Array.from(existingHidden) };
			});
			_logger.info(
				`[probe] ${providerId}: auto-hidden ${broken.length} broken models`,
			);
		}

		onBroken?.(broken);
		_logger.info(`[probe] ${providerId}: found ${broken.length} broken models`);
		return broken;
	};

	const autoProbeHandler: ProviderProbe["autoProbeHandler"] = (
		apiKey,
		models,
	) => {
		let done = false;
		return async () => {
			if (done) return;
			done = true;
			_logger.info(`[probe] Starting lazy auto-probe for ${providerId}...`);
			try {
				await run(apiKey, models, { useCache: true });
			} catch (err) {
				_logger.warn(`[probe] ${providerId}: auto-probe failed`, {
					error: err instanceof Error ? err.message : String(err),
				});
			}
		};
	};

	return { run, autoProbeHandler };
}
