import { describe, expect, it } from "vitest";
import {
	DEFAULT,
	GPT_OSS,
	NO_OFF,
	QWEN3,
	resolveThinkingMap,
} from "../providers/ollama/thinking-levels.ts";

describe("Thinking Level Maps", () => {
	describe("resolveThinkingMap", () => {
		it("returns undefined for non-thinking models", () => {
			expect(resolveThinkingMap("glm-5.1", ["tools"])).toBeUndefined();
			expect(resolveThinkingMap("gemma4:31b", [])).toBeUndefined();
		});

		// ── DEFAULT map ────────────────────────────────────────
		it("returns DEFAULT for most thinking models", () => {
			const map = resolveThinkingMap("deepseek-v4-pro", ["thinking", "tools"]);
			expect(map).toBe(DEFAULT);
			expect(map?.off).toBe("none");
			expect(map?.xhigh).toBe("max");
		});

		it("DEFAULT hides minimal level", () => {
			expect(DEFAULT.minimal).toBeNull();
		});

		// ── GPT_OSS map ────────────────────────────────────────
		it("returns GPT_OSS for gpt-oss models", () => {
			const map = resolveThinkingMap("gpt-oss:120b", ["thinking", "tools"]);
			expect(map).toBe(GPT_OSS);
		});

		it("GPT_OSS has no off or xhigh", () => {
			expect(GPT_OSS.off).toBeNull();
			expect(GPT_OSS.xhigh).toBeNull();
		});

		it("GPT_OSS supports low/medium/high", () => {
			expect(GPT_OSS.low).toBe("low");
			expect(GPT_OSS.medium).toBe("medium");
			expect(GPT_OSS.high).toBe("high");
		});

		// ── QWEN3 map ──────────────────────────────────────────
		it("returns QWEN3 for qwen3 non-VL models", () => {
			const map = resolveThinkingMap("qwen3.5", ["thinking", "tools"]);
			expect(map).toBe(QWEN3);
		});

		it("QWEN3 is binary — only off and medium", () => {
			expect(QWEN3.off).toBe("none");
			expect(QWEN3.medium).toBe("medium");
			expect(QWEN3.low).toBeNull();
			expect(QWEN3.high).toBeNull();
			expect(QWEN3.xhigh).toBeNull();
		});

		// ── NO_OFF map ─────────────────────────────────────────
		it("returns NO_OFF for qwen3-vl models (takes priority over QWEN3)", () => {
			const map = resolveThinkingMap("qwen3-vl:235b", ["thinking", "tools"]);
			expect(map).toBe(NO_OFF);
		});

		it("returns NO_OFF for kimi-k2-thinking specifically", () => {
			const map = resolveThinkingMap("kimi-k2-thinking", ["thinking", "tools"]);
			expect(map).toBe(NO_OFF);
		});

		it("returns DEFAULT for other kimi models (kimi-k2.5, kimi-k2.6)", () => {
			expect(resolveThinkingMap("kimi-k2.5", ["thinking", "tools"])).toBe(
				DEFAULT,
			);
			expect(resolveThinkingMap("kimi-k2.6", ["thinking", "tools"])).toBe(
				DEFAULT,
			);
		});

		it("returns NO_OFF for minimax models", () => {
			expect(resolveThinkingMap("minimax-m2.1", ["thinking", "tools"])).toBe(
				NO_OFF,
			);
			expect(resolveThinkingMap("minimax-m2.5", ["thinking", "tools"])).toBe(
				NO_OFF,
			);
		});

		it("NO_OFF has no off but supports all other levels", () => {
			expect(NO_OFF.off).toBeNull();
			expect(NO_OFF.low).toBe("low");
			expect(NO_OFF.medium).toBe("medium");
			expect(NO_OFF.high).toBe("high");
			expect(NO_OFF.xhigh).toBe("max");
		});

		// ── Edge cases ─────────────────────────────────────────
		it("handles model IDs with colons", () => {
			expect(resolveThinkingMap("gpt-oss:20b", ["thinking", "tools"])).toBe(
				GPT_OSS,
			);
		});

		it("prefix matching is case-sensitive", () => {
			// "GPT-OSS" (uppercase) should NOT match gpt-oss prefix check
			const map = resolveThinkingMap("GPT-OSS:20b", ["thinking", "tools"]);
			// startsWith is case-sensitive, so this falls through to DEFAULT
			expect(map).toBe(DEFAULT);
		});

		it("qwen3-vl prefix check takes priority over qwen3", () => {
			// qwen3-vl must be checked before qwen3
			const map = resolveThinkingMap("qwen3-vl:235b", ["thinking", "tools"]);
			expect(map).toBe(NO_OFF);
			expect(map).not.toBe(QWEN3);
		});
	});
});
