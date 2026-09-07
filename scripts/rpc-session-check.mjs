#!/usr/bin/env node
/**
 * RPC session + filter check — strict end-to-end assertions over a real Pi
 * boot with pi-free installed. Headless and model-free (no prompt is ever
 * sent, no network beyond Pi's own boot). Speaks Pi through the shared
 * harness in scripts/lib/rpc-driver.mjs.
 *
 * The caller is responsible for providing an isolated HOME (with pi-free
 * already installed and `free_only: true` in free.json). This script:
 *
 *   1. `get_commands` — pi-free commands are registered.
 *   2. `get_available_models` — the free-only view holds: every managed
 *      model is zero-cost, anchored deterministically on llm7 (static
 *      keyless catalog with both free and paid selectors).
 *   3. `new_session` — session replacement settles with no cancellation.
 *   4. `get_commands` + `get_available_models` again — registration and
 *      the free-only view survive replacement (#509 stale-ctx class and
 *      the #510 filter-stickiness class).
 *   5. `/toggle-llm7` via prompt dispatch, then another `new_session` —
 *      the flipped choice persists and shows in the catalog.
 *
 * Fails on ANY extension_error event at ANY point, any timeout, any
 * missing command, an empty catalog, a paid managed model, or a missing
 * llm7 anchor. Strict by design: a failure names a product bug to fix,
 * not a threshold to tune.
 *
 * Managed vs unmanaged: the harness injects a dummy ANTHROPIC_API_KEY so
 * Pi boots, which makes Anthropic's paid catalog visible. Anthropic is
 * not pi-free-managed (the global filter only governs pi-free's own
 * registry), so provider `anthropic` is excluded from the paid check —
 * and named as such in failures.
 *
 * Usage:
 *   node scripts/rpc-session-check.mjs
 */
import { bootPi, sleep } from "./lib/rpc-driver.mjs";

const expectedCommands = ["toggle-free", "free-providers", "pi-free-health"];

// Providers pi-free manages = providers with a pi-free toggle command.
// Anything else (e.g. anthropic, visible via the harness-injected dummy
// key, or Pi's own built-in `opencode` catalog) is Pi-managed and outside
// the free-only promise — the harness asserts only on the managed set,
// derived here so new providers are covered without editing this script.
const GLOBAL_COMMANDS = new Set(["toggle-free", "toggle-auto-fallback"]);

function managedIds(commands) {
	return new Set(
		(commands ?? [])
			.map((command) => command.name)
			.filter(
				(name) => name.startsWith("toggle-") && !GLOBAL_COMMANDS.has(name),
			)
			.map((name) => name.slice("toggle-".length)),
	);
}

// Deterministic anchor: static keyless catalog with free AND paid
// selectors, always available without network or credentials.
const ANCHOR_PROVIDER = "llm7";

const driver = bootPi({
	cwd: process.cwd(),
	env: {
		...process.env,
		ANTHROPIC_API_KEY:
			process.env.ANTHROPIC_API_KEY || "sk-ant-dummy-rpc-session-check",
	},
	timeoutMs: 150_000,
});

function paidCost(model) {
	return (model.cost?.input ?? 0) > 0 || (model.cost?.output ?? 0) > 0;
}

/** Strict catalog assertions. Throws on the first violation. */
function assertCatalog(models, phase, managed) {
	if (!Array.isArray(models) || models.length === 0) {
		throw new Error(`${phase}: empty model catalog`);
	}
	const inScope = models.filter((m) => managed.has(m.provider));
	if (inScope.length === 0) {
		throw new Error(
			`${phase}: no pi-free-managed models in catalog (${models.length} unmanaged present)`,
		);
	}
	const paid = inScope.filter(paidCost);
	if (paid.length > 0) {
		const sample = paid
			.slice(0, 3)
			.map((m) => `${m.provider}/${m.id}`)
			.join(", ");
		throw new Error(
			`${phase}: ${paid.length} paid managed model(s) visible under free-only (e.g. ${sample})`,
		);
	}
	const anchor = inScope.filter((m) => m.provider === ANCHOR_PROVIDER);
	if (anchor.length === 0) {
		throw new Error(
			`${phase}: anchor provider ${ANCHOR_PROVIDER} missing from catalog (${inScope.length} managed models present)`,
		);
	}
	const anchorPaid = anchor.filter(paidCost);
	if (anchorPaid.length > 0) {
		throw new Error(
			`${phase}: anchor provider shows paid models: ${anchorPaid.map((m) => m.id).join(", ")}`,
		);
	}
	console.log(
		`${phase}: catalog ok (${models.length} total, ${inScope.length} managed, ${anchor.length} anchor, 0 paid)`,
	);
}

function assertCommands(commands, phase) {
	const names = new Set((commands ?? []).map((command) => command.name));
	const missing = expectedCommands.filter((name) => !names.has(name));
	if (missing.length > 0) {
		throw new Error(
			`${phase}: missing pi-free command(s): ${missing.join(", ")}`,
		);
	}
	console.log(`${phase}: commands ok (${names.size} total)`);
}

try {
	// Allow Pi to finish loading extensions before querying.
	await sleep(2500);

	const commands = (await driver.send({ type: "get_commands" })).commands;
	assertCommands(commands, "boot");
	const managed = managedIds(commands);

	const before = (await driver.send({ type: "get_available_models" })).models;
	assertCatalog(before, "boot", managed);

	const replaced = await driver.send({ type: "new_session" });
	if (replaced?.cancelled) {
		throw new Error("new_session was cancelled by an extension");
	}
	console.log("new_session ok (replacement settled)");

	// session_start handlers + detached capture land in ~1s; wait with
	// margin so a stale-ctx failure has time to surface as extension_error.
	await sleep(8000);

	const commandsAfter = (await driver.send({ type: "get_commands" })).commands;
	assertCommands(commandsAfter, "post-replacement");

	const after = (await driver.send({ type: "get_available_models" })).models;
	assertCatalog(after, "post-replacement", managed);

	// Toggle persistence end to end: flipping llm7 must survive a session
	// replacement and show in the catalog (the paid pro selector appears).
	// Slash commands dispatch through prompt preflight — no model runs.
	await driver.prompt("/toggle-llm7");
	await sleep(3000);
	const toggled = (await driver.send({ type: "get_available_models" })).models;
	const pro = toggled.filter(
		(m) => m.provider === ANCHOR_PROVIDER && m.id === "pro",
	);
	if (pro.length === 0) {
		throw new Error(
			"post-toggle: llm7/pro missing from catalog after /toggle-llm7",
		);
	}
	console.log("post-toggle: llm7/pro visible after /toggle-llm7");
	await driver.send({ type: "new_session" });
	await sleep(8000);
	const persisted = (await driver.send({ type: "get_available_models" }))
		.models;
	const proAfter = persisted.filter(
		(m) => m.provider === ANCHOR_PROVIDER && m.id === "pro",
	);
	if (proAfter.length === 0) {
		throw new Error(
			"post-toggle-replacement: llm7/pro lost across new_session (choice did not persist)",
		);
	}
	console.log("post-toggle-replacement: llm7/pro survives new_session");

	driver.pass("session replacement clean, free-only view holds");
} catch (error) {
	driver.fail(error instanceof Error ? error.message : String(error));
}
