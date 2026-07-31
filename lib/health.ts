import { getProviderRegistry } from "./registry.ts";
import {
	formatStartupSummary,
	getStartupSummary,
} from "./startup-timing.ts";
import { getLogPath, isFileLoggingEnabled } from "./logger.ts";

/** Render a credential-free diagnostic report for `/pi-free-health`. */
export function formatHealthReport(): string {
	const startup = getStartupSummary();
	const registry = getProviderRegistry();
	const networkFailures = startup.cacheNetwork.flatMap((entry) =>
		entry.networkFailures > 0
			? [`${entry.provider} (${entry.networkFailures} failed)`]
			: [],
	);
	const failures = [...startup.failures, ...startup.sessionStartFailures];
	const problemCount = failures.length + networkFailures.length;
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
	if (failures.length > 0) {
		lines.push(`Recorded failures: ${failures.join(", ")}`);
	}
	if (registry.size === 0) {
		lines.push("No providers are registered; check the log for setup errors.");
	}

	return lines.join("\n");
}
