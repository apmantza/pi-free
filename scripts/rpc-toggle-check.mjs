#!/usr/bin/env node
/**
 * RPC toggle check — provider capture views end to end, over a real Pi
 * boot with pi-free installed. Headless and model-free. Speaks Pi through
 * the shared harness in scripts/lib/rpc-driver.mjs.
 *
 * The caller is responsible for providing an isolated HOME (with pi-free
 * already installed and `free_only: true` in free.json). Given a provider
 * id whose catalog Pi owns statically (default: opencode-free — 70 models,
 * 8 free — needs a key present for availability, never a real call), this
 * script:
 *
 *   1. `get_available_models` — the provider shows only zero-cost models
 *      under the global free-only default (capture resolved the view).
 *   2. `/toggle-<provider>` via prompt dispatch — paid models appear.
 *   3. `new_session`, then `get_available_models` again — the flipped
 *      choice persists across replacement (no stale per-provider pref
 *      resurrects the old view).
 *
 * Waiting is poll-until-condition with deadlines, never fixed sleeps.
 * Fails on ANY extension_error at ANY point, any timeout, an empty
 * provider catalog, a paid model in the free view, no paid model after
 * the toggle, or a lost choice across replacement. Strict by design.
 *
 * Usage:
 *   node scripts/rpc-toggle-check.mjs [providerId]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bootPi } from "./lib/rpc-driver.mjs";

const providerId = process.argv[2] ?? "opencode-free";
const toggleCommand = `/toggle-${providerId}`;

const driver = bootPi({
	cwd: process.cwd(),
	env: {
		...process.env,
		ANTHROPIC_API_KEY:
			process.env.ANTHROPIC_API_KEY || "sk-ant-dummy-rpc-toggle-check",
	},
	timeoutMs: 300_000,
});

function paidCost(model) {
	return (model.cost?.input ?? 0) > 0 || (model.cost?.output ?? 0) > 0;
}

function forProvider(models) {
	return (models ?? []).filter((m) => m.provider === providerId);
}

/**
 * Fetch until assert() passes twice in a row, then return the view.
 * Pi rebuilds its model snapshot unfiltered on every re-registration
 * until the availability refresh lands — asserting first sight as final
 * flakes on slow/fresh boots (settled-state contract instead).
 */
async function settledView(phase, assert) {
	const models = await driver.waitSettled(
		async () => (await driver.send({ type: "get_available_models" })).models,
		(all) => {
			const view = forProvider(all);
			if (view.length === 0) {
				throw new Error(
					`${phase}: provider ${providerId} missing from catalog`,
				);
			}
			assert(view, phase);
		},
		{ timeoutMs: 180_000, label: `${phase} ${providerId} view` },
	);
	return forProvider(models);
}

/** Persisted override from the smoke HOME's free.json (same file Pi reads). */
function readOverride() {
	try {
		const homeDir = process.env.HOME || process.env.USERPROFILE || "";
		const cfg = JSON.parse(
			readFileSync(join(homeDir, ".pi", "free.json"), "utf8"),
		);
		return cfg?.model_view_overrides?.[providerId];
	} catch {
		return undefined;
	}
}

function assertFreeOnly(view, phase) {
	const paid = view.filter(paidCost);
	if (paid.length > 0) {
		throw new Error(
			`${phase}: ${providerId} shows ${paid.length} paid model(s) under free-only (e.g. ${paid
				.slice(0, 3)
				.map((m) => m.id)
				.join(", ")})`,
		);
	}
	console.log(
		`${phase}: ${providerId} free-only view ok (${view.length} models, 0 paid)`,
	);
}

function assertAll(view, phase) {
	const paid = view.filter(paidCost);
	if (paid.length === 0) {
		throw new Error(
			`${phase}: ${providerId} still shows no paid models after ${toggleCommand}`,
		);
	}
	console.log(
		`${phase}: ${providerId} all view ok (${view.length} models, ${paid.length} paid)`,
	);
}

try {
	await settledView("boot", assertFreeOnly);

	await driver.prompt(toggleCommand);
	// The persisted override (not just catalog presence, which a transient
	// unfiltered snapshot could fake) proves the command did its write.
	await driver.waitFor(
		async () => (readOverride() === "all" ? true : null),
		{ timeoutMs: 60_000, label: `post-toggle ${providerId} override` },
	);
	await settledView("post-toggle", assertAll);

	await driver.send({ type: "new_session" });
	await settledView("post-replacement", assertAll);

	driver.pass(`${providerId} capture, toggle, and persistence hold`);
} catch (error) {
	driver.fail(error instanceof Error ? error.message : String(error));
}
