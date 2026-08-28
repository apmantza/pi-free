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
		chmodSync: vi.fn(),
		// Minimal no-op append stream so the (buffered) logger can open a stream
		// without touching the real filesystem during config tests.
		createWriteStream: vi.fn(() => ({
			write: vi.fn(),
			on: vi.fn(),
			end: vi.fn(),
		})),
		copyFileSync: vi.fn((src: string, dest: string) => {
			mockData.set(dest, mockData.get(src) ?? "");
		}),
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

function parseMockJson(value: unknown): Record<string, unknown> {
	try {
		if (typeof value !== "string") {
			throw new TypeError("mock JSON value is not a string");
		}
		const parsed: unknown = JSON.parse(value);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new TypeError("mock JSON value is not an object");
		}
		return parsed as Record<string, unknown>;
	} catch (error) {
		throw new Error(
			`Invalid mock JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
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

	it("getStepfunShowPaid defaults to true for the paid-only catalog", async () => {
		vi.stubEnv("HOME", "/tmp");
		const { getStepfunShowPaid } = await import("../config.ts");
		expect(getStepfunShowPaid()).toBe(true);
	});

	it("getStepfunShowPaid respects an explicit false setting", async () => {
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(configPath(), JSON.stringify({ stepfun_show_paid: false }));

		const { getStepfunShowPaid } = await import("../config.ts");
		expect(getStepfunShowPaid()).toBe(false);
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

	it("getKiroProfileArn returns undefined when neither env nor file is set", async () => {
		vi.stubEnv("HOME", "/tmp");
		const { getKiroProfileArn } = await import("../config.ts");
		expect(getKiroProfileArn()).toBeUndefined();
	});

	it("getKiroProfileArn reads from ~/.pi/free.json kiro_profile_arn", async () => {
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(
			configPath(),
			JSON.stringify({
				kiro_profile_arn:
					"arn:aws:codewhisperer:us-east-1:610548660232:profile/VNECVYCYYAWN",
			}),
		);

		const { getKiroProfileArn } = await import("../config.ts");
		expect(getKiroProfileArn()).toBe(
			"arn:aws:codewhisperer:us-east-1:610548660232:profile/VNECVYCYYAWN",
		);
	});

	it("getKiroProfileArn prefers KIRO_PROFILE_ARN env over file value", async () => {
		vi.stubEnv("HOME", "/tmp");
		vi.stubEnv(
			"KIRO_PROFILE_ARN",
			"arn:aws:codewhisperer:eu-central-1:12345:profile/ENV",
		);
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(
			configPath(),
			JSON.stringify({
				kiro_profile_arn: "arn:aws:codewhisperer:us-east-1:0000:profile/FILE",
			}),
		);

		const { getKiroProfileArn } = await import("../config.ts");
		expect(getKiroProfileArn()).toBe(
			"arn:aws:codewhisperer:eu-central-1:12345:profile/ENV",
		);
	});

	it("getKiroProfileArn returns undefined for an explicitly empty file value", async () => {
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(configPath(), JSON.stringify({ kiro_profile_arn: "" }));

		const { getKiroProfileArn } = await import("../config.ts");
		expect(getKiroProfileArn()).toBeUndefined();
	});

	it("getOpenrouterShowPaid reads from file", async () => {
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(configPath(), JSON.stringify({ openrouter_show_paid: true }));

		const { getOpenrouterShowPaid } = await import("../config.ts");
		expect(getOpenrouterShowPaid()).toBe(true);
	});

	it("getOpenrouterShowPaid defaults to false", async () => {
		vi.stubEnv("HOME", "/tmp");
		const { getOpenrouterShowPaid } = await import("../config.ts");
		expect(getOpenrouterShowPaid()).toBe(false);
	});

	it("getOpencodeFreeShowPaid reads its own key, not the shared opencode key", async () => {
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(
			configPath(),
			JSON.stringify({ opencode_show_paid: true, opencode_free_show_paid: false }),
		);

		const { getOpencodeFreeShowPaid } = await import("../config.ts");
		expect(getOpencodeFreeShowPaid()).toBe(false);
	});

	it("getOpencodeGoShowPaid reads its own key, not the shared opencode key", async () => {
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(
			configPath(),
			JSON.stringify({ opencode_show_paid: false, opencode_go_show_paid: true }),
		);

		const { getOpencodeGoShowPaid } = await import("../config.ts");
		expect(getOpencodeGoShowPaid()).toBe(true);
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

	it("getOpengatewayShowPaid reads from file", async () => {
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(configPath(), JSON.stringify({ opengateway_show_paid: true }));

		const { getOpengatewayShowPaid, getProviderShowPaid } = await import(
			"../config.ts"
		);
		expect(getOpengatewayShowPaid()).toBe(true);
		expect(getProviderShowPaid("opengateway")).toBe(true);
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

	it("getOpengatewayApiKey prefers the environment", async () => {
		vi.stubEnv("OPENGATEWAY_API_KEY", "env-key");
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(
			configPath(),
			JSON.stringify({ opengateway_api_key: "file-key" }),
		);

		const { getOpengatewayApiKey } = await import("../config.ts");
		expect(getOpengatewayApiKey()).toBe("env-key");
	});
});

// =============================================================================
// saveConfig / loadConfigFile
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
		await saveConfig({ free_only: false });

		const lastCall =
			writeFileSync.mock.calls[writeFileSync.mock.calls.length - 1];
		const written = parseMockJson(lastCall[1]);
		expect(written.free_only).toBe(false);
		expect(written.nvidia_api_key).toBe("existing");
	});

	it("saveConfig adds new fields while keeping existing", async () => {
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData, writeFileSync } = fs as any;
		__mockData.set(configPath(), JSON.stringify({ free_only: true }));

		const { saveConfig } = await import("../config.ts");
		await saveConfig({ nvidia_api_key: "new-key" });

		const lastCall =
			writeFileSync.mock.calls[writeFileSync.mock.calls.length - 1];
		const written = parseMockJson(lastCall[1]);
		expect(written.free_only).toBe(true);
		expect(written.nvidia_api_key).toBe("new-key");
	});
});

describe("updateConfig", () => {
	it("applies the updater to the current config and writes the merge", async () => {
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData, writeFileSync } = fs as any;
		__mockData.set(
			configPath(),
			JSON.stringify({ hidden_models: ["a/b"], nvidia_api_key: "keep" }),
		);

		const { updateConfig } = await import("../config.ts");
		await updateConfig((cfg) => ({
			hidden_models: [...(cfg.hidden_models ?? []), "c/d"],
		}));

		const lastCall =
			writeFileSync.mock.calls[writeFileSync.mock.calls.length - 1];
		const written = parseMockJson(lastCall[1]);
		expect(written.hidden_models).toEqual(["a/b", "c/d"]);
		expect(written.nvidia_api_key).toBe("keep");
	});

	it("serialises concurrent updates so they don't clobber each other", async () => {
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(configPath(), JSON.stringify({ hidden_models: ["initial"] }));

		const { updateConfig } = await import("../config.ts");
		// Simulate two providers' probes updating hidden_models concurrently
		await Promise.all([
			updateConfig((cfg) => ({
				hidden_models: [...(cfg.hidden_models ?? []), "deepinfra/x"],
			})),
			updateConfig((cfg) => ({
				hidden_models: [...(cfg.hidden_models ?? []), "novita/y"],
			})),
		]);

		// Read the final state of the file
		const finalRaw = __mockData.get(configPath());
		const final = parseMockJson(finalRaw);
		// Both updates must be present, in some order
		expect(final.hidden_models).toContain("initial");
		expect(final.hidden_models).toContain("deepinfra/x");
		expect(final.hidden_models).toContain("novita/y");
		expect(final.hidden_models).toHaveLength(3);
	});

	it("backs up a corrupt config file and applies the update to a fresh template", async () => {
		vi.stubEnv("HOME", "/tmp");
		const fs = await import("node:fs");
		const { __mockData, copyFileSync } = fs as any;
		__mockData.set(configPath(), "not json {{{");

		const { updateConfig } = await import("../config.ts");
		await updateConfig(() => ({ nvidia_api_key: "recovered-write" }));

		// Original bytes preserved in a timestamped backup
		const backupCall = copyFileSync.mock.calls.at(-1);
		expect(backupCall).toBeDefined();
		expect(backupCall[0]).toBe(configPath());
		expect(String(backupCall[1])).toContain(".bak-");
		expect(__mockData.get(backupCall[1])).toBe("not json {{{");

		// The update proceeds against a fresh template
		const written = parseMockJson(__mockData.get(configPath()));
		expect(written.nvidia_api_key).toBe("recovered-write");
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
			"getOpencodeFreeShowPaid",
			"getOpencodeGoShowPaid",
			"getProviderShowPaid",
			"getZenmuxApiKey",
			"getCrofaiApiKey",
			"getOllamaApiKey",
			"saveConfig",
			"updateConfig",
			"applyHidden",
		];
		for (const name of getters) {
			expect(typeof (cfg as any)[name]).toBe("function");
		}
	});
});
