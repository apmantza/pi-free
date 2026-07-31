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
 *   - sync `getModels()` returning the catalog pi-free chose to show
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
 * the static baseline on every refresh, which would clobber pi-free's
 * re-registration based free/paid toggle. Assembling directly keeps `getModels()`
 * returning precisely the view pi-free selected while still using the native
 * store and auth.
 *
 * Pi owns refresh throttling and the `force` flag (`pi update --models`); this
 * module performs no freshness gating of its own so the two never double-throttle.
 */

import type {
	Api,
	Model,
	Provider,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { getLlm7ShowPaid } from "../../config.ts";
import { BASE_URL_LLM7, PROVIDER_LLM7 } from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { getGlobalFreeOnly, isFreeModel } from "../../lib/registry.ts";
import { persistNativeProviderModels } from "../../lib/native-provider.ts";
import { enhanceWithCI, type StoredModels } from "../../provider-helper.ts";
import { llm7Auth } from "./llm7-auth.ts";
import { fetchLlm7Catalog, toLlm7Models } from "./llm7-models.ts";

const _logger = createLogger("llm7");

type Llm7Model = Model<"openai-completions">;

/** Handle returned to the extension factory for toggle wiring. */
export interface Llm7NativeProvider {
	/** The native provider object to register via registerProvider(provider). */
	provider: Provider<"openai-completions">;
	/** Mutable catalogs shared with registerWithGlobalToggle / /free-providers. */
	stored: StoredModels;
	/** Set the visible catalog (toggle / global-toggle re-registration target). */
	setView: (models: ProviderModelConfig[]) => void;
	/** Ingest a fresh catalog: update stored + view, per toggle state. */
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
	let currentView: Llm7Model[] = [];

	/**
	 * Which catalog the current toggle state wants to show. Mirrors
	 * applyGlobalFilter's decision so the offline-init initial view matches what
	 * the global free/paid toggle would select. LLM7 has no per-provider
	 * free-only override — only the persisted show_paid flag.
	 */
	function decideView(): ProviderModelConfig[] {
		// Global free-only off → show everything.
		if (!getGlobalFreeOnly()) {
			return stored.all.length > 0 ? stored.all : stored.free;
		}
		// Global free-only on → free, unless per-provider show_paid is persisted.
		const showPaid = getLlm7ShowPaid();
		return showPaid && stored.all.length > 0 ? stored.all : stored.free;
	}

	function setView(models: ProviderModelConfig[]): void {
		currentView = toLlm7Models(models);
	}

	function ingest(
		all: ProviderModelConfig[],
		free: ProviderModelConfig[],
	): void {
		stored.all = toLlm7Models(enhanceWithCI(all));
		stored.free = toLlm7Models(enhanceWithCI(free));
		setView(decideView());
	}

	async function refreshModels(context: RefreshModelsContext): Promise<void> {
		// Offline init / cache restore: always read the store first so a warm
		// startup shows models with zero network.
		try {
			const entry = await context.store.read();
			const storedModels = (entry?.models ?? []).filter(
				(m) => m.provider === PROVIDER_LLM7,
			) as Llm7Model[];
			if (storedModels.length > 0) {
				stored.all = storedModels;
				stored.free = storedModels.filter((m) =>
					isFreeModel({ ...m, provider: PROVIDER_LLM7 }, storedModels),
				);
				setView(decideView());
			}
		} catch (err) {
			_logger.warn("Failed to read models store; continuing empty", {
				error: err instanceof Error ? err.message : String(err),
			});
		}

		// Offline init stops here: serve the store only.
		if (!context.allowNetwork || context.signal?.aborted) return;

		// Online: build the static selector catalog. This is purely local (no
		// fetch, no credential) — LLM7's selectors never change.
		const { all, free } = fetchLlm7Catalog();
		if (context.signal?.aborted) return;

		// Retain the previous list on a degenerate result (poisoning guard —
		// e.g. every selector hidden via hidden_models config).
		if (all.length === 0) return;

		ingest(all, free);

		await persistNativeProviderModels(
			PROVIDER_LLM7,
			context,
			// stored.all holds full Model objects at runtime (toLlm7Models output);
			// the StoredModels type widens them to ProviderModelConfig for the toggle.
			stored.all as unknown as readonly Model<Api>[],
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
		getModels: () => currentView,
		refreshModels,
		stream: (model, context, options) =>
			streams.stream(model, context, options),
		streamSimple: (model, context, options) =>
			streams.streamSimple(model, context, options),
	};

	return { provider, stored, setView, ingest };
}
