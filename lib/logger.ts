/**
 * Structured logging utility.
 * Replaces console.log statements with namespaced, level-based logging.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
	timestamp: string;
	level: LogLevel;
	namespace: string;
	message: string;
	data?: Record<string, unknown>;
}

const LOG_LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

// Default to error-only. Set LOG_LEVEL=debug or LOG_LEVEL=info to see more.
const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "error";

function shouldLog(level: LogLevel): boolean {
	return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(entry: LogEntry): string {
	const data = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
	return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.namespace}] ${entry.message}${data}`;
}

function log(
	level: LogLevel,
	namespace: string,
	message: string,
	data?: Record<string, unknown>,
): void {
	if (!shouldLog(level)) return;

	const entry: LogEntry = {
		timestamp: new Date().toISOString(),
		level,
		namespace,
		message,
		data,
	};

	const formatted = formatMessage(entry);

	switch (level) {
		case "debug":
			console.debug(formatted);
			break;
		case "info":
			console.info(formatted);
			break;
		case "warn":
			console.warn(formatted);
			break;
		case "error":
			console.error(formatted);
			break;
	}
}

export const logger = {
	debug: (namespace: string, message: string, data?: Record<string, unknown>) =>
		log("debug", namespace, message, data),
	info: (namespace: string, message: string, data?: Record<string, unknown>) =>
		log("info", namespace, message, data),
	warn: (namespace: string, message: string, data?: Record<string, unknown>) =>
		log("warn", namespace, message, data),
	error: (namespace: string, message: string, data?: Record<string, unknown>) =>
		log("error", namespace, message, data),
};

/**
 * Create a namespaced logger instance.
 */
export function createLogger(namespace: string) {
	return {
		debug: (message: string, data?: Record<string, unknown>) =>
			logger.debug(namespace, message, data),
		info: (message: string, data?: Record<string, unknown>) =>
			logger.info(namespace, message, data),
		warn: (message: string, data?: Record<string, unknown>) =>
			logger.warn(namespace, message, data),
		error: (message: string, data?: Record<string, unknown>) =>
			logger.error(namespace, message, data),
	};
}
