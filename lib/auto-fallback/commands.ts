/**
 * Slash-command surface for auto-fallback.
 *
 * Registers three commands on the ExtensionAPI (Q17 = B):
 *
 *   - `/toggle-auto-fallback`  — flip the on/off switch (persists).
 *   - `/free-fallback-history` — show this-session switch log.
 *   - `/reset-fallback-blacklist` — clear the in-memory blacklist.
 *
 * Command registration is decoupled from the {@link createAutoFallback}
 * factory so tests can drive commands without standing up the full
 * auto-fallback pipeline.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { saveConfig } from "../../config.ts";
import { getAutoFallbackConfig } from "./config.ts";
import type { Blacklist } from "./blacklist.ts";
import { modelKey } from "./selection.ts";
import { createLogger } from "../logger.ts";

const _logger = createLogger("auto-fallback");

export interface CommandsDeps {
	blacklist: Blacklist;
	/**
	 * Function returning the switch history for `/free-fallback-history`.
	 * The history is owned by the auto-fallback entry point, not the
	 * blacklist (which only tracks failures, not successful switches).
	 */
	getHistory: () => ReadonlyArray<HistoryEntry>;
	/**
	 * Function returning whether auto-fallback is currently enabled.
	 * (May differ from the config value if `/toggle-auto-fallback`
	 * was used mid-session.)
	 */
	isEnabled: () => boolean;
	/**
	 * Function returning whether auto-fallback has exhausted all
	 * candidates (every model blacklisted or none eligible).
	 */
	isExhausted: () => boolean;
}

export interface HistoryEntry {
	at: number;
	fromKey: string;
	toKey: string;
	reason: string;
	recovered: boolean; // true if a subsequent run on the new model succeeded
}

export function registerAutoFallbackCommands(
	pi: ExtensionAPI,
	deps: CommandsDeps,
): void {
	pi.registerCommand("toggle-auto-fallback", {
		description:
			"Toggle automatic fallback to another free model when the current one errors",
		handler: async (_args, ctx) => {
			const cfg = getAutoFallbackConfig();
			const next = !cfg.enabled;
			// Persist synchronously (saveConfig is async but the handler
			// signature is async — we await it so the on-disk state matches
			// the toast before the user takes another action).
			await saveConfig({ auto_fallback: next });
			ctx.ui.notify(
				next
					? "Auto-fallback: ON — failing free models will be auto-switched"
					: "Auto-fallback: OFF",
				"info",
			);
		},
	});

	pi.registerCommand("free-fallback-history", {
		description:
			"Show auto-fallback switch history for the current session",
		handler: async (_args, ctx) => {
			const history = deps.getHistory();
			if (history.length === 0) {
				ctx.ui.notify(
					"No auto-fallback switches this session.",
					"info",
				);
				return;
			}
			const cfg = getAutoFallbackConfig();
			const lines: string[] = ["🛟 Auto-fallback history:", ""];
			if (!cfg.enabled) {
				lines.push("(currently disabled)", "");
			} else if (deps.isExhausted()) {
				lines.push("(exhausted — all free candidates tried)", "");
			}
			for (const entry of history) {
				const when = formatClock(entry.at);
				const recovery = entry.recovered ? "✓ recovered" : "↻ still trying";
				lines.push(
					`${when}  ${entry.fromKey} → ${entry.toKey}  [${entry.reason}]  ${recovery}`,
				);
			}
			// Include the blacklist snapshot so the user can see WHY each
			// model was excluded at the last selection.
			const blacklist = deps.blacklist.snapshot();
			if (blacklist.size > 0) {
				lines.push("", "Blacklist:");
				for (const [key, record] of blacklist) {
					lines.push(
						`  ${key}: ${record.count}× (${record.reasons.join(", ") || "no reason recorded"})`,
					);
				}
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("reset-fallback-blacklist", {
		description:
			"Clear the auto-fallback in-memory blacklist (unban every model)",
		handler: async (_args, ctx) => {
			const cleared = deps.blacklist.clearAll();
			ctx.ui.notify(
				cleared > 0
					? `Auto-fallback: cleared ${cleared} blacklist ${cleared === 1 ? "entry" : "entries"}`
					: "Auto-fallback: blacklist was already empty",
				"info",
			);
		},
	});
}

function formatClock(ts: number): string {
	try {
		return new Date(ts).toLocaleTimeString();
	} catch {
		return String(ts);
	}
}