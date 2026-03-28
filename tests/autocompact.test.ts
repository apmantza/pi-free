import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
	isAutocompactCooldown,
	markAutocompactTriggered,
	triggerAutocompact,
} from "../provider-failover/autocompact.ts";

describe("Autocompact", () => {
	describe("isAutocompactCooldown", () => {
		it("should return false if no recent autocompact", () => {
			expect(isAutocompactCooldown("session-1")).toBe(false);
		});

		it("should return true if autocompact was recent", () => {
			markAutocompactTriggered("session-2");
			expect(isAutocompactCooldown("session-2")).toBe(true);
		});

		it("should return false after cooldown expires", () => {
			markAutocompactTriggered("session-3");
			// Wait 31 seconds
			const future = Date.now() + 31000;
			vi.spyOn(Date, "now").mockReturnValue(future);

			expect(isAutocompactCooldown("session-3")).toBe(false);
		});
	});

	describe("triggerAutocompact", () => {
		it("should show notification on cooldown", async () => {
			const mockNotify = vi.fn();
			const ctx = {
				ui: { notify: mockNotify },
				session: { id: "test-session" },
			};

			// Trigger first time
			await triggerAutocompact(
				{} as unknown as ExtensionAPI,
				ctx,
				"test reason",
			);

			// Trigger again immediately (should be on cooldown)
			const result = await triggerAutocompact(
				{} as unknown as ExtensionAPI,
				ctx,
				"test reason",
			);

			expect(result.success).toBe(false);
			expect(result.message).toContain("cooldown");
		});

		it("should succeed when not on cooldown", async () => {
			const mockNotify = vi.fn();
			const ctx = {
				ui: { notify: mockNotify },
				session: { id: "new-session" },
			};

			const result = await triggerAutocompact(
				{} as unknown as ExtensionAPI,
				ctx,
				"test reason",
			);

			expect(result.success).toBe(true);
			expect(mockNotify).toHaveBeenCalled();
		});
	});
});
