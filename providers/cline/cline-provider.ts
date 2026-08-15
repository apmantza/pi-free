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
 * rotating `X-Task-ID`) are exposed as a single SHARED mutable record on
 * `provider.headers`; Pi merges provider headers into the request auth on
 * every call (`Models.getAuth`), so `rotateClineTaskId()` keeps working by
 * mutating that same object — no re-registration needed.
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
import {
	BASE_URL_CLINE,
	CLINE_EXTENSION_VERSION,
	PROVIDER_CLINE,
	VS_CODE_VERSION,
} from "../../constants.ts";
import { isFreeModel } from "../../lib/registry.ts";
import {
	filterNativeModels,
	persistNativeProviderModels,
	restoreNativeProviderModels,
} from "../../lib/native-provider.ts";
import { lazyOpenAICompletionsApi } from "../../lib/lazy-compat.ts";
import { enhanceWithCI, type StoredModels } from "../../provider-helper.ts";
import { clineAuth } from "./cline-auth.ts";
import { fetchClineCatalog, toClineModels } from "./cline-models.ts";

type ClineModel = Model<"openai-completions">;

/** Api Cline models used before the OpenAI-compatible migration (#433). */
export const LEGACY_CLINE_API = "cline-xml-tools";

// =============================================================================
// Cline API headers (must match real Cline VS Code extension exactly)
// =============================================================================

function generateUlid(): string {
	const CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
	const now = Date.now();
	let ts = "";
	let t = now;
	for (let i = 0; i < 10; i++) {
		ts = CHARS[t % 32] + ts;
		t = Math.floor(t / 32);
	}
	const rand = new Uint8Array(16);
	crypto.getRandomValues(rand);
	let r = "";
	for (let i = 0; i < 16; i++) r += CHARS[rand[i] % 32];
	return ts + r;
}

function createClineHeadersRecord(): Record<string, string> {
	return {
		"HTTP-Referer": "https://cline.bot",
		"X-Title": "Cline",
		"X-Task-ID": generateUlid(),
		"X-PLATFORM": "Visual Studio Code",
		"X-PLATFORM-VERSION": VS_CODE_VERSION,
		"X-CLIENT-TYPE": "VSCode Extension",
		"X-CLIENT-VERSION": CLINE_EXTENSION_VERSION,
		"X-CORE-VERSION": CLINE_EXTENSION_VERSION,
		"X-Is-Multiroot": "false",
		// Cline's gateway treats a missing/foreign User-Agent as a non-Cline
		// client and gates product-only models (403 "only available via Cline
		// product surfaces").
		"User-Agent": `Cline/${CLINE_EXTENSION_VERSION}`,
	};
}

/**
 * The single shared mutable Cline headers record, exposed as `provider.headers`.
 * Pi merges provider headers into the request auth on every call, so mutating
 * this object (e.g. `rotateClineTaskId()`) takes effect on the next request.
 */
const clineProviderHeaders: Record<string, string> = createClineHeadersRecord();

/**
 * Rotate the Cline task id on the shared headers record. The extension factory
 * calls this on `before_agent_start` (when a Cline model is active), mirroring
 * the legacy behavior. The mutated record IS `provider.headers`, so the new id
 * takes effect on the next request with no re-registration.
 */
export function rotateClineTaskId(): void {
	clineProviderHeaders["X-Task-ID"] = generateUlid();
}

/**
 * Access the live Cline request headers record (the exact object exposed as
 * `provider.headers`). Returns the shared record, not a copy: mutations are
 * picked up by the next request.
 */
export function buildClineHeaders(): Record<string, string> {
	return clineProviderHeaders;
}

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
		if (api !== LEGACY_CLINE_API) return model as unknown as ClineModel;
		return {
			...model,
			api: "openai-completions",
			baseUrl: BASE_URL_CLINE,
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
		await restoreNativeProviderModels(
			PROVIDER_CLINE,
			context,
			// Covers BOTH the Pi 0.84+ `context.stored` snapshot and the legacy
			// `context.store` read path (restoreNativeProviderModels branches
			// internally): rewrite retired `cline-xml-tools` entries in either.
			(storedModels: ClineModel[]) => {
				const normalized = normalizeStoredClineModels(storedModels);
				stored.all = normalized;
				stored.free = normalized.filter((model) =>
					isFreeModel({ ...model, provider: PROVIDER_CLINE }, normalized),
				);
			},
		);

		// Offline init stops here: serve the store only.
		if (!context.allowNetwork || context.signal?.aborted) return;

		// Online: fetch the public catalog (no credential required).
		const { all, free } = await fetchClineCatalog({ signal: context.signal });
		if (context.signal?.aborted) return;

		// Retain the previous list on a degenerate/failed fetch (poisoning guard).
		if (all.length === 0) return;

		const next = prepare(all, free);
		await persistNativeProviderModels(
			PROVIDER_CLINE,
			context,
			// next.all holds full Model objects at runtime (toClineModels output);
			// the StoredModels type widens them to ProviderModelConfig for the toggle.
			next.all as unknown as readonly Model<Api>[],
			() => {
				stored.all = next.all;
				stored.free = next.free;
			},
		);
	}

	const provider: Provider<"openai-completions"> = {
		id: PROVIDER_CLINE,
		name: "Cline",
		baseUrl: BASE_URL_CLINE,
		// Shared mutable record: rotateClineTaskId() mutates it in place and Pi
		// merges provider headers into the request on every call.
		headers: clineProviderHeaders,
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
