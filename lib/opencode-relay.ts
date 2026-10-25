/**
 * Bun TLS relay for the opencode-free anonymous lane.
 *
 * Upstream regressed enforcement on the anonymous free lane: the lane now
 * discriminates on the TLS/transport fingerprint of the caller (issue bisect:
 * a byte-identical replay of the real CLI request 429s from node and curl,
 * while the same request over bun succeeds). Node's undici cannot change
 * that, so the only path that keeps the anonymous lane usable is making the
 * TLS hop itself with bun.
 *
 * Design: a loopback-only relay child (pattern from pi-claude-code's
 * turn-relay) owns the hop. pi still owns history, tools, SSE parsing; the
 * relay is a byte pipe. Missing bun is a bounded, once-per-process fallback —
 * never a silent auth change (the lane stays anonymous; the Go lane keeps its
 * own credential and never touches this relay).
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { Socket } from "node:net";
import { createLogger } from "./logger.ts";

const _logger = createLogger("opencode-relay");

/** Only these path roots may be relayed. Gates fail closed (PRINCIPLES #8). */
export const OPENCODE_RELAY_PATH_RE = /^\/(zen|inference)\/v1(\/|$)/u;

/**
 * Map an upstream model baseUrl to the relay's loopback form. Returns
 * undefined when the URL is not an opencode.ai https URL under an allowlisted
 * path (other hosts or paths pass through untouched by callers).
 */
export function getOpenCodeRelayBaseUrl(
	url: string,
	port: number,
): string | undefined {
	let parsed: URL;
	try {
		parsed = new URL(url, "https://opencode.ai");
	} catch {
		return undefined;
	}
	if (parsed.protocol !== "https:" || parsed.hostname !== "opencode.ai") {
		return undefined;
	}
	if (!OPENCODE_RELAY_PATH_RE.test(parsed.pathname)) {
		return undefined;
	}
	let loopback: URL;
	try {
		loopback = new URL(parsed.toString());
	} catch {
		return undefined; // never rethrows on a caller URL
	}
	loopback.protocol = "http:";
	loopback.hostname = "127.0.0.1";
	loopback.port = String(port);
	return loopback.toString().replace(/\/$/u, "");
}

export interface OpenCodeRelay {
	/** The child's ephemeral loopback port, once it has reported one. */
	port(): number | undefined;
	/** Resolves with the port, or rejects on spawn failure/child exit. */
	ready(timeoutMs: number): Promise<number>;
	/** Stop the child (idle TTL or process shutdown). Idempotent. */
	stop(): void;
	/** Notify activity, resetting the idle TTL when no stream is active. */
	touch(): void;
	/** Hold the child through a stream; call the returned release exactly once. */
	acquire(): () => void;
}

interface RelayStartOptions {
	/** Bun executable override (tests set this; default: `PI_FREE_OPENCODE_BUN` env or "bun"). */
	bunCommand?: string;
	/** Child args override: tests substitute a stub script for the real relay. */
	childArgs?: string[];
	/** Idle TTL before the child is stopped. Default 5 minutes. */
	idleTtlMs?: number;
}

type Waiter = { resolve: (port: number) => void; reject: (e: Error) => void };

const relayUpstream = (): string => {
	const raw = process.env.PI_FREE_OPENCODE_RELAY_UPSTREAM;
	return (raw ? raw : "https://opencode.ai").replace(/\/+$/u, "");
};

let _singleton: Relay | undefined;

export function getOpenCodeRelay(options?: RelayStartOptions): OpenCodeRelay {
	if (!_singleton) {
		_singleton = new Relay(options ?? {});
	}
	_singleton.touch();
	return _singleton;
}

/** Test hook: drop the singleton so a test gets a fresh constructor. */
export function resetOpenCodeRelayForTest(): void {
	_singleton?.stop();
	_singleton = undefined;
}

class Relay implements OpenCodeRelay {
	private child: ChildProcess | undefined;
	private boundPort: number | undefined;
	private idleTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly idleTtlMs: number;
	private readonly bunCommand: string;
	private readonly childArgs: string[];
	private readonly waiters = new Set<Waiter>();
	private stopped = false;
	private activeRequests = 0;

	constructor(options: RelayStartOptions) {
		this.idleTtlMs = options.idleTtlMs ?? 5 * 60_000;
		this.bunCommand =
			options.bunCommand ?? process.env.PI_FREE_OPENCODE_BUN ?? "bun";
		this.childArgs = options.childArgs ?? ["-e", OPENCODE_RELAY_SCRIPT];
		this.spawnChild();
	}

	private settleWaiter(port: number | undefined, error?: Error): void {
		for (const waiter of this.waiters) {
			if (error !== undefined) {
				waiter.reject(error);
			} else if (port !== undefined) {
				waiter.resolve(port);
			}
		}
		this.waiters.clear();
	}

