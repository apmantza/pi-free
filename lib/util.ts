/**
 * Backwards-compatible re-export shim (arch lifecycle review).
 *
 * The implementation moved to focused modules — fetch primitives in
 * `lib/fetch.ts`, model mapping/filtering in `lib/model-map.ts`. This shim
 * keeps the 25+ existing importers (providers, tests, scripts) working
 * untouched. New code should import from the focused modules directly.
 */

export {
	computeRetryBackoffMs,
	fetchWithRetry,
	fetchWithTimeout,
	logWarning,
	MAX_RETRY_BACKOFF_MS,
	parseModelResponse,
	sleep,
	withFetchDeadline,
} from "./fetch.ts";
export {
	cleanModelName,
	fetchOpenAICompatibleModels,
	isUsableModel,
	mapOpenRouterModel,
} from "./model-map.ts";
export type {
	OpenAIModelCallbacks,
	OpenAIModelDefaults,
} from "./model-map.ts";
