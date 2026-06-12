import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "pi-free-provider-cache-test-"));

describe("provider cache", () => {
	beforeEach(() => {
		if (existsSync(join(tempDir, "provider-cache.json"))) {
			unlinkSync(join(tempDir, "provider-cache.json"));
		}
		// Point HOME at the temp dir so PI_DATA_DIR resolves inside it.
		process.env.HOME = tempDir;
		process.env.USERPROFILE = tempDir;
		delete process.env.PI_FREE_PROVIDER_CACHE;
		vi.resetModules();
	});

	afterEach(() => {
		delete process.env.HOME;
		delete process.env.USERPROFILE;
	});

	it("returns a copy of cached models so callers cannot corrupt the cache", async () => {
		const { saveProviderCache, loadProviderCache } = await import(
			"../lib/provider-cache.ts"
		);
		const model = {
			id: "m1",
			name: "Model 1",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 4096,
			maxTokens: 2048,
		};
		await saveProviderCache("test", [model as any]);
		const models = loadProviderCache("test")!;
		models.pop();
		const models2 = loadProviderCache("test")!;
		expect(models2).toHaveLength(1);
	});
});
