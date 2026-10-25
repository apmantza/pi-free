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
	/** Notify activity, resetting the idle TTL. */
	touch(): void;
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
	private waiter: Waiter | undefined;
	private stopped = false;

	constructor(options: RelayStartOptions) {
		this.idleTtlMs = options.idleTtlMs ?? 5 * 60_000;
		this.bunCommand =
			options.bunCommand ?? process.env.PI_FREE_OPENCODE_BUN ?? "bun";
		this.childArgs = options.childArgs ?? ["-e", OPENCODE_RELAY_SCRIPT];
		this.spawnChild();
	}

	private settleWaiter(port: number | undefined, error?: Error): void {
		const waiter = this.waiter;
		this.waiter = undefined;
		if (!waiter) return;
		if (error !== undefined) {
			waiter.reject(error);
		} else if (port !== undefined) {
			waiter.resolve(port);
		}
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
				stdio: ["ignore", "pipe", "pipe"],
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
				this.stopped = true;
				_singleton = undefined;
				// One record per session: the next getOpenCodeRelay() call starts
				// a fresh child; repeated exits in a loop stay one line.
				_logger.warn(
					"[opencode-relay] relay child exited unexpectedly; opencode-free falls back to the direct anonymous lane until the next turn restarts it",
				);
			}
		});
	}

	private fail(error: Error): void {
		_logger.warn(
			"[opencode-relay] cannot start bun relay; opencode-free uses the direct anonymous lane",
			{ error: error.message },
		);
		this.settleWaiter(undefined, error);
	}

	private armIdleTimer(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = setTimeout(() => this.stop(), this.idleTtlMs);
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
			if (this.waiter) {
				this.waiter.reject(new Error("superseded"));
			}
			const timer = setTimeout(() => {
				this.waiter = undefined;
				reject(
					new Error(
						`opencode-relay did not become ready within ${timeoutMs}ms`,
					),
				);
			}, timeoutMs);
			timer.unref?.();
			this.waiter = {
				resolve: (port) => {
					clearTimeout(timer);
					resolve(port);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			};
		});
	}

	touch(): void {
		if (this.boundPort !== undefined) this.armIdleTimer();
	}

	stop(): void {
		this.stopped = true;
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
				const r = await fetch(UP + u.pathname + u.search, {
      method: req.method,
      headers: h,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      redirect: "manual",
    }).catch((e) =>
      new Response(JSON.stringify({ type: "error", error: { type: "relay", message: String(e && e.message || e) } }), { status: 502, headers: { "content-type": "application/json" } })
    );
    if (r instanceof Response) return r;
    const out = new Headers();
    r.headers.forEach((v, k) => {
      if (k !== "content-length") out.set(k, v);
    });
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: out });
  },
});
console.log("PORT=" + server.port);
`;
