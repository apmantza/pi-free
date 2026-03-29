/**
 * Free tier usage commands
 *
 * Provides:
 * - /free-sessionusage: Current session breakdown
 * - /free-totalusage: Cumulative usage from disk
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	formatCumulativeUsage,
	formatSessionUsage,
} from "./free-tier-limits.js";

export function registerUsageCommands(pi: ExtensionAPI): void {
	// Check if commands already exist using Pi's API
	const existingCommands =
		(pi as unknown as { getCommands?: () => string[] }).getCommands?.() || [];

	// Only register if commands don't already exist
	if (!existingCommands.includes("free-sessionusage")) {
		pi.registerCommand("free-sessionusage", {
			description: "Show current session usage (requests, tokens, per-model)",
			handler: async (_args, ctx) => {
				const report = formatSessionUsage();
				ctx.ui.notify(report, "info");
			},
		});
	}

	if (!existingCommands.includes("free-totalusage")) {
		pi.registerCommand("free-totalusage", {
			description: "Show cumulative usage across all sessions",
			handler: async (_args, ctx) => {
				const report = formatCumulativeUsage();
				ctx.ui.notify(report, "info");
			},
		});
	}
}
