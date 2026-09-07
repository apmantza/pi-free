#!/usr/bin/env node
/**
 * RPC load check -- positively verify pi-free loaded, headless and model-free.
 *
 * The caller is responsible for providing an isolated HOME. This script starts
 * Pi in RPC mode, requests the command registry (which never calls a model),
 * and fails on extension errors, timeouts, or missing pi-free commands.
 * Speaks Pi through the shared harness in scripts/lib/rpc-driver.mjs.
 *
 * Usage:
 *   node scripts/rpc-load-check.mjs
 */
import { bootPi, sleep } from "./lib/rpc-driver.mjs";

const expectedCommands = ["toggle-free", "free-providers", "pi-free-health"];

const driver = bootPi({
	cwd: process.cwd(),
	env: {
		...process.env,
		// RPC startup needs a configured provider, but get_commands never calls it.
		ANTHROPIC_API_KEY:
			process.env.ANTHROPIC_API_KEY || "sk-ant-dummy-rpc-load-check",
	},
	timeoutMs: 30_000,
});

try {
	// Allow Pi to finish loading extensions before querying the registry.
	await sleep(2500);

	const data = await driver.send({ type: "get_commands" });
	const commands = data?.commands ?? [];
	const names = new Set(commands.map((command) => command.name));
	const missing = expectedCommands.filter((name) => !names.has(name));
	console.log(
		`Pi reported ${commands.length} command(s): ${[...names].join(", ")}`,
	);

	if (missing.length > 0) {
		driver.fail(`missing pi-free command(s): ${missing.join(", ")}`);
	} else {
		driver.pass("pi-free loaded and registered the expected commands");
	}
} catch (error) {
	driver.fail(error instanceof Error ? error.message : String(error));
}
