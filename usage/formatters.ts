/**
 * Usage report formatters - text formatting for display
 */

import type { CumulativeUsageReport } from "./cumulative.ts";
import {
	type FreeTierLimit,
	getFreeTierUsage,
	getLimitWarning,
} from "./limits.ts";
import type { SessionUsageReport } from "./tracking.ts";

export interface FreeTierUsage {
	provider: string;
	requestsToday: number;
	requestsThisHour: number;
	requestsThisMonth?: number;
	limit: FreeTierLimit;
	remainingToday?: number;
	remainingThisHour?: number;
	remainingThisMonth?: number;
	percentUsed: number;
	status: "ok" | "warning" | "critical" | "unknown";
}

export function formatSessionUsage(report: SessionUsageReport): string {
	if (report.providers.length === 0) {
		return "No usage recorded in this session yet.";
	}

	const lines: string[] = [];
	lines.push("━".repeat(50));
	lines.push(`📊 Session Usage (${report.durationFormatted})`);
	lines.push("━".repeat(50));
	lines.push("");

	for (const p of report.providers) {
		const warning = getLimitWarning(p.name);
		const statusEmoji = warning ? (warning.includes("⚠️") ? "🔴" : "🟡") : "🟢";
		lines.push(`${statusEmoji} ${p.name}`);
		lines.push(`   Requests: ${p.requests}`);
		lines.push(
			`   Tokens: ~${Math.round(p.tokensIn / 1000)}K in, ~${Math.round(p.tokensOut / 1000)}K out`,
		);

		if (p.topModels.length > 0) {
			lines.push(`   Top models:`);
			for (const m of p.topModels.slice(0, 3)) {
				lines.push(`     • ${m.modelId.split("/").pop()}: ${m.count} req`);
			}
		}
		lines.push("");
	}

	lines.push("━".repeat(50));
	lines.push(
		`📈 Totals: ${report.totalRequests} requests, ~${Math.round(report.totalTokensIn / 1000)}K tokens`,
	);
	lines.push("━".repeat(50));

	return lines.join("\n");
}

export function formatCumulativeUsage(report: CumulativeUsageReport): string {
	if (report.providers.length === 0) {
		return "No cumulative usage data yet. Start using free models!";
	}

	const lines: string[] = [];
	lines.push("━".repeat(50));
	lines.push("📊 Total Usage (All Time)");
	lines.push("━".repeat(50));
	lines.push("");

	for (const p of report.providers) {
		lines.push(`🔹 ${p.name}`);
		lines.push(`   Requests: ${p.totalRequests.toLocaleString()}`);
		lines.push(
			`   Tokens: ~${Math.round(p.totalTokensIn / 1000).toLocaleString()}K in, ~${Math.round(p.totalTokensOut / 1000).toLocaleString()}K out`,
		);
		lines.push(`   Models used: ${p.modelCount}`);

		if (p.topModels.length > 0) {
			lines.push(`   Top models:`);
			for (const m of p.topModels.slice(0, 3)) {
				lines.push(
					`     • ${m.modelId.split("/").pop()}: ${m.count.toLocaleString()} req`,
				);
			}
		}

		lines.push(`   Active since: ${p.firstUsed.split("T")[0]}`);
		lines.push("");
	}

	lines.push("━".repeat(50));
	lines.push(`📈 Grand Totals:`);
	lines.push(`   ${report.grandTotalRequests.toLocaleString()} requests`);
	lines.push(
		`   ~${Math.round(report.grandTotalTokensIn / 1000).toLocaleString()}K input tokens`,
	);
	lines.push(
		`   ~${Math.round(report.grandTotalTokensOut / 1000).toLocaleString()}K output tokens`,
	);
	lines.push("━".repeat(50));

	return lines.join("\n");
}

export function formatFreeTierStatus(provider: string): string {
	const usage = getFreeTierUsage(provider);
	const parts: string[] = [];

	if (usage.limit.requestsPerHour) {
		parts.push(`${usage.requestsThisHour}/${usage.limit.requestsPerHour}/h`);
	}
	if (usage.limit.requestsPerDay) {
		parts.push(`${usage.requestsToday}/${usage.limit.requestsPerDay}/d`);
	}
	if (usage.limit.requestsPerMonth) {
		parts.push(
			`${usage.requestsThisMonth ?? 0}/${usage.limit.requestsPerMonth}/mo`,
		);
	}

	if (parts.length === 0) {
		return `${provider}: ${usage.limit.description}`;
	}

	return `${provider}: ${parts.join(" | ")}`;
}
