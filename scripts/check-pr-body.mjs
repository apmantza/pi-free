import { readFileSync } from "node:fs";

// Minimal structural contract for PR bodies (advisory): a body must exist
// and must contain at least one section heading, so the change is described
// in prose, not just a title. Deeper template rules (required sections,
// answered questions) belong to heavier repos; here the title check carries
// the gating weight and this stays a nudge.
const SECTION_HEADING = /^##\s+\S+/m;

export const EMPTY_BODY_MESSAGE =
	"PR body is empty. Describe what changed and why, with at least one ## section.";

export const NO_SECTION_MESSAGE =
	"PR body has no ## section. Structure the description with at least one ## heading (e.g. ## What).";

/**
 * Lint a PR body against the minimal structural contract. Pure function
 * so it is unit-testable without a GitHub event payload. Fenced code
 * blocks are ignored — a ## inside a code sample is not a section.
 */
export function lintPrBody(body = "") {
	const errors = [];
	const source = String(body ?? "");
	if (source.trim().length === 0) {
		errors.push(EMPTY_BODY_MESSAGE);
		return { valid: false, errors };
	}
	const withoutFences = source
		.split(/```/)
		.filter((_, index) => index % 2 === 0)
		.join("");
	if (!SECTION_HEADING.test(withoutFences)) {
		errors.push(NO_SECTION_MESSAGE);
	}
	return { valid: errors.length === 0, errors };
}

function readEventBody() {
	try {
		const eventPath = process.env.GITHUB_EVENT_PATH;
		if (!eventPath) return null;
		const payload = JSON.parse(readFileSync(eventPath, "utf8"));
		return payload?.pull_request?.body ?? null;
	} catch {
		return null;
	}
}

const body = process.argv[2] ?? readEventBody() ?? "";
const { valid, errors } = lintPrBody(body);
if (!valid) {
	for (const error of errors) console.error(`PR body check: ${error}`);
	process.exit(1);
}
console.log("PR body ok.");
