/**
 * Session-start timing helpers.
 *
 * Pi-lens logs the total cost of session_start via debug messages. Extensions
 * like pi-free attach async handlers to session_start that can materially
 * increase that cost (model refresh, accessibility probes, etc.). This module
 * wraps handlers so those delays show up in the logs and can be audited.
 */

import { createLogger } from "./logger.ts";
import {
	recordDetachedSessionWork,
	recordSessionStartHandler,
} from "./startup-timing.ts";

const _logger = createLogger("session-start-metrics");

export interface SessionStartHandlerOptions {
	/** Treat a returned promise as detached so session_start is not blocked. */
	detached?: boolean;
}

function now(): number {
	return performance.now();
}

/** Track work deliberately left running after a session_start handler returns. */
export function trackDetachedSessionStart<T>(
	label: string,
	work: PromiseLike<T>,
	onError?: (error: unknown) => void,
): void {
	const start = now();
	void Promise.resolve(work).then(
		() => {
			const durationMs = now() - start;
			recordDetachedSessionWork(label, durationMs, true);
			_logger.info(
				`session_start ${label} detached complete: ${Math.round(durationMs)}ms`,
			);
		},
		(error: unknown) => {
			const durationMs = now() - start;
			recordDetachedSessionWork(label, durationMs, false);
			_logger.warn(
				`session_start ${label} detached failed: ${Math.round(durationMs)}ms`,
				{
					error: error instanceof Error ? error.message : String(error),
				},
			);
			try {
				onError?.(error);
			} catch {
				// Observability callbacks must not create an unhandled rejection.
			}
		},
	);
}

/**
 * Wrap a session_start handler with monotonic handler timing. Detached handlers
 * record their immediate return separately from the eventual task completion.
 */
export function wrapSessionStartHandler<TArgs extends unknown[]>(
	label: string,
	handler: (...args: TArgs) => void | Promise<void>,
	options: SessionStartHandlerOptions = {},
): (...args: TArgs) => Promise<void> {
	return async (...args) => {
		const start = now();
		try {
			const result = handler(...args);
			if (options.detached && result && typeof result.then === "function") {
				trackDetachedSessionStart(`${label}-detached`, result);
				const durationMs = now() - start;
				recordSessionStartHandler(label, durationMs, true);
				_logger.info(
					`session_start ${label} handler return: ${Math.round(durationMs)}ms`,
				);
				return;
			}
			await result;
			const durationMs = now() - start;
			recordSessionStartHandler(label, durationMs, true);
			_logger.info(
				`session_start ${label} handler complete: ${Math.round(durationMs)}ms`,
			);
		} catch (error) {
			const durationMs = now() - start;
			recordSessionStartHandler(label, durationMs, false);
			_logger.warn(
				`session_start ${label} handler failed: ${Math.round(durationMs)}ms`,
				{
					error: error instanceof Error ? error.message : String(error),
				},
			);
			throw error;
		}
	};
}
