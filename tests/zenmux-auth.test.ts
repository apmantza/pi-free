import type { AuthInteraction } from "@earendil-works/pi-ai/compat";
import { describe, expect, it, vi } from "vitest";

const mockGetZenmuxApiKey = vi.hoisted(() =>
	vi.fn((): string | undefined => undefined),
);

vi.mock("../config.ts", () => ({
	getZenmuxApiKey: () => mockGetZenmuxApiKey(),
}));

import { zenmuxAuth } from "../providers/zenmux/zenmux-auth.ts";

describe("ZenMux native API-key auth", () => {
	it("returns undefined when no credential or ambient key exists", async () => {
		mockGetZenmuxApiKey.mockReturnValue(undefined);
		expect(
			await zenmuxAuth.apiKey?.resolve({
				ctx: {} as never,
				credential: undefined,
			}),
		).toBeUndefined();
	});

	it("uses the ambient ZenMux key", async () => {
		mockGetZenmuxApiKey.mockReturnValue("sk-ambient");
		expect(
			await zenmuxAuth.apiKey?.resolve({
				ctx: {} as never,
				credential: undefined,
			}),
		).toMatchObject({ auth: { apiKey: "sk-ambient" } });
	});

	it("prefers a natively stored key", async () => {
		mockGetZenmuxApiKey.mockReturnValue("sk-ambient");
		expect(
			await zenmuxAuth.apiKey?.resolve({
				ctx: {} as never,
				credential: { type: "api_key", key: "sk-stored" },
			}),
		).toMatchObject({ auth: { apiKey: "sk-stored" } });
	});

	it("prompts for a key through native login", async () => {
		const prompt = vi.fn().mockResolvedValue("sk-prompted");
		const login = zenmuxAuth.apiKey?.login;
		if (!login) throw new Error("ZenMux native login is unavailable");
		const credential = await login({
			prompt,
		} as unknown as AuthInteraction);
		expect(prompt).toHaveBeenCalledWith({
			type: "secret",
			message: "ZenMux API key",
		});
		expect(credential).toEqual({ type: "api_key", key: "sk-prompted" });
	});
});
