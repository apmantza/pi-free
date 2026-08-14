/**
 * Kilo native provider — the createProvider object form.
 *
 * Builds a pi-ai `Provider` object that pi-free registers via
 * `pi.registerProvider(provider)` (the >=0.81 single-argument overload). Pi then
 * owns credential refresh, background model refresh (4h throttle, abortable), and
 * offline initialization:
 *
 *   - native `auth` (apiKey + oauth) persisted to ~/.pi/agent/auth.json
 *   - sync `getModels()` returning the complete catalog; Pi applies `filterModels`
 *   - `refreshModels(context)`:
 *       allowNetwork:false → restore from context.store only (fast offline init)
 *       allowNetwork:true  → fetch with context.credential, persist via
 *                            context.store.write, honor context.signal
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

import type {
	Api,
	Credential,
	Model,
	Provider,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import {
	getKiloApiKey,
	getKiloFreeOnly,
	getKiloShowPaid,
} from "../../config.ts";
import { PROVIDER_KILO } from "../../constants.ts";
import { isFreeModel } from "../../lib/registry.ts";
import {
	filterNativeModels,
	persistNativeProviderModels,
	restoreNativeProviderModels,
} from "../../lib/native-provider.ts";
import { lazyOpenAICompletionsApi } from "../../lib/lazy-compat.ts";
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
	/** Ingest a freshly fetched catalog into the complete native catalog. */
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
	const streams = lazyOpenAICompletionsApi();

	// Display-ready catalogs (CI-enhanced + compat-shaped + converted to Model).
	// Typed as StoredModels (ProviderModelConfig[]) for registerWithGlobalToggle;
	// the runtime values are full Model objects, which are assignable.
	const stored: StoredModels = { free: [], all: [] };

	function prepare(
		all: ProviderModelConfig[],
		free: ProviderModelConfig[],
	): { all: KiloModel[]; free: KiloModel[] } {
		return {
			all: toKiloModels(enhanceWithCI(applyKiloCompat(all))),
			free: toKiloModels(enhanceWithCI(applyKiloCompat(free))),
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
			PROVIDER_KILO,
			context,
			(storedModels: KiloModel[]) => {
				stored.all = storedModels;
				stored.free = storedModels.filter((model) =>
					isFreeModel({ ...model, provider: PROVIDER_KILO }, storedModels),
				);
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

		const next = prepare(all, free);
		await persistNativeProviderModels(
			PROVIDER_KILO,
			context,
			// next.all holds full Model objects at runtime (toKiloModels output);
			// the StoredModels type widens them to ProviderModelConfig for the toggle.
			next.all as unknown as readonly Model<Api>[],
			() => {
				stored.all = next.all;
				stored.free = next.free;
			},
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
		getModels: () =>
			(stored.all.length > 0 ? stored.all : stored.free) as KiloModel[],
		filterModels: (models) =>
			filterNativeModels(PROVIDER_KILO, models, {
				showPaid: getKiloShowPaid(),
				freeModels: stored.free,
				forceFree: getKiloFreeOnly(),
			}),
		refreshModels,
		stream: (model, context, options) => streams.stream(model, context, options),
		streamSimple: (model, context, options) =>
			streams.streamSimple(model, context, options),
	};

	return { provider, stored, ingest };
}
