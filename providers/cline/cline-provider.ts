/**
 * Cline native provider — the createProvider object form.
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
 *       allowNetwork:true  → fetch the PUBLIC catalog (no credential needed),
 *                            persist via context.store.write, honor context.signal
 *
 * Wire api: Cline's endpoint (https://api.cline.bot/api/v1/chat/completions)
 * speaks vanilla OpenAI Chat Completions, so models use the standard
 * `"openai-completions"` api and both `stream`/`streamSimple` delegate to the
 * lazy compat bridge (`lazyOpenAICompletionsApi()`), like every other
 * OpenAI-compatible native provider. The Cline identity headers (including the
 * rotating `X-Task-ID`) live on a single shared mutable record (see
 * cline-headers.ts); pi-ai merges only the MODEL's `headers` into requests
 * (`Models.getAuth`), so the record is stamped on every Cline model — and
 * `rotateClineTaskId()` keeps working by mutating that same object, no
 * re-registration needed.
 *
 * Public catalog: the model list needs no credential, so `refreshModels`
 * fetches without `context.credential`. (Cline's auth resolves even when
 * unconfigured — see cline-auth.ts — so Pi still drives refresh for
 * logged-out users, preserving the legacy "models before /login" behavior.)
 *
 * Stored-store migration: users' model stores contain models with the retired
 * `cline-xml-tools` api until their next successful network refresh. Restore
 * normalizes those entries to `openai-completions` + the Cline baseUrl so the
 * first session after upgrade dispatches a real api.
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
	Model,
	Provider,
	RefreshModelsContext,
} from "@earendil-works/pi-ai/compat";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { getClineShowPaid } from "../../config.ts";
import { BASE_URL_CLINE, PROVIDER_CLINE } from "../../constants.ts";
import { createLogger } from "../../lib/logger.ts";
import { isFreeModel } from "../../lib/registry.ts";
import {
	filterNativeModels,
	refreshNativeProviderModels,
} from "../../lib/native-provider.ts";
import { lazyOpenAICompletionsApi } from "../../lib/lazy-compat.ts";
import { enhanceWithCI, type StoredModels } from "../../provider-helper.ts";
import { clineAuth } from "./cline-auth.ts";
import {
	buildClineHeaders,
	getClineProviderHeaders,
	rotateClineTaskId,
} from "./cline-headers.ts";
import { fetchClineCatalog, toClineModels } from "./cline-models.ts";

type ClineModel = Model<"openai-completions">;

const _logger = createLogger("cline-provider");

/** Api Cline models used before the OpenAI-compatible migration (#433). */
export const LEGACY_CLINE_API = "cline-xml-tools";

/** Mn2 (#437): warn once per process when legacy-api store entries are normalized. */
let _clineNormalizeWarned = false;

/** Test seam: reset the once-per-process normalize warning (mirrors the compat-loader seam). */
export function __resetClineNormalizeWarnForTests(): void {
	_clineNormalizeWarned = false;
}

// Cline identity headers now live in cline-headers.ts; this module re-exports
// the two public accessors so existing imports keep working.
export { buildClineHeaders, rotateClineTaskId };

// =============================================================================
// Native provider
// =============================================================================

/** Handle returned to the extension factory for toggle/login wiring. */
export interface ClineNativeProvider {
	/** The native provider object to register via registerProvider(provider). */
	provider: Provider<"openai-completions">;
	/** Mutable catalogs shared with registerWithGlobalToggle / /free-providers. */
	stored: StoredModels;
	/** Ingest a freshly fetched catalog into the complete native catalog. */
	ingest: (all: ProviderModelConfig[], free: ProviderModelConfig[]) => void;
}

/**
 * Normalize models restored from Pi's models store. Until the next successful
 * network refresh, users' stores still contain models with the retired
 * `cline-xml-tools` api; rewrite those to `openai-completions` + the Cline
 * baseUrl so the first session after upgrade dispatches a real api.
 */