	private spawnChild(): void {
		if (this.stopped) return;
		let child: ChildProcess;
		try {
			child = spawn(this.bunCommand, this.childArgs, {
				env: {
					...process.env,
					// Read the upstream override live: tests (and a user pointing
					// the relay elsewhere) must not be pinned to import-time.
					PI_FREE_OPENCODE_RELAY_UPSTREAM: relayUpstream(),
				},
				// The child's stdin is a lifetime fence: parent death closes the
				// pipe even when an exit hook cannot run (e.g. SIGKILL).
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch (error) {
			this.fail(error instanceof Error ? error : new Error(String(error)));
			return;
		}
		this.child = child;

		let stdoutBuf = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			stdoutBuf += chunk.toString();
			const match = /PORT=(\d+)/u.exec(stdoutBuf);
			if (match && this.boundPort === undefined) {
				this.boundPort = Number(match[1]);
				this.armIdleTimer();
				this.settleWaiter(this.boundPort);
			}
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			_logger.debug("opencode-relay child stderr", {
				text: chunk.toString().slice(0, 500),
			});
		});
		child.on("error", (error) => this.fail(error));
		child.on("exit", (code, signal) => {
			this.boundPort = undefined;
			this.settleWaiter(
				undefined,
				new Error(
					`opencode-relay child exited (code ${code ?? "?"}, signal ${signal ?? "?"})`,
				),
			);
			if (!this.stopped) {
				this.stop();
				_singleton = undefined;
				// One record per session: the next getOpenCodeRelay() call starts
				// a fresh child; repeated exits in a loop stay one line.
				_logger.warn(
					"[opencode-relay] relay child exited unexpectedly; opencode-free falls back to the direct anonymous lane until the next turn restarts it",
				);
			}
		});
		// Pipes/child must not keep an otherwise idle parent alive. The child
		// watches stdin EOF, so normal drain and abrupt parent death stop it.
		child.unref();
		(child.stdout as Socket | null)?.unref();
		(child.stderr as Socket | null)?.unref();
	}

	private fail(error: Error): void {
		_logger.warn(
			"[opencode-relay] cannot start bun relay; opencode-free uses the direct anonymous lane",
			{ error: error.message },
		);
		this.settleWaiter(undefined, error);
		// Cache the unavailable generation: later turns fall back immediately,
		// rather than retrying a missing executable and logging on every turn.
		this.stop();
	}

	private armIdleTimer(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = undefined;
		if (this.stopped || this.activeRequests > 0) return;
		this.idleTimer = setTimeout(() => {
			this.stop();
			if (_singleton === this) _singleton = undefined;
		}, this.idleTtlMs);
		// Unref: a TTL'd relay must never hold pi's process open.
		this.idleTimer.unref?.();
	}

	port(): number | undefined {
		return this.boundPort;
	}

	ready(timeoutMs: number): Promise<number> {
		if (this.stopped || !this.child) {
			return Promise.reject(new Error("opencode-relay is not running"));
		}
		if (this.boundPort !== undefined) return Promise.resolve(this.boundPort);
		return new Promise<number>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.waiters.delete(waiter);
				reject(
					new Error(
						`opencode-relay did not become ready within ${timeoutMs}ms`,
					),
				);
			}, timeoutMs);
			// A readiness caller is active work: keep this bounded deadline
			// referenced until the child reports a port or failure.
			const waiter: Waiter = {
				resolve: (port) => {
					clearTimeout(timer);
					resolve(port);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			};
			this.waiters.add(waiter);
		});
	}

	touch(): void {
		if (this.boundPort !== undefined) this.armIdleTimer();
	}

	acquire(): () => void {
		this.activeRequests += 1;
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = undefined;
		return () => {
			this.activeRequests -= 1;
			this.armIdleTimer();
		};
	}

	stop(): void {
		this.stopped = true;
		this.boundPort = undefined;
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = undefined;
		this.settleWaiter(undefined, new Error("opencode-relay stopped"));
		const child = this.child;
		this.child = undefined;
		if (child && child.exitCode === null) {
			child.kill();
		}
	}
}

/**
 * The relay child script, run as `bun -e <script>`. Prints `PORT=<n>` on
 * stdout so the parent knows the ephemeral loopback port. Only paths matching
 * ALLOW are forwarded (fail-closed gate); the response body is streamed
 * verbatim so SSE chunks pass through without buffering.
 */
export const OPENCODE_RELAY_SCRIPT = `
const UP = (process.env.PI_FREE_OPENCODE_RELAY_UPSTREAM || "https://opencode.ai").replace(/\\/+$/, "");
const ALLOW = /^\\/(zen|inference)\\/v1(\\/|$)/;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    if (!ALLOW.test(u.pathname)) {
      return new Response(undefined, { status: 404 });
    }
    const h = new Headers();
    req.headers.forEach((v, k) => {
      if (k !== "host" && k !== "connection") h.set(k, v);
    });
    return fetch(UP + u.pathname + u.search, {
      method: req.method,
      headers: h,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      redirect: "manual",
      // This is a byte pipe: retain encoded bytes and their encoding header.
      decompress: false,
    }).catch((e) =>
      new Response(JSON.stringify({ type: "error", error: { type: "relay", message: String(e && e.message || e) } }), { status: 502, headers: { "content-type": "application/json" } })
    );
  },
});
// The OS closes this parent-owned pipe on every kind of parent termination.
process.stdin.on("end", () => { server.stop(true); process.exit(0); });
process.stdin.resume();
console.log("PORT=" + server.port);
`;
