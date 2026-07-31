/**
 * LLM7.io Provider Extension
 *
 * LLM7.io is an LLM API gateway that routes requests across multiple
 * providers (OpenAI, Mistral, Google, DeepSeek, Cloudflare, etc.) through
 * a single OpenAI-compatible endpoint.
 *
 * Free tier:
 *   - Anonymous (no key) or free token from https://token.llm7.io/
 *   - 100 req/hr, 20 req/min, 2 req/s
 *   - No credit card required
 *
 * Pro tier ($12/mo):
 *   - Higher rate limits, JSON mode, function calling
 *   - Access to "pro" routing selector
 *
 * Model selectors (not specific model IDs — LLM7 routes randomly):
 *   - "default" — first available free model (free)
 *   - "fast" — lowest latency option (free)
 *   - "pro" — highest quality, longer reasoning (paid)
 *
 * Endpoint:
 *   Chat: https://api.llm7.io/v1/chat/completions
 *
 * Registered as a native pi-ai `Provider` (createProvider object form) so Pi
 * owns credential resolution, background model refresh, and offline
 * initialization. LLM7 is pi-free's keyless-provider proof case: its auth
 * always resolves (empty auth when no key is configured), so the public free
 * catalog stays visible without an API key — the legacy registration skipped
 * the provider entirely in that case. Authenticated requests still use the
 * ambient `LLM7_API_KEY` env var / `~/.pi/free.json` value as before.
 *
 *   - The factory is synchronous and network-free — it builds the provider
 *     object and registers it. Models load via `refreshModels` (offline init
 *     from the native models store, then a background refresh of the STATIC
 *     selector catalog), so LLM7 no longer owns any of Pi's startup critical
 *     path.
 *   - Free/paid filtering stays on pi-free's re-registration toggle so it
 *     keeps composing with the global /toggle-free system.
 *
 * Setup (optional — free models work without a key):
 *   1. Get a free token from https://token.llm7.io/
 *   2. Set LLM7_API_KEY env var (or add to ~/.pi/free.json)
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Models appear in /model selector as "llm7/default", "llm7/fast", "llm7/pro"
 */

import type { Provider } from "@earendil-works/pi-ai/compat";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {
	getLlm7ApiKey,
	getLlm7ShowPaid,
	saveConfig,
} from "../../config.ts";
import { PROVIDER_LLM7 } from "../../constants.ts";
import { registerWithGlobalToggle } from "../../lib/registry.ts";
import { wrapSessionStartHandler } from "../../lib/session-start-metrics.ts";
import { logWarning } from "../../lib/util.ts";
import { createLlm7Provider } from "./llm7-provider.ts";

// =============================================================================
// Native provider registration
// =============================================================================

/**
 * The >=0.81 `registerProvider(provider: Provider)` single-argument overload.
 * The dev lockfile predates it (its ExtensionAPI only types the legacy
 * `(name, config)` form), so we bridge the type here; the declared peer range
 * (>=0.81) guarantees the overload exists at runtime. Re-registering the same
 * provider object upserts by id, which is how the free/paid toggle republishes a
 * new visible catalog without dropping native auth.
 */
type NativeRegistrar = {
	registerProvider(provider: Provider): void;
};

function registerNative(
	pi: ExtensionAPI,
	provider: Provider<"openai-completions">,
): void {
	(pi as unknown as NativeRegistrar).registerProvider(provider);
}

// =============================================================================
// Extension entry point
// =============================================================================

export default async function llm7Provider(pi: ExtensionAPI) {
	const { provider, stored, setView } = createLlm7Provider();

	// Register the native provider. The factory performs NO network I/O: models
	// load via refreshModels (offline init from the store, then a background
	// refresh of the static selector catalog), so LLM7 no longer owns any of
	// Pi's startup critical path.
	registerNative(pi, provider);

	// Re-registration republishes the same native provider object (upsert by id)
	// with a new visible catalog, keeping native auth intact. This is the hook the
	// global /toggle-free system and /toggle-llm7 drive.
	const reRegister = (models: ProviderModelConfig[]) => {
		setView(models);
		registerNative(pi, provider);
	};

	const hasLlm7Key = !!getLlm7ApiKey();
	registerWithGlobalToggle(PROVIDER_LLM7, stored, reRegister, hasLlm7Key);

	// Per-provider toggle command
	pi.registerCommand("toggle-llm7", {
		description: "Toggle between free and all LLM7 models",
		handler: async (_args, ctx) => {
			const showPaid = !getLlm7ShowPaid();
			await saveConfig({ llm7_show_paid: showPaid });

			const modelsToShow =
				showPaid && stored.all.length > 0 ? stored.all : stored.free;
			reRegister(modelsToShow);

			const freeCount = stored.free.length;
			const paidCount = stored.all.length - freeCount;
			if (showPaid && stored.all.length > 0) {
				ctx.ui.notify(
					`llm7: showing all ${stored.all.length} models (${freeCount} free, ${paidCount} paid)`,
					"info",
				);
			} else {
				ctx.ui.notify(
					`llm7: showing ${freeCount} free models (${paidCount} paid hidden)`,
					"info",
				);
			}
		},
	});

	// ToS notice on first LLM7 selection (mirrors the legacy setupProvider
	// notice). Suppressed when an API key is configured — the "set API key for
	// paid access" hint is only relevant to keyless users.
	let tosShown = false;
	pi.on("model_select", async (_event, ctx) => {
		if (tosShown || ctx.model?.provider !== PROVIDER_LLM7) return;
		tosShown = true;
		if (getLlm7ApiKey()) return;
		ctx.ui.notify(
			"Using llm7 free models. Set API key for paid access. Terms: https://llm7.io/",
			"info",
		);
	});

	// Refresh nudge on session start. Native refreshModels (owned by Pi) keeps the
	// catalog fresh on its throttled cycle; this only nudges the model registry
	// when it exposes a refresh hook, and is a safe no-op otherwise.
	pi.on(
		"session_start",
		wrapSessionStartHandler("llm7", (_event, ctx) => {
			try {
				const registry = (
					ctx as {
						modelRegistry?: { refresh?: (opts?: unknown) => unknown };
					}
				).modelRegistry;
				const result = registry?.refresh?.({ allowNetwork: true });
				if (result && typeof (result as Promise<void>).catch === "function") {
					(result as Promise<void>).catch((err: unknown) =>
						logWarning(
							"llm7",
							"Model refresh nudge failed",
							err instanceof Error ? err.message : String(err),
						),
					);
				}
			} catch (err) {
				logWarning(
					"llm7",
					"Model refresh nudge failed",
					err instanceof Error ? err.message : String(err),
				);
			}
			return Promise.resolve();
		}),
	);
}
