/**
 * Filter-only free view over Pi's BUILT-IN `openrouter` provider.
 *
 * The one exception to the Standing Invariant "never override a provider
 * native to Pi" (agents.md). Pi has no extension API to hide another
 * provider's models, so under the free view pi-free registers an overlay
 * holding ONLY `models`: a snapshot of Pi's own resolved OpenRouter catalog
 * entries, taken at session start or toggle, with the paid chat models
 * removed. Each entry keeps the fields Pi resolved for it (per-model
 * `baseUrl`, `api`, `headers`, `compat`, cost, limits); pi-free adds nothing
 * of its own. Pi composes the overlay over its built-in provider, so auth
 * (stored credential, OAuth, `OPENROUTER_API_KEY`), streams and Pi's own
 * catalog refresh stay Pi's. No fetch, no apiKey (defect shape 9), no
 * request wrapper, no refreshModels. Residual: being a snapshot, the
 * entries do not follow a later refresh of Pi's catalog (new or repriced
 * models, or a changed endpoint/header in Pi's data) until the next
 * session start or toggle.
 *
 * Under the "all" view there is no pi-free registration at all:
 * `unregisterProvider` hands the id back to Pi's untouched built-in.
 *
 * Lifecycle: session_start derives the overlay from Pi's catalog; every
 * session_shutdown removes it, because /reload (and an SDK session switch)
 * keeps Pi's ModelRuntime while loading a fresh copy of this module.
 *
 * Usage: /toggle-openrouter (and /toggle-free, which switches every view).
 */

import type { AnyModel, Api, Model } from "@earendil-works/pi-ai/compat";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { toggleModelViewOverride } from "../config.ts";
import { PROVIDER_OPENROUTER } from "../constants.ts";
import { recordAction } from "./action-log.ts";
import { createLogger, withRunId } from "./logger.ts";
import { type ModelView, resolveModelView } from "./registry.ts";
import { wrapSessionStartHandler } from "./session-start-metrics.ts";
import { isStaleContextError } from "./stale-ctx.ts";
import { isChatModel } from "./types.ts";

const _logger = createLogger("openrouter-free-view");

/** The slice of Pi's session ModelRegistry this module reads. */
export interface OpenRouterCatalogSource {
	getAll(): Model<Api>[];
	/** Pi >=1.x; older hosts list chat models only. */
	getModelsOfType?(type: "image" | "classifier", provider: string): unknown;
}

/**
 * Free on OpenRouter = zero prompt AND completion price AND published as
 * free (`:free` id, or "free" in the name, e.g. `openrouter/free`).
 * Zero cost alone is not enough: OpenRouter lists routers
 * (`openrouter/auto`, `openrouter/fusion`, …) at $0 that bill the model
 * they route to. Judged per model, never against the list it sits in, so a
 * free-only list cannot be re-judged into a different answer (the Route B
 * trap of `isFreeModel`).
 */
export function isOpenRouterFreeModel(model: {
	id: string;
	name: string;
	cost: { input: number; output: number };
}): boolean {
	return (
		model.cost.input === 0 &&
		model.cost.output === 0 &&
		(model.id.endsWith(":free") || model.name.toLowerCase().includes("free"))
	);
}

/** Whether THIS module instance holds the overlay in the live ModelRuntime. */
let overlayActive = false;

/**
 * Bring Pi's `openrouter` provider in line with the effective view.
 * Idempotent; never touches the network. Returns the visible chat count.
 */
export function applyOpenRouterView(
	pi: ExtensionAPI,
	source: OpenRouterCatalogSource,
	view: ModelView = resolveModelView(PROVIDER_OPENROUTER),
): number {
	if (view === "all") {
		removeOverlay(pi);
		return countChat(source);
	}
	// While the overlay is live the source already reads filtered; the
	// per-model predicate makes re-filtering it a no-op, and the upsert
	// replaces the previous models. Under strict free-view rules an empty
	// result registers no models and hides the provider.
	const models = readPiCatalog(source).filter(
		(model) => !isChatModel(model) || isOpenRouterFreeModel(model),
	);
	pi.registerProvider(PROVIDER_OPENROUTER, {
		models: models as unknown as ProviderModelConfig[],
	});
	overlayActive = true;
	return countChat(source);
}

function removeOverlay(pi: ExtensionAPI): void {
	if (!overlayActive) return;
	pi.unregisterProvider(PROVIDER_OPENROUTER);
	overlayActive = false;
}

/** Pi's complete OpenRouter catalog: chat plus image/classifier models. */
function readPiCatalog(source: OpenRouterCatalogSource): AnyModel[] {
	const chat = source
		.getAll()
		.filter((model) => model.provider === PROVIDER_OPENROUTER);
	const other = (["image", "classifier"] as const).flatMap(
		(type) =>
			(source.getModelsOfType?.(type, PROVIDER_OPENROUTER) ?? []) as AnyModel[],
	);
	return [...chat, ...other];
}

function countChat(source: OpenRouterCatalogSource): number {
	return source
		.getAll()
		.filter((model) => model.provider === PROVIDER_OPENROUTER).length;
}

/** Register `/toggle-openrouter` and the session lifecycle hooks. */
export function setupOpenRouterFreeView(pi: ExtensionAPI): void {
	pi.on(
		"session_start",
		wrapSessionStartHandler("openrouter-free-view", (_event, ctx) => {
			applyOpenRouterView(pi, ctx.modelRegistry);
		}),
	);
	// Every reason (quit, reload, new, resume, fork): the next session
	// re-derives from Pi's catalog, so nothing outlives its session.
	pi.on("session_shutdown", () => removeOverlay(pi));

	pi.registerCommand("toggle-openrouter", {
		description:
			"Toggle Pi's built-in OpenRouter between free models only and all",
		handler: async (_args, ctx) => {
			try {
				await withRunId(async () => {
					const next = await toggleModelViewOverride(PROVIDER_OPENROUTER);
					const visible = applyOpenRouterView(pi, ctx.modelRegistry, next);
					recordAction("toggle", `openrouter ${next} (${visible} models)`);
					ctx.ui.notify(
						next === "all"
							? `openrouter: showing all ${visible} models (Pi's native catalog)`
							: `openrouter: showing ${visible} free models`,
						"info",
					);
				});
			} catch (error) {
				// The command ctx may belong to a replaced session (#509).
				if (!isStaleContextError(error)) throw error;
				_logger.info("openrouter: session changed during toggle; ignoring", {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		},
	});
}
