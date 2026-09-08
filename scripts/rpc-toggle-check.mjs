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

async function waitProviderView(phase, wantPaid) {
	return driver.waitFor(
		async () => {
			const models = (await driver.send({ type: "get_available_models" }))
				.models;
			const view = forProvider(models);
			if (view.length === 0) return null;
			const hasPaid = view.some(paidCost);
			if (wantPaid && !hasPaid) return null;
			return view;
		},
		{
			timeoutMs: 120_000,
			label: `${phase} ${providerId} ${wantPaid ? "all" : "free-only"} view`,
		},
	);
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
	const bootView = await waitProviderView("boot", false);
	assertFreeOnly(bootView, "boot");

	await driver.prompt(toggleCommand);
	const toggledView = await waitProviderView("post-toggle", true);
	assertAll(toggledView, "post-toggle");

	await driver.send({ type: "new_session" });
	const persistedView = await waitProviderView("post-replacement", true);
	assertAll(persistedView, "post-replacement");

	driver.pass(`${providerId} capture, toggle, and persistence hold`);
} catch (error) {
	driver.fail(error instanceof Error ? error.message : String(error));
}
