/**
 * Regression: Qoder must load on Oh My Pi's legacy pi-ai bundle.
 *
 * Shipped defect (PR #557 follow-up, refs #543): `providers/qoder/stream.ts`
 * statically imported `getCurrentSystemPrompt` / `getCurrentTools` from
 * `@earendil-works/pi-ai/compat`. OMP remaps pi-ai to its legacy bundle
 * (`omp-legacy-pi-bundled:@oh-my-pi/pi-ai`) which predates those exports, so
 * the whole extension failed at load with:
 *   Export named 'getCurrentSystemPrompt' not found in module
 *     'omp-legacy-pi-bundled:@oh-my-pi/pi-ai'
 * Recurrence: any future static *value* import of a post-legacy compat export
 * re-breaks OMP load. Qoder must read the transcript through the local
 * host-agnostic helpers (`lib/transcript-helpers.ts`) instead.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	getCurrentSystemPrompt as upstreamPrompt,
	getCurrentTools as upstreamTools,
	normalizeContext,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
	getCurrentSystemPrompt,
	getCurrentTools,
} from "../lib/transcript-helpers.ts";

/** Strip comments and string literals so prose can never satisfy the scan. */
function blanked(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/\/\/[^\n]*/g, " ")
		.replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
		.replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
		.replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

describe("Qoder OMP legacy-compat", () => {
	it("has no static value import from pi-ai compat (type-only is fine)", () => {
		const raw = readFileSync(
			join(__dirname, "../providers/qoder/stream.ts"),
			"utf-8",
		);
		// Value imports from the compat entry point resolve at load time on the
		// host; a missing export (legacy OMP bundle) takes the extension down.
		// `import type` is erased at compile time and always safe. The
		// specifier is a string literal, so this needle is checked on the
		// raw source (not the blanked text).
		const valueImports = raw.match(
			/import\s+(?!type\b)[^;]*?from\s*["']@earendil-works\/pi-ai\/compat["']/g,
		);
		expect(valueImports).toBeNull();
		// The transcript helpers must come from the host-agnostic local
		// module. Checked on blanked text so a comment quoting the path
		// can never satisfy it.
		const source = blanked(raw);
		expect(source).toMatch(/getCurrentSystemPrompt/);
		expect(source).toMatch(/getCurrentTools/);
		expect(raw).toContain("lib/transcript-helpers");
	});

	it("local prompt helper matches upstream incl. sections replay", () => {
		const context = normalizeContext({
			systemPrompt: "BASE",
			tools: [],
			messages: [
				{
					role: "system",
					content: "extra",
					sections: { s1: "SEC-ONE" },
					timestamp: 2,
				},
				{ role: "user", content: "hi", timestamp: 3 },
				{
					role: "system",
					content: "",
					sections: { s1: null, s2: "SEC-TWO" },
					timestamp: 4,
				},
			],
		} as never);
		const messages = (context as unknown as { messages: never[] }).messages;
		expect(getCurrentSystemPrompt(messages as never)).toBe(
			upstreamPrompt(messages as never),
		);
		expect(getCurrentSystemPrompt(messages as never)).toBe(
			"BASE\n\nextra\n\nSEC-TWO",
		);
	});

	it("local tools helper matches upstream add/remove replay", () => {
		const read = {
			name: "read",
			description: "r",
			parameters: { type: "object" },
		};
		const write = {
			name: "write",
			description: "w",
			parameters: { type: "object" },
		};
		const context = normalizeContext({
			systemPrompt: "SYS",
			tools: [read],
			messages: [
				{
					role: "system",
					content: "",
					toolsAdded: [write],
					toolsRemoved: [{ name: "read" }],
					timestamp: 2,
				},
			],
		} as never);
		const messages = (context as unknown as { messages: never[] }).messages;
		const local = getCurrentTools(messages as never) as Array<{ name: string }>;
		const upstream = upstreamTools(messages as never) as Array<{
			name: string;
		}>;
		expect(local.map((t) => t.name)).toEqual(upstream.map((t) => t.name));
		expect(local.map((t) => t.name)).toEqual(["write"]);
	});
});
