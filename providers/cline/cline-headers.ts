/**
 * Cline request identity headers.
 *
 * Cline's gateway distinguishes real Cline clients from third-party callers
 * by the request headers (User-Agent, X-PLATFORM, X-CLIENT-VERSION, ...) and
 * 403s product-gated models (e.g. deepseek/deepseek-v4-flash: "only available
 * via Cline product surfaces") for clients it doesn't recognize.
 *
 * IMPORTANT (pi-ai 0.84): `provider.headers` is NOT merged into requests —
 * `Models.getAuth(model)` merges only the MODEL's `headers` field. So these
 * headers must be stamped on every Cline Model (see cline-models.ts
 * toClineModel / normalizeStoredClineModels), and the same shared mutable
 * record is exposed as `provider.headers` for symmetry/inspection.
 */
import {
	CLINE_EXTENSION_VERSION,
	VS_CODE_VERSION,
} from "../../constants.ts";

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
 * The single shared mutable Cline headers record. Stamped on every Cline
 * model (models carry it into requests via pi-ai's per-model header merge)
 * and exposed as `provider.headers` for inspection. Mutations (e.g.
 * `rotateClineTaskId()`) take effect on the next request — no re-registration
 * needed, because every model holds a reference to this same object.
 */
const clineProviderHeaders: Record<string, string> =
	createClineHeadersRecord();

/** Access the live shared Cline headers record. */
export function getClineProviderHeaders(): Record<string, string> {
	return clineProviderHeaders;
}

/** Alias kept for compatibility: the live shared record, not a copy. */
export function buildClineHeaders(): Record<string, string> {
	return clineProviderHeaders;
}

/**
 * Rotate the Cline task id on the shared headers record. Called on
 * `before_agent_start` when a Cline model is active. Because every Cline
 * model carries this same object as its `headers`, the new id reaches the
 * next request automatically.
 */
export function rotateClineTaskId(): void {
	clineProviderHeaders["X-Task-ID"] = generateUlid();
}
