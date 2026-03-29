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

// Track if commands are registered (prevents duplicates across provider setups)
let usageCommandsRegistered = false;

export function registerUsageCommands(pi: ExtensionAPI): void {
	// Skip if already registered in this session
	if (usageCommandsRegistered) {
		return;
	}

	try {
		pi.registerCommand("free-sessionusage", {
			description: "Show current session usage (requests, tokens, per-model)",
			handler: async (_args, ctx) => {
				const report = formatSessionUsage();
				ctx.ui.notify(report, "info");
			},
		});

		pi.registerCommand("free-totalusage", {
			description: "Show cumulative usage across all sessions",
			handler: async (_args, ctx) => {
				const report = formatCumulativeUsage();
				ctx.ui.notify(report, "info");
			},
		});

		usageCommandsRegistered = true;
	} catch (error) {
		// Commands might already exist - ignore silently
		usageCommandsRegistered = true;
	}
}
