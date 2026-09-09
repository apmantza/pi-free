#!/usr/bin/env node
/**
 * RPC restore check — pi-free's deferred saved-model restore end to end,
 * over a real Pi boot with pi-free installed. Headless and model-free
 * (no prompt is ever sent). Speaks Pi through the shared harness in
 * scripts/lib/rpc-driver.mjs.
 *
 * Background: Pi resolves a resumed session's model BEFORE extension
 * provider registrations flush, so sessions saved with a built-in-toggle
 * provider (opencode-free/…) hit Pi's fallback on every resume. After the
 * capture applies its catalog view, pi-free re-reads the session's
 * persisted choice and re-selects it. This driver proves that whole arc
 * live by switching into crafted session files:
 *
 *   0. Read a free opencode-free model id from the live catalog (no
 *      hardcoded catalog ids — the catalog rotates between Pi releases).
 *   1. Deliberate previous-run switch wins: trailing model_change names
 *      another provider with a pre-run timestamp → no restore (stays put).
 *   2. Plain restore: trailing choice names opencode-free/<id> → the
 *      session ends on exactly that model.
 *   3. Poisoned context: trailing change during this run names another
 *      (nonexistent) provider → the earlier opencode-free choice is
 *      restored, not the fallback artifact.
 *   4. Unknown id: trailing choice names a nonexistent opencode-free
 *      model → graceful no-restore, session stays usable, no error.
 *
 * Fails on ANY extension_error at ANY point, any timeout, or any
 * unexpected final model. Strict by design.
 *
 * The caller provides the isolated HOME (pi-free installed, free_only
 * seeded, OPENCODE_API_KEY present so opencode-free models are
 * available and setModel's auth gate passes).
 *
 * Usage:
 *   node scripts/rpc-restore-check.mjs
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bootPi } from "./lib/rpc-driver.mjs";

const PROVIDER = "opencode-free";
const OLD_STAMP = "2024-01-01T00:00:00.000Z";

const driver = bootPi({
	cwd: process.cwd(),
	env: {
		...process.env,
		ANTHROPIC_API_KEY:
			process.env.ANTHROPIC_API_KEY || "sk-ant-dummy-rpc-restore-check",
	},
	timeoutMs: 300_000,
	// A live session is required: crafted files switch into it, and the
	// boot session's directory is where they are written.
	noSession: false,
});

function paidCost(model) {
	return (model.cost?.input ?? 0) > 0 || (model.cost?.output ?? 0) > 0;
}

/** Locate the boot cwd's session dir (exactly one exists in a fresh HOME). */
function sessionDir() {
	const homeDir = process.env.HOME || process.env.USERPROFILE || "";
	const roots = join(homeDir, ".pi", "agent", "sessions");
	const dirs = readdirSync(roots, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(roots, entry.name));
	if (dirs.length !== 1) {
		throw new Error(
			`expected exactly one session dir in a fresh HOME, found ${dirs.length}`,
		);
	}
	return dirs[0];
}

/** Write a session file with the given model_change trail; returns its path. */
function craftSession(cwd, changes) {
	const dir = sessionDir();
	const name = `${new Date().toISOString().replace(/[:.]/g, "-")}_${randomUUID().slice(0, 8)}.jsonl`;
	const filePath = join(dir, name);
	const lines = [
		JSON.stringify({
			type: "session",
			version: 3,
			id: randomUUID(),
			timestamp: new Date().toISOString(),
			cwd,
		}),
	];
	let parentId = null;
	for (const change of changes) {
		const id = randomUUID().slice(0, 8);
		lines.push(
			JSON.stringify({
				type: "model_change",
				id,
				parentId,
				timestamp: change.at ?? new Date().toISOString(),
				provider: change.provider,
				modelId: change.modelId,
			}),
		);
		parentId = id;
	}
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, `${lines.join("\n")}\n`);
	return filePath;
}

async function currentModel() {
	const state = await driver.send({ type: "get_state" });
	return state?.model;
}

