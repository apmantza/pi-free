#!/usr/bin/env node
/**
 * RPC toggle check — provider capture views end to end, over a real Pi
 * boot with pi-free installed. Headless and model-free. Speaks Pi through
 * the shared harness in scripts/lib/rpc-driver.mjs.
 *
 * The caller is responsible for providing an isolated HOME (with pi-free
 * already installed and `free_only: true` in free.json). Given a provider
 * id whose catalog Pi owns statically (default: opencode-free — 70 models,
 * 8 free — no credentials, no network), this script:
 *
 *   1. `get_available_models` — the provider shows only zero-cost models
 *      under the global free-only default (capture resolved the view).
 *   2. `/toggle-<provider>` via prompt dispatch — paid models appear.
 *   3. `new_session`, then `get_available_models` again — the flipped
 *      choice persists across replacement (no stale per-provider pref
 *      resurrects the old view).
 *
 * Fails on ANY extension_error at ANY point, any timeout, an empty
 * provider catalog, a paid model in the free view, no paid model after
 * the toggle, or a lost choice across replacement. Strict by design.
 *
 * Usage:
 *   node scripts/rpc-toggle-check.mjs [providerId]
 */
import { bootPi, sleep } from "./lib/rpc-driver.mjs";

const providerId = process.argv[2] ?? "opencode-free";
const toggleCommand = `/toggle-${providerId}`;

const driver = bootPi({
	cwd: process.cwd(),
	env: {
		...process.env,
		ANTHROPIC_API_KEY:
			process.env.ANTHROPIC_API_KEY || "sk-ant-dummy-rpc-toggle-check",
	},
	timeoutMs: 150_000,
});

function paidCost(model) {
	return (model.cost?.input ?? 0) > 0 || (model.cost?.output ?? 0) > 0;
}

function forProvider(models) {
	return (models ?? []).filter((m) => m.provider === providerId);
}

try {
	// Allow Pi to finish loading extensions + the detached capture (~1s).
	await sleep(4000);

	const bootModels = (await driver.send({ type: "get_available_models" }))
		.models;
	const bootView = forProvider(bootModels);
	if (bootView.length === 0) {
		throw new Error(
			`boot: provider ${providerId} missing from catalog — cannot assert its view`,
		);
	}
	const bootPaid = bootView.filter(paidCost);
	if (bootPaid.length > 0) {
		throw new Error(
			`boot: ${providerId} shows ${bootPaid.length} paid model(s) under free-only (e.g. ${bootPaid
				.slice(0, 3)
				.map((m) => m.id)
				.join(", ")})`,
		);
	}
	console.log(
		`boot: ${providerId} free-only view ok (${bootView.length} models, 0 paid)`,
	);

	await driver.prompt(toggleCommand);
	await sleep(3000);
	const toggledModels = (await driver.send({ type: "get_available_models" }))
		.models;
	const toggledView = forProvider(toggledModels);
	const toggledPaid = toggledView.filter(paidCost);
	if (toggledPaid.length === 0) {
		throw new Error(
			`post-toggle: ${providerId} still shows no paid models after ${toggleCommand}`,
		);
	}
	console.log(
		`post-toggle: ${providerId} all view ok (${toggledView.length} models, ${toggledPaid.length} paid)`,
	);

	await driver.send({ type: "new_session" });
	await sleep(8000);
	const persistedModels = (
		await driver.send({ type: "get_available_models" })
	).models;
	const persistedView = forProvider(persistedModels);
	const persistedPaid = persistedView.filter(paidCost);
	if (persistedPaid.length === 0) {
		throw new Error(
			`post-replacement: ${providerId} lost its all view across new_session (choice did not persist)`,
		);
	}
	console.log(
		`post-replacement: ${providerId} all view persists (${persistedView.length} models)`,
	);

	driver.pass(`${providerId} capture, toggle, and persistence hold`);
} catch (error) {
	driver.fail(error instanceof Error ? error.message : String(error));
}
