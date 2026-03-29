/**
 * Free tier usage commands
 *
 * Provides:
 * - /free-sessionusage: Current session breakdown
 * - /free-totalusage: Cumulative usage from disk
 *
 * NOTE: Commands temporarily disabled due to duplicate registration issues.
 * Use /kilo-sessionusage or /zen-sessionusage instead.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export function registerUsageCommands(_pi: ExtensionAPI): void {
	// Commands disabled - Pi shows duplicate registrations across providers
	// TODO: Find reliable way to register global commands once
}
