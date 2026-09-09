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
 * Waiting is poll-until-condition with deadlines, never fixed sleeps, so
 * slow runners (Windows CI) get patience instead of flakes. Fails on ANY
 * extension_error event at ANY point, any timeout, any missing command,
 * an empty catalog, a paid managed model, or a missing llm7 anchor.
 * Strict by design: a failure names a product bug to fix, not a
 * threshold to tune.
 *
 * Managed vs unmanaged: pi-free manages exactly the providers with a
 * pi-free toggle command (derived live from get_commands, so new
 * providers are covered without editing this script). Anything else
 * (e.g. anthropic via the harness dummy key, Pi's own built-in
 * `opencode` catalog) is Pi-managed and out of scope.
 *
 * Usage:
 *   node scripts/rpc-session-check.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bootPi, sleep } from "./lib/rpc-driver.mjs";

const expectedCommands = ["toggle-free", "free-providers", "pi-free-health"];

// Providers pi-free manages = providers with a pi-free toggle command.
const GLOBAL_COMMANDS = new Set(["toggle-free", "toggle-auto-fallback"]);

function managedIds(commands) {
	return new Set(
		(commands ?? [])
			.map((command) => command.name)
			.filter((name) => name.startsWith("toggle-") && !GLOBAL_COMMANDS.has(name))
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
	timeoutMs: 600_000,
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
	return commands;
}

async function waitCommands(phase) {
	return driver.waitFor(
		async () => {
			const commands = (await driver.send({ type: "get_commands" })).commands;
			assertCommands(commands, phase);
			return commands;
		},
		{ timeoutMs: 60_000, label: `${phase} pi-free commands` },
	);
}

async function waitCatalog(phase, managed) {
	// Settled strictness (not first sight): the snapshot rebuilds
	// unfiltered on every re-registration until the availability refresh
	// lands, so presence alone would assert a transient.
	return driver.waitSettled(
		async () =>
			(await driver.send({ type: "get_available_models" })).models,
		(models) => assertCatalog(models, phase, managed),
		{ timeoutMs: 180_000, label: `${phase} managed catalog` },
	);
}

/**
 * Write the smoke HOME's free.json (same file the extension reads).
 * Used by the hot-reload probe to bypass applyGlobalFilter on purpose.
 */
function writeFreeJson(value) {
	const homeDir = process.env.HOME || process.env.USERPROFILE || "";
	writeFileSync(join(homeDir, ".pi", "free.json"), JSON.stringify(value));
}

/**
 * Read the smoke HOME's free.json (same file the extension reads).
 * Total: returns null when the file is missing or unparsable, so polling
 * callers keep waiting and one-shot callers fail fast with context.
 */
function readSeededConfig() {
	try {
		const homeDir = process.env.HOME || process.env.USERPROFILE || "";
		return JSON.parse(readFileSync(join(homeDir, ".pi", "free.json"), "utf8"));
	} catch {
		return null;
	}
}

try {
	// Read back the seeded free.json through the same HOME Pi sees: if the
	// seed is absent here, a filter failure below is environmental (wrong
	// file / race), not a view-resolution bug. Fail fast with the evidence.
	const seededConfig = readSeededConfig();
	console.log(`boot: free.json is ${JSON.stringify(seededConfig)}`);
	if (seededConfig?.free_only !== true) {
		throw new Error(
			`boot: seeded free.json does not enable free_only: ${JSON.stringify(seededConfig)}`,
		);
	}

	const commands = await waitCommands("boot");
	const managed = managedIds(commands);
	await waitCatalog("boot", managed);

	const replaced = await driver.send({ type: "new_session" });
	if (replaced?.cancelled) {
		throw new Error("new_session was cancelled by an extension");
	}
	console.log("new_session ok (replacement settled)");

	await waitCommands("post-replacement");
	await waitCatalog("post-replacement", managed);

	// Toggle persistence end to end: flipping llm7 must survive a session
	// replacement and show in the catalog (the paid pro selector appears).
	// Slash commands dispatch through prompt preflight — no model runs.
	// The persisted override (not just catalog presence, which a transient
	// unfiltered snapshot could fake) proves the command did its write.
	await driver.prompt("/toggle-llm7");
	await driver.waitFor(
		async () =>
			readSeededConfig()?.model_view_overrides?.llm7 === "all"
				? true
				: null,
		{ timeoutMs: 60_000, label: "post-toggle llm7 override" },
	);
	const toggled = await driver.waitFor(
		async () => {
			const found = (await driver.send({ type: "get_available_models" })).models;
			return (found ?? []).some(
				(m) => m.provider === ANCHOR_PROVIDER && m.id === "pro",
			)
				? found
				: null;
		},
		{ timeoutMs: 60_000, label: "post-toggle llm7/pro" },
	);
	console.log(
		`post-toggle: llm7/pro visible after /toggle-llm7 (${toggled.length} total)`,
	);
	await driver.send({ type: "new_session" });
	const persisted = await driver.waitFor(
		async () => {
			const found = (await driver.send({ type: "get_available_models" })).models;
			return (found ?? []).some(
				(m) => m.provider === ANCHOR_PROVIDER && m.id === "pro",
			)
				? found
				: null;
		},
		{ timeoutMs: 90_000, label: "post-toggle-replacement llm7/pro" },
	);
	console.log(
		`post-toggle-replacement: llm7/pro survives new_session (${persisted.length} total)`,
	);

	// Global flip: /toggle-free clears overrides and shows paid everywhere;
	// flipping back restores the strict free view.
	await driver.prompt("/toggle-free");
	await driver.waitFor(
		async () => {
			const found = (await driver.send({ type: "get_available_models" }))
				.models;
			const paid = (found ?? []).filter(
				(m) => managed.has(m.provider) && paidCost(m),
			);
			return paid.length > 0 ? paid : null;
		},
		{ timeoutMs: 90_000, label: "toggle-free-off paid visible" },
	);
	console.log("toggle-free-off: paid managed models visible");
	await driver.prompt("/toggle-free");
	await waitCatalog("toggle-free-on", managed);

	// Hot-reload probe (observe + report, not assert): a direct free.json
	// write bypasses applyGlobalFilter, so the module-cached global may
	// not follow. The log line below is the evidence either way.
	writeFreeJson({ free_only: false });
	await sleep(5000);
	const probeOff = (await driver.send({ type: "get_available_models" })).models;
	const probeOffPaid = (probeOff ?? []).filter(
		(m) => managed.has(m.provider) && paidCost(m),
	);
	console.log(
		`hot-reload-probe: file free_only=false -> ${probeOffPaid.length} paid managed visible`,
	);
	writeFreeJson({ free_only: true });
	await sleep(5000);
	const probeOn = (await driver.send({ type: "get_available_models" })).models;
	const probeOnPaid = (probeOn ?? []).filter(
		(m) => managed.has(m.provider) && paidCost(m),
	);
	console.log(
		`hot-reload-probe: file free_only=true -> ${probeOnPaid.length} paid managed visible`,
	);

	// Rapid-switch stress: replacements back-to-back must stay clean.
	for (let i = 0; i < 5; i++) {
		await driver.send({ type: "new_session" });
	}
	console.log("rapid-switch: 5 replacements issued");
	await waitCommands("rapid-switch");
	await waitCatalog("rapid-switch", managed);

	driver.pass("session replacement clean, free-only view holds");
} catch (error) {
	driver.fail(error instanceof Error ? error.message : String(error));
}
