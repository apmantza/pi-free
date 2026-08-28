/**
 * Live API test for the Kiro Web Portal auth flow (Phase F of the
 * kiro-web-portal-auth plan).
 *
 * Drives the real PKCE + InitiateLogin + ExchangeToken flow against
 * `app.kiro.dev` so the design contract can be verified end-to-end
 * before each release that touches the kiro auth flow.
 *
 * Per design doc Phase F: this test is NOT run in CI. It requires
 * user interaction (browser + paste of the redirect URL after the IdP
 * authenticates) and is run by hand before each release. It lives
 * in `scripts/` next to the other dev-only helpers (drive-pi-ai,
 * smoke-compiled, etc.).
 *
 * Usage:
 *   node scripts/test-kiro-desktop.mjs
 *   node scripts/test-kiro-desktop.mjs --idp Google
 *
 * Flags:
 *   --idp <idp>         IdP to authenticate against. One of
 *                       BuilderId (default), Google, Github, AWSIdC.
 *
 * The script:
 *   1. Generates a PKCE pair
 *   2. Calls InitiateLogin to get a redirect URL
 *   3. Prints the URL + instructions to the terminal
 *   4. Waits for the user to paste the full redirect URL
 *   5. Verifies the state parameter (CSRF protection)
 *   6. Calls ExchangeToken to get the Kiro auth token
 *   7. Inspects the response for profileArn / csrfToken / cookies
 *   8. Reports the credential shape and any missing fields
 *
 * On success, the script prints a report with:
 *   - The persisted KiroCredentials shape (without revealing the
 *     accessToken / refreshToken in plaintext)
 *   - Whether profileArn is present
 *   - The test exit code is 0 on success, 1 on failure
 *
 * Run from the project root with the user's real Kiro creds in
 * ~/.pi/agent/auth.json (any valid kiro creds work; the script
 * reads them to confirm the user is logged in but doesn't use
 * them for the new flow — this is a clean test of the web-portal
 * path).
 *
 * Per agents.md convention #17: never log access tokens or refresh
 * tokens. The script prints only the accessToken LENGTH, the last
 * 20 chars of the profileArn, and boolean presence flags for each
 * credential field.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { platform, homedir } from "node:os";

// =============================================================================
// PKCE helpers (RFC 7636)
// =============================================================================

function generateCodeVerifier() {
	return randomBytes(64).toString("base64url");
}

function computeCodeChallenge(verifier) {
	return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

function generatePkce() {
	const codeVerifier = generateCodeVerifier();
	return {
		codeVerifier,
		codeChallenge: computeCodeChallenge(codeVerifier),
		state: randomUUID(),
	};
}

// =============================================================================
// cbor-x replacement (this script runs in plain Node, no pi-free deps)
// =============================================================================
//
// The Kiro Web Portal speaks Smithy rpc-v2-cbor. We use the same
// RFC 8949 subset that kiro-web-portal-cbor.ts uses (text strings,
// unsigned ints, maps, byte strings). This is a minimal hand-rolled
// implementation — only the types we need for the test script.
//
// For real production code, kiro-web-portal-cbor.ts uses the
// `cbor-x` library (added in Phase B of #486 plan).

function cborEncode(value) {
	// Map
	if (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		!(value instanceof Uint8Array)
	) {
		const keys = Object.keys(value);
		const header = new Uint8Array([0xa0 | keys.length]);
		const parts = [header];
		for (const k of keys) {
			parts.push(cborEncode(k));
			parts.push(cborEncode(value[k]));
		}
		const total = parts.reduce((n, p) => n + p.length, 0);
		const out = new Uint8Array(total);
		let off = 0;
		for (const p of parts) {
			out.set(p, off);
			off += p.length;
		}
		return out;
	}
	// Byte string
	if (value instanceof Uint8Array) {
		const len = value.length;
		const out = new Uint8Array(1 + len);
		out[0] = len < 24 ? 0x40 | len : 0x58;
		out.set(value, 1);
		return out;
	}
	// Text string
	if (typeof value === "string") {
		const bytes = new TextEncoder().encode(value);
		const len = bytes.length;
		const out = new Uint8Array(1 + len);
		out[0] = len < 24 ? 0x60 | len : 0x78;
		out.set(bytes, 1);
		return out;
	}
	// Unsigned int
	if (Number.isInteger(value) && value >= 0) {
		if (value < 24) return new Uint8Array([value]);
		if (value < 256) return new Uint8Array([0x18, value]);
		if (value < 65536) {
			return new Uint8Array([0x19, value >> 8, value & 0xff]);
		}
		return new Uint8Array([
			0x1a,
			(value >>> 24) & 0xff,
			(value >>> 16) & 0xff,
			(value >>> 8) & 0xff,
			value & 0xff,
		]);
	}
	throw new Error(`cborEncode: unsupported type ${typeof value}`);
}

function cborDecode(buf) {
	let pos = 0;
	function readHeader() {
		const b = buf[pos++];
		const major = b >> 5;
		const minor = b & 0x1f;
		let len;
		if (minor < 24) {
			len = minor;
		} else if (minor === 24) {
			len = buf[pos++];
		} else if (minor === 25) {
			len = (buf[pos++] << 8) | buf[pos++];
		} else if (minor === 26) {
			len =
				((buf[pos++] << 24) |
					(buf[pos++] << 16) |
					(buf[pos++] << 8) |
					buf[pos++]) >>>
				0;
		} else {
			throw new Error(`cborDecode: unsupported length minor ${minor}`);
		}
		return { major, len };
	}
	function read() {
		const { major, len } = readHeader();
		if (major === 0) return len;
		if (major === 1) return -1 - len;
		if (major === 2) {
			const out = new Uint8Array(len);
			for (let i = 0; i < len; i++) out[i] = buf[pos++];
			return out;
		}
		if (major === 3) {
			const bytes = new Uint8Array(len);
			for (let i = 0; i < len; i++) bytes[i] = buf[pos++];
			return new TextDecoder().decode(bytes);
		}
		if (major === 5) {
			const obj = {};
			for (let i = 0; i < len; i++) {
				const k = read();
				const v = read();
				obj[k] = v;
			}
			return obj;
		}
		throw new Error(`cborDecode: unsupported major ${major}`);
	}
	return read();
}

// =============================================================================
// Kiro Web Portal client
// =============================================================================

const KIRO_WEB_PORTAL = "https://app.kiro.dev";
const KIRO_REDIRECT_URI = `${KIRO_WEB_PORTAL}/signin/oauth`;

async function callWebPortal(operation, body) {
	const url = `${KIRO_WEB_PORTAL}/service/KiroWebPortalService/operation/${operation}`;
	const cborBody = cborEncode(body);
	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/cbor",
			Accept: "application/cbor",
			"smithy-protocol": "rpc-v2-cbor",
		},
		body: cborBody,
	});
	const buf = new Uint8Array(await response.arrayBuffer());
	const setCookie = [];
	// Headers#getSetCookie is the spec-compliant accessor for the
	// multi-valued Set-Cookie header.
	if (typeof response.headers.getSetCookie === "function") {
		setCookie.push(...response.headers.getSetCookie());
	}
	return { status: response.status, ok: response.ok, body: buf, setCookie };
}

function parseSetCookie(headers) {
	const out = {
		refreshToken: undefined,
		sessionToken: undefined,
		accessToken: undefined,
		idp: undefined,
	};
	for (const raw of headers) {
		const first = raw.split(";")[0]?.trim() ?? "";
		const eq = first.indexOf("=");
		if (eq < 0) continue;
		const name = first.slice(0, eq).trim();
		const value = first.slice(eq + 1).trim();
		if (name === "RefreshToken") out.refreshToken = value;
		else if (name === "SessionToken") out.sessionToken = value;
		else if (name === "AccessToken") out.accessToken = value;
		else if (name === "Idp") out.idp = value;
	}
	return out;
}

// =============================================================================
// Test driver
// =============================================================================

function parseArgs(argv) {
	const args = { idp: "BuilderId" };
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--idp") args.idp = argv[++i];
		else throw new Error(`Unknown flag: ${a}`);
	}
	return args;
}

function checkExistingKiroCreds() {
	const authPath = join(homedir(), ".pi", "agent", "auth.json");
	if (!existsSync(authPath)) {
		console.log(
			`ℹ️  No existing kiro creds at ${authPath} (this is fine for a clean test)`,
		);
		return null;
	}
	const parsed = JSON.parse(readFileSync(authPath, "utf-8"));
	return parsed.kiro ?? null;
}

async function main() {
	const args = parseArgs(process.argv);
	console.log("🔬 Kiro Web Portal live API test");
	console.log(`   IdP: ${args.idp}`);
	console.log(`   Platform: ${platform()}`);
	console.log("");

	console.log("📋 Pre-flight: checking for existing kiro creds...");
	const existing = checkExistingKiroCreds();
	if (existing) {
		console.log(
			`   Found kiro entry in auth.json (authMethod: ${existing.authMethod ?? "idc"})`,
		);
		console.log(
			`   (The test will run a fresh Web Portal flow regardless — it does NOT reuse these creds)`,
		);
	} else {
		console.log("   No existing kiro creds — clean test");
	}
	console.log("");

	// Step 1: PKCE
	const pkce = generatePkce();
	console.log("🔑 Step 1/4: PKCE generated");
	console.log(`   state: ${pkce.state}`);
	console.log(`   code_challenge: ${pkce.codeChallenge}`);
	console.log("");

	// Step 2: InitiateLogin
	console.log("🌐 Step 2/4: calling InitiateLogin...");
	const initInput = {
		idp: args.idp,
		redirectUri: KIRO_REDIRECT_URI,
		codeChallenge: pkce.codeChallenge,
		codeChallengeMethod: "S256",
		state: pkce.state,
	};
	const initResult = await callWebPortal("InitiateLogin", initInput);
	if (!initResult.ok) {
		const decoded = cborDecode(initResult.body);
		console.error(`❌ InitiateLogin failed: ${initResult.status}`);
		console.error(`   body: ${JSON.stringify(decoded)}`);
		process.exit(1);
	}
	const init = cborDecode(initResult.body);
	console.log(`   ✅ redirect URL issued (length: ${init.redirectUrl.length})`);
	if (init.applicationArn) {
		console.log(`   applicationArn: ${init.applicationArn}`);
	}
	if (init.instanceRegion) {
		console.log(`   instanceRegion: ${init.instanceRegion}`);
	}
	console.log("");

	// Step 3: Browser redirect (manual)
	console.log("🖱️  Step 3/4: BROWSER INTERACTION REQUIRED");
	console.log(
		"   ─────────────────────────────────────────────────────────────",
	);
	console.log(`   Open this URL in your browser:`);
	console.log(`   ${init.redirectUrl}`);
	console.log("");
	console.log(
		`   Sign in with ${args.idp}. After signing in, your browser will`,
	);
	console.log(`   land on a page with a URL starting with:`);
	console.log(`   ${KIRO_REDIRECT_URI}?code=...&state=...`);
	console.log("");
	console.log(
		`   Copy the FULL URL from your browser's address bar and paste it below.`,
	);
	console.log(
		"   ─────────────────────────────────────────────────────────────",
	);
	console.log("");

	const readline = await import("node:readline/promises");
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	let pasted;
	while (!pasted) {
		pasted = (await rl.question("Paste the redirect URL: ")).trim();
		if (!pasted) {
			console.log("   (empty input, try again — paste the full URL)");
		}
	}
	rl.close();
	console.log("");

	// Parse and verify state
	let pastedUrl;
	try {
		pastedUrl = new URL(pasted);
	} catch {
		console.error("❌ Pasted input is not a valid URL");
		process.exit(1);
	}
	if (!pastedUrl.href.startsWith(`${KIRO_REDIRECT_URI}?`)) {
		console.error(
			`❌ Pasted URL is not a Kiro redirect (expected ${KIRO_REDIRECT_URI}?..., got ${pastedUrl.origin}${pastedUrl.pathname})`,
		);
		process.exit(1);
	}
	const code = pastedUrl.searchParams.get("code");
	const returnedState = pastedUrl.searchParams.get("state");
	if (!code) {
		console.error("❌ Pasted URL is missing the `code` query parameter");
		process.exit(1);
	}
	if (!returnedState) {
		console.error("❌ Pasted URL is missing the `state` query parameter");
		process.exit(1);
	}
	if (returnedState !== pkce.state) {
		console.error(
			`❌ State mismatch (CSRF protection) — pasted URL was not from this login session`,
		);
		console.error(`   expected: ${pkce.state}`);
		console.error(`   got:      ${returnedState}`);
		process.exit(1);
	}
	console.log("   ✅ URL parsed, state verified");

	// Step 4: ExchangeToken
	console.log("");
	console.log("🔄 Step 4/4: calling ExchangeToken...");
	const exchangeInput = {
		idp: args.idp,
		code,
		codeVerifier: pkce.codeVerifier,
		redirectUri: KIRO_REDIRECT_URI,
		state: pkce.state,
	};
	const exchangeResult = await callWebPortal("ExchangeToken", exchangeInput);
	if (!exchangeResult.ok) {
		const decoded = cborDecode(exchangeResult.body);
		console.error(`❌ ExchangeToken failed: ${exchangeResult.status}`);
		console.error(`   body: ${JSON.stringify(decoded)}`);
		process.exit(1);
	}
	const exchange = cborDecode(exchangeResult.body);
	const cookies = parseSetCookie(exchangeResult.setCookie);
	console.log("   ✅ ExchangeToken succeeded");
	console.log("");

	// Report (no credential material exposed)
	console.log("═══════════════════════════════════════════════════════════════");
	console.log("📊 RESULT");
	console.log("═══════════════════════════════════════════════════════════════");
	const hasRefresh = Boolean(cookies.refreshToken);
	const profileArn = exchange.profileArn;
	console.log(`   IdP:                       ${args.idp}`);
	console.log(
		`   accessToken length:        ${(exchange.accessToken ?? "").length} chars`,
	);
	console.log(
		`   refreshToken cookie:       ${hasRefresh ? "present" : "ABSENT"}`,
	);
	console.log(
		`   sessionToken cookie:       ${cookies.sessionToken ? "present" : "ABSENT"}`,
	);
	console.log(
		`   csrfToken (in body):       ${exchange.csrfToken ? "present" : "ABSENT"}`,
	);
	console.log(`   expiresIn:                 ${exchange.expiresIn}s`);
	console.log(
		`   profileArn:                ${profileArn ? `present (last 20: ...${profileArn.slice(-20)})` : "ABSENT"}`,
	);
	console.log("");
	if (profileArn) {
		console.log(
			"   ✅ profileArn is present — the design doc's primary success criterion is met.",
		);
	} else {
		console.log("   ⚠️  profileArn is absent. This may indicate:");
		console.log("      - The Kiro Web Portal changed its contract for this IdP");
		console.log(
			"      - The IdP returned a credential without an associated profile",
		);
		console.log(
			"      - You're using an account that doesn't have an associated AWS profile",
		);
		console.log("      Set kiro_profile_arn in ~/.pi/free.json as a workaround.");
	}
	console.log("");
	if (!hasRefresh) {
		console.log(
			"   ⚠️  refreshToken cookie is absent. The Kiro Web Portal may have changed",
		);
		console.log(
			"      its cookie contract for this IdP; the refresh path won't work without it.",
		);
	}
	console.log("");
	console.log("═══════════════════════════════════════════════════════════════");

	process.exit(profileArn && hasRefresh ? 0 : 1);
}

main().catch((err) => {
	console.error("Unhandled error:", err);
	process.exit(1);
});
