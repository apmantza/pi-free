/**
 * #603: the toggle flip must resolve from the LOCKED config read, not from
 * the memoized parse.
 *
 * Two rapid toggles each used to resolve the flip (a memoized
 * loadConfigFile() read) before awaiting their write, so both read the same
 * pre-write state and collapsed to one net flip. toggleModelViewOverride
 * resolves inside updateConfig's updater, which reads the file itself.
 *
 * This suite keeps the mtime memo LIVE (unlike config.test.ts, whose mocked
 * fs makes statSync throw and bypasses the cache), so a stale memo is
 * observable: a concurrent writer updates the file without bumping the
 * cached mtime, exactly as a missed invalidation does in production.
 */
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => {
	const mockData = new Map<string, string>();
	const mockMtime = new Map<string, number>();
	return {
		appendFileSync: vi.fn(),
		chmodSync: vi.fn(),
		createWriteStream: vi.fn(() => ({
			write: vi.fn(),
			on: vi.fn(),
			end: vi.fn(),
		})),
		copyFileSync: vi.fn(),
		existsSync: vi.fn((path: string) => mockData.has(path)),
		mkdirSync: vi.fn(),
		readFileSync: vi.fn((path: string) => mockData.get(path) ?? ""),
		statSync: vi.fn((path: string) => {
			if (!mockData.has(path)) {
				const err = new Error("ENOENT") as Error & { code: string };
				err.code = "ENOENT";
				throw err;
			}
			return { mtimeMs: mockMtime.get(path) ?? 0 };
		}),
		writeFileSync: vi.fn((path: string, content: string) => {
			mockData.set(path, content);
			mockMtime.set(path, (mockMtime.get(path) ?? 0) + 1);
		}),
		__mockData: mockData,
		__mockMtime: mockMtime,
	};
});

function configPath(): string {
	const home = process.env.HOME || process.env.USERPROFILE || "";
	return join(home, ".pi", "free.json");
}

describe("atomic toggle resolves from the locked read (#603)", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.stubEnv("HOME", "/tmp");
	});

	it("flips from the on-disk state even when the memo is stale", async () => {
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(configPath(), JSON.stringify({ free_only: true }));

		const { loadConfigFile, toggleModelViewOverride } =
			await import("../config.ts");
		// Prime the memo with the initial state (mtime 0).
		expect(loadConfigFile().model_view_overrides).toBeUndefined();

		// A concurrent writer moves the choice to "all" WITHOUT a mtime bump,
		// so the memo stays stale — the production hazard the fix removes.
		__mockData.set(
			configPath(),
			JSON.stringify({
				free_only: true,
				model_view_overrides: { kilo: "all" },
			}),
		);

		// Must flip the FRESH state (all -> free), not the stale memo (free -> all).
		await expect(toggleModelViewOverride("kilo")).resolves.toBe("free");
	});

	// The memo-stale case above is the PIN (it reds when the flip reads
	// the memoized cache). This one asserts the user-visible outcome:
	// two toggles are two flips, not one collapsed flip.
	it("two concurrent toggles produce two distinct flips", async () => {
		const fs = await import("node:fs");
		const { __mockData } = fs as any;
		__mockData.set(configPath(), JSON.stringify({ free_only: true }));

		const { toggleModelViewOverride } = await import("../config.ts");
		const applied = await Promise.all([
			toggleModelViewOverride("kilo"),
			toggleModelViewOverride("kilo"),
		]);
		expect([...applied].sort()).toEqual(["all", "free"]);
	});
});
