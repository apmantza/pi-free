import { readFileSync } from "node:fs";

// Repo convention: conventional-commit-style prefix, then an issue
// reference, BOTH IN THE TITLE. Merges are merge commits from the PR title,
// so a malformed title becomes the permanent commit subject — catch it
// before merge, not after. A ref that lives only in the body doesn't
// survive into the merge-commit subject line, so it doesn't satisfy the
// convention: the body is never consulted here, on purpose.
const CONVENTIONAL_PREFIX =
	/^(feat|fix|chore|docs|refactor|test|ci|perf)(\([^)]+\))?: .+/;
const ISSUE_REF = /#\d+/;

export const MISSING_PREFIX_MESSAGE =
	'PR title must start with a conventional prefix and a colon, for example "fix: repair the widget cache (refs #123)". ' +
	"Allowed prefixes: feat, fix, chore, docs, refactor, test, ci, perf.";

export const MISSING_ISSUE_REF_MESSAGE =
	'PR title must reference an issue (e.g. "#123"). Use "Closes #123" when the PR fully resolves the issue, or "Refs #123" when work remains. A reference in the PR body alone does not count — the title becomes the merge-commit subject.';

/**
 * Lint a PR title against the repo's conventional-prefix + issue-ref
 * convention. Both requirements are checked against the TITLE ONLY.
 * Pure function so it is unit-testable without a GitHub event payload.
 */
export function lintPrTitle(title = "") {
	const errors = [];
	if (!CONVENTIONAL_PREFIX.test(title.trim())) {
		errors.push(MISSING_PREFIX_MESSAGE);
	}
	if (!ISSUE_REF.test(title)) {
		errors.push(MISSING_ISSUE_REF_MESSAGE);
	}
	return { valid: errors.length === 0, errors };
}

function readEventTitle() {
	try {
		const eventPath = process.env.GITHUB_EVENT_PATH;
		if (!eventPath) return null;
		const payload = JSON.parse(readFileSync(eventPath, "utf8"));
		return payload?.pull_request?.title ?? null;
	} catch {
		return null;
	}
}

const title = process.argv[2] ?? readEventTitle() ?? "";
const { valid, errors } = lintPrTitle(title);
if (!valid) {
	for (const error of errors) console.error(`PR title check failed: ${error}`);
	console.error(`Checked title: ${JSON.stringify(title)}`);
	process.exit(1);
}
console.log(`PR title ok: ${JSON.stringify(title)}`);
