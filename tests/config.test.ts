/**
 * Config Tests
 *
 * Covers key resolution priority (env var > file), show-paid flags,
 * hidden model filtering, and config persistence.
 *
 * Mocks node:fs to avoid touching real ~/.pi/free.json.
 * The mock uses __mockData (a Map) as the virtual filesystem:
 *  - existsSync checks if path exists in the map
 *  - readFileSync reads from the map
 *  - writeFileSync writes to the map
 * Tests configure the initial state via __mockData.set().
 */

import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock fs before importing config module
vi.mock("node:fs", () => {
	const mockData = new Map<string, string>();
	return {
		appendFileSync: vi.fn(),
		existsSync: vi.fn((path: string) => mockData.has(path)),
		mkdirSync: vi.fn(),
		readFileSync: vi.fn((path: string) => mockData.get(path) ?? ""),
		writeFileSync: vi.fn((path: string, content: string) => {
			mockData.set(path, content);
		}),
		__mockData: mockData,
	};
});

function configPath(): string {
	const home = process.env.HOME || process.env.USERPROFILE || "";
	return join(home, ".pi", "free.json");
}

// Fresh modules, env, and mock fs state for each test
beforeEach(async () => {
	vi.unstubAllEnvs();
	vi.resetModules();
	// Clear the mock filesystem to prevent cross-contamination
	const fs = await import("node:fs");
	const { __mockData } = fs as any;
	__mockData.clear();
});

// =============================================================================
// applyHidden
// =============================================================================

describe("applyHidden", () => {
	it("returns all models when no hidden models configured", async () => {
		const { applyHidden } = await import("../config.ts");
		const models = [{ id: "gpt-4" }, { id: "claude-3" }];
		expect(applyHidden(models)).toEqual(models);
	});

	it("filters out globally hidden model IDs", async () => {
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(
			configPath(),
			JSON.stringify({ hidden_models: ["gpt-4-bad"] }),
		);

		const { applyHidden } = await import("../config.ts");
		const models = [{ id: "gpt-4" }, { id: "gpt-4-bad" }, { id: "claude-3" }];
		expect(applyHidden(models)).toEqual([{ id: "gpt-4" }, { id: "claude-3" }]);
	});

	it("filters out provider-scoped hidden model IDs", async () => {
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(
			configPath(),
			JSON.stringify({ hidden_models: ["nvidia/gpt-4-bad"] }),
		);

		const { applyHidden } = await import("../config.ts");
		const models = [{ id: "gpt-4-bad" }, { id: "gpt-4-ok" }];

		// NOT hidden globally (only scoped to nvidia)
		expect(applyHidden(models)).toHaveLength(2);

		// Hidden when scoped to nvidia
		expect(applyHidden(models, "nvidia")).toEqual([{ id: "gpt-4-ok" }]);
	});

	it("handles empty hidden_models gracefully", async () => {
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(configPath(), JSON.stringify({ hidden_models: [] }));

		const { applyHidden } = await import("../config.ts");
		const models = [{ id: "a" }, { id: "b" }];
		expect(applyHidden(models)).toEqual(models);
	});
});

// =============================================================================
// Config getters — boolean show-paid flags
// =============================================================================

describe("show-paid getters", () => {
	it("getFreeOnly returns default from template (true)", async () => {
		vi.stubEnv("HOME", "/tmp");
		const { getFreeOnly } = await import("../config.ts");
		expect(getFreeOnly()).toBe(true);
	});

	it("getFreeOnly prefers env var over file value", async () => {
		vi.stubEnv("PI_FREE_ONLY", "false");
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(configPath(), JSON.stringify({ free_only: true }));

		const { getFreeOnly } = await import("../config.ts");
		expect(getFreeOnly()).toBe(false);
	});

	it("getKiloShowPaid defaults to false", async () => {
		vi.stubEnv("HOME", "/tmp");
		const { getKiloShowPaid } = await import("../config.ts");
		expect(getKiloShowPaid()).toBe(false);
	});

	it("getKiloShowPaid reads from file", async () => {
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(configPath(), JSON.stringify({ kilo_show_paid: true }));

		const { getKiloShowPaid } = await import("../config.ts");
		expect(getKiloShowPaid()).toBe(true);
	});

	it("getKiloShowPaid prefers env var over file", async () => {
		vi.stubEnv("KILO_SHOW_PAID", "false");
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(configPath(), JSON.stringify({ kilo_show_paid: true }));

		const { getKiloShowPaid } = await import("../config.ts");
		expect(getKiloShowPaid()).toBe(false);
	});

	it("getOpenrouterShowPaid reads from file", async () => {
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(
			configPath(),
			JSON.stringify({ openrouter_show_paid: true }),
		);

		const { getOpenrouterShowPaid } = await import("../config.ts");
		expect(getOpenrouterShowPaid()).toBe(true);
	});

	it("getOpenrouterShowPaid defaults to false", async () => {
		vi.stubEnv("HOME", "/tmp");
		const { getOpenrouterShowPaid } = await import("../config.ts");
		expect(getOpenrouterShowPaid()).toBe(false);
	});

	it("getProviderShowPaid maps provider ids to persisted flags", async () => {
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(configPath(), JSON.stringify({ zenmux_show_paid: true }));

		const { getProviderShowPaid } = await import("../config.ts");
		expect(getProviderShowPaid("zenmux")).toBe(true);
		expect(getProviderShowPaid("unknown-provider")).toBe(false);
	});

	it("getRoutewayShowPaid reads from file", async () => {
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(configPath(), JSON.stringify({ routeway_show_paid: true }));

		const { getProviderShowPaid, getRoutewayShowPaid } = await import(
			"../config.ts"
		);
		expect(getRoutewayShowPaid()).toBe(true);
		expect(getProviderShowPaid("routeway")).toBe(true);
	});
});

