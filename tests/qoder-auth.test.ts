import type { OAuthCredential } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import { qoderAuth } from "../providers/qoder/qoder.ts";

describe("Qoder native authentication", () => {
	it("exposes the existing OAuth/PAT flow through ProviderAuth", () => {
		expect(qoderAuth.oauth).toMatchObject({
			name: "Qoder (Browser OAuth / PAT)",
			login: expect.any(Function),
			refresh: expect.any(Function),
			toAuth: expect.any(Function),
		});
	});

	it("converts a stored Qoder credential into a bearer API auth", async () => {
		const credential = {
			type: "oauth",
			access: "job-token",
			refresh: "refresh-token",
			expires: Date.now() + 60_000,
		} as OAuthCredential;

		expect(await qoderAuth.oauth?.toAuth(credential)).toEqual({
			apiKey: "job-token",
		});
	});
});
