/**
 * Registry Tests
 *
 * Covers the global provider registry, toggle registration,
 * global filter application, and pricing detection.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
	applyGlobalFilter,
	getGlobalFreeOnly,
	getProviderRegistry,
	registerWithGlobalToggle,
} from "../lib/registry.ts";
import type { ProviderModelConfig } from "../lib/types.ts";

// =============================================================================
// Helpers
// =============================================================================

function makeCost(
	input: number,
	output: number,
): { input: number; output: number; cacheRead: number; cacheWrite: number } {
	return { input, output, cacheRead: 0, cacheWrite: 0 };
}

function makeModel(
	id: string,
	cost?: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	},
	name?: string,
): ProviderModelConfig {
	return {
		id,
		name: name ?? id,
		reasoning: false,
		input: ["text"],
		cost: cost ?? makeCost(0, 0),
		contextWindow: 4096,
		maxTokens: 2048,
	};
}

function makeFreeModel(id: string, name?: string): ProviderModelConfig {
	return makeModel(id, makeCost(0, 0), name);
}

function makePaidModel(id: string, name?: string): ProviderModelConfig {
	return makeModel(id, makeCost(1, 2), name);
}

const mockPi = {} as ExtensionAPI;

// =============================================================================
// registerWithGlobalToggle
// =============================================================================

describe("registerWithGlobalToggle", () => {
	it("registers a provider with free and all model lists", () => {
		const id = "rg-test-001";
		const free = [makeFreeModel("free-1"), makeFreeModel("free-2")];
		const all = [...free, makePaidModel("paid-1")];
		const reRegister = vi.fn();

		registerWithGlobalToggle(id, { free, all }, reRegister, true);

		const registry = getProviderRegistry();
		expect(registry.has(id)).toBe(true);
		const entry = registry.get(id)!;
		expect(entry.stored.free).toHaveLength(2);
		expect(entry.stored.all).toHaveLength(3);
		expect(entry.hasKey).toBe(true);
	});

	it("registers multiple providers independently", () => {
		registerWithGlobalToggle("rg-indep-a", { free: [], all: [] }, vi.fn());
		registerWithGlobalToggle("rg-indep-b", { free: [], all: [] }, vi.fn());

		expect(getProviderRegistry().has("rg-indep-a")).toBe(true);
		expect(getProviderRegistry().has("rg-indep-b")).toBe(true);
	});

	it("overwrites an existing registration for the same provider ID", () => {
		const reRegister1 = vi.fn();
		const reRegister2 = vi.fn();

		registerWithGlobalToggle(
			"rg-overwrite",
			{ free: [], all: [] },
			reRegister1,
		);
		registerWithGlobalToggle(
			"rg-overwrite",
			{ free: [], all: [] },
			reRegister2,
		);

		expect(getProviderRegistry().get("rg-overwrite")!.reRegister).toBe(
			reRegister2,
		);
	});

	it("defaults hasKey to false", () => {
		registerWithGlobalToggle("rg-default-key", { free: [], all: [] }, vi.fn());
		expect(getProviderRegistry().get("rg-default-key")!.hasKey).toBe(false);
	});
});

// =============================================================================
// getGlobalFreeOnly
// =============================================================================

describe("getGlobalFreeOnly", () => {
	it("returns a boolean value", () => {
		const val = getGlobalFreeOnly();
		expect(typeof val).toBe("boolean");
	});

	it("reflects changes after applyGlobalFilter", () => {
		const before = getGlobalFreeOnly();
		applyGlobalFilter(mockPi, !before);
		expect(getGlobalFreeOnly()).toBe(!before);
		applyGlobalFilter(mockPi, before);
	});
});

// =============================================================================
// getProviderRegistry
// =============================================================================

describe("getProviderRegistry", () => {
	it("returns a Map-like ReadonlyMap", () => {
		const registry = getProviderRegistry();
		expect(registry).toBeInstanceOf(Map);
	});

	it("returns the same instance across calls", () => {
		expect(getProviderRegistry()).toBe(getProviderRegistry());
	});
});

// =============================================================================
// applyGlobalFilter
// =============================================================================

describe("applyGlobalFilter", () => {
	it("re-registers providers with free models when freeOnly=true", () => {
		const free = [makeFreeModel("a"), makeFreeModel("b")];
		const all = [...free, makePaidModel("c")];
		const reRegister = vi.fn();

		registerWithGlobalToggle("af-test-1", { free, all }, reRegister, true);
		applyGlobalFilter(mockPi, true);

		expect(reRegister).toHaveBeenCalledTimes(1);
		expect(reRegister).toHaveBeenCalledWith(free);
	});

	it("re-registers providers with all models when freeOnly=false", () => {
		const free = [makeFreeModel("a")];
		const all = [...free, makePaidModel("b")];
		const reRegister = vi.fn();

		registerWithGlobalToggle("af-test-2", { free, all }, reRegister, true);
		applyGlobalFilter(mockPi, false);

		expect(reRegister).toHaveBeenCalledTimes(1);
		expect(reRegister).toHaveBeenCalledWith(all);
	});

	it("falls back to free list when all list is empty", () => {
		const free = [makeFreeModel("a")];
		const reRegister = vi.fn();

		registerWithGlobalToggle("af-test-3", { free, all: [] }, reRegister, true);
		applyGlobalFilter(mockPi, false);

		expect(reRegister).toHaveBeenCalledWith(free);
	});

	it("handles providers with no free models gracefully", () => {
		const free: ProviderModelConfig[] = [];
		const all = [makePaidModel("expensive")];
		const reRegister = vi.fn();

		registerWithGlobalToggle("af-test-4", { free, all }, reRegister, true);

		expect(() => applyGlobalFilter(mockPi, true)).not.toThrow();
		expect(reRegister).not.toHaveBeenCalled();
	});

	it("applies filter to all registered providers", () => {
		const reRegA = vi.fn();
		const reRegB = vi.fn();

		registerWithGlobalToggle(
			"af-all-a",
			{ free: [makeFreeModel("f1")], all: [makeFreeModel("f1")] },
			reRegA,
		);
		registerWithGlobalToggle(
			"af-all-b",
			{ free: [makeFreeModel("f2")], all: [makeFreeModel("f2")] },
			reRegB,
		);

		applyGlobalFilter(mockPi, true);

		expect(reRegA).toHaveBeenCalledTimes(1);
		expect(reRegB).toHaveBeenCalledTimes(1);
	});

	it("does not crash when a provider's reRegister throws", () => {
		const failingReRegister = vi.fn().mockImplementation(() => {
			throw new Error("boom");
		});
		const goodReRegister = vi.fn();

		registerWithGlobalToggle(
			"af-crash-fail",
			{ free: [makeFreeModel("f")], all: [makeFreeModel("f")] },
			failingReRegister,
		);
		registerWithGlobalToggle(
			"af-crash-ok",
			{ free: [makeFreeModel("g")], all: [makeFreeModel("g")] },
			goodReRegister,
		);

		expect(() => applyGlobalFilter(mockPi, true)).not.toThrow();
		expect(goodReRegister).toHaveBeenCalledTimes(1);
	});
});