export function normalizeStoredClineModels<T extends Model<Api>>(
	models: readonly T[],
): ClineModel[] {
	return models.map((model) => {
		const api = (model as { api?: string }).api;
		// SAFETY: the store widens full Model objects to ProviderModelConfig;
		// every other field passes through untouched, so restoring the native
		// Model shape is lossless apart from the two fields rewritten below.
		return {
			...model,
			api: api === LEGACY_CLINE_API ? "openai-completions" : api,
			baseUrl: BASE_URL_CLINE,
			// Re-point at the live shared record: a restored model's serialized
			// headers would be a stale snapshot, and rotation must keep working.
			headers: getClineProviderHeaders(),
		} as unknown as ClineModel;
	});
}

/**
 * Build the Cline native provider. All mutable catalog state lives in the returned
 * closure so the extension factory can wire toggles against a single source of
 * truth.
 */
export function createClineProvider(): ClineNativeProvider {
	const streams = lazyOpenAICompletionsApi();

	// Display-ready catalogs (CI-enhanced + converted to Model). Typed as
	// StoredModels (ProviderModelConfig[]) for registerWithGlobalToggle; the
	// runtime values are full Model objects, which are assignable.
	const stored: StoredModels = { free: [], all: [] };

	function prepare(
		all: ProviderModelConfig[],
		free: ProviderModelConfig[],
	): { all: ClineModel[]; free: ClineModel[] } {
		return {
			all: toClineModels(enhanceWithCI(all)),
			free: toClineModels(enhanceWithCI(free)),
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
		// Free split of the most recent fetch, kept beside the flat list the
		// shared helper passes through (see the fetch callback below).
		let fetchedFree: ClineModel[] = [];
		// Shared skeleton: restore → allowNetwork gate → abort checks → fetch →
		// empty-retain → persist, with the M1 counters recorded centrally.
		await refreshNativeProviderModels(
			PROVIDER_CLINE,
			context,
			// Covers BOTH the Pi 0.84+ `context.stored` snapshot and the legacy
			// `context.store` read path (restoreNativeProviderModels branches
			// internally): rewrite retired `cline-xml-tools` entries in either.
			(storedModels: ClineModel[]) => {
				// Mn2 (#437): the cline-xml-tools → openai-completions migration is
				// silent today; warn ONCE per process when any model was normalized
				// (the store keeps legacy entries until a network refresh rewrites
				// it, so per-restore warning would spam every session).
				if (!_clineNormalizeWarned) {
					const legacyCount = storedModels.filter(
						(model) => (model as { api?: string }).api === LEGACY_CLINE_API,
					).length;
					if (legacyCount > 0) {
						_clineNormalizeWarned = true;
						_logger.warn(
							`Restored ${legacyCount} Cline model(s) with retired ${LEGACY_CLINE_API} api; normalized to openai-completions`,
							{ count: legacyCount },
						);
					}
				}
				const normalized = normalizeStoredClineModels(storedModels);
				stored.all = normalized;
				stored.free = normalized.filter((model) =>
					isFreeModel({ ...model, provider: PROVIDER_CLINE }, normalized),
				);
			},
			async () => {
				// Online: fetch the public catalog (no credential required).
				const { all, free } = await fetchClineCatalog({
					signal: context.signal,
				});
				const next = prepare(all, free);
				fetchedFree = next.free;
				return next.all;
			},
			(next) => {
				stored.all = next;
				stored.free = fetchedFree;
			},
		);
	}

	const provider: Provider<"openai-completions"> = {
		id: PROVIDER_CLINE,
		name: "Cline",
		baseUrl: BASE_URL_CLINE,
		// Shared mutable record: rotateClineTaskId() mutates it in place; every
		// model carries the same object as its headers (see cline-headers.ts).
		headers: getClineProviderHeaders(),
		auth: clineAuth,
		getModels: () =>
			(stored.all.length > 0 ? stored.all : stored.free) as ClineModel[],
		filterModels: (models) =>
			filterNativeModels(PROVIDER_CLINE, models, {
				showPaid: getClineShowPaid(),
				freeModels: stored.free,
			}),
		refreshModels,
		stream: (model, context, options) => streams.stream(model, context, options),
		streamSimple: (model, context, options) =>
			streams.streamSimple(model, context, options),
	};

	return { provider, stored, ingest };
}
