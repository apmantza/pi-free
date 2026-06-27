// Shared CHANGELOG.md parsing/extraction helpers (Keep a Changelog format).
//
// One source of truth: the curated CHANGELOG section for a version IS the body
// of its GitHub release. `changelog-extract.mjs` (release workflow) builds on
// these pure functions so the parsing rules stay identical everywhere.

/** A version heading looks like `## [2.2.4] - 2026-06-27` or `## [Unreleased]`. */
const VERSION_HEADING = /^## \[([^\]]+)\]/;

/**
 * Split a CHANGELOG into ordered sections. Each entry is the bracketed label
 * (e.g. `2.2.4`, `Unreleased`) plus the raw body between this heading and the
 * next `## ` heading (heading line excluded, surrounding blank lines trimmed).
 *
 * @param {string} text full CHANGELOG.md contents
 * @returns {Array<{ label: string, heading: string, body: string }>}
 */
export function parseSections(text) {
	const lines = text.split(/\r?\n/);
	const sections = [];
	let current = null;
	for (const line of lines) {
		const m = line.match(VERSION_HEADING);
		if (m) {
			if (current) sections.push(finalize(current));
			current = { label: m[1].trim(), heading: line, bodyLines: [] };
			continue;
		}
		if (current) current.bodyLines.push(line);
	}
	if (current) sections.push(finalize(current));
	return sections;
}

function finalize(current) {
	return {
		label: current.label,
		heading: current.heading,
		body: current.bodyLines
			.join("\n")
			.replace(/^\n+/, "")
			.replace(/\s+$/, ""),
	};
}

/**
 * Condense a section body into scannable release notes: keep the `### Added/
 * Changed/Fixed` subheadings and each entry's bold title, but trim the entry to
 * a single short gist (first sentence, length-capped). The full prose stays in
 * CHANGELOG.md; this is what the GitHub release body shows.
 *
 * @param {string} body a section body from extractSection()
 * @param {{ maxGist?: number }} [opts]
 * @returns {string}
 */
export function summarizeSection(body, opts = {}) {
	const maxGist = opts.maxGist ?? 130;
	const order = [];
	const buckets = new Map();
	let heading = null;
	for (const raw of body.split(/\r?\n/)) {
		const line = raw.trimEnd();
		const h = line.match(/^#{2,4}\s+(.*)$/);
		if (h) {
			heading = h[1].trim();
			if (!buckets.has(heading)) {
				buckets.set(heading, []);
				order.push(heading);
			}
			continue;
		}
		const m = line.match(/^- (\*\*.+?\*\*)\s*(.*)$/);
		if (!m || heading === null) continue;
		const gist = cleanGist(m[2], maxGist);
		buckets.get(heading).push(gist ? `- ${m[1]} — ${gist}` : `- ${m[1]}`);
	}
	const out = [];
	for (const h of order) {
		const items = buckets.get(h);
		if (!items.length) continue;
		out.push(`### ${h}`, "", ...items, "");
	}
	return out.join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
}

function cleanGist(rest, maxGist) {
	const text = rest
		.replace(/^\s*\((?:refs?|closes?|fixes?)?\s*#\d+\)\s*/i, "")
		.replace(/^\s*[—–:-]\s*/, "")
		.trim();
	if (!text) return "";
	const period = text.search(/\.\s/);
	const first = period >= 0 ? text.slice(0, period) : text;
	return first.length > 0 && first.length <= maxGist ? first : "";
}

/**
 * Normalize a tag/version to its bare semver form: `v2.2.4` -> `2.2.4`.
 * @param {string} version
 */
export function normalizeVersion(version) {
	return String(version).trim().replace(/^v/i, "");
}

/**
 * Return the curated release-notes body for a version (heading excluded), or
 * `null` if no matching `## [version]` section exists.
 *
 * @param {string} text full CHANGELOG.md contents
 * @param {string} version e.g. "2.2.4" or "v2.2.4"
 * @returns {string | null}
 */
export function extractSection(text, version) {
	const want = normalizeVersion(version);
	const section = parseSections(text).find(
		(s) => normalizeVersion(s.label) === want,
	);
	return section ? section.body : null;
}

/** True if the CHANGELOG has a non-empty section for this version. */
export function hasSection(text, version) {
	const body = extractSection(text, version);
	return typeof body === "string" && body.trim().length > 0;
}
