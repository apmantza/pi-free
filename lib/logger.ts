/**
 * Structured logging utility.
 * Replaces console.log statements with namespaced, level-based logging.
 *
 * File logging:
 * - Default file: ~/.pi/free.log
 * - Override filename: PI_FREE_LOG_PATH=custom-free.log
 * - Disable file logging: PI_FREE_FILE_LOG=false
 * - Rotate size: PI_FREE_LOG_MAX_BYTES=10485760 (default 10 MiB; 3 backups)
 */

import {
	appendFileSync,
	createWriteStream,
	type WriteStream,
} from "node:fs";
import { mkdir as mkdirAsync, rename, rm, stat } from "node:fs/promises";
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
const DEFAULT_MAX_LOG_BYTES = 10 * 1024 * 1024;
const MAX_LOG_BYTES = parsePositiveInteger(
	process.env.PI_FREE_LOG_MAX_BYTES,
	DEFAULT_MAX_LOG_BYTES,
);
const LOG_BACKUP_COUNT = 3;

function parsePositiveInteger(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// File logging is buffered through a lazily-opened append stream so startup
// does not pay synchronous open/write/rotation work. The first stream open and
// every size-based rotation use async fs operations; lines emitted while that
// work is pending stay in a small in-memory queue. If streams are unavailable
// (e.g. a minimal test mock), we retain the synchronous fallback.
let logStream: WriteStream | null = null;
let logDirEnsured = false;
let logStreamUnavailable = false;
let logStreamReady: Promise<void> | null = null;
let logBytes = 0;
const queuedLines: string[] = [];

function ensureLogDirOnce(): void {
	if (logDirEnsured) return;
	ensureDir(dirname(LOG_PATH));
	logDirEnsured = true;
}

async function ensureLogDirAsync(): Promise<void> {
	if (logDirEnsured) return;
	await mkdirAsync(dirname(LOG_PATH), { recursive: true });
	logDirEnsured = true;
}

async function moveLog(source: string, target: string): Promise<void> {
	try {
		await rm(target, { force: true });
		await rename(source, target);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	}
}

async function rotateLogFilesIfNeeded(force = false): Promise<void> {
	let size: number;
	try {
		size = (await stat(LOG_PATH)).size;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
		throw err;
	}
	if (!force && size < MAX_LOG_BYTES) return;

	for (let index = LOG_BACKUP_COUNT; index >= 1; index--) {
		const source = index === 1 ? LOG_PATH : `${LOG_PATH}.${index - 1}`;
		await moveLog(source, `${LOG_PATH}.${index}`);
	}
}

function flushQueuedFallback(): void {
	if (queuedLines.length === 0) return;
	const lines = queuedLines.splice(0);
	try {
		ensureLogDirOnce();
		appendFileSync(LOG_PATH, lines.join(""), "utf8");
	} catch (err) {
		console.error("Failed to write to log file:", err);
	}
}

function attachLogStream(stream: WriteStream, existingBytes: number): void {
	stream.on("error", (err) => {
		console.error("Failed to write to log file:", err);
		logStreamUnavailable = true;
		logStream = null;
		flushQueuedFallback();
	});
	logStream = stream;
	logBytes = existingBytes;
	const pending = queuedLines.splice(0);
	for (let index = 0; index < pending.length; index++) {
		const line = pending[index];
		const bytes = Buffer.byteLength(line, "utf8");
		if (logBytes > 0 && logBytes + bytes > MAX_LOG_BYTES) {
			queuedLines.push(...pending.slice(index));
			break;
		}
		stream.write(line);
		logBytes += bytes;
	}
}

async function openLogStream(forceRotate = false): Promise<void> {
	await ensureLogDirAsync();
	await rotateLogFilesIfNeeded(forceRotate);
	let existingBytes = 0;
	try {
		existingBytes = (await stat(LOG_PATH)).size;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	}
	if (typeof createWriteStream !== "function") {
		logStreamUnavailable = true;
		flushQueuedFallback();
		return;
	}
	const stream = createWriteStream(LOG_PATH, {
		flags: "a",
		encoding: "utf8",
	});
	attachLogStream(stream, existingBytes);
}

function finishLogStreamOperation(): void {
	logStreamReady = null;
	if (logStream && (logBytes >= MAX_LOG_BYTES || queuedLines.length > 0)) {
		queueMicrotask(() => startLogStream(true));
	}
}

function startLogStream(rotationRequested = false): void {
	if (logStreamReady) return;
	if (logStreamUnavailable) {
		flushQueuedFallback();
		return;
	}
	if (logStream && !rotationRequested) return;

	if (logStream && rotationRequested) {
		const oldStream = logStream;
		logStream = null;
		logStreamReady = new Promise<void>((resolve) => oldStream.end(resolve))
			.then(() => openLogStream(true))
			.catch((err) => {
				console.error("Failed to rotate log file:", err);
				logStreamUnavailable = true;
				flushQueuedFallback();
			})
			.finally(finishLogStreamOperation);
		return;
	}

	logStreamReady = openLogStream()
		.catch((err) => {
			console.error("Failed to open log file stream:", err);
			logStreamUnavailable = true;
			flushQueuedFallback();
		})
		.finally(finishLogStreamOperation);
}

function appendToFile(line: string): void {
	if (!FILE_LOG_ENABLED) return;
	const formatted = `${line}\n`;
	const bytes = Buffer.byteLength(formatted, "utf8");
	if (logStream && logBytes + bytes < MAX_LOG_BYTES) {
		logStream.write(formatted);
		logBytes += bytes;
		return;
	}

	queuedLines.push(formatted);
	startLogStream(Boolean(logStream));
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

export function getLogPath(): string {
	return LOG_PATH;
}

export function isFileLoggingEnabled(): boolean {
	return FILE_LOG_ENABLED;
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
