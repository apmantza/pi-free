/**
 * Session-start timing helpers.
 *
 * Pi-lens logs the total cost of session_start via debug messages. Extensions
 * like pi-free attach async handlers to session_start that can materially
 * increase that cost (model refresh, accessibility probes, etc.). This module
 * wraps handlers so those delays show up in the logs and can be audited.
 */

import { createLogger } from "./logger.ts";

const _logger = createLogger("session-start-metrics");

/**
 * Wrap a session_start handler so its wall-clock duration is logged.
 * The label should identify the provider/feature being timed.
 */
export function wrapSessionStartHandler<TArgs extends unknown[]>(
	label: string,
	handler: (...args: TArgs) => void | Promise<void>,
): (...args: TArgs) => Promise<void> {
	return async (...args) => {
		const start = Date.now();
		try {
			await handler(...args);
		} finally {
			_logger.info(`session_start ${label}: ${Date.now() - start}ms`);
		}
	};
}

/**
 * Time a synchronous or asynchronous block and log its duration.
 * Returns the result of the block.
 */
export async function timeAsync<T>(
	label: string,
	block: () => T | Promise<T>,
): Promise<T> {
	const start = Date.now();
	try {
		return await block();
	} finally {
		_logger.info(`${label}: ${Date.now() - start}ms`);
	}
}
