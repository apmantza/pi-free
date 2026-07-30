/**
 * Structured logging utility.
 * Replaces console.log statements with namespaced, level-based logging.
 *
 * File logging:
 * - Default file: ~/.pi/free.log
 * - Override path: PI_FREE_LOG_PATH=/custom/path/free.log
 * - Disable file logging: PI_FREE_FILE_LOG=false
 */

import {
	appendFileSync,
	createWriteStream,
	type WriteStream,
} from "node:fs";
import { dirname } from "node:path";
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
// File default: debug (so we can inspect full behavior in ~/.pi/free.log).
const VALID_LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"]);

function parseLogLevel(
	envValue: string | undefined,
	defaultLevel: LogLevel,
): LogLevel {
	if (!envValue) return defaultLevel;
	const normalized = envValue.toLowerCase() as LogLevel;
	return VALID_LEVELS.has(normalized) ? normalized : defaultLevel;
}

const currentLevel: LogLevel = parseLogLevel(process.env.LOG_LEVEL, "error");
const fileLevel: LogLevel = parseLogLevel(
	process.env.PI_FREE_LOG_LEVEL,
	"debug",
);

function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
	return LOG_LEVELS[level] >= LOG_LEVELS[minLevel];
}

function sanitizeLogText(value: string): string {
	return value.replace(/[\u0000-\u001f\u007f]/g, (character) =>
		`\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
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
	return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${sanitizeLogText(entry.namespace)}] ${sanitizeLogText(entry.message)}${data}`;
}

const LOG_PATH = resolveSafeDataFile(process.env.PI_FREE_LOG_PATH, "free.log");
const FILE_LOG_ENABLED = process.env.PI_FREE_FILE_LOG !== "false";

// File logging is buffered through a lazily-opened append stream so startup
// (which emits many log lines) does not pay a synchronous open+write+close —
// plus an existsSync — on every single line. The log directory is ensured once,
// not per line. If a stream cannot be opened (e.g. fs streams are absent under
// a test mock), we fall back to a single synchronous append per line so logs
// are never silently dropped.
let logStream: WriteStream | null = null;
let logDirEnsured = false;
let logStreamUnavailable = false;

function ensureLogDirOnce(): void {
	if (logDirEnsured) return;
	ensureDir(dirname(LOG_PATH));
	logDirEnsured = true;
}

function getLogStream(): WriteStream | null {
	if (logStream) return logStream;
	if (logStreamUnavailable) return null;
	if (typeof createWriteStream !== "function") {
		// fs.createWriteStream missing (e.g. a minimal test mock) — use fallback.
		logStreamUnavailable = true;
		return null;
	}
	try {
		ensureLogDirOnce();
		const stream = createWriteStream(LOG_PATH, {
			flags: "a",
			encoding: "utf8",
		});
		stream.on("error", (err) => {
			console.error("Failed to write to log file:", err);
			logStreamUnavailable = true;
			logStream = null;
		});
		logStream = stream;
		return logStream;
	} catch (err) {
		console.error("Failed to open log file stream:", err);
		logStreamUnavailable = true;
		return null;
	}
}

function appendToFile(line: string): void {
	if (!FILE_LOG_ENABLED) return;
	const stream = getLogStream();
	if (stream) {
		stream.write(`${line}\n`);
		return;
	}
	// Fallback: a single synchronous append (used only when streams are
	// unavailable). Still ensures the directory just once.
	try {
		ensureLogDirOnce();
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
