/**
 * Kilo native provider — the createProvider object form.
 *
 * Builds a pi-ai `Provider` object that pi-free registers via
 * `pi.registerProvider(provider)` (the >=0.81 single-argument overload). Pi then
 * owns credential refresh, background model refresh (4h throttle, abortable), and
 * offline initialization:
 *
 *   - native `auth` (apiKey + oauth) persisted to ~/.pi/agent/auth.json
 *   - sync `getModels()` returning the catalog pi-free chose to show
 *   - `refreshModels(context)`:
 *       allowNetwork:false → restore from context.store only (fast offline init)
 *       allowNetwork:true  → fetch with context.credential, persist via
 *                            context.store.write, honor context.signal
 *
 * The object is assembled directly against the public `Provider` interface (the
 * exact shape `createProvider()` returns) rather than through the `createProvider`
 * helper: that helper unconditionally merges its stored dynamic overlay on top of
 * the static baseline on every refresh, which would clobber pi-free's
 * re-registration based free/paid toggle (the stored full catalog would always win
 * over a free-only baseline). Assembling directly keeps `getModels()` returning
 * precisely the view pi-free selected while still using the native store and auth.
 *
 * Pi owns refresh throttling and the `force` flag (`pi update --models`); this
 * module performs no freshness gating of its own so the two never double-throttle.
 */

import type {
	Api,
	Credential,
	Model,
	Provider,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import {
	getKiloApiKey,
	getKiloFreeOnly,
	getKiloShowPaid,
} from "../../config.ts";
import { PROVIDER_KILO } from "../../constants.ts";
import { getGlobalFreeOnly, isFreeModel } from "../../lib/registry.ts";
import {
	persistNativeProviderModels,
	restoreNativeProviderModels,
} from "../../lib/native-provider.ts";
import { enhanceWithCI, type StoredModels } from "../../provider-helper.ts";
import { kiloAuth } from "./kilo-auth.ts";
import {
	applyKiloCompat,
	fetchKiloCatalog,
	KILO_GATEWAY_BASE,
	toKiloModels,
} from "./kilo-models.ts";

type KiloModel = Model<"openai-completions">;

/** Handle returned to the extension factory for toggle/login wiring. */
export interface KiloNativeProvider {
	/** The native provider object to register via registerProvider(provider). */
	provider: Provider<"openai-completions">;
	/** Mutable catalogs shared with registerWithGlobalToggle / /free-providers. */
	stored: StoredModels;
	/** Set the visible catalog (toggle / global-toggle re-registration target). */
	setView: (models: ProviderModelConfig[]) => void;
	/** Ingest a freshly fetched catalog: update stored + view, per toggle state. */
	ingest: (all: ProviderModelConfig[], free: ProviderModelConfig[]) => void;
}

/** Resolve the bearer token from the effective credential Pi passes us. */
function credentialToken(credential?: Credential): string | undefined {
	if (!credential) return getKiloApiKey();
	if (credential.type === "oauth") return credential.access;
	if (credential.type === "api_key") return credential.key ?? getKiloApiKey();
	return getKiloApiKey();
}

/**
 * Build the Kilo native provider. All mutable catalog state lives in the returned
 * closure so the extension factory can wire toggles against a single source of
 * truth.
 */
export function createKiloProvider(): KiloNativeProvider {
	const streams = openAICompletionsApi();

	// Display-ready catalogs (CI-enhanced + compat-shaped + converted to Model).
	// Typed as StoredModels (ProviderModelConfig[]) for registerWithGlobalToggle;
	// the runtime values are full Model objects, which are assignable.
	const stored: StoredModels = { free: [], all: [] };
	let currentView: KiloModel[] = [];

	/**
	 * Which catalog the current toggle state wants to show. Mirrors
	 * applyGlobalFilter's decision so the offline-init initial view matches what
	 * the global free/paid toggle would select.
	 */
	function decideView(): ProviderModelConfig[] {
		if (getKiloFreeOnly()) return stored.free;
		// Global free-only off → show everything.
		if (!getGlobalFreeOnly()) {
			return stored.all.length > 0 ? stored.all : stored.free;
		}
		// Global free-only on → free, unless per-provider show_paid is persisted.
		const showPaid = getKiloShowPaid();
		return showPaid && stored.all.length > 0 ? stored.all : stored.free;
	}

	function setView(models: ProviderModelConfig[]): void {
		currentView = toKiloModels(models);
	}

	function ingest(
		all: ProviderModelConfig[],
		free: ProviderModelConfig[],
	): void {
		stored.all = toKiloModels(enhanceWithCI(applyKiloCompat(all)));
		stored.free = toKiloModels(enhanceWithCI(applyKiloCompat(free)));
		setView(decideView());
	}

	async function refreshModels(context: RefreshModelsContext): Promise<void> {
		await restoreNativeProviderModels(
			PROVIDER_KILO,
			context,
			(storedModels: KiloModel[]) => {
				stored.all = storedModels;
				stored.free = storedModels.filter((model) =>
					isFreeModel({ ...model, provider: PROVIDER_KILO }, storedModels),
				);
				setView(decideView());
			},
		);

		// Offline init stops here: serve the store only.
		if (!context.allowNetwork || context.signal?.aborted) return;

		// Online: fetch a fresh catalog with the resolved+refreshed credential.
		const { all, free } = await fetchKiloCatalog({
			token: credentialToken(context.credential),
			signal: context.signal,
		});
		if (context.signal?.aborted) return;

		// Retain the previous list on a degenerate/failed fetch (poisoning guard).
		if (all.length === 0) return;

		ingest(all, free);

		await persistNativeProviderModels(
			PROVIDER_KILO,
			context,
			// stored.all holds full Model objects at runtime (toKiloModels output);
			// the StoredModels type widens them to ProviderModelConfig for the toggle.
			stored.all as unknown as readonly Model<Api>[],
		);
	}

	const provider: Provider<"openai-completions"> = {
		id: PROVIDER_KILO,
		name: "Kilo",
		baseUrl: KILO_GATEWAY_BASE,
		headers: {
			"X-KILOCODE-EDITORNAME": "Pi",
			"User-Agent": "pi-free-providers",
		},
		auth: kiloAuth,
		getModels: () => currentView,
		refreshModels,
		stream: (model, context, options) =>
			streams.stream(model, context, options),
		streamSimple: (model, context, options) =>
			streams.streamSimple(model, context, options),
	};

	return { provider, stored, setView, ingest };
}
