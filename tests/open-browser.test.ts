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
	it("uses single-quoted -FilePath on Windows to prevent PowerShell injection", () => {
		const original = process.platform;
		Object.defineProperty(process, "platform", { value: "win32" });
		try {
			openBrowser("https://example.com/$(calc)");
			expect(spawn).toHaveBeenCalledOnce();
			const args = vi.mocked(spawn).mock.calls[0][1] as string[];
			expect(args).toContain("-Command");
			expect(args[args.length - 1]).toBe(
				"Start-Process -FilePath 'https://example.com/$(calc)'",
			);
		} finally {
			Object.defineProperty(process, "platform", { value: original });
		}
	});

	it("doubles embedded single quotes in URL on Windows", () => {
		const original = process.platform;
		Object.defineProperty(process, "platform", { value: "win32" });
		try {
			openBrowser("https://example.com/it'cool");
			expect(spawn).toHaveBeenCalledOnce();
			const args = vi.mocked(spawn).mock.calls[0][1] as string[];
			expect(args[args.length - 1]).toBe(
				"Start-Process -FilePath 'https://example.com/it''cool'",
			);
		} finally {
			Object.defineProperty(process, "platform", { value: original });
		}
	});
});
