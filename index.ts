/**
 * Pi-Free Providers Index
 *
 * Provides free model filtering for ALL providers (built-in + extension)
 * plus unique free/paid providers not covered by pi's built-in providers.
 *
 * The unique provider list is defined in `UNIQUE_PROVIDERS` below; see
 * `README.md` for the full provider catalog.
 */

// MUST be the first import: its module body captures the startup timing
// origin (performance.now()) at module scope, and ES modules evaluate
// imports depth-first in declaration order — so the clock starts before any
// provider module below executes. Do not reorder above/below casually.
import {
	beginSessionStart,
	beginStartup,
	endPhase,
	finalizeStartup,
	formatStartupSummary,
	logStartupSummary,
	startPhase,
	timeProvider,
} from "./lib/startup-timing.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setupBuiltInProviderToggles } from "./lib/built-in-toggle.ts";
import { createLogger, flushLogsSync } from "./lib/logger.ts";
import {
	processQuotaResponse,
	formatQuotaStatus,
} from "./lib/quota-monitor.ts";
import { formatHealthReport } from "./lib/health.ts";
import { logWireSignature } from "./lib/wire-signature.ts";
import {
	startModelCall,
	recordModelCall,
	getAllTelemetry,
	getProviderErrorCounts,
	getTelemetryPath,
	clearTelemetry,
} from "./lib/telemetry.ts";
import {
	applyGlobalFilter,
	getGlobalFreeOnly,
	getProviderRegistry,
	isFreeModel,
	registerWithGlobalToggle,
} from "./lib/registry.ts";
// Import unique provider extensions (only providers NOT built into pi)
import cline from "./providers/cline/cline.ts";
import crofai from "./providers/crofai/crofai.ts";
import kilo from "./providers/kilo/kilo.ts";
import llm7 from "./providers/llm7/llm7.ts";
import deepinfra from "./providers/deepinfra/deepinfra.ts";
import fastrouter from "./providers/fastrouter/fastrouter.ts";
import requesty from "./providers/requesty/requesty.ts";
import stepfun from "./providers/stepfun/stepfun.ts";
import gmi from "./providers/gmi/gmi.ts";
import agnes from "./providers/agnes/agnes.ts";
import sambanova from "./providers/sambanova/sambanova.ts";
import novita from "./providers/novita/novita.ts";
import venice from "./providers/venice/venice.ts";
import infron from "./providers/infron/infron.ts";
import merge from "./providers/merge/merge.ts";
import routeway from "./providers/routeway/routeway.ts";
import opengateway from "./providers/opengateway/opengateway.ts";
import tokenRouter from "./providers/tokenrouter/tokenrouter.ts";
import ollama from "./providers/ollama/ollama.ts";
import zenmux from "./providers/zenmux/zenmux.ts";
import bai from "./providers/bai/bai.ts";
import anyapi from "./providers/anyapi/anyapi.ts";
import qoder from "./providers/qoder/qoder.ts";

/**
 * Single source of truth for unique provider extensions (providers NOT
 * built into pi). Each entry is an async function that registers its
 * provider with pi. Add a new provider by:
 *   1. Adding the import above
 *   2. Adding an entry to this array
 *   3. Adding the provider constant + getter to constants.ts and config.ts
 */
const UNIQUE_PROVIDERS: ReadonlyArray<(pi: ExtensionAPI) => Promise<void>> = [
	kilo,
	ollama,
	cline,
	zenmux,
	crofai,
	llm7,
	deepinfra,
	sambanova,
	novita,
	venice,
	infron,
	merge,
	fastrouter,
	requesty,
	stepfun,
	gmi,
	agnes,
	routeway,
	opengateway,
	tokenRouter,
	anyapi,
	bai,
	qoder,
];

const _logger = createLogger("pi-free");

// =============================================================================
// Initialization Guard
// =============================================================================

/**
 * ExtensionAPI identity that global event handlers were last registered for.
 *
 * A reload creates a NEW runner (fresh ExtensionAPI) while this module's state
 * can survive — the same host behavior lib/built-in-toggle.ts and
 * lib/native-provider.ts key their guards on. The new runner must receive the
 * handlers again or it would run with no /toggle-free, /free-providers, quota
 * monitoring, or telemetry at all. Guarding on identity keeps same-runner
 * re-entry (which would otherwise accumulate duplicate pi.on() handlers —
 * pi.on() is additive with no unsubscribe API) from double-registering.
 */