async function waitModel(label, predicate, timeoutMs = 90_000) {
	return driver.waitSettled(
		async () => {
			const model = await currentModel();
			if (!model) return null;
			const file = (await driver.send({ type: "get_state" }))?.sessionFile;
			return { model, file };
		},
		({ model }) => {
			if (!predicate(model)) {
				throw new Error(
					`${label}: unexpected model ${model?.provider}/${model?.id}`,
				);
			}
		},
		{ timeoutMs, label },
	);
}

try {
	const cwd = process.cwd();
	// Wait for the boot session itself before touching its directory.
	await driver.waitFor(
		async () => {
			const state = await driver.send({ type: "get_state" });
			return state?.sessionFile ? true : null;
		},
		{ timeoutMs: 60_000, label: "boot session" },
	);
	const models = await driver.waitSettled(
		async () => (await driver.send({ type: "get_available_models" })).models,
		(all) => {
			if ((all ?? []).filter((m) => m.provider === PROVIDER).length === 0) {
				throw new Error(`boot: no ${PROVIDER} models in catalog`);
			}
		},
		{ timeoutMs: 120_000, label: "boot opencode-free catalog" },
	);
	const target = models
		.filter((m) => m.provider === PROVIDER && !paidCost(m))
		.map((m) => m.id)
		.sort()[0];
	if (!target) throw new Error(`boot: no free ${PROVIDER} model to restore`);
	console.log(`boot: restore target is ${PROVIDER}/${target}`);

	// 1. Deliberate previous-run switch wins: trailing change names another
	// provider with a pre-run stamp, so no restore may happen.
	const deliberate = craftSession(cwd, [
		{ provider: PROVIDER, modelId: target, at: OLD_STAMP },
		{ provider: "kilo", modelId: "no-such-model", at: OLD_STAMP },
	]);
	await driver.send({ type: "switch_session", sessionPath: deliberate });
	const kept = await waitModel(
		"deliberate-switch",
		(model) => model?.id !== target,
	);
	console.log(
		`deliberate-switch: kept ${kept.model.provider}/${kept.model.id} (no restore, as designed)`,
	);

	// 2. Plain restore onto the recorded choice. Stamped pre-run like a
	// real resumed session: a during-run stamp would look like Pi's own
	// fallback artifact and be skipped by design.
	const plain = craftSession(cwd, [
		{ provider: PROVIDER, modelId: target, at: OLD_STAMP },
	]);
	await driver.send({ type: "switch_session", sessionPath: plain });
	const restored = await waitModel(
		"plain-restore",
		(model) => model?.provider === PROVIDER && model?.id === target,
	);
	console.log(
		`plain-restore: landed on ${restored.model.provider}/${restored.model.id}`,
	);

	// 3. Poisoned context: trailing during-run change names a nonexistent
	// provider model (Pi's own fallback artifact) — the earlier recorded
	// choice must win, not the artifact.
	const poisoned = craftSession(cwd, [
		{ provider: PROVIDER, modelId: target, at: OLD_STAMP },
		{ provider: "anthropic", modelId: "no-such-model" },
	]);
	await driver.send({ type: "switch_session", sessionPath: poisoned });
	const unpoisoned = await waitModel(
		"poisoned-context",
		(model) => model?.provider === PROVIDER && model?.id === target,
	);
	console.log(
		`poisoned-context: landed on ${unpoisoned.model.provider}/${unpoisoned.model.id}`,
	);

	// 4. Unknown id: graceful no-restore, session stays usable.
	const unknown = craftSession(cwd, [
		{ provider: PROVIDER, modelId: "definitely-not-a-model" },
	]);
	await driver.send({ type: "switch_session", sessionPath: unknown });
	const usable = await waitModel(
		"unknown-id",
		(model) => model?.id !== "definitely-not-a-model",
	);
	console.log(
		`unknown-id: session usable on ${usable.model.provider}/${usable.model.id} (no crash, no bogus restore)`,
	);

	driver.pass("deferred saved-model restore holds across crafted resumes");
} catch (error) {
	driver.fail(error instanceof Error ? error.message : String(error));
}
