/**
 * Session file parsing - extracts historical usage data from Pi session files
 *
 * Pi stores sessions in ~/.pi/agent/sessions/{cwd-hash}/*.jsonl
 * Each line is a JSON entry with type "session" or "message"
 */

import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger } from "./lib/logger.ts";

const _logger = createLogger("session-parser");

export interface SessionMessage {
	provider: string;
	model: string;
	tokensIn: number;
	tokensOut: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	timestamp: number;
}

export interface ParsedSession {
	sessionId: string;
	messages: SessionMessage[];
}

function getSessionsDir(): string {
	const agentDir =
		process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	return join(agentDir, "sessions");
}

async function getAllSessionFiles(signal?: AbortSignal): Promise<string[]> {
	const sessionsDir = getSessionsDir();
	const files: string[] = [];

	try {
		const cwdDirs = await readdir(sessionsDir, { withFileTypes: true });
		for (const dir of cwdDirs) {
			if (signal?.aborted) return files;
			if (!dir.isDirectory()) continue;
			const cwdPath = join(sessionsDir, dir.name);
			try {
				const sessionFiles = await readdir(cwdPath);
				for (const file of sessionFiles) {
					if (file.endsWith(".jsonl")) {
						files.push(join(cwdPath, file));
					}
				}
			} catch {
				// Skip directories we can't read
			}
		}
	} catch {
		// Return empty if we can't read sessions dir
	}

	return files;
}

async function parseSessionFile(
	filePath: string,
	seenHashes: Set<string>,
	signal?: AbortSignal,
): Promise<ParsedSession | null> {
	try {
		const content = await readFile(filePath, "utf8");
		if (signal?.aborted) return null;

		const lines = content.trim().split("\n");
		const messages: SessionMessage[] = [];
		let sessionId = "";

		for (let i = 0; i < lines.length; i++) {
			if (signal?.aborted) return null;
			if (i % 500 === 0) {
				await new Promise<void>((resolve) => setImmediate(resolve));
			}

			const line = lines[i]!;
			if (!line.trim()) continue;

			try {
				const entry = JSON.parse(line);

				if (entry.type === "session") {
					sessionId = entry.id;
				} else if (
					entry.type === "message" &&
					entry.message?.role === "assistant"
				) {
					const msg = entry.message;
					if (msg.usage && msg.provider && msg.model) {
						const tokensIn = msg.usage.input || 0;
						const tokensOut = msg.usage.output || 0;
						const cacheRead = msg.usage.cacheRead || 0;
						const cacheWrite = msg.usage.cacheWrite || 0;
						const cost = msg.usage.cost?.total || 0;

						const fallbackTs = entry.timestamp
							? new Date(entry.timestamp).getTime()
							: 0;
						const timestamp =
							msg.timestamp || (Number.isNaN(fallbackTs) ? 0 : fallbackTs);

						const totalTokens = tokensIn + tokensOut + cacheRead + cacheWrite;
						const hash = `${timestamp}:${totalTokens}`;
						if (seenHashes.has(hash)) continue;
						seenHashes.add(hash);

						messages.push({
							provider: msg.provider,
							model: msg.model,
							tokensIn,
							tokensOut,
							cacheRead,
							cacheWrite,
							cost,
							timestamp,
						});
					}
				}
			} catch {
				// Skip malformed lines
			}
		}

		return sessionId ? { sessionId, messages } : null;
	} catch {
		return null;
	}
}

export type TimePeriod = "today" | "thisWeek" | "allTime";

export interface TimeRange {
	start: number;
	end?: number;
}

export function getTimeRange(period: TimePeriod): TimeRange {
	const now = Date.now();
	const startOfToday = new Date();
	startOfToday.setHours(0, 0, 0, 0);

	switch (period) {
		case "today":
			return { start: startOfToday.getTime(), end: now };
		case "thisWeek": {
			const startOfWeek = new Date();
			const dayOfWeek = startOfWeek.getDay();
			const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
			startOfWeek.setDate(startOfWeek.getDate() - daysSinceMonday);
			startOfWeek.setHours(0, 0, 0, 0);
			return { start: startOfWeek.getTime(), end: now };
		}
		case "allTime":
			return { start: 0, end: now };
	}
}

export function filterByTimeRange(
	messages: SessionMessage[],
	range: TimeRange,
): SessionMessage[] {
	return messages.filter((m) => {
		if (m.timestamp < range.start) return false;
		if (range.end && m.timestamp > range.end) return false;
		return true;
	});
}

