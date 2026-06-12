import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
	return {
		...(await importOriginal()),
		spawn: vi.fn().mockReturnValue({ unref: vi.fn() }),
	};
});

import { spawn } from "node:child_process";
import { openBrowser } from "../lib/open-browser.ts";

describe("openBrowser", () => {
	beforeEach(() => {
		vi.mocked(spawn).mockClear();
	});

	it("uses cmd /c start with empty title and URL as separate arg on Windows", () => {
		const original = process.platform;
		Object.defineProperty(process, "platform", { value: "win32" });
		try {
			openBrowser("https://example.com/$(calc)");
			expect(spawn).toHaveBeenCalledOnce();
			const args = vi.mocked(spawn).mock.calls[0][1] as string[];
			// The URL must be a single, separate argument — never interpolated
			// into a command string. This is what prevents shell injection.
			expect(args).toEqual(["/c", "start", "", "https://example.com/$(calc)"]);
		} finally {
			Object.defineProperty(process, "platform", { value: original });
		}
	});

	it("preserves single quotes in URL on Windows without escaping", () => {
		const original = process.platform;
		Object.defineProperty(process, "platform", { value: "win32" });
		try {
			openBrowser("https://example.com/it'cool");
			expect(spawn).toHaveBeenCalledOnce();
			const args = vi.mocked(spawn).mock.calls[0][1] as string[];
			expect(args[args.length - 1]).toBe("https://example.com/it'cool");
		} finally {
			Object.defineProperty(process, "platform", { value: original });
		}
	});

	it("uses cmd /c start with shell: false on Windows", () => {
		const original = process.platform;
		Object.defineProperty(process, "platform", { value: "win32" });
		try {
			openBrowser("https://example.com/");
			const opts = vi.mocked(spawn).mock.calls[0][2] as Record<string, unknown>;
			expect(opts.shell).toBe(false);
		} finally {
			Object.defineProperty(process, "platform", { value: original });
		}
	});

	it("treats shell-metacharacter URLs as literal paths (no injection)", () => {
		const original = process.platform;
		Object.defineProperty(process, "platform", { value: "win32" });
		try {
			// Attempted injection: '; Start-Process calc.exe; '
			openBrowser("'; Start-Process calc.exe; '");
			const args = vi.mocked(spawn).mock.calls[0][1] as string[];
			// URL must be passed as a single, unmodified argument
			expect(args[args.length - 1]).toBe("'; Start-Process calc.exe; '");
			// No PowerShell command-string interpolation
			expect(args.join(" ")).not.toContain("Start-Process -FilePath");
		} finally {
			Object.defineProperty(process, "platform", { value: original });
		}
	});
});
