/**
 * Source-scanning support for test-side detectors.
 *
 * Two guards need to look for text in source files: `tests/qoder-omp-compat.test.ts`
 * (no static value import of pi-ai's compat entry) and
 * `tests/worker-thread-safety.test.ts` (no worker-hostile `process` calls). Both
 * would be broken by prose: pi-free's own source *quotes* the very strings they
 * look for, in comments explaining why those patterns are banned. A comment
 * quoting a needle must never satisfy a requirement, and must never trip one.
 *
 * A real parser would settle this by construction, but the installed
 * `typescript` is the 7.x native port whose JS API is absent — `createSourceFile`,
 * `isCallExpression` and `ScriptTarget` are all `undefined` (the same reason
 * `stryker.config.mjs` avoids Stryker's tsconfig preprocessor). So this is a
 * single-pass lexer that blanks every comment and literal while preserving
 * offsets, and both directions matter:
 *
 *   - prose must not trip a scan (false positive: reds loudly, wastes a round);
 *   - code must not be hidden by over-blanking (false negative: the dangerous
 *     direction — a real needle silently escaping the guard).
 *
 * Handled: `//` and block comments, `'`/`"` strings, template literals, and
 * regex literals. Interpolations inside a template (`` `${…}` ``) recurse as
 * code, so a call inside one is still scanned. Unterminated `'`/`"` strings
 * stop at the newline rather than swallowing the rest of the file.
 *
 * Regex literals are the one heuristic: telling `/` from division needs the
 * preceding token. This tree really contains quote-bearing regexes
 * (`scripts/check-runtime-imports.mjs` matches `(["'])`), so a naive
 * quote-first scan would blank the code after one — which is exactly the
 * false-negative direction above.
 */

/** Characters that can precede a regex literal (`x = /re/`) but never division. */
const REGEX_PREFIX_CHARS = new Set([
	"(",
	",",
	"=",
	":",
	"[",
	"!",
	"&",
	"|",
	"?",
	"{",
	"}",
	";",
	"+",
	"-",
	"*",
	"%",
	"~",
	"^",
	"<",
	">",
]);

/** Keywords that can precede a regex literal (`return /re/`) but never division. */
const REGEX_PREFIX_KEYWORDS = new Set([
	"return",
	"typeof",
	"instanceof",
	"in",
	"of",
	"do",
	"else",
	"case",
	"void",
	"delete",
	"throw",
	"new",
	"yield",
	"await",
]);

const isWordChar = (ch: string | undefined): boolean =>
	ch !== undefined && /[A-Za-z0-9_$]/.test(ch);

/** Index just past a `'`/`"` string, stopping at a newline if unterminated. */
function endOfQuoted(source: string, start: number): number {
	const quote = source[start];
	let i = start + 1;
	while (i < source.length) {
		const ch = source[i];
		if (ch === "\\") {
			i += 2;
			continue;
		}
		if (ch === quote) return i + 1;
		if (ch === "\n") return i;
		i += 1;
	}
	return source.length;
}

/** Index just past a `/re/flags` literal, stopping at a newline if unterminated. */
function endOfRegex(source: string, start: number): number {
	let i = start + 1;
	let inClass = false;
	while (i < source.length) {
		const ch = source[i];
		if (ch === "\\") {
			i += 2;
			continue;
		}
		if (ch === "\n") return i;
		if (ch === "[") inClass = true;
		else if (ch === "]") inClass = false;
		else if (ch === "/" && !inClass) {
			i += 1;
			while (i < source.length && isWordChar(source[i])) i += 1;
			return i;
		}
		i += 1;
	}
	return source.length;
}

/**
 * Blanks comments and literals in `source`, replacing every blanked character
 * with a space and keeping newlines so offsets and line numbers stay valid.
 * Interpolated code inside template literals is left visible.
 */
