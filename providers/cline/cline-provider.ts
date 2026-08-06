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
 * Cline differs from Kilo (the first native port) in two ways:
 *
 *   1. Wire api: Cline uses the custom `"cline-xml-tools"` api — both `stream`
 *      and `streamSimple` delegate to the XML bridge (`streamClineXml`), exactly
 *      as the legacy composer dispatched both entry points to the extension's
 *      streamSimple for the custom api. The bridge reshapes outgoing messages for
 *      the Cline API; that behavior is carried over verbatim.
 *   2. Public catalog: the model list needs no credential, so `refreshModels`
 *      fetches without `context.credential`. (Cline's auth resolves even when
 *      unconfigured — see cline-auth.ts — so Pi still drives refresh for
 *      logged-out users, preserving the legacy "models before /login" behavior.)
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
	AssistantMessageEventStream,
	Context,
	Model,
	Provider,
	RefreshModelsContext,
	StreamOptions,
} from "@earendil-works/pi-ai/compat";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { getClineShowPaid } from "../../config.ts";
import { BASE_URL_CLINE, PROVIDER_CLINE } from "../../constants.ts";
import { isFreeModel } from "../../lib/registry.ts";
import {
	filterNativeModels,
	persistNativeProviderModels,
	restoreNativeProviderModels,
} from "../../lib/native-provider.ts";
import { enhanceWithCI, type StoredModels } from "../../provider-helper.ts";
import { clineAuth } from "./cline-auth.ts";
import { fetchClineCatalog, toClineModels } from "./cline-models.ts";
import { streamClineXml } from "./cline-xml-bridge.ts";

type ClineModel = Model<"cline-xml-tools">;

// =============================================================================
// Cline API headers (must match real Cline VS Code extension exactly)
// =============================================================================

const VS_CODE_VERSION = "1.109.3";
const CLINE_EXTENSION_VERSION = "3.76.0";

let _currentTaskId = generateUlid();

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

/**
 * Start a fresh Cline task id. The extension factory calls this on
 * `before_agent_start` (when a Cline model is active), mirroring the legacy
 * behavior. Headers are built per request (below), so the new id takes effect
 * on the next request with no re-registration.
 */
export function rotateClineTaskId(): void {
	_currentTaskId = generateUlid();
}

/** Build the VS Code-spoofing request headers for the current task. */
export function buildClineHeaders(): Record<string, string> {
	return {
		"HTTP-Referer": "https://cline.bot",
		"X-Title": "Cline",
		"X-Task-ID": _currentTaskId,
		"X-PLATFORM": "Visual Studio Code",
		"X-PLATFORM-VERSION": VS_CODE_VERSION,
		"X-CLIENT-TYPE": "VSCode Extension",
		"X-CLIENT-VERSION": CLINE_EXTENSION_VERSION,
		"X-CORE-VERSION": CLINE_EXTENSION_VERSION,
		"X-Is-Multiroot": "false",
	};
}

/**
 * Register the Cline wire API for Pi's legacy/default agent stream path.
 *
 * Native ModelRuntime requests call the Provider object directly, but older
 * Pi agent sessions still dispatch through pi-ai/compat's global API registry.
 * Cline's custom API is not built into pi-ai, so without this fallback those
 * sessions fail before the XML bridge can handle the request.
 */
export async function registerClineXmlApiProvider(): Promise<void> {
	const { registerApiProvider } = await import(
		"@earendil-works/pi-ai/compat"
	);
	const stream = (
		model: Model<"cline-xml-tools">,
		context: Context,
		options?: StreamOptions,
	) =>
		streamClineXml(
			model,
			context,
			options,
			buildClineHeaders(),
		) as unknown as AssistantMessageEventStream;

	registerApiProvider(
		{
			api: "cline-xml-tools",
			stream,
			streamSimple: stream,
		},
		"pi-free-cline",
	);
}

// =============================================================================
// Native provider
// =============================================================================

/** Handle returned to the extension factory for toggle/login wiring. */
export interface ClineNativeProvider {
	/** The native provider object to register via registerProvider(provider). */
	provider: Provider<"cline-xml-tools">;
	/** Mutable catalogs shared with registerWithGlobalToggle / /free-providers. */
	stored: StoredModels;
	/** Ingest a freshly fetched catalog into the complete native catalog. */
	ingest: (all: ProviderModelConfig[], free: ProviderModelConfig[]) => void;
}

/**
 * Build the Cline native provider. All mutable catalog state lives in the
 * returned closure so the extension factory can wire toggles against a single
 * source of truth.
 */
export function createClineProvider(): ClineNativeProvider {
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
			(storedModels: ClineModel[]) => {
				stored.all = storedModels;
				stored.free = storedModels.filter((model) =>
					isFreeModel({ ...model, provider: PROVIDER_CLINE }, storedModels),
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

	// Both entry points dispatch to the XML bridge, exactly as the legacy
	// composer routed stream AND streamSimple to the extension's streamSimple
	// for the custom "cline-xml-tools" api. Headers are built per request so a
	// rotated task id (before_agent_start) applies without re-registration.
	const streamViaXmlBridge = (
		model: ClineModel,
		context: Parameters<typeof streamClineXml>[1],
		options: Parameters<typeof streamClineXml>[2],
	): AssistantMessageEventStream =>
		streamClineXml(
			model,
			context,
			options,
			buildClineHeaders(),
		) as unknown as AssistantMessageEventStream;

	const provider: Provider<"cline-xml-tools"> = {
		id: PROVIDER_CLINE,
		name: "Cline",
		baseUrl: BASE_URL_CLINE,
		auth: clineAuth,
		getModels: () =>
			(stored.all.length > 0 ? stored.all : stored.free) as ClineModel[],
		filterModels: (models) =>
			filterNativeModels(PROVIDER_CLINE, models, {
				showPaid: getClineShowPaid(),
				freeModels: stored.free,
			}),
		refreshModels,
		stream: (model, context, options) =>
			streamViaXmlBridge(model, context, options),
		streamSimple: (model, context, options) =>
			streamViaXmlBridge(model, context, options),
	};

	return { provider, stored, ingest };
}