// =============================================================================
// API key getters
// =============================================================================

describe("API key getters", () => {
	it("getNvidiaApiKey reads from env var over file", async () => {
		vi.stubEnv("NVIDIA_API_KEY", "nv-env-key");
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(
			configPath(),
			JSON.stringify({ nvidia_api_key: "nv-file-key" }),
		);

		const { getNvidiaApiKey } = await import("../config.ts");
		expect(getNvidiaApiKey()).toBe("nv-env-key");
	});

	it("getNvidiaApiKey falls back to file value", async () => {
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(
			configPath(),
			JSON.stringify({ nvidia_api_key: "nv-file-key" }),
		);

		const { getNvidiaApiKey } = await import("../config.ts");
		expect(getNvidiaApiKey()).toBe("nv-file-key");
	});

	it("getNvidiaApiKey returns undefined when not set anywhere", async () => {
		vi.stubEnv("HOME", "/tmp");
		const { getNvidiaApiKey } = await import("../config.ts");
		expect(getNvidiaApiKey()).toBeUndefined();
	});

	it("getOpenrouterApiKey only reads from env var (no file fallback)", async () => {
		vi.stubEnv("OPENROUTER_API_KEY", "or-env-key");
		vi.stubEnv("HOME", "/tmp");

		const { getOpenrouterApiKey } = await import("../config.ts");
		expect(getOpenrouterApiKey()).toBe("or-env-key");
	});

	it("getOpenrouterApiKey returns undefined when no env var set", async () => {
		vi.stubEnv("HOME", "/tmp");
		const { getOpenrouterApiKey } = await import("../config.ts");
		expect(getOpenrouterApiKey()).toBeUndefined();
	});
});

// =============================================================================
// saveConfig / loadConfigFile / getConfig
// =============================================================================

describe("config persistence", () => {
	it("saveConfig writes merged updates to file", async () => {
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData, writeFileSync } = fs as any;
		__mockData.set(
			configPath(),
			JSON.stringify({ free_only: true, nvidia_api_key: "existing" }),
		);

		const { saveConfig } = await import("../config.ts");
		saveConfig({ free_only: false });

		const lastCall =
			writeFileSync.mock.calls[writeFileSync.mock.calls.length - 1];
		const written = JSON.parse(lastCall[1]);
		expect(written.free_only).toBe(false);
		expect(written.nvidia_api_key).toBe("existing");
	});

	it("saveConfig adds new fields while keeping existing", async () => {
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData, writeFileSync } = fs as any;
		__mockData.set(configPath(), JSON.stringify({ free_only: true }));

		const { saveConfig } = await import("../config.ts");
		saveConfig({ nvidia_api_key: "new-key" });

		const lastCall =
			writeFileSync.mock.calls[writeFileSync.mock.calls.length - 1];
		const written = JSON.parse(lastCall[1]);
		expect(written.free_only).toBe(true);
		expect(written.nvidia_api_key).toBe("new-key");
	});
});

// =============================================================================
// Re-exports
// =============================================================================

describe("config re-exports", () => {
	it("exports PROVIDER constants", async () => {
		const cfg = await import("../config.ts");
		expect(cfg.PROVIDER_KILO).toBe("kilo");
		expect(cfg.PROVIDER_CLINE).toBe("cline");
	});

	it("exports all getter functions", async () => {
		const cfg = await import("../config.ts");
		const getters = [
			"getFreeOnly",
			"getOpenrouterApiKey",
			"getKiloShowPaid",
			"getClineShowPaid",
			"getZenmuxShowPaid",
			"getCrofaiShowPaid",
			"getOllamaShowPaid",
			"getOpenrouterShowPaid",
			"getOpencodeShowPaid",
			"getProviderShowPaid",
			"getMistralApiKey",
			"getGroqApiKey",
			"getCerebrasApiKey",
			"getXaiApiKey",
			"getHfToken",
			"getZenmuxApiKey",
			"getCrofaiApiKey",
			"getOllamaApiKey",
			"saveConfig",
			"getConfig",
			"applyHidden",
		];
		for (const name of getters) {
			expect(typeof (cfg as any)[name]).toBe("function");
		}
	});
});
