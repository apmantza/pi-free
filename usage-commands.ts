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

// Track if we've already registered commands
declare global {
	var __PI_FREE_COMMANDS_REGISTERED__: boolean | undefined;
}

export function registerUsageCommands(pi: ExtensionAPI): void {
	// Use global to track across provider instances
	if (globalThis.__PI_FREE_COMMANDS_REGISTERED__) {
		return;
	}

	// Defer registration to avoid "runtime not initialized" error
	// Register on next tick after extension loading completes
	setImmediate(() => {
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

			globalThis.__PI_FREE_COMMANDS_REGISTERED__ = true;
		} catch (error) {
			// Commands might already exist - ignore silently
			globalThis.__PI_FREE_COMMANDS_REGISTERED__ = true;
		}
	});
}
