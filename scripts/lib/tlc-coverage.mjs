/**
 * Parser for TLC's `-coverage` output (see `scripts/check-tlc.mjs --coverage`).
 *
 * Under `-coverage`, TLC prints a table of definitions with evaluation counts:
 *
 *   <FetchComplete line 94, col 1 to line 94, col 13 of module Toggle>: 2:8
 *   <TypeOK line 137, col 1 to line 137, col 6 of module Toggle>
 *
 * Definitions carrying a `fired:total` suffix are the ones TLC evaluated as
 * part of the next-state relation (actions, and the operators Next reaches
 * through); invariants and other operators have no suffix, because they cannot
 * "fire".
 *
 * **Read this, do not gate on it.** The counts are per-evaluation, not
 * "transitions taken", and the exact semantics of the pair are not pinned by
 * this repo — `ToggleA` reports `FetchAborted: 0:8` for an action that is
 * enabled in that config, so a zero is a prompt to go read the spec, not proof
 * of a dead guard. The repo's assertion for "the guarded transition fires" is
 * the falsifying twin in `tla/README.md` (`FallbackLive` / `CoverRepair`).
 *
 * Plain `.mjs` on purpose: `scripts/check-tlc.mjs` is executed by plain `node`
 * in CI, so it cannot import a `.ts` module.
 *
 * @typedef {object} TlcCoverageAction
 * @property {string} name
 * @property {string} module
 * @property {number} fired evaluations TLC attributed to the definition
 * @property {number} total the denominator TLC printed alongside it
 *
 * @typedef {object} TlcCoveragePredicate
 * @property {string} name
 * @property {string} module
 *
 * @typedef {object} TlcCoverage
 * @property {TlcCoverageAction[]} actions
 * @property {TlcCoveragePredicate[]} predicates
 */

const DEFINITION_RE =
	/^<(\w+) line \d+, col \d+ to line \d+, col \d+ of module (\w+)>(?:: (\d+):(\d+))?$/;

/**
 * Parse the definition table out of a full TLC run's output. Unknown lines are
 * ignored, so this survives TLC printing its own diagnostics around the table.
 *
 * @param {string} output
 * @returns {TlcCoverage}
 */
export function parseTlcCoverage(output) {
	/** @type {TlcCoverageAction[]} */
	const actions = [];
	/** @type {TlcCoveragePredicate[]} */
	const predicates = [];
	for (const raw of output.split("\n")) {
		const match = DEFINITION_RE.exec(raw.trim());
		if (!match) continue;
		const [, name, module, fired, total] = match;
		if (name === undefined || module === undefined) continue;
		if (fired === undefined || total === undefined) {
			predicates.push({ name, module });
			continue;
		}
		actions.push({
			name,
			module,
			fired: Number(fired),
			total: Number(total),
		});
	}
	return { actions, predicates };
}

/**
 * Actions that never fired, in table order — the interesting lines.
 *
 * @param {TlcCoverage} coverage
 * @returns {TlcCoverageAction[]}
 */
export function zeroFireActions(coverage) {
	return coverage.actions.filter((action) => action.fired === 0);
}

/**
 * Human-readable report for one config: the action table, then the caveat that
 * keeps a zero from being read as a verdict.
 *
 * @param {TlcCoverage} coverage
 * @param {{ config: string }} options
 * @returns {string[]}
 */
export function formatCoverageReport(coverage, { config }) {
	const lines = [`coverage ${config}: ${coverage.actions.length} action(s)`];
	for (const action of coverage.actions) {
		const flag = action.fired === 0 ? "  <- never fired" : "";
		lines.push(
			`  ${action.module}.${action.name}: ${action.fired}:${action.total}${flag}`,
		);
	}
	const zeros = zeroFireActions(coverage);
	if (zeros.length > 0) {
		lines.push(
			`  note: ${zeros.length} action(s) never fired here ` +
				`(${zeros.map((action) => action.name).join(", ")}). Read the spec ` +
				"before concluding anything: an action can be inert in one config " +
				"(ToggleA's FetchAborted) while another config requires it to fire.",
		);
	}
	if (coverage.predicates.length > 0) {
		lines.push(
			`  invariants/operators (no count): ${coverage.predicates
				.map((predicate) => predicate.name)
				.join(", ")}`,
		);
	}
	return lines;
}
