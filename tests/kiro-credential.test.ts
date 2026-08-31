/**
 * Unit tests for `providers/kiro/kiro-credential.ts`.
 *
 * Per design doc Phase E test plan: `kiro-stream.test.ts` covers the
 * full resolution order (modelMetadata > credential > getKiroProfileArn).
 * This file isolates the `readPersistedKiroProfileArn` helper because
 * it does filesystem I/O and the resolution order test would need to
 * stub a lot of state. The helper is best tested in isolation with
 * mocked fs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";

// Mock node:fs so we don't touch the real auth.json
vi.mock("node:fs", async () => {
	const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
	return {
		...actual,
		existsSync: vi.fn(actual.existsSync),
		readFileSync: vi.fn(actual.readFileSync),
	};
});

// Mock the paths module so PI_DATA_DIR is predictable
vi.mock("../../lib/paths.ts", () => ({
	PI_DATA_DIR: "/tmp/pi-test-data",
}));

// Mock the JSON reviver in the kiro-credential module's readFileSync path
// to confirm the helper is best-effort (returns undefined on parse error).
import { readPersistedKiroProfileArn } from "../providers/kiro/kiro-credential.ts";

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

afterEach(() => {
	vi.clearAllMocks();
});

describe("kiro-credential — readPersistedKiroProfileArn", () => {
	it("returns undefined when auth.json doesn't exist", () => {
		mockedExistsSync.mockReturnValue(false);
		expect(readPersistedKiroProfileArn()).toBeUndefined();
	});

	it("returns the kiro.profileArn when present", () => {
		mockedExistsSync.mockReturnValue(true);
		mockedReadFileSync.mockReturnValue(
			JSON.stringify({
				kiro: {
					type: "oauth",
					access: "aoa...",
					refresh: "rt...",
					expires: 1787906008267,
					profileArn: "arn:aws:codewhisperer:us-east-1:123456789:profile/ABCDE",
				},
			}),
		);
		expect(readPersistedKiroProfileArn()).toBe(
			"arn:aws:codewhisperer:us-east-1:123456789:profile/ABCDE",
		);
	});

	it("returns undefined when the kiro entry is missing", () => {
		mockedExistsSync.mockReturnValue(true);
		mockedReadFileSync.mockReturnValue(
			JSON.stringify({ openai: { type: "oauth" } }),
		);
		expect(readPersistedKiroProfileArn()).toBeUndefined();
	});

	it("returns undefined when the kiro entry has no profileArn field", () => {
		mockedExistsSync.mockReturnValue(true);
		mockedReadFileSync.mockReturnValue(
			JSON.stringify({
				kiro: {
					type: "oauth",
					access: "aoa...",
					refresh: "rt...",
					expires: 1787906008267,
					// no profileArn
				},
			}),
		);
		expect(readPersistedKiroProfileArn()).toBeUndefined();
	});

	it("returns undefined when the kiro.profileArn is not a string", () => {
		mockedExistsSync.mockReturnValue(true);
		mockedReadFileSync.mockReturnValue(
			JSON.stringify({
				kiro: {
					type: "oauth",
					access: "aoa...",
					refresh: "rt...",
					expires: 1787906008267,
					profileArn: 12345, // wrong type
				},
			}),
		);
		expect(readPersistedKiroProfileArn()).toBeUndefined();
	});

	it("returns undefined when auth.json is malformed JSON", () => {
		mockedExistsSync.mockReturnValue(true);
		mockedReadFileSync.mockReturnValue("{ this is not valid JSON");
		expect(readPersistedKiroProfileArn()).toBeUndefined();
	});

	it("returns undefined when readFileSync throws", () => {
		mockedExistsSync.mockReturnValue(true);
		mockedReadFileSync.mockImplementation(() => {
			throw new Error("EACCES: permission denied");
		});
		expect(readPersistedKiroProfileArn()).toBeUndefined();
	});

	it("returns undefined when auth.json is the empty object", () => {
		mockedExistsSync.mockReturnValue(true);
		mockedReadFileSync.mockReturnValue("{}");
		expect(readPersistedKiroProfileArn()).toBeUndefined();
	});

	it("does not read any other field from the kiro entry", () => {
		// Sanity check: the helper only reads profileArn. Other fields
		// (access, refresh, etc.) are not in the return value.
		mockedExistsSync.mockReturnValue(true);
		mockedReadFileSync.mockReturnValue(
			JSON.stringify({
				kiro: {
					type: "oauth",
					access: "aoa-secret-access-token",
					refresh: "rt-secret-refresh-token",
					expires: 1787906008267,
					profileArn: "arn:aws:codewhisperer:us-east-1:123:profile/X",
				},
			}),
		);
		const result = readPersistedKiroProfileArn();
		expect(result).toBe("arn:aws:codewhisperer:us-east-1:123:profile/X");
		// The return type is a string, not an object, so there's no
		// way to leak access/refresh. This test documents the contract.
	});
});
