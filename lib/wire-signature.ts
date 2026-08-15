/**
 * Wire-signature logging (M3, #437).
 *
 * Records the request contract pi-free hands pi-ai at agent start:
 * provider/model identity, the wire api, the base URL, and the NAMES of the
 * headers attached to the request.
 *
 * REDACTION RULE (durable convention): log header NAMES only — never values.
 * Cline's identity record carries `X-Task-ID`, and models can carry any
 * header a provider stamps, but an Authorization/apiKey/token VALUE in this
 * line would leak credentials into the shared ~/.pi/free.log (a plain-text
 * diagnostic file). If you extend this logger, never add a header value,
 * cookie, token, or any derived secret — names and shapes only.
 *
 * Debug-only: normal runs must not spam the log.
 */

import { createLogger } from "./logger.ts";

const _logger = createLogger("wire-signature");

/** The slice of a pi-ai Model this logger consumes. */
export interface WireSignatureModel {
	id: string;
	provider: string;
	api?: string;
	baseUrl?: string;
	headers?: Record<string, string>;
}

/** Look up the registered Provider for a provider id (for provider.headers). */
export type WireSignatureProviderLookup = (
	providerId: string,
) => { headers?: Record<string, string> } | undefined;

/**
 * Debug-log the request contract for the active model. Header NAMES only —
 * see the module-level redaction rule. Best-effort: never throws.
 */
export function logWireSignature(
	model: WireSignatureModel,
	getProvider?: WireSignatureProviderLookup,
): void {
	try {
		const providerHeaders = getProvider?.(model.provider)?.headers ?? {};
		const modelHeaders = model.headers ?? {};
		// Names only. Never log values — an Authorization/apiKey/token value in
		// this line would leak credentials into the shared free.log.
		const headerNames = Array.from(
			new Set([...Object.keys(providerHeaders), ...Object.keys(modelHeaders)]),
		);
		_logger.debug("agent request contract", {
			provider: model.provider,
			model: model.id,
			api: model.api,
			baseUrl: model.baseUrl,
			headerNames,
		});
	} catch {
		// Observability is best-effort — never break the agent flow.
	}
}