let handlersRegisteredFor: ExtensionAPI | undefined;

// =============================================================================
// Global Commands
// =============================================================================

function setupGlobalCommands(pi: ExtensionAPI) {
	// /toggle-free - Global free-only mode toggle
	pi.registerCommand("toggle-free", {
		description: "Toggle global free-only mode for all providers",
		handler: async (_args, ctx) => {
			const current = getGlobalFreeOnly();
			const next = !current;
			applyGlobalFilter(next, { force: true });

			const registry = getProviderRegistry();
			const providerCount = registry.size;

			if (next) {
				const totalFree = [...registry.values()].reduce(
					(sum, e) => sum + e.stored.free.length,
					0,
				);
				ctx.ui.notify(
					`Free-only mode: ON (${totalFree} free models across ${providerCount} providers)`,
					"info",
				);
			} else {
				const totalAll = [...registry.values()].reduce(
					(sum, e) => sum + (e.stored.all.length || e.stored.free.length),
					0,
				);
				ctx.ui.notify(
					`Free-only mode: OFF (all ${totalAll} models visible across ${providerCount} providers)`,
					"info",
				);
			}
		},
	});

	// /free-providers - Show free model counts by provider
	pi.registerCommand("free-providers", {
		description: "Show free/paid model counts for all pi-free providers",
		handler: async (_args, ctx) => {
			const lines = ["📊 Pi-Free Providers:", ""];
			const registry = getProviderRegistry();

			// Freemium providers - all models share a free tier quota
			const freemiumProviders = new Set(["sambanova", "ollama-cloud"]);
			// Trial credit providers - one-time credits, otherwise paid
			const trialCreditProviders = new Set(["deepinfra"]);

			for (const [id, entry] of registry) {
				const free = entry.stored.free.length;
				const all = entry.stored.all.length || free;
				const indicator = entry.hasKey ? "🔑" : "🆓";
				const paid = all - free;

				if (freemiumProviders.has(id)) {
					// Freemium: all models share a free tier (e.g., 1,000 reqs/month)
					lines.push(`${indicator} ${id}: ${all} models (freemium)`);
				} else if (trialCreditProviders.has(id)) {
					// Trial credit: one-time credits, otherwise paid
					lines.push(`${indicator} ${id}: ${all} models ($5 trial credit)`);
				} else if (paid === 0 && free > 0) {
					// All models are actually free
					lines.push(`${indicator} ${id}: ${free} free models`);
				} else {
					// Mix of free and paid
					lines.push(
						`${indicator} ${id}: ${free} free / ${paid} paid (${all} total)`,
					);
				}
			}

			if (registry.size === 0) {
				lines.push("(No providers registered yet)");
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// /telemetry — Show model telemetry data
	pi.registerCommand("free-telemetry", {
		description:
			"Show real-world performance data for free models (tokens/s, latency, success rate)",
		handler: async (_args, ctx) => {
			const allTelemetry = getAllTelemetry();
			const entries = Object.entries(allTelemetry);

			if (entries.length === 0) {
				ctx.ui.notify("No telemetry data yet. Use some free models first!", "info");
				return;
			}

			// Sort by total calls descending
			entries.sort((a, b) => b[1].totalCalls - a[1].totalCalls);

			const lines = ["📊 Model Telemetry:", ""];
			lines.push(
				"Model".padEnd(40) +
					" " +
					"Calls".padEnd(6) +
					" " +
					"OK%".padEnd(6) +
					" " +
					"Lat".padEnd(7) +
					" " +
					"tok/s".padEnd(7) +
					" " +
					"Cost",
			);
			lines.push(`─`.repeat(75));

			for (const [key, t] of entries.slice(0, 20)) {
				const name = key.length > 38 ? key.slice(0, 35) + "..." : key;
				const calls = String(t.totalCalls).padStart(5);
				const ok = `${t.successRate}%`.padStart(5);
				const lat =
					t.avgLatencyMs > 0 ? `${t.avgLatencyMs}ms`.padStart(6) : "—".padStart(6);
				const tps =
					t.avgTokensPerSecond > 0
						? `${t.avgTokensPerSecond}`.padStart(6)
						: "—".padStart(6);
				const cost =
					t.totalCost > 0
						? `$${t.totalCost.toFixed(4)}`.padStart(8)
						: "free".padStart(8);
				lines.push(`${name.padEnd(40)} ${calls} ${ok} ${lat} ${tps} ${cost}`);
			}

			lines.push("", `File: ${getTelemetryPath()}`);

			// M2 (#437): aggregate auth-failure counts (401/403) per provider from
			// recorded telemetry — status classes only, never error bodies.
			const authFailures = getProviderErrorCounts();
			const authLines: string[] = [];
			for (const [provider, counts] of authFailures) {
				const total = counts["401"] + counts["403"] + counts["429"] + counts["5xx"];
				if (total === 0) continue;
				authLines.push(
					`  ${provider}: 401×${counts["401"]}, 403×${counts["403"]}, 429×${counts["429"]}, 5xx×${counts["5xx"]}`,
				);
			}
			if (authLines.length > 0) {
				lines.push("", "Failures by class:", ...authLines);
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// /clear-free-telemetry — Clear all telemetry data
	pi.registerCommand("clear-free-telemetry", {
		description: "Clear all model telemetry data",
		handler: async (_args, ctx) => {
			await clearTelemetry();
			ctx.ui.notify("Telemetry data cleared", "info");
		},
	});
	// /pi-free-health — Show a credential-free diagnostic report and log path
	pi.registerCommand("pi-free-health", {
		description:
			"Show pi-free health, startup issues, and the diagnostic log path",
		handler: async (_args, ctx) => {
			ctx.ui.notify(formatHealthReport(), "info");
		},
	});

	// /free-startup — Show the last startup timing breakdown
	pi.registerCommand("free-startup", {
		description:
			"Show pi-free startup timing (total, slowest providers, cache/network, failures)",
		handler: async (_args, ctx) => {
			ctx.ui.notify(formatStartupSummary(), "info");
		},
	});
}

// =============================================================================
// Quota Monitoring
// =============================================================================

function setupQuotaMonitoring(pi: ExtensionAPI) {
	// Capture rate-limit headers from every provider response
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(pi as any).on(
		"after_provider_response",
		(event: { status: number; headers: Record<string, string> }, ctx: any) => {
			try {
				const providerId = ctx.model?.provider;
				if (!providerId) return;

				processQuotaResponse(providerId, event.status, event.headers);

				// Update status bar with quota for the active provider
				const status = formatQuotaStatus(providerId);
				if (status) {
					ctx.ui.setStatus("quota", status);
				}
			} catch (err) {
				// Quota monitoring is best-effort — never break the agent flow
				_logger.warn("quota monitoring failed", {
					error: err instanceof Error ? err.message : String(err),
				});
			}
		},
	);

	// Clear quota status when switching away from a provider
	pi.on("model_select", (_event, ctx) => {
		try {
			const providerId = ctx.model?.provider;
			if (!providerId) {
				ctx.ui.setStatus("quota", undefined);
				return;
			}
			// Show cached quota on provider switch (if still fresh)
			const status = formatQuotaStatus(providerId);
			ctx.ui.setStatus("quota", status);
		} catch (err) {
			_logger.warn("quota status update failed", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	});
}

// =============================================================================
// Model Telemetry
// =============================================================================

function setupTelemetry(pi: ExtensionAPI) {
	// Tracks the most recent call id per provider/model so turn_end can
	// pair with the correct startModelCall. Calls are serialized per model
	// in practice, so the last id is the correct one.
	const pendingCallIds = new Map<string, string>();

	// Only track telemetry for FREE models (uses same isFreeModel logic as model filtering)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(pi as any).on("before_agent_start", (_event: any, ctx: any) => {
		if (!ctx.model) return;

		// M3 (#437): wire-signature debug log — the request contract pi-free
		// hands pi-ai at agent start. REDACTION RULE: header NAMES only, never
		// values — an Authorization/apiKey/token value in this line would leak
		// credentials into the shared ~/.pi/free.log. Debug-only so normal runs
		// don't spam the log.
		logWireSignature(ctx.model, (providerId) =>
			ctx.modelRegistry?.getProvider?.(providerId),
		);

		if (!isFreeModel(ctx.model as any)) return;
		const provider = ctx.model?.provider;
		const model = ctx.model?.id;
		if (provider && model) {
			try {
				const callId = startModelCall(provider, model);
				pendingCallIds.set(`${provider}/${model}`, callId);
			} catch (err) {
				// Telemetry is best-effort — never break the agent flow
				_logger.warn("telemetry startModelCall failed", {
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
	});

	// Record telemetry when a turn completes
	pi.on("turn_end", async (event, ctx) => {
		if (!ctx.model) return;
		if (!isFreeModel(ctx.model as any)) return;

		const msg = (
			event as {
				message?: {
					role?: string;
					model?: string;
					usage?: {
						input?: number;
						output?: number;
						totalTokens?: number;
						cost?: { total?: number };
					};
					stopReason?: string;
					errorMessage?: string;
				};
			}
		).message;

		if (msg?.role !== "assistant") return;

		const provider = ctx.model?.provider;
		const model = msg.model || ctx.model?.id;
		if (!provider || !model) return;

		const callKey = `${provider}/${model}`;
		const callId = pendingCallIds.get(callKey);
		pendingCallIds.delete(callKey);

		const usage = msg.usage;
		const inputTokens = usage?.input ?? 0;
		const outputTokens = usage?.output ?? 0;
		const totalTokens = usage?.totalTokens ?? inputTokens + outputTokens;
		const cost = usage?.cost?.total ?? 0;
		const isError = msg.stopReason === "error" || !!msg.errorMessage;

		try {
			await recordModelCall(
				callId,
				provider,
				model,
				{ input: inputTokens, output: outputTokens, totalTokens },
				cost,
				{
					success: !isError,
					stopReason: msg.stopReason,
					errorMessage: msg.errorMessage,
				},
			);
		} catch (err) {
			// Telemetry is best-effort — never break the agent flow
			_logger.warn("telemetry recordModelCall failed", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	});
}

// =============================================================================
// Main Entry Point
// =============================================================================

export default async function piFreeEntry(pi: ExtensionAPI) {
	// Begin timing this startup run (best-effort, negligible overhead).
	beginStartup();

	const globalFreeOnly = getGlobalFreeOnly();
	_logger.info(`[pi-free] Initializing (global free-only: ${globalFreeOnly})`);

	// Guard: register global event handlers once per runner (ExtensionAPI).
	// On extension reload the module scope is preserved but a new runner calls
	// this function, so it must receive fresh registrations; same-runner
	// re-entry would accumulate duplicate handlers for quota monitoring and
	// telemetry. Commands and provider registrations are idempotent (the
	// runtime replaces them), but pi.on() is additive with no unsubscribe API,
	// so we skip the registration block when this runner already has them.
	startPhase("global-handlers");
	if (handlersRegisteredFor === pi) {
		_logger.info(
			"[pi-free] Skipping global handler registration (already registered for this runner)",
		);
	} else {
		handlersRegisteredFor = pi;

		// Start a fresh observability window before any provider session_start
		// handlers run. The handler is synchronous and never blocks Pi.
		pi.on("session_start", () => beginSessionStart());

		// Setup global commands first
		setupGlobalCommands(pi);

		// Setup quota monitoring (passive, no extra API calls)
		setupQuotaMonitoring(pi);

		// Setup model telemetry (tracks real-world performance)
		setupTelemetry(pi);
	}
	endPhase("global-handlers");

	// Time each provider setup individually so slow providers are visible in
	// the startup summary. Native providers register network-free Provider
	// objects here; Pi owns their model-store refresh lifecycle. timeProvider
	// rethrows, so Promise.allSettled keeps its exact never-throws semantics.
	startPhase("providers");
	const providerSetups = UNIQUE_PROVIDERS.map((setup) => {
		const name = (setup.name || "provider").replace(/Provider$/, "");
		return timeProvider(name, () => setup(pi));
	});

	await Promise.allSettled(providerSetups);
	endPhase("providers");

	// Setup toggles for pi's built-in providers (e.g., OpenCode)
	startPhase("built-in-toggles");
	setupBuiltInProviderToggles(pi);
	endPhase("built-in-toggles");

	// Apply initial global filter if free-only mode is enabled
	startPhase("global-filter");
	if (globalFreeOnly) {
		_logger.info("[pi-free] Applying initial free-only filter");
		applyGlobalFilter(true);
	}
	endPhase("global-filter");

	// Finalize timing and emit the observability summary (best-effort).
	finalizeStartup();
	logStartupSummary();
	// Pi's main.js calls process.exit(0) right after startup, which would
	// drop the logger's buffered async writes; flush everything logged so far
	// to disk synchronously so the startup summary line survives (best-effort).
	flushLogsSync();

	const registry = getProviderRegistry();
	_logger.info(`[pi-free] Loaded with ${registry.size} providers`);
}

// Re-export registry helpers so consumers don't need deep imports
export {
	applyGlobalFilter,
	getGlobalFreeOnly,
	getProviderRegistry,
	isFreeModel,
	registerWithGlobalToggle,
};
