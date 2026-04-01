/**
 * Usage tracking module
 *
 * Exports:
 * - Commands: /free-sessionusage, /free-totalusage
 * - Tracking: per-model and per-provider usage counts
 * - Cumulative: persistent storage across sessions
 * - Formatters: display formatting with rate limits
 */

// Commands
export { registerUsageCommands } from "./commands.ts";
// Cumulative (persistent)
export {
	type CumulativeUsageReport,
	getCumulativeUsage,
} from "./cumulative.ts";
// Formatters
export {
	formatCumulativeUsage,
	formatFreeTierStatus,
	formatSessionUsage,
} from "./formatters.ts";
// Limits
export {
	FREE_TIER_LIMITS,
	type FreeTierLimit,
	type FreeTierUsage,
	getFreeTierUsage,
	getLimitWarning,
	isApproachingLimit,
} from "./limits.ts";
// Metrics (internal)
export { getDailyRequestCount, incrementRequestCount } from "./metrics.ts";
// Tracking (runtime)
export {
	getModelUsage,
	getProviderModelUsage,
	getSessionUsage,
	getTopModels,
	incrementModelRequestCount,
	logModelUsageReport,
	type ModelUsageEntry,
	resetUsageStats,
	type SessionUsageReport,
} from "./tracking.ts";
