#!/usr/bin/env node
/**
 * RPC session + filter check — strict end-to-end assertions over a real Pi
 * boot with pi-free installed. Headless and model-free (no prompt is ever
 * sent, no network beyond Pi's own boot).
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
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const expectedCommands = ["toggle-free", "free-providers", "pi-free-health"];

// The harness-injected dummy key makes this paid catalog visible. It is
// deliberately NOT pi-free-managed, so it is excluded from the paid
// assertions below (and any failure message says so).
const UNMANAGED_PROVIDERS = new Set(["anthropic"]);

// Deterministic anchor: static keyless catalog with free AND paid
// selectors, always available without network or credentials.
const ANCHOR_PROVIDER = "llm7";

function resolveInstalledPi() {
	const piModule = fileURLToPath(
		import.meta.resolve("@earendil-works/pi-coding-agent"),
	);
	return {
		command: process.execPath,
		args: [join(dirname(piModule), "cli.js")],
	};
}

const piCommand = resolveInstalledPi();
const pi = spawn(
	piCommand.command,
	[...piCommand.args, "--mode", "rpc", "--no-session"],
	{
		stdio: ["pipe", "pipe", "inherit"],
		env: {
			...process.env,
			ANTHROPIC_API_KEY:
				process.env.ANTHROPIC_API_KEY || "sk-ant-dummy-rpc-session-check",
		},
		shell: false,
	},
);

let buffer = "";
const extensionErrors = [];
let finished = false;
let timer;
let pending = null;

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

function fail(message) {
	if (extensionErrors.length > 0) {
		console.log(
			`extension_error events observed: ${JSON.stringify(extensionErrors).slice(0, 500)}`,
		);
	}
	finish(1, `FAIL: ${message}`);
}

/** Send a command and resolve with its response data. */
function send(command) {
	return new Promise((resolveSend, rejectSend) => {
		const timeout = setTimeout(
			() => rejectSend(new Error(`timed out waiting for ${command.type}`)),
			20_000,
		);
		pending = {
			command: command.type,
			resolve: (data) => {
				clearTimeout(timeout);
				resolveSend(data);
			},
			reject: (error) => {
				clearTimeout(timeout);
				rejectSend(error);
			},
		};
		try {
			pi.stdin.write(`${JSON.stringify(command)}\n`);
		} catch (error) {
			pending = null;
			rejectSend(error);
		}
	});
}

function paidCost(model) {
	return (model.cost?.input ?? 0) > 0 || (model.cost?.output ?? 0) > 0;
}

/** Strict catalog assertions. Throws on the first violation. */
function assertCatalog(models, phase) {
	if (!Array.isArray(models) || models.length === 0) {
		throw new Error(`${phase}: empty model catalog`);
	}
	const managed = models.filter((m) => !UNMANAGED_PROVIDERS.has(m.provider));
	const paid = managed.filter(paidCost);
	if (paid.length > 0) {
		const sample = paid
			.slice(0, 3)
			.map((m) => `${m.provider}/${m.id}`)
			.join(", ");
		throw new Error(
			`${phase}: ${paid.length} paid managed model(s) visible under free-only (e.g. ${sample})`,
		);
	}
	const anchor = managed.filter((m) => m.provider === ANCHOR_PROVIDER);
	if (anchor.length === 0) {
		throw new Error(
			`${phase}: anchor provider ${ANCHOR_PROVIDER} missing from catalog (${managed.length} managed models present)`,
		);
	}
	const anchorPaid = anchor.filter(paidCost);
	if (anchorPaid.length > 0) {
		throw new Error(
			`${phase}: anchor provider shows paid models: ${anchorPaid.map((m) => m.id).join(", ")}`,
		);
	}
	console.log(
		`${phase}: catalog ok (${models.length} total, ${managed.length} managed, ${anchor.length} anchor, 0 paid)`,
	);
}

/** Prompt pi with a slash command; resolves when preflight succeeds. */
function sendPrompt(text) {
	return send({ type: "prompt", message: text });
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
		return;
	}

	if (message.type !== "response" || !pending) return;
	if (message.command !== pending.command) return;
	const current = pending;
	pending = null;
	if (message.error) {
		current.reject(new Error(`${message.command}: ${message.error}`));
	} else {
		current.resolve(message.data);
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

pi.on("error", (error) => fail(`could not start Pi: ${error.message}`));
pi.on("exit", (code) => {
	if (!finished) {
		fail(`Pi exited before checks completed (code ${code ?? "unknown"})`);
	}
});

const sleep = (ms) =>
	new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

timer = setTimeout(() => fail("TIMEOUT waiting for session checks"), 120_000);

try {
	// Allow Pi to finish loading extensions before querying.
	await sleep(2500);

	const commands = (await send({ type: "get_commands" })).commands;
	assertCommands(commands, "boot");

	const before = (await send({ type: "get_available_models" })).models;
	assertCatalog(before, "boot");

	const replaced = await send({ type: "new_session" });
	if (replaced?.cancelled) {
		throw new Error("new_session was cancelled by an extension");
	}
	console.log("new_session ok (replacement settled)");

	// session_start handlers + detached capture land in ~1s; wait with
	// margin so a stale-ctx failure has time to surface as extension_error.
	await sleep(8000);

	const commandsAfter = (await send({ type: "get_commands" })).commands;
	assertCommands(commandsAfter, "post-replacement");

	const after = (await send({ type: "get_available_models" })).models;
	assertCatalog(after, "post-replacement");

	// Toggle persistence end to end: flipping llm7 must survive a session
	// replacement and show in the catalog (the paid pro selector appears).
	// Slash commands dispatch through prompt preflight — no model runs.
	await sendPrompt("/toggle-llm7");
	await sleep(3000);
	const toggled = (await send({ type: "get_available_models" })).models;
	const pro = toggled.filter(
		(m) => m.provider === ANCHOR_PROVIDER && m.id === "pro",
	);
	if (pro.length === 0) {
		throw new Error(
			"post-toggle: llm7/pro missing from catalog after /toggle-llm7",
		);
	}
	console.log("post-toggle: llm7/pro visible after /toggle-llm7");
	await send({ type: "new_session" });
	await sleep(8000);
	const persisted = (await send({ type: "get_available_models" })).models;
	const proAfter = persisted.filter(
		(m) => m.provider === ANCHOR_PROVIDER && m.id === "pro",
	);
	if (proAfter.length === 0) {
		throw new Error(
			"post-toggle-replacement: llm7/pro lost across new_session (choice did not persist)",
		);
	}
	console.log("post-toggle-replacement: llm7/pro survives new_session");

	if (extensionErrors.length > 0) {
		fail(`${extensionErrors.length} extension_error event(s) observed`);
	}
	finish(0, "PASS: session replacement clean, free-only view holds");
} catch (error) {
	fail(error instanceof Error ? error.message : String(error));
}
