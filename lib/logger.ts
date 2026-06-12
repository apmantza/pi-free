/**
 * Structured logging utility.
 * Replaces console.log statements with namespaced, level-based logging.
 *
 * File logging:
 * - Default file: ~/.pi/free.log
 * - Override path: PI_FREE_LOG_PATH=/custom/path/free.log
 * - Disable file logging: PI_FREE_FILE_LOG=false
 */

import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, resolveSafeDataFile } from "./paths.ts";

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

// Console default: error-only. Set LOG_LEVEL=debug or LOG_LEVEL=info to see more.
const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "error";
// File default: debug (so we can inspect full behavior in ~/.pi/free.log).
const fileLevel: LogLevel =
	(process.env.PI_FREE_LOG_LEVEL as LogLevel) || "debug";

function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
	return LOG_LEVELS[level] >= LOG_LEVELS[minLevel];
}

function formatMessage(entry: LogEntry): string {
	let data = "";
	if (entry.data) {
		try {
			data = ` ${JSON.stringify(entry.data)}`;
		} catch {
			data = " [unserializable-data]";
		}
	}
	return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.namespace}] ${entry.message}${data}`;
}

const LOG_PATH = resolveSafeDataFile(process.env.PI_FREE_LOG_PATH, "free.log");
const FILE_LOG_ENABLED = process.env.PI_FREE_FILE_LOG !== "false";

function appendToFile(line: string): void {
	if (!FILE_LOG_ENABLED) return;
	try {
		ensureDir(join(LOG_PATH, ".."));
		appendFileSync(LOG_PATH, `${line}\n`, "utf8");
	} catch (err) {
		console.error("Failed to write to log file:", err);
	}
}

function log(
	level: LogLevel,
	namespace: string,
	message: string,
	data?: Record<string, unknown>,
): void {
	const logToConsole = shouldLog(level, currentLevel);
	const logToFile = shouldLog(level, fileLevel);
	if (!logToConsole && !logToFile) return;

	const entry: LogEntry = {
		timestamp: new Date().toISOString(),
		level,
		namespace,
		message,
		data,
	};

	const formatted = formatMessage(entry);
	if (logToFile) {
		appendToFile(formatted);
	}

	if (!logToConsole) {
		return;
	}

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
