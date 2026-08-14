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
	renameSync,
	rmSync,
	statSync,
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
	return value.replace(
		/[\u0000-\u001f\u007f]/g,
		(character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
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

function parsePositiveInteger(
	value: string | undefined,
	fallback: number,
): number {
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
// Lines handed to the open stream whose write callbacks have not fired yet,
// i.e. data that may still sit in the stream's user-space buffer and would be
// LOST if the process exits hard (pi's main.js calls process.exit(0) right
// after extension startup). flushLogsSync() recovers exactly these lines via
// a synchronous append. Callbacks fire in write order, so FIFO shift is exact.
const pendingStreamLines: string[] = [];

function trackStreamWrite(stream: WriteStream, line: string): void {
	pendingStreamLines.push(line);
	stream.write(line, () => {
		pendingStreamLines.shift();
	});
}

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

function rotateLogFileSyncIfNeeded(): void {
	let size: number;
	try {
		size = statSync(LOG_PATH).size;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
		throw err;
	}
	if (size < MAX_LOG_BYTES) return;

	for (let index = LOG_BACKUP_COUNT; index >= 1; index--) {
		const source = index === 1 ? LOG_PATH : `${LOG_PATH}.${index - 1}`;
		const target = `${LOG_PATH}.${index}`;
		rmSync(target, { force: true });
		try {
			renameSync(source, target);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
		}
	}
}

function flushQueuedFallback(): void {
	if (queuedLines.length === 0) return;
	const lines = queuedLines.splice(0);
	try {
		ensureLogDirOnce();
		const data = lines.join("");
		const bytes = Buffer.byteLength(data, "utf8");
		if (logBytes > 0 && logBytes + bytes > MAX_LOG_BYTES) {
			rotateLogFileSyncIfNeeded();
			// After rotation LOG_PATH no longer exists; the append recreates it.
			logBytes = 0;
		}
		appendFileSync(LOG_PATH, data, "utf8");
		logBytes += bytes;
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
		trackStreamWrite(stream, line);
		logBytes += bytes;
	}
}

async function openLogStream(forceRotate = false): Promise<void> {
	await ensureLogDirAsync();
	// A synchronous flush may have declared streams unavailable while this
	// open was in flight; bail out instead of re-attaching a stream.
	if (logStreamUnavailable) {
		flushQueuedFallback();
		return;
	}
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
		trackStreamWrite(logStream, formatted);
		logBytes += bytes;
		return;
	}

	queuedLines.push(formatted);
	if (logStreamUnavailable) {
		// Sync-fallback mode (e.g. after flushLogsSync()): never defer to a
		// stream open that may not complete before a hard process exit.
		flushQueuedFallback();
		return;
	}
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

/**
 * Guarantee that everything logged so far is on disk SYNCHRONOUSLY.
 *
 * Pi's main.js calls `process.exit(0)` right after extension startup, which
 * discards the WriteStream's buffered (not-yet-flushed) writes and the queue
 * of lines waiting for the stream to open — that is why the startup summary
 * line was sometimes missing from free.log. This function:
 *
 * 1. Recovers lines still buffered in the open stream (tracked via write
 *    callbacks), destroys the stream so its buffered copies are dropped
 *    without duplicating the sync-written ones, and marks logging as
 *    stream-unavailable so all subsequent lines use the synchronous path.
 * 2. Appends everything (recovered + still-queued lines) with
 *    `appendFileSync`, honoring the MAX_LOG_BYTES rotation policy via a
 *    synchronous rotation when the size limit would be exceeded.
 *
 * Best-effort: never throws. Intended to be called once at the end of
 * `piFreeEntry`, after `logStartupSummary()`.
 */
export function flushLogsSync(): void {
	if (!FILE_LOG_ENABLED) return;
	try {
		if (logStream) {
			const buffered = pendingStreamLines.splice(0);
			const stream = logStream;
			logStream = null;
			logStreamUnavailable = true;
			try {
				stream.destroy();
			} catch {
				// best-effort
			}
			// Recover in front of any still-queued lines so file order is kept.
			queuedLines.unshift(...buffered);
			// Their bytes were already counted in logBytes when handed to the
			// stream; un-count them so flushQueuedFallback doesn't double-count
			// (which would trip size-based rotation early).
			for (const line of buffered) {
				logBytes = Math.max(0, logBytes - Buffer.byteLength(line, "utf8"));
			}
		} else {
			// No open stream (either never opened, open still in flight, or
			// already in sync-fallback mode). Everything pending is in
			// queuedLines; stop any in-flight stream open from re-attaching.
			logStreamUnavailable = true;
		}
		flushQueuedFallback();
	} catch (err) {
		// Never break startup for an observability flush.
		console.error("Failed to flush logs synchronously:", err);
	}
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
