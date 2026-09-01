import { getProviderRegistry } from "./registry.ts";
import {
	formatStartupSummary,
	getStartupSummary,
	nativeRefreshFlags,
} from "./startup-timing.ts";
import {
	getLastLogWriteError,
	getLogPath,
	getLogWriteFailures,
	isFileLoggingEnabled,
} from "./logger.ts";
import { getAllResponseCounters } from "./quota-monitor.ts";
import { getAutoFallback } from "./auto-fallback-status.ts";

/**
 * Render a credential-free diagnostic report for `/pi-free-health`.
 *
 * Credential-free by construction: counts, ages, and status codes only —
 * never API keys, tokens, response bodies, log tails, or config values.
 */
export function formatHealthReport(): string {
	const startup = getStartupSummary();
	const registry = getProviderRegistry();
	const networkFailures = startup.cacheNetwork.flatMap((entry) =>
		entry.networkFailures > 0
			? [`${entry.provider} (${entry.networkFailures} failed)`]
			: [],
	);
	const failures = [...startup.failures, ...startup.sessionStartFailures];
	const outcomeFlags = nativeRefreshFlags(startup);
	const emptyCatalogs = emptyCatalogFlags();
	const responseIssues = responseOutcomeLines();
	const logWriteFailures = getLogWriteFailures();
	const problemCount =
		failures.length +
		networkFailures.length +
		outcomeFlags.length +
		emptyCatalogs.length +
		responseIssues.length +
		(logWriteFailures > 0 ? 1 : 0);
	const status = registry.size === 0 || problemCount > 0 ? "WARN" : "OK";
	const logSuffix = isFileLoggingEnabled() ? "" : " (file logging disabled)";
	const lines = [
		`🩺 Pi-Free health: ${status}`,
		`Registered providers: ${registry.size}`,
		`Startup run: ${startup.runId}`,
		`Log file: ${getLogPath()}${logSuffix}`,
		"",
		formatStartupSummary(),
	];

	if (networkFailures.length > 0) {
		lines.push(`Network failures: ${networkFailures.join(", ")}`);
	}
	if (emptyCatalogs.length > 0) {
		lines.push(`Empty catalogs: ${emptyCatalogs.join("; ")}`);
	}
	if (responseIssues.length > 0) {
		lines.push(`Response issues: ${responseIssues.join("; ")}`);
	}
	if (failures.length > 0) {
		lines.push(`Recorded failures: ${failures.join(", ")}`);
	}
	if (logWriteFailures > 0) {
		const lastError = getLastLogWriteError();
		lines.push(
			`Log write failures: ${logWriteFailures} (sink: ${getLogPath()}${
				lastError ? `; last: ${lastError}` : ""
			})`,
		);
	}
	if (registry.size === 0) {
		lines.push("No providers are registered; check the log for setup errors.");
	}

	// Auto-fallback status (Q32 = B). Credential-free: only enabled flag,
	// counts, and the last failure class — never keys, tokens, or models
	// payload. Missing handle (extension not initialized yet) is treated as
	// "not loaded" rather than "broken".
	const fallback = getAutoFallback();
	if (fallback) {
		const status = fallback.getStatus();
		const statusLine =
			`auto_fallback: ${status.enabled ? "enabled" : "disabled"}` +
			` (switches: ${status.switchCount}` +
			(status.lastSwitchReason
				? `, last: ${status.lastSwitchReason}`
				: "") +
			`${status.exhausted ? ", EXHAUSTED" : ""})`;
		lines.push(statusLine);
	}

	return lines.join("\n");
}

/**
 * Mn1 (#437): providers whose stored catalog is empty after a refresh.
 * Distinguishes "refresh completed and published 0 models" (refreshOks > 0)
 * from "refresh never ran" (no cacheNetwork evidence at all).
 */
function emptyCatalogFlags(): string[] {
	const flags: string[] = [];
	const startup = getStartupSummary();
	const outcomeByProvider = new Map(
		startup.cacheNetwork.map((entry) => [entry.provider, entry]),
	);
	for (const [providerId, entry] of getProviderRegistry()) {
		if (entry.stored.all.length > 0 || entry.stored.free.length > 0) continue;
		const outcome = outcomeByProvider.get(providerId);
		// Only flag providers with refresh evidence. Auth-required providers
		// whose auth resolves undefined without a key (StepFun, TokenRouter,
		// AnyAPI, B.AI, OpenGateway, unconfigured Qoder) are never refreshed by
		// Pi at all — flagging them would flip health to WARN on installs that
		// were previously fine (Mn1 false-alarm regression).
		if (!outcome) continue;
		if (outcome.refreshOks > 0) {
			flags.push(`${providerId}: empty after completed refresh (0 models)`);
		} else {
			flags.push(`${providerId}: no models; refresh never completed`);
		}
	}
	return flags;
}

/** M2/Mn3 (#437): per-provider 401/403/429/5xx and quota-header-drift counts. */
function responseOutcomeLines(): string[] {
	const lines: string[] = [];
	for (const [providerId, counters] of getAllResponseCounters()) {
		const parts: string[] = [];
		if (counters.authFailures > 0) {
			parts.push(`${counters.authFailures} auth-fail (401/403)`);
		}
		if (counters.rateLimited > 0) {
			parts.push(`${counters.rateLimited} rate-limited (429)`);
		}
		if (counters.serverErrors > 0) {
			parts.push(`${counters.serverErrors} server-error (5xx)`);
		}
		if (counters.quotaHeaderDrift > 0) {
			parts.push(`${counters.quotaHeaderDrift} quota-header-drift`);
		}
		if (parts.length > 0) lines.push(`${providerId}: ${parts.join(", ")}`);
	}
	return lines;
}
