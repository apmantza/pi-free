import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PROVIDER_INFRON } from "../../constants.ts";
import { safeNotify } from "../../lib/stale-ctx.ts";

/** Infron's explicit TPM cooldown only; never guess a delay from a generic 429. */
function retryDelay(error: string | undefined): number | undefined {
	if (
		!error ||
		!/^(?:Error: )?Retry failed after 3 (?:attempts|times): 429:/.test(error) ||
		!/"code"\s*:\s*"tpm_rate_limit_exceeded"/.test(error)
	)
		return;
	const seconds = error.match(/Please try again after (\d+) seconds?\./)?.[1];
	if (!seconds) return;
	const ms = Number(seconds) * 1_000;
	// Node silently clamps overflowing timers to 1ms, defeating the cooldown.
	if (!Number.isSafeInteger(ms) || ms <= 0 || ms > 2_147_483_647) return;
	return ms;
}

/** Keep timed recovery inside Pi's abort-aware boundary, ahead of auto-fallback. */
export function registerInfronRateLimitContinuation(pi: ExtensionAPI): void {
	let lastAssistant: AssistantMessage | undefined;
	let cancelWait: (() => void) | undefined;
	const cancel = () => {
		cancelWait?.();
		lastAssistant = undefined;
	};
	pi.on("before_agent_start", cancel);
	pi.on("input", () => {
		cancel();
	});
	pi.on("model_select", cancel);
	pi.on("session_start", cancel);
	pi.on("session_shutdown", cancel);
	pi.on("message_end", (event) => {
		if (event.message.role === "assistant") lastAssistant = event.message;
	});
	pi.on("agent_before_settle", async (event, ctx) => {
		const message = lastAssistant;
		lastAssistant = undefined;
		if (
			event.outcome !== "error" ||
			event.continue ||
			!message ||
			message.stopReason !== "error" ||
			message.provider !== PROVIDER_INFRON ||
			ctx.model?.provider !== PROVIDER_INFRON ||
			ctx.model.id !== message.model ||
			ctx.hasPendingMessages()
		)
			return;
		const delay = retryDelay(message.errorMessage);
		if (delay === undefined) return;
		safeNotify(
			ctx,
			`Infron TPM limit: continuing in ${delay / 1_000} seconds. Escape cancels continuation.`,
			"info",
		);
		const signal = ctx.signal;
		const elapsed = await new Promise<boolean>((resolve) => {
			const finish = (completed: boolean) => {
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
				cancelWait = undefined;
				resolve(completed);
			};
			const onAbort = () => finish(false);
			const timer = setTimeout(() => finish(true), delay);
			cancelWait = onAbort;
			signal?.addEventListener("abort", onAbort, { once: true });
			if (signal?.aborted) onAbort();
		});
		// No ctx access after await: model/session/input transitions cancel the wait.
		// Pi also refuses boundary continuation after Escape, even without a signal.
		if (elapsed)
			return {
				entries: [
					{
						type: "custom_message" as const,
						customType: "infron-rate-limit-continue",
						content: "Continue the interrupted task.",
						display: true,
					},
				],
				continue: true,
			};
		return;
	});
}
