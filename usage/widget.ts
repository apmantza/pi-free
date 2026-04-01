/**
 * Usage monitoring widget — floating glimpseui window showing per-provider
 * free quota status, daily request counts, credit balances, and cumulative
 * token usage across all sessions.
 *
 * Tracks ALL providers dynamically (including local/Ollama models).
 * Launch with /usage command. Toggles on repeated invocation.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { collectRows, recordSessionRequest } from "../widget/data.ts";
import { renderWidgetHTML } from "../widget/render.ts";
import { recordTurn } from "./store.ts";

const GLIMPSE_PATH =
	"file:///C:/Users/R3LiC/AppData/Roaming/npm/node_modules/glimpseui/src/glimpse.mjs";

let glimpseWin: unknown = null;

export async function openUsageWidget(): Promise<void> {
	const { open } = await import(GLIMPSE_PATH);
	glimpseWin = open(renderWidgetHTML(collectRows()), {
		width: 340,
		height: 400,
		title: "Pi Free Usage",
		frameless: true,
		transparent: true,
		floating: true,
		x: 20,
		y: 20,
	});
	(glimpseWin as any).on("closed", () => {
		glimpseWin = null;
	});
}

export function updateWidget(): void {
	if (!glimpseWin) return;
	try {
		(glimpseWin as any).setHTML(renderWidgetHTML(collectRows()));
	} catch {
		glimpseWin = null;
	}
}

export function closeWidget(): void {
	if (glimpseWin) {
		(glimpseWin as any).close();
		glimpseWin = null;
	}
}

export function registerUsageWidget(pi: ExtensionAPI): void {
	pi.registerCommand("usage", {
		description: "Toggle free model usage dashboard",
		handler: async (_args, ctx) => {
			if (glimpseWin) {
				closeWidget();
				return;
			}
			try {
				await openUsageWidget();
			} catch {
				ctx.ui.notify(
					"Failed to open usage widget (glimpseui required)",
					"warning",
				);
			}
		},
	});

	// Track tokens for ANY provider (including local, custom, etc.)
	// and refresh the widget
	pi.on("turn_end", async (_event, ctx) => {
		const msg = _event.message;
		const provider = ctx.model?.provider;
		if (msg.role === "assistant" && provider) {
			// Record cumulative usage for this provider
			recordTurn(
				provider,
				msg.usage.input,
				msg.usage.output,
				msg.usage.cost.total,
			);
			// Track session requests for providers not handled by provider-helper
			recordSessionRequest(provider);
		}
		updateWidget();
	});
}
