/**
 * Autocompact integration for provider failover
 * Triggers /autocompact when hitting rate limits in free mode
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export interface AutocompactResult {
	success: boolean;
	originalTokens?: number;
	compactedTokens?: number;
	reductionPercent?: number;
	message?: string;
}

// Track autocompact attempts to prevent loops
const recentAutocompacts = new Map<string, number>();
const AUTOCOMPACT_COOLDOWN_MS = 30000; // 30 seconds between attempts

/**
 * Check if we've recently triggered autocompact (prevent loops)
 */
export function isAutocompactCooldown(
	sessionId: string,
	cooldownMs = AUTOCOMPACT_COOLDOWN_MS,
): boolean {
	const lastAttempt = recentAutocompacts.get(sessionId);
	if (!lastAttempt) return false;
	return Date.now() - lastAttempt < cooldownMs;
}

/**
 * Mark autocompact as triggered for this session
 */
export function markAutocompactTriggered(sessionId: string): void {
	recentAutocompacts.set(sessionId, Date.now());

	// Cleanup old entries (keep last 10)
	if (recentAutocompacts.size > 10) {
		const oldest = [...recentAutocompacts.entries()].sort(
			(a, b) => a[1] - b[1],
		)[0];
		if (oldest) recentAutocompacts.delete(oldest[0]);
	}
}

/**
 * Trigger autocompact via Pi's command system
 * This attempts to compact the conversation context to reduce token usage
 */
export async function triggerAutocompact(
	_pi: ExtensionAPI, // Reserved for future Pi API integration
	ctx: {
		ui: {
			notify: (message: string, type: "info" | "warning" | "error") => void;
		};
		session?: { id?: string };
	},
	reason = "Rate limit hit - compacting context",
): Promise<AutocompactResult> {
	const sessionId = ctx.session?.id ?? "default";

	// Check cooldown
	if (isAutocompactCooldown(sessionId)) {
		return {
			success: false,
			message: "Autocompact on cooldown (preventing loop)",
		};
	}

	try {
		console.log(`[failover] Triggering autocompact: ${reason}`);
		ctx.ui.notify("🗜️ Compacting conversation to reduce tokens...", "info");

		markAutocompactTriggered(sessionId);

		// For now, we notify the user to run /autocompact manually
		// Full integration requires Pi's internal API which varies by version
		ctx.ui.notify(
			"⚠️ Rate limit hit on free provider. Run /autocompact to reduce tokens, then retry.",
			"warning",
		);

		return {
			success: true,
			message: "Autocompact suggestion shown to user",
		};
	} catch (error) {
		console.error("[failover] Autocompact failed:", error);

		return {
			success: false,
			message: `Autocompact error: ${String(error)}`,
		};
	}
}

/**
 * Try autocompact, then retry the operation if successful
 */
export async function autocompactAndRetry<T>(
	pi: ExtensionAPI,
	ctx: {
		ui: {
			notify: (message: string, type: "info" | "warning" | "error") => void;
		};
		session?: { id?: string };
	},
	operation: () => Promise<T>,
	maxRetries = 1,
): Promise<{
	success: boolean;
	result?: T;
	autocompactResult?: AutocompactResult;
	message?: string;
}> {
	// Try autocompact first
	const autocompactResult = await triggerAutocompact(
		pi,
		ctx,
		"Free provider rate limit - compacting before retry",
	);

	if (!autocompactResult.success) {
		return {
			success: false,
			autocompactResult,
			message: autocompactResult.message,
		};
	}

	// Wait a moment for user to potentially run autocompact
	// In the future, this could be replaced with actual compaction
	ctx.ui.notify("⏳ Waiting for compaction... (retrying in 3s)", "info");
	await new Promise((resolve) => setTimeout(resolve, 3000));

	// Retry the operation
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			const result = await operation();
			return {
				success: true,
				result,
				autocompactResult,
				message: "Success after autocompact suggestion",
			};
		} catch (error) {
			if (attempt < maxRetries - 1) {
				console.log(`[failover] Retry ${attempt + 1} failed, waiting...`);
				await new Promise((resolve) => setTimeout(resolve, 1000));
			} else {
				return {
					success: false,
					autocompactResult,
					message: `Failed after autocompact suggestion: ${String(error)}`,
				};
			}
		}
	}

	return {
		success: false,
		autocompactResult,
		message: "Max retries exceeded",
	};
}
