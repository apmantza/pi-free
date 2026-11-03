/**
 * Tell the user about an OpenCode free-tier problem when the model is selected,
 * rather than at the first 429. Selecting an opencode-free model starts the Bun
 * relay; selecting a free model on Pi's built-in opencode provider warns, because
 * that route never uses the relay.
 */
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { PROVIDER_OPENCODE, PROVIDER_OPENCODE_FREE } from "../constants.ts";
import { prewarmOpenCodeRelay } from "../providers/opencode-session.ts";
import { createLogger } from "./logger.ts";
import { isFreeModel } from "./registry.ts";
import { wrapSessionStartHandler } from "./session-start-metrics.ts";
import { safeNotify } from "./stale-ctx.ts";

const _logger = createLogger("opencode-readiness");

export function setupOpenCodeReadiness(pi: ExtensionAPI): void {
	let warnedRelay = false;
	let warnedBuiltIn = false;

	const prepare = async (
		model: ExtensionContext["model"],
		ctx: ExtensionContext,
	): Promise<void> => {
		if (model?.provider === PROVIDER_OPENCODE) {
			if (warnedBuiltIn || !isFreeModel(model)) return;
			warnedBuiltIn = true;
			safeNotify(
				ctx,
				`${model.id} is a free model on Pi's built-in opencode provider, where OpenCode rejects free-tier requests with 429 or 403. Select it under opencode-free instead.`,
				"warning",
			);
			return;
		}
		if (model?.provider !== PROVIDER_OPENCODE_FREE) return;
		const failure = await prewarmOpenCodeRelay();
		if (!failure || warnedRelay) return;
		warnedRelay = true;
		safeNotify(
			ctx,
			`opencode-free cannot use its Bun relay (${failure}), so requests will get 429 FreeUsageLimitError. Install Bun from https://bun.sh or set PI_FREE_OPENCODE_BUN to its full path, then restart Pi.`,
			"warning",
		);
	};

	pi.on(
		"session_start",
		wrapSessionStartHandler(
			"opencode-readiness",
			(_event, ctx: ExtensionContext) => prepare(ctx.model, ctx),
			{ detached: true },
		),
	);
	pi.on("model_select", (event, ctx) => {
		prepare(event.model, ctx).catch((error: unknown) => {
			_logger.warn("opencode readiness check failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		});
	});
}
