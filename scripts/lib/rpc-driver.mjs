/**
 * Shared harness for the RPC smoke drivers (rpc-load-check,
 * rpc-session-check, rpc-toggle-check). One place owns the Pi RPC
 * lifecycle: spawning, JSON-lines framing, request/response matching by
 * command, extension_error collection, and timeouts — so protocol quirks
 * are fixed once, not per driver.
 *
 * Drivers stay focused on their assertions; this module never asserts.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const sleep = (ms) =>
	new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/**
 * Boot Pi in RPC --no-session mode (or with a session when `withSession`).
 * Returns a driver object; call `driver.close(code)` at the end (it kills
 * Pi and exits the process).
 *
 * @param {object} options
 * @param {string} options.cwd project directory for the Pi process
 * @param {NodeJS.ProcessEnv} options.env environment (must carry isolated HOME)
 * @param {number} [options.timeoutMs] overall deadline (default 120s)
 * @param {boolean} [options.noSession] pass --no-session (default true)
 */
export function bootPi({ cwd, env, timeoutMs = 120_000, noSession = true }) {
	const piModule = fileURLToPath(
		import.meta.resolve("@earendil-works/pi-coding-agent"),
	);
	const args = [join(dirname(piModule), "cli.js"), "--mode", "rpc"];
	if (noSession) args.push("--no-session");
	const pi = spawn(process.execPath, args, {
		cwd,
		stdio: ["pipe", "pipe", "inherit"],
		env,
		shell: false,
	});

	const state = {
		buffer: "",
		extensionErrors: [],
		pending: null,
		finished: false,
		timer: null,
		onFailure: null,
	};

	function finish(code, message) {
		if (state.finished) return;
		state.finished = true;
		if (state.timer) clearTimeout(state.timer);
		if (message) console.log(message);
		try {
			pi.kill("SIGKILL");
		} catch {
			// The process may already have exited.
		}
		process.exit(code);
	}

	state.timer = setTimeout(() => {
		if (state.onFailure) state.onFailure(new Error("TIMEOUT"));
		else finish(2, "TIMEOUT waiting for RPC checks");
	}, timeoutMs);
	if (state.timer.unref) state.timer.unref();

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
			state.extensionErrors.push(message);
			console.log("extension_error:", JSON.stringify(message).slice(0, 500));
			return;
		}
		if (message.type !== "response" || !state.pending) return;
		if (message.command !== state.pending.command) return;
		const current = state.pending;
		state.pending = null;
		if (message.error) {
			current.reject(new Error(`${message.command}: ${message.error}`));
		} else {
			current.resolve(message.data);
		}
	}

	pi.stdout.on("data", (data) => {
		state.buffer += data.toString();
		let newline;
		while ((newline = state.buffer.indexOf("\n")) >= 0) {
			const line = state.buffer.slice(0, newline).replace(/\r$/, "");
			state.buffer = state.buffer.slice(newline + 1);
			if (line.trim()) handleLine(line);
		}
	});

	pi.on("error", (error) => {
		if (state.onFailure) state.onFailure(error);
		else finish(1, `FAIL: could not start Pi: ${error.message}`);
	});
	pi.on("exit", (code) => {
		if (state.finished) return;
		const error = new Error(`Pi exited early (code ${code ?? "unknown"})`);
		if (state.onFailure) state.onFailure(error);
		else
			finish(
				state.extensionErrors.length > 0 ? 1 : 2,
				`Pi exited before checks completed (code ${code ?? "unknown"})`,
			);
	});

	return {
		/** Send a command; resolves with response data. */
		send(command, stepTimeoutMs = 20_000) {
			return new Promise((resolveSend, rejectSend) => {
				const stepTimer = setTimeout(
					() =>
						rejectSend(new Error(`timed out waiting for ${command.type}`)),
					stepTimeoutMs,
				);
				if (stepTimer.unref) stepTimer.unref();
				state.pending = {
					command: command.type,
					resolve: (data) => {
						clearTimeout(stepTimer);
						resolveSend(data);
					},
					reject: (error) => {
						clearTimeout(stepTimer);
						rejectSend(error);
					},
				};
				try {
					pi.stdin.write(`${JSON.stringify(command)}\n`);
				} catch (error) {
					state.pending = null;
					clearTimeout(stepTimer);
					rejectSend(error);
				}
			});
		},
		/** Prompt Pi (slash commands dispatch through preflight — no model runs). */
		prompt(text) {
			return this.send({ type: "prompt", message: text });
		},
		extensionErrors: state.extensionErrors,
		/** Fail with message (plus any observed extension errors). */
		fail(message) {
			if (state.extensionErrors.length > 0) {
				console.log(
					`extension_error events observed: ${JSON.stringify(state.extensionErrors).slice(0, 500)}`,
				);
			}
			finish(1, `FAIL: ${message}`);
		},
		/** Pass with message. Fails instead if extension errors were observed. */
		pass(message) {
			if (state.extensionErrors.length > 0) {
				this.fail(
					`${state.extensionErrors.length} extension_error event(s) observed`,
				);
				return;
			}
			finish(0, `PASS: ${message}`);
		},
		close: finish,
	};
}
