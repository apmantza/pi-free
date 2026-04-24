import { describe, expect, it, vi } from "vitest";

import { createToggleState } from "../lib/toggle-state.ts";

describe("toggle-state helper", () => {
	it("toggles from the actual currently applied mode", () => {
		const save = vi.fn();
		const state = createToggleState({
			providerId: "cline",
			initialShowPaid: false,
			save,
		});

		state.setModels({
			free: [{ id: "free" }],
			all: [{ id: "free" }, { id: "paid" }],
		});

		state.applyMode("all");
		const next = state.toggle();

		expect(next.mode).toBe("free");
		expect(next.models).toEqual([{ id: "free" }]);
		expect(save).toHaveBeenCalledWith({ cline_show_paid: false });
	});

	it("re-applies persisted show-paid mode after model refresh", () => {
		const state = createToggleState({
			providerId: "cline",
			initialShowPaid: true,
			save: vi.fn(),
		});

		state.setModels({
			free: [{ id: "free" }],
			all: [{ id: "free" }, { id: "paid" }],
		});

		expect(state.getCurrentMode()).toBe("all");
		expect(state.getCurrentModels()).toEqual([{ id: "free" }, { id: "paid" }]);
	});
});