export interface ModelStats {
	count: number;
	tokensIn: number;
	tokensOut: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export interface ProviderStats {
	messages: number;
	tokensIn: number;
	tokensOut: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	models: Record<string, ModelStats>;
}

export interface SessionFileStats {
	totalMessages: number;
	totalTokensIn: number;
	totalTokensOut: number;
	totalCacheRead: number;
	totalCacheWrite: number;
	totalCost: number;
	providers: Record<string, ProviderStats>;
	sessions: Set<string>;
}

export function createEmptyStats(): SessionFileStats {
	return {
		totalMessages: 0,
		totalTokensIn: 0,
		totalTokensOut: 0,
		totalCacheRead: 0,
		totalCacheWrite: 0,
		totalCost: 0,
		providers: {},
		sessions: new Set(),
	};
}

export function aggregateMessages(
	messages: SessionMessage[],
	sessionId: string,
): SessionFileStats {
	const stats = createEmptyStats();
	stats.sessions.add(sessionId);

	for (const msg of messages) {
		stats.totalMessages++;
		stats.totalTokensIn += msg.tokensIn;
		stats.totalTokensOut += msg.tokensOut;
		stats.totalCacheRead += msg.cacheRead;
		stats.totalCacheWrite += msg.cacheWrite;
		stats.totalCost += msg.cost;

		if (!stats.providers[msg.provider]) {
			stats.providers[msg.provider] = {
				messages: 0,
				tokensIn: 0,
				tokensOut: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0,
				models: {},
			};
		}
		const provider = stats.providers[msg.provider]!;
		provider.messages++;
		provider.tokensIn += msg.tokensIn;
		provider.tokensOut += msg.tokensOut;
		provider.cacheRead += msg.cacheRead;
		provider.cacheWrite += msg.cacheWrite;
		provider.cost += msg.cost;

		if (!provider.models[msg.model]) {
			provider.models[msg.model] = {
				count: 0,
				tokensIn: 0,
				tokensOut: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0,
			};
		}
		const model = provider.models[msg.model]!;
		model.count++;
		model.tokensIn += msg.tokensIn;
		model.tokensOut += msg.tokensOut;
		model.cacheRead += msg.cacheRead;
		model.cacheWrite += msg.cacheWrite;
		model.cost += msg.cost;
	}

	return stats;
}

export async function collectSessionFileStats(
	period: TimePeriod = "allTime",
	signal?: AbortSignal,
): Promise<SessionFileStats> {
	const range = getTimeRange(period);
	const allStats = createEmptyStats();

	const sessionFiles = await getAllSessionFiles(signal);
	if (signal?.aborted) return allStats;

	const seenHashes = new Set<string>();

	for (const filePath of sessionFiles) {
		if (signal?.aborted) return allStats;

		const parsed = await parseSessionFile(filePath, seenHashes, signal);
		if (signal?.aborted) return allStats;
		if (!parsed) continue;

		const filteredMessages = filterByTimeRange(parsed.messages, range);
		if (filteredMessages.length === 0) continue;

		const fileStats = aggregateMessages(filteredMessages, parsed.sessionId);

		allStats.sessions.add(parsed.sessionId);
		allStats.totalMessages += fileStats.totalMessages;
		allStats.totalTokensIn += fileStats.totalTokensIn;
		allStats.totalTokensOut += fileStats.totalTokensOut;
		allStats.totalCacheRead += fileStats.totalCacheRead;
		allStats.totalCacheWrite += fileStats.totalCacheWrite;
		allStats.totalCost += fileStats.totalCost;

		for (const [providerName, providerStats] of Object.entries(
			fileStats.providers,
		)) {
			if (!allStats.providers[providerName]) {
				allStats.providers[providerName] = {
					messages: 0,
					tokensIn: 0,
					tokensOut: 0,
					cacheRead: 0,
					cacheWrite: 0,
					cost: 0,
					models: {},
				};
			}
			const allProvider = allStats.providers[providerName]!;
			allProvider.messages += providerStats.messages;
			allProvider.tokensIn += providerStats.tokensIn;
			allProvider.tokensOut += providerStats.tokensOut;
			allProvider.cacheRead += providerStats.cacheRead;
			allProvider.cacheWrite += providerStats.cacheWrite;
			allProvider.cost += providerStats.cost;

			for (const [modelName, modelStats] of Object.entries(
				providerStats.models,
			)) {
				if (!allProvider.models[modelName]) {
					allProvider.models[modelName] = {
						count: 0,
						tokensIn: 0,
						tokensOut: 0,
						cacheRead: 0,
						cacheWrite: 0,
						cost: 0,
					};
				}
				const allModel = allProvider.models[modelName]!;
				allModel.count += modelStats.count;
				allModel.tokensIn += modelStats.tokensIn;
				allModel.tokensOut += modelStats.tokensOut;
				allModel.cacheRead += modelStats.cacheRead;
				allModel.cacheWrite += modelStats.cacheWrite;
				allModel.cost += modelStats.cost;
			}
		}
	}

	return allStats;
}
