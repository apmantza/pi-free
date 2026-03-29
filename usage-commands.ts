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

// Extend ExtensionAPI to track registration
type PiWithFlag = ExtensionAPI & {
	__piFreeCommandsRegistered?: boolean;
};

export function registerUsageCommands(pi: ExtensionAPI): void {
	const piExtended = pi as PiWithFlag;

	// Check flag on pi object itself (shared across all providers)
	if (piExtended.__piFreeCommandsRegistered) {
		return;
	}

	// Mark as registered immediately (synchronously) to prevent race conditions
	piExtended.__piFreeCommandsRegistered = true;

	// Register commands
	try {
		pi.registerCommand("free-sessionusage", {
			description: "Show current session usage (requests, tokens, per-model)",
			handler: async (_args, ctx) => {
				const report = formatSessionUsage();
				ctx.ui.notify(report, "info");
			},
		});
	} catch {
		// Command may already exist, ignore
	}

	try {
		pi.registerCommand("free-totalusage", {
			description: "Show cumulative usage across all sessions",
			handler: async (_args, ctx) => {
				const report = formatCumulativeUsage();
				ctx.ui.notify(report, "info");
			},
		});
	} catch {
		// Command may already exist, ignore
	}
}