export function blankNonCode(source: string): string {
	const out = source.split("");

	/** Overwrites `[from, to)` with spaces, preserving line breaks and length. */
	const blank = (from: number, to: number): void => {
		const stop = Math.min(to, out.length);
		for (let k = Math.max(from, 0); k < stop; k++) {
			if (out[k] !== "\n") out[k] = " ";
		}
	};

	// Blanks a template literal's *literal text* and returns the index just past
	// it, leaving `${…}` interpolations visible so code inside them is scanned.
	// Callers must not re-blank the returned span (that would erase the code).
	function skipTemplate(start: number): number {
		blank(start, start + 1); // opening backtick
		let i = start + 1;
		let textStart = i;
		while (i < source.length) {
			const ch = source[i];
			if (ch === "\\") {
				i += 2;
				continue;
			}
			if (ch === "`") {
				blank(textStart, i);
				blank(i, i + 1); // closing backtick
				return i + 1;
			}
			if (ch === "$" && source[i + 1] === "{") {
				blank(textStart, i);
				const close = skipInterpolation(i + 2);
				blank(i, i + 2); // the `${`
				blank(close, close + 1); // the `}`
				i = close + 1;
				textStart = i;
				continue;
			}
			i += 1;
		}
		blank(textStart, i); // unterminated: blank to EOF
		return source.length;
	}

	// Walks code, returning the index of the `}` that closes the `${` at
	// `start`. Used for template interpolations, which hold code, not text.
	function skipInterpolation(start: number): number {
		// Depth starts at 1: the `${` itself opened a brace, so the matching
		// `}` is the one that brings depth back to zero.
		let depth = 1;
		let i = start;
		while (i < source.length) {
			const ch = source[i];
			const next = source[i + 1];
			if (ch === "/" && next === "/") {
				const end = source.indexOf("\n", i);
				const stop = end === -1 ? source.length : end;
				blank(i, stop); // comments are blanked here too, for consistency
				i = stop;
				continue;
			}
			if (ch === "/" && next === "*") {
				const end = source.indexOf("*/", i + 2);
				const stop = end === -1 ? source.length : end + 2;
				blank(i, stop);
				i = stop;
				continue;
			}
			if (ch === "'" || ch === '"') {
				i = endOfQuoted(source, i);
				continue;
			}
			if (ch === "`") {
				i = skipTemplate(i);
				continue;
			}
			if (ch === "{") depth += 1;
			if (ch === "}") {
				depth -= 1;
				if (depth === 0) return i;
			}
			i += 1;
		}
		return source.length;
	}

	let lastSignificant = "";
	let lastWord = "";
	let i = 0;
	while (i < source.length) {
		const ch = source[i]!;
		const next = source[i + 1];

		if (ch === "/" && next === "/") {
			const end = source.indexOf("\n", i);
			const stop = end === -1 ? source.length : end;
			blank(i, stop);
			i = stop;
			continue;
		}

		if (ch === "/" && next === "*") {
			const end = source.indexOf("*/", i + 2);
			const stop = end === -1 ? source.length : end + 2;
			blank(i, stop);
			i = stop;
			continue;
		}

		if (ch === "'" || ch === '"') {
			const stop = endOfQuoted(source, i);
			blank(i, stop);
			i = stop;
			lastSignificant = ch;
			lastWord = "";
			continue;
		}

		if (ch === "`") {
			// skipTemplate blanks the literal text itself; re-blanking the whole
			// span here would erase any interpolation it deliberately preserved.
			i = skipTemplate(i);
			lastSignificant = ch;
			lastWord = "";
			continue;
		}

		if (
			ch === "/" &&
			(lastSignificant === "" ||
				REGEX_PREFIX_CHARS.has(lastSignificant) ||
				REGEX_PREFIX_KEYWORDS.has(lastWord))
		) {
			const stop = endOfRegex(source, i);
			blank(i, stop);
			i = stop;
			lastSignificant = "/";
			lastWord = "";
			continue;
		}

		if (!/\s/.test(ch)) {
			if (isWordChar(ch)) {
				lastWord = isWordChar(source[i - 1]) ? lastWord + ch : ch;
			} else {
				lastWord = "";
			}
			lastSignificant = ch;
		}
		i += 1;
	}

	return out.join("");
}
