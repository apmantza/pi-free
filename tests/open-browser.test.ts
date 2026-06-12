import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

	it("uses rundll32 + url.dll on Windows to bypass cmd's command parser", () => {
		const original = process.platform;
		Object.defineProperty(process, "platform", { value: "win32" });
		try {
			openBrowser("https://example.com/$(calc)");
			expect(spawn).toHaveBeenCalledOnce();
			const [cmd, args, opts] = vi.mocked(spawn).mock.calls[0];
			// rundll32 is the launcher — bypasses cmd's command parser
			expect(cmd).toMatch(/rundll32/i);
			// URL is a single, separate argument — never interpolated
			expect(args).toEqual([
				"url.dll,FileProtocolHandler",
				"https://example.com/$(calc)",
			]);
			// shell: false is set so Node doesn't wrap in a shell
			expect(opts).toMatchObject({ shell: false });
		} finally {
			Object.defineProperty(process, "platform", { value: original });
		}
	});

	it("does NOT go through cmd.exe (avoids cmd's metacharacter parser)", () => {
		const original = process.platform;
		Object.defineProperty(process, "platform", { value: "win32" });
		try {
			openBrowser("https://example.com/");
			const [cmd, args] = vi.mocked(spawn).mock.calls[0];
			// The launcher must be rundll32, NOT cmd.exe
			expect(cmd).not.toMatch(/cmd/i);
			// And there must be no /c start "" in the args
			expect(args).not.toContain("/c");
			expect(args).not.toContain("start");
		} finally {
			Object.defineProperty(process, "platform", { value: original });
		}
	});

	it("preserves single quotes and shell metacharacters in URL without escaping", () => {
		const original = process.platform;
		Object.defineProperty(process, "platform", { value: "win32" });
		try {
			openBrowser("https://example.com/it'cool&echo pwned");
			expect(spawn).toHaveBeenCalledOnce();
			const args = vi.mocked(spawn).mock.calls[0][1] as string[];
			expect(args[args.length - 1]).toBe(
				"https://example.com/it'cool&echo pwned",
			);
		} finally {
			Object.defineProperty(process, "platform", { value: original });
		}
	});

	describe("URL validation", () => {
		let original: string;
		beforeEach(() => {
			original = process.platform;
			Object.defineProperty(process, "platform", { value: "win32" });
		});
		afterEach(() => {
			Object.defineProperty(process, "platform", { value: original });
		});

		it("rejects non-http(s) protocols (e.g. file://, javascript:)", () => {
			expect(openBrowser("file:///c:/Windows/System32/calc.exe")).toBe(false);
			expect(openBrowser("javascript:alert(1)")).toBe(false);
			expect(spawn).not.toHaveBeenCalled();
		});

		it("rejects URLs with control characters (NUL, CR, LF)", () => {
			expect(openBrowser("https://example.com/\n")).toBe(false);
			expect(openBrowser("https://example.com/\r\n")).toBe(false);
			expect(openBrowser("https://example.com/\x00")).toBe(false);
			expect(openBrowser("https://example.com/\x1b[31m")).toBe(false);
			expect(spawn).not.toHaveBeenCalled();
		});

		it("rejects malformed URLs", () => {
			expect(openBrowser("not a url")).toBe(false);
			expect(openBrowser("")).toBe(false);
			expect(spawn).not.toHaveBeenCalled();
		});

		it("rejects excessively long URLs (>2048 chars)", () => {
			const long = `https://example.com/${"a".repeat(2100)}`;
			expect(openBrowser(long)).toBe(false);
			expect(spawn).not.toHaveBeenCalled();
		});

		it("returns true for valid http/https URLs", () => {
			expect(openBrowser("https://example.com/")).toBe(true);
			expect(openBrowser("http://example.com/path?q=1")).toBe(true);
			expect(spawn).toHaveBeenCalled();
		});
	});
});
