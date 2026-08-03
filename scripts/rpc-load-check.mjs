#!/usr/bin/env node
/**
 * RPC load check -- positively verify pi-free loaded, headless and model-free.
 *
 * The caller is responsible for providing an isolated HOME. This script starts
 * Pi in RPC mode, requests the command registry (which never calls a model),
 * and fails on extension errors, timeouts, or missing pi-free commands.
 *
 * Usage:
 *   node scripts/rpc-load-check.mjs [path-to-pi-bin]
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const expectedCommands = ["toggle-free", "free-providers", "pi-free-health"];
const suppliedPi = process.argv[2];

function commandForPi(piPath) {
	if (!piPath) return undefined;
	if (/\.m?js$/i.test(piPath)) {
		return { command: process.execPath, args: [piPath] };
	}
	return { command: piPath, args: [] };
}

function resolveInstalledPi() {
	const piModule = fileURLToPath(
		import.meta.resolve("@earendil-works/pi-coding-agent"),
	);
	return { command: process.execPath, args: [join(dirname(piModule), "cli.js")] };
}

const piCommand = commandForPi(suppliedPi) ?? resolveInstalledPi();
const pi = spawn(
	piCommand.command,
	[...piCommand.args, "--mode", "rpc", "--no-session"],
	{
		stdio: ["pipe", "pipe", "inherit"],
		env: {
			...process.env,
			// RPC startup needs a configured provider, but get_commands never calls it.
			ANTHROPIC_API_KEY:
				process.env.ANTHROPIC_API_KEY || "sk-ant-dummy-rpc-load-check",
		},
		shell: false,
	},
);

let buffer = "";
const extensionErrors = [];
let finished = false;
let timer;

function finish(code, message) {
	if (finished) return;
	finished = true;
	clearTimeout(timer);
	if (message) console.log(message);
	try {
		pi.kill("SIGKILL");
	} catch {
		// The process may already have exited.
	}
	process.exit(code);
}

timer = setTimeout(
	() => finish(2, "TIMEOUT waiting for get_commands response"),
	30_000,
);

function handleLine(line) {
	let message;
	try {
		message = JSON.parse(line);
	} catch {
		return;
	}

	if (
		(message.type === "event" && message.event === "extension_error") ||
		message.type === "extension_error"
	) {
		extensionErrors.push(message);
		console.log("extension_error:", JSON.stringify(message).slice(0, 500));
	}

	if (message.type !== "response" || message.command !== "get_commands") return;

	const commands = message.data?.commands ?? [];
	const names = new Set(commands.map((command) => command.name));
	const missing = expectedCommands.filter((name) => !names.has(name));
	console.log(`Pi reported ${commands.length} command(s): ${[...names].join(", ")}`);

	if (extensionErrors.length > 0) {
		finish(1, `FAIL: ${extensionErrors.length} extension_error event(s)`);
	} else if (missing.length > 0) {
		finish(1, `FAIL: missing pi-free command(s): ${missing.join(", ")}`);
	} else {
		finish(0, "PASS: pi-free loaded and registered the expected commands");
	}
}

pi.stdout.on("data", (data) => {
	buffer += data.toString();
	let newline;
	while ((newline = buffer.indexOf("\n")) >= 0) {
		const line = buffer.slice(0, newline).replace(/\r$/, "");
		buffer = buffer.slice(newline + 1);
		if (line.trim()) handleLine(line);
	}
});

pi.on("error", (error) => finish(1, `FAIL: could not start Pi: ${error.message}`));
pi.on("exit", (code) => {
	if (!finished) {
		finish(
			extensionErrors.length > 0 ? 1 : 2,
			`Pi exited before get_commands (code ${code ?? "unknown"})`,
		);
	}
});

// Allow Pi to finish loading extensions before querying the registry.
setTimeout(() => {
	try {
		pi.stdin.write(`${JSON.stringify({ type: "get_commands" })}\n`);
	} catch (error) {
		finish(1, `FAIL: could not send get_commands: ${error.message}`);
	}
}, 2_500);
