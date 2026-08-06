/**
 * LLM7 native provider — the createProvider object form.
 *
 * Builds a pi-ai `Provider` object that pi-free registers via
 * `pi.registerProvider(provider)` (the >=0.81 single-argument overload). Pi then
 * owns credential resolution, background model refresh (4h throttle, abortable),
 * and offline initialization:
 *
 *   - native `auth` (apiKey only — LLM7 has no OAuth flow) persisted to
 *     ~/.pi/agent/auth.json; always resolves so the keyless public catalog
 *     stays visible (see llm7-auth.ts)
 *   - sync `getModels()` returning the complete catalog; Pi applies `filterModels`
 *   - `refreshModels(context)`:
 *       allowNetwork:false → restore from context.store only (fast offline init)
 *       allowNetwork:true  → build the STATIC selector catalog locally (no
 *                            network I/O, no credential needed), persist via
 *                            context.store.write, honor context.signal
 *
 * LLM7 differs from Kilo/Cline in that its "catalog" is three static routing
 * selectors (default/fast/pro), so the online refresh path is purely local —
 * the poisoning guard and store contract are kept identical to the reference
 * ports anyway, so a future fetched catalog drops in without reshaping this.
 *
 * The object is assembled directly against the public `Provider` interface (the
 * exact shape `createProvider()` returns) rather than through the `createProvider`
 * helper: that helper unconditionally merges its stored dynamic overlay on top of
 * the static baseline on every refresh. The complete catalog stays in
 * `getModels()` and the shared `filterModels` policy selects the current view
 * while still using the native store and auth.
 *
 * Pi owns refresh throttling and the `force` flag (`pi update --models`); this
 * module performs no freshness gating of its own so the two never double-throttle.
 */

import {
	openAICompletionsApi,
	type Api,
	type Model,
	type Provider,
	type RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { getLlm7ShowPaid } from "../../config.ts";
import { BASE_URL_LLM7, PROVIDER_LLM7 } from "../../constants.ts";
import { isFreeModel } from "../../lib/registry.ts";
import {
	filterNativeModels,
	persistNativeProviderModels,
	restoreNativeProviderModels,
} from "../../lib/native-provider.ts";
import { enhanceWithCI, type StoredModels } from "../../provider-helper.ts";
import { llm7Auth } from "./llm7-auth.ts";
import { fetchLlm7Catalog, toLlm7Models } from "./llm7-models.ts";

type Llm7Model = Model<"openai-completions">;

/** Handle returned to the extension factory for toggle wiring. */
export interface Llm7NativeProvider {
	/** The native provider object to register via registerProvider(provider). */
	provider: Provider<"openai-completions">;
	/** Mutable catalogs shared with registerWithGlobalToggle / /free-providers. */
	stored: StoredModels;
	/** Ingest a fresh catalog into the complete native catalog. */
	ingest: (all: ProviderModelConfig[], free: ProviderModelConfig[]) => void;
}

/**
 * Build the LLM7 native provider. All mutable catalog state lives in the
 * returned closure so the extension factory can wire toggles against a single
 * source of truth.
 */
export function createLlm7Provider(): Llm7NativeProvider {
	const streams = openAICompletionsApi();

	// Display-ready catalogs (CI-enhanced + converted to Model). Typed as
	// StoredModels (ProviderModelConfig[]) for registerWithGlobalToggle; the
	// runtime values are full Model objects, which are assignable.
	const stored: StoredModels = { free: [], all: [] };

	function prepare(
		all: ProviderModelConfig[],
		free: ProviderModelConfig[],
	): { all: Llm7Model[]; free: Llm7Model[] } {
		return {
			all: toLlm7Models(enhanceWithCI(all)),
			free: toLlm7Models(enhanceWithCI(free)),
		};
	}

	function ingest(
		all: ProviderModelConfig[],
		free: ProviderModelConfig[],
	): void {
		const next = prepare(all, free);
		stored.all = next.all;
		stored.free = next.free;
	}

	async function refreshModels(context: RefreshModelsContext): Promise<void> {
		await restoreNativeProviderModels(
			PROVIDER_LLM7,
			context,
			(storedModels: Llm7Model[]) => {
				stored.all = storedModels;
				stored.free = storedModels.filter((model) =>
					isFreeModel({ ...model, provider: PROVIDER_LLM7 }, storedModels),
				);
			},
		);

		// Offline init stops here: serve the store only.
		if (!context.allowNetwork || context.signal?.aborted) return;

		// Online: build the static selector catalog. This is purely local (no
		// fetch, no credential) — LLM7's selectors never change.
		const { all, free } = fetchLlm7Catalog();
		if (context.signal?.aborted) return;

		// Retain the previous list on a degenerate result (poisoning guard —
		// e.g. every selector hidden via hidden_models config).
		if (all.length === 0) return;

		const next = prepare(all, free);
		await persistNativeProviderModels(
			PROVIDER_LLM7,
			context,
			// next.all holds full Model objects at runtime (toLlm7Models output);
			// the StoredModels type widens them to ProviderModelConfig for the toggle.
			next.all as unknown as readonly Model<Api>[],
			() => {
				stored.all = next.all;
				stored.free = next.free;
			},
		);
	}

	const provider: Provider<"openai-completions"> = {
		id: PROVIDER_LLM7,
		name: "LLM7",
		baseUrl: BASE_URL_LLM7,
		headers: {
			"User-Agent": "pi-free-providers",
		},
		auth: llm7Auth,
		getModels: () =>
			(stored.all.length > 0 ? stored.all : stored.free) as Llm7Model[],
		filterModels: (models) =>
			filterNativeModels(PROVIDER_LLM7, models, {
				showPaid: getLlm7ShowPaid(),
				freeModels: stored.free,
			}),
		refreshModels,
		stream: (model, context, options) =>
			streams.stream(model, context, options),
		streamSimple: (model, context, options) =>
			streams.streamSimple(model, context, options),
	};

	return { provider, stored, ingest };
}
