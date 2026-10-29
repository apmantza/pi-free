import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PROVIDER_INFRON } from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { safeNotify } from "../../lib/stale-ctx.ts";

/** Parse the real assistant error, not Pi's UI-only exhausted-retry summary. */
function retryDelay(error: string | undefined): number | undefined {
	const json = error?.match(/^429[ \t]*:[ \t]*(\{[\s\S]*\})$/)?.[1];
	if (!json) return;
	let body: unknown;
	try {
		body = JSON.parse(json);
	} catch {
		return;
	}
	if (typeof body !== "object" || body === null) return;
	const { code, message } = body as { code?: unknown; message?: unknown };
	if (code !== "tpm_rate_limit_exceeded" || typeof message !== "string") return;
	const seconds = message.match(/Please try again after (\d+) seconds?\./)?.[1];
	if (!seconds) return;
	const ms = Number(seconds) * 1_000;
	// Node silently clamps overflowing timers to 1ms, defeating the cooldown.
	if (!Number.isSafeInteger(ms) || ms <= 0 || ms > 2_147_483_647) return;
	return ms;
}

type Decision =
	| "observed"
	| "unrecognized-error"
	| "superseded"
	| "suppressed"
	| "continuation-armed"
	| "waiting"
	| "elapsed"
	| "cancelled"
	| "notify-failed"
	| "missing-signal";
interface Cooldown {
	provider: string;
	model: string;
	delayMs: number;
	phase: "observed" | "armed" | "waiting";
	cancelled: boolean;
	finish?: () => void;
}

/** Let Pi exhaust retries first, then hold its native continuation on an active signal. */
export function registerInfronRateLimitContinuation(pi: ExtensionAPI): void {
	const logger = createLogger("infron-retry");
	// Finite reason keys: bounded counters, and at most one file-log record per reason/session.
	const decisions = new Map<Decision, number>();
	let cooldown: Cooldown | undefined;
	const record = (decision: Decision) => {
		const count = (decisions.get(decision) ?? 0) + 1;
		decisions.set(decision, count);
		if (count === 1) logger.info("Infron retry lifecycle", { decision });
	};
	const cancel = () => {
		const ticket = cooldown;
		if (!ticket || ticket.cancelled) return;
		ticket.cancelled = true;
		ticket.finish?.();
		// Armed/waiting tickets must survive until their automatic run can abort.
		if (ticket.phase === "observed") cooldown = undefined;
		if (ticket.phase !== "waiting") record("cancelled");
	};
	pi.registerCommand("free-infron-retry", {
		description: "Show credential-free Infron cooldown lifecycle diagnostics",
		handler: async (_args, ctx) => {
			safeNotify(
				ctx,
				[
					"Infron retry lifecycle v2",
					`state: ${cooldown?.phase ?? "idle"}${cooldown?.cancelled ? " (cancelled)" : ""}`,
					...Array.from(decisions, ([reason, count]) => `${reason}: ${count}`),
				].join("\n"),
				"info",
			);
		},
	});
	pi.on("before_agent_start", () => {
		cancel();
		cooldown = undefined;
	});
	pi.on("input", () => {
		cancel();
	});
	pi.on("model_select", cancel);
	pi.on("session_start", () => {
		cancel();
		cooldown = undefined;
		decisions.clear();
	});
	pi.on("session_shutdown", cancel);
	pi.on("message_end", (event) => {
		const message = event.message;
		if (message.role !== "assistant") return;
		if (cooldown) {
			cooldown.finish?.();
			cooldown = undefined;
			record("superseded");
		}
		if (message.provider !== PROVIDER_INFRON || message.stopReason !== "error")
			return;
		const delayMs = retryDelay(message.errorMessage);
		if (delayMs === undefined) {
			record("unrecognized-error");
			return;
		}
		cooldown = {
			provider: message.provider,
			model: message.model,
			delayMs,
			phase: "observed",
			cancelled: false,
		};
		record("observed");
	});
	pi.on("agent_before_settle", (event, ctx) => {
		const ticket = cooldown;
		if (!ticket || ticket.phase !== "observed") return;
		if (
			ticket.cancelled ||
			event.outcome !== "error" ||
			event.continue ||
			ctx.model?.provider !== ticket.provider ||
			ctx.model.id !== ticket.model ||
			ctx.hasPendingMessages()
		) {
			cooldown = undefined;
			record("suppressed");
			return;
		}
		// This boundary is the native exhaustion authority; it must not await a timer.
		ticket.phase = "armed";
		record("continuation-armed");
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
	});
	pi.on("agent_start", async (_event, ctx) => {
		const ticket = cooldown;
		// Pi's ordinary retry runs only have an observed ticket: never delay them.
		if (!ticket || ticket.phase !== "armed") return;
		const signal = ctx.signal;
		const abort = ctx.abort;
		if (!signal || signal.aborted || ticket.cancelled) {
			if (!signal) record("missing-signal");
			cooldown = undefined;
			abort();
			return;
		}
		ticket.phase = "waiting";
		record("waiting");
		try {
			safeNotify(
				ctx,
				`Infron TPM limit: continuing in ${ticket.delayMs / 1_000} seconds. Escape cancels continuation.`,
				"info",
			);
		} catch {
			// The wait is the point: a host UI failure must not reject this handler
			// before the timer and abort listener exist and skip the cooldown.
			record("notify-failed");
		}
		const elapsed = await new Promise<boolean>((resolve) => {
			const finish = (completed: boolean) => {
				clearTimeout(timer);
				signal.removeEventListener("abort", onAbort);
				delete ticket.finish;
				resolve(completed);
			};
			const onAbort = () => finish(false);
			const timer = setTimeout(() => finish(true), ticket.delayMs);
			ticket.finish = onAbort;
			signal.addEventListener("abort", onAbort, { once: true });
			// Host notification callbacks can re-enter input before finish is installed.
			if (signal.aborted || ticket.cancelled) onAbort();
		});
		if (cooldown === ticket) cooldown = undefined;
		if (elapsed && !ticket.cancelled) record("elapsed");
		else {
			record("cancelled");
			// A model/input change releases the timer but must also stop this stale request.
			if (!signal.aborted) abort();
		}
	});
}
