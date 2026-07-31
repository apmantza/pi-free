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

import {
	readStoredCredential,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
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
import { isOAuthCredential } from "../../provider-helper.ts";
import { createClineProvider, rotateClineTaskId } from "./cline-provider.ts";

const _logger = createLogger("cline");

// =============================================================================
// Credential inspection (non-destructive)
// =============================================================================

/**
 * Per-load credential inspection (the extension factory loads once per process,
 * so this runs once). Native auth reads the SAME ~/.pi/agent/auth.json that the
 * legacy `/login cline` flow already persisted to, so existing OAuth credentials
 * work with no destructive migration. This only logs status and flags malformed
 * old credentials (re-login is the recovery path); it never rewrites or deletes.
 * The inspection is a pure read + log, so it is idempotent by nature.
 */
function inspectStoredClineCredential(): void {
	try {
		const cred = readStoredCredential(PROVIDER_CLINE);
		if (!cred) {
			_logger.info(
				"No stored Cline credential; using ambient CLINE_API_KEY if configured",
			);
			return;
		}
		if (isOAuthCredential(cred)) {
			if (typeof cred.access === "string" && cred.access.length > 0) {
				_logger.info(
					"Reusing existing Cline OAuth credential from auth.json (no migration needed)",
				);
			} else {
				_logger.warn(
					"Stored Cline OAuth credential is malformed; run /login cline to re-authenticate",
				);
			}
			return;
		}
		if (cred.type === "api_key") {
			_logger.info("Found stored Cline API key credential in auth.json");
			return;
		}
		_logger.warn(
			"Unrecognized stored Cline credential shape; run /login cline if auth fails",
		);
	} catch (err) {
		_logger.warn("Failed to inspect stored Cline credential", {
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

// =============================================================================
// Extension entry point
// =============================================================================

export default async function clineProvider(pi: ExtensionAPI) {
	const { provider, stored } = createClineProvider();

	// Non-destructive credential inspection (native auth reuses auth.json).
	inspectStoredClineCredential();

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

	const hasClineKey = !!getClineApiKey();
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
	pi.on("before_agent_start", (_event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_CLINE) return;
		rotateClineTaskId();
	});

	registerNativeProviderRefresh(pi, PROVIDER_CLINE);
}
