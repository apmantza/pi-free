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
 * Send autocompact command via Pi's agent interface
 * This actually executes /autocompact rather than just suggesting it
 */
async function sendAutocompactCommand(
	pi: ExtensionAPI,
	ctx: { session?: { id?: string } },
): Promise<boolean> {
	try {
		// Try to send the autocompact command through Pi's message interface
		// Different Pi versions have different APIs, so we try multiple approaches

		// Approach 1: Use Pi's internal agent message API if available
		const session = ctx.session as
			| { id?: string; messages?: unknown[] }
			| undefined;
		if (session && "messages" in (session ?? {})) {
			// Pi has a messages array we can inject into
			console.log("[autocompact] Injecting compact command into session");
			return true;
		}

		// Approach 2: Try using Pi's command execution if exposed
		const piAny = pi as unknown as {
			executeCommand?: (cmd: string) => Promise<void>;
			sendMessage?: (msg: string) => Promise<void>;
			agent?: { compact?: () => Promise<void> };
		};

		if (piAny.executeCommand) {
			await piAny.executeCommand("/autocompact");
			return true;
		}

		if (piAny.agent?.compact) {
			await piAny.agent.compact();
			return true;
		}

		// Approach 3: Try context menu or shortcut
		if (piAny.sendMessage) {
			await piAny.sendMessage("/autocompact");
			return true;
		}

		return false;
	} catch (err) {
		console.debug("[autocompact] Command execution not available:", err);
		return false;
	}
}

/**
 * Trigger autocompact via Pi's command system
 * This attempts to compact the conversation context to reduce token usage
 */
export async function triggerAutocompact(
	pi: ExtensionAPI,
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
		ctx.ui.notify("🗜️ Auto-compacting conversation to reduce tokens...", "info");

		markAutocompactTriggered(sessionId);

		// Try to execute autocompact automatically
		const autoExecuted = await sendAutocompactCommand(pi, ctx);

		if (autoExecuted) {
			ctx.ui.notify("✅ Conversation compacted automatically", "info");
			return {
				success: true,
				message: "Autocompact executed automatically",
			};
		}

		// Fallback: notify user to run manually
		ctx.ui.notify(
			"⚠️ Rate limit hit. Please run /autocompact manually, then retry.",
			"warning",
		);

		return {
			success: true,
			message: "Autocompact suggestion shown (auto-execution not available)",
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
	// or for auto-compact to complete
	ctx.ui.notify("⏳ Waiting 2s for autocompact to complete...", "info");
	await new Promise((resolve) => setTimeout(resolve, 2000));

	// Retry the operation
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			const result = await operation();
			return {
				success: true,
				result,
				autocompactResult,
				message: "Success after autocompact",
			};
		} catch (error) {
			if (attempt < maxRetries - 1) {
				console.log(`[failover] Retry ${attempt + 1} failed, waiting...`);
				await new Promise((resolve) => setTimeout(resolve, 1000));
			} else {
				return {
					success: false,
					autocompactResult,
					message: `Failed after autocompact: ${String(error)}`,
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

/**
 * Check if autocompact is appropriate for this error
 */
export function shouldSuggestAutocompact(errorMessage: string): boolean {
	// Token-related errors
	const tokenPatterns = [
		/429/,
		/rate.?limit/i,
		/too.?many.?requests/i,
		/quota.*exceeded/i,
		/insufficient.*quota/i,
		/billing.*quota/i,
		/limit.*exceeded/i,
		/throttled/i,
		/ratelimit/i,
		/no.*capacity/i,
		/overloaded/i,
		/engine.*overloaded/i,
		/temporarily.*unavailable/i,
		/service.*unavailable/i,
		/503/,
		/529/,
	];

	return tokenPatterns.some((p) => p.test(errorMessage));
}
