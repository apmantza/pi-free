/**
 * COSY cryptographic signing for Qoder API authentication.
 *
 * Qoder uses a proprietary signing scheme (COSY) that combines RSA-encrypted
 * AES keys, AES-CBC-encrypted user info, and MD5 payload signing. This module
 * reimplements the same algorithm used by the official qodercli binary.
 *
 * The auth flow:
 *   1. Generate a random 16-byte AES key
 *   2. AES-CBC-encrypt user info (uid, auth token, name, email) with it
 *   3. RSA-encrypt the AES key with Qoder's public key
 *   4. Build a COSY payload: { version, requestId, info, cosyVersion, ideVersion }
 *   5. MD5-hash: payloadB64 + "\n" + cosyKey + "\n" + timestamp + "\n" + body + "\n" + sigPath
 *   6. Send as Authorization: Bearer COSY.{payloadB64}.{sig} + 15 Cosy-* headers
 */

import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const QODER_RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`;

const QODER_IDE_VERSION = "1.0.0";
const QODER_CLIENT_TYPE = "5";
const QODER_DATA_POLICY = "disagree";
const QODER_LOGIN_VERSION = "v2";
const QODER_MACHINE_OS = "x86_64_windows";
const QODER_MACHINE_TYPE_MAGIC = "5";

interface UserInfo {
	uid: string;
	security_oauth_token: string;
	name: string;
	aid: string;
	email: string;
}

interface CosyPayload {
	version: string;
	requestId: string;
	info: string;
	cosyVersion: string;
	ideVersion: string;
}

export interface CosyCredentials {
	userID: string;
	authToken: string;
	name: string;
	email: string;
	machineID?: string;
}

type BodyInput = Buffer | string | null;

function bodyToUtf8(body: BodyInput): string {
	if (!body) return "";
	if (Buffer.isBuffer(body)) return body.toString("utf8");
	return body;
}

function bodyToLengthString(body: BodyInput): string {
	if (!body) return "0";
	if (Buffer.isBuffer(body)) return String(body.length);
	return String(Buffer.from(body).length);
}

function rsaEncryptBase64(data: Buffer | string): string {
	const key = {
		key: QODER_RSA_PUBLIC_KEY,
		padding: crypto.constants.RSA_PKCS1_PADDING,
	};
	const encrypted = crypto.publicEncrypt(
		key,
		typeof data === "string" ? Buffer.from(data) : data,
	);
	return encrypted.toString("base64");
}

/**
 * Encrypt plaintext with AES-128-CBC using the same key for both key and IV.
 *
 * NOTE: Using key as IV is insecure in general and would be flagged by static
 * analysis tools. However, this is a strict requirement of Qoder's COSY protocol
 * (reverse-engineered from the official CLI). Changing the mode or IV derivation
 * will cause authentication failures.
 *
 * @param plaintext - Data to encrypt
 * @param keyStr - 16-byte hex key (also used as IV per protocol spec)
 * @returns Base64-encoded ciphertext
 */
function aesEncryptCBCBase64(plaintext: string, keyStr: string): string {
	// sonar-security: AES-CBC with key-as-IV is protocol-mandatory for Qoder COSY auth
	const cipher = crypto.createCipheriv(
		"aes-128-cbc",
		Buffer.from(keyStr),
		Buffer.from(keyStr),
	);
	let encrypted = cipher.update(plaintext, "utf8", "base64");
	encrypted += cipher.final("base64");
	return encrypted;
}

function computeSigPath(urlStr: string): string {
	try {
		const parsed = new URL(urlStr);
		let sigPath = parsed.pathname;
		if (sigPath.startsWith("/algo")) {
			sigPath = sigPath.slice("/algo".length);
		}
		return sigPath;
	} catch {
		return "";
	}
}

/**
 * Get or create a persistent machine ID.
 * Checks ~/.qoder/.auth/machine_id first, then falls back to ~/.pi/agent/qoder-machine-id.
 */
export function getMachineId(): string {
	const paths = [
		join(homedir(), ".qoder", ".auth", "machine_id"),
		join(homedir(), ".pi", "agent", "qoder-machine-id"),
	];
	for (const p of paths) {
		if (existsSync(p)) {
			try {
				const val = readFileSync(p, "utf8").trim();
				if (val) return val;
			} catch {
				// Ignore read errors
			}
		}
	}
	const newId = crypto.randomUUID();
	try {
		const savePath = paths[1];
		mkdirSync(dirname(savePath), { recursive: true });
		writeFileSync(savePath, newId, "utf8");
	} catch {
		// Best-effort
	}
	return newId;
}

/**
 * Build all COSY authentication headers for a Qoder API request.
 *
 * @param body - Request body (Buffer or string), or null for GET requests
 * @param requestURL - Full URL being requested
 * @param creds - COSY credentials (userID, authToken, name, email, machineID)
 * @returns Record of headers to include in the request
 */
export function buildAuthHeaders(
	body: Buffer | string | null,
	requestURL: string,
	creds: CosyCredentials,
): Record<string, string> {
	if (!creds.userID) {
		throw new Error("cosy: user id is empty");
	}
	if (!creds.authToken) {
		throw new Error("cosy: auth token is empty");
	}

	const aesKey = crypto.randomUUID().replaceAll(/-/g, "").slice(0, 16);
	const userInfo: UserInfo = {
		uid: creds.userID,
		security_oauth_token: creds.authToken,
		name: creds.name || "",
		aid: "",
		email: creds.email || "",
	};

	const infoB64 = aesEncryptCBCBase64(JSON.stringify(userInfo), aesKey);
	const cosyKey = rsaEncryptBase64(aesKey);

	const timestamp = Math.floor(Date.now() / 1000).toString();
	const requestId = crypto.randomUUID();

	const cosyPayload: CosyPayload = {
		version: "v1",
		requestId,
		info: infoB64,
		cosyVersion: QODER_IDE_VERSION,
		ideVersion: "",
	};

	const payloadB64 = Buffer.from(JSON.stringify(cosyPayload)).toString(
		"base64",
	);
	const sigPath = computeSigPath(requestURL);

	const bodyStr = bodyToUtf8(body);
	const sigInput = `${payloadB64}\n${cosyKey}\n${timestamp}\n${bodyStr}\n${sigPath}`;
	// sonar-security: MD5 is protocol-mandatory for COSY signature (reverse-engineered from Qoder CLI)
	const sig = crypto.createHash("md5").update(sigInput).digest("hex");

	// sonar-security: MD5 is protocol-mandatory for COSY body hash (reverse-engineered from Qoder CLI)
	const bodyHash = crypto
		.createHash("md5")
		.update(body || "")
		.digest("hex");
	const bodyLen = bodyToLengthString(body);

	const machineID = creds.machineID || getMachineId();

	return {
		Authorization: `Bearer COSY.${payloadB64}.${sig}`,
		"Cosy-Key": cosyKey,
		"Cosy-User": creds.userID,
		"Cosy-Date": timestamp,
		"Cosy-Version": QODER_IDE_VERSION,
		"Cosy-Machineid": machineID,
		"Cosy-Machinetoken": machineID,
		"Cosy-Machinetype": QODER_MACHINE_TYPE_MAGIC,
		"Cosy-Machineos": QODER_MACHINE_OS,
		"Cosy-Clienttype": QODER_CLIENT_TYPE,
		"Cosy-Clientip": "127.0.0.1",
		"Cosy-Bodyhash": bodyHash,
		"Cosy-Bodylength": bodyLen,
		"Cosy-Sigpath": sigPath,
		"Cosy-Data-Policy": QODER_DATA_POLICY,
		"Cosy-Organization-Id": "",
		"Cosy-Organization-Tags": "",
		"Login-Version": QODER_LOGIN_VERSION,
		"X-Request-Id": crypto.randomUUID(),
	};
}
