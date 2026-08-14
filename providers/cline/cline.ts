/**
 * Cline Provider Extension
 *
 * Provides access to Cline's models via their gateway, with the message flow
 * reshaped for the Cline API by the XML bridge (`cline-xml-bridge.ts`).
 * Registered as a native pi-ai `Provider` (createProvider object form) so Pi
 * owns credential refresh, background model refresh, and offline initialization:
 *
 *   - The factory is synchronous and network-free — it builds the provider
 *     object and registers it. Models load via `refreshModels` (offline init
 *     from the native models store, then a background fetch of Cline's PUBLIC
 *     catalog), so Cline no longer owns any of Pi's startup critical path and
 *     models still appear before `/login cline` (browsing needs no account).
 *   - Native `auth` (API key + OAuth callback-server flow) persisted to
 *     ~/.pi/agent/auth.json — the same store the legacy `/login cline` used.
 *   - Free/paid filtering stays on pi-free's re-registration toggle so it keeps
 *     composing with the global /toggle-free system.
 *
 * Run /login cline to authenticate and make API calls; /toggle-cline shows the
 * paid catalog.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	getClineApiKey,
	getClineShowPaid,
	PROVIDER_CLINE,
} from "../../config.ts";
import { createLogger } from "../../lib/logger.ts";
import { registerWithGlobalToggle } from "../../lib/registry.ts";
import {
	registerNativeProvider,
	registerNativeProviderRefresh,
	registerNativeProviderToggle,
} from "../../lib/native-provider.ts";
import {
	createClineProvider,
	registerClineXmlApiProvider,
	rotateClineTaskId,
} from "./cline-provider.ts";

const _logger = createLogger("cline");

// =============================================================================
// Extension entry point
// =============================================================================

export default async function clineProvider(pi: ExtensionAPI) {
	const { provider, stored } = createClineProvider();

	// Register the native provider. The factory performs NO network I/O: models
	// load via refreshModels (offline init from the store, then a background
	// fetch of the public catalog), so Cline no longer owns any of Pi's startup
	// critical path.
	registerNativeProvider(pi, provider);

	// Re-registration invalidates Pi's availability snapshot while preserving the
	// complete catalog and native auth on the same provider object.
	const reRegister = () => {
		registerNativeProvider(pi, provider);
	};

	const hasClineKey = Boolean(getClineApiKey());
	registerWithGlobalToggle(PROVIDER_CLINE, stored, reRegister, hasClineKey, {
		native: true,
		invalidate: reRegister,
	});

	registerNativeProviderToggle(pi, {
		providerId: PROVIDER_CLINE,
		stored,
		getShowPaid: getClineShowPaid,
		reRegister,
	});

	// Rotate the Cline task id when a Cline agent starts (mirrors the legacy
	// behavior). The XML bridge builds its request headers per request, so the
	// new X-Task-ID takes effect immediately — no re-registration needed.
	//
	// Also register the legacy compat-API fallback here (single-flight, lazy):
	// compat is heavy and must not load at extension boot, but it has to be in
	// place before any request can dispatch through the legacy path, and every
	// such request is preceded by a Cline agent start.
	pi.on("before_agent_start", async (_event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_CLINE) return;
		rotateClineTaskId();
		try {
			await registerClineXmlApiProvider();
		} catch (error) {
			_logger.warn("Failed to register Cline XML legacy API fallback", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	});

	registerNativeProviderRefresh(pi, PROVIDER_CLINE);
}
