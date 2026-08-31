/**
 * Typed configuration accessors for auto-fallback.
 *
 * Resolves the 7 fields added to `~/.pi/free.json` (Q12 = A) via the
 * existing config-loader in `config.ts`. All fields are optional with
 * sensible defaults (Q29 = A), so existing config files work unchanged
 * — the extension simply logs a one-time INFO message on first run
 * letting the user know they are operating on defaults (Q29 = C).
 *
 * Reading the config on every getter (rather than caching) means that
 * `/toggle-auto-fallback` writes and the next event handler read see
 * the same value without a cache-invalidation step.
 */

import { loadConfigFile } from "../../config.ts";
import { createLogger } from "../logger.ts";

const _logger = createLogger("auto-fallback");

export type FallbackScope = "provider" | "global" | "whitelist";
export type FallbackNotifyLevel = "silent" | "toast" | "status_bar" | "both";
export type FallbackRestoreMode =
	| "manual"
	| "auto_next_turn"
	| "auto_session_end";

export interface AutoFallbackConfig {
	/** Master on/off switch. Default true. */
	enabled: boolean;
	/** Scope of the candidate pool. Default "provider". */
	scope: FallbackScope;
	/** Used only when scope === "whitelist". Default []. */
	whitelistProviders: string[];
	/** Failure TTL window in ms. Default 10 minutes. */
	blacklistTtlMs: number;
	/** Strikes within the TTL that promote to hard ban. Default 3. */
	blacklistMaxStrikes: number;
	/** How to surface fallback events to the user. Default "toast". */
	notifyLevel: FallbackNotifyLevel;
	/** Whether to auto-restore the original model after fallback. Default "manual". */
	restoreMode: FallbackRestoreMode;
	/** Re-issue the user's last prompt on the new model after a switch, so the
	 *  conversation keeps moving without a manual re-send. Default true. */
	autoContinue: boolean;
	/** Max consecutive auto-replays (loop guard) before falling back to manual.
	 *  Default 3. */
	autoContinueMax: number;
}

const DEFAULTS: AutoFallbackConfig = {
	enabled: true,
	scope: "provider",
	whitelistProviders: [],
	blacklistTtlMs: 10 * 60 * 1000,
	blacklistMaxStrikes: 3,
	notifyLevel: "toast",
	restoreMode: "manual",
	autoContinue: true,
	autoContinueMax: 3,
};

let defaultsLogged = false;

function logDefaultsOnce(config: AutoFallbackConfig): void {
	if (defaultsLogged) return;
	const cfg = loadConfigFile();
	const hasAny =
		cfg.auto_fallback !== undefined ||
		cfg.auto_fallback_scope !== undefined ||
		cfg.auto_fallback_providers !== undefined ||
		cfg.auto_fallback_blacklist_ttl_ms !== undefined ||
		cfg.auto_fallback_blacklist_max !== undefined ||
		cfg.auto_fallback_auto_continue !== undefined ||
		cfg.auto_fallback_auto_continue_max !== undefined ||
		cfg.fallback_notify !== undefined ||
		cfg.fallback_restore !== undefined;
	if (!hasAny) {
		_logger.info(
			"auto_fallback: no user config found; using defaults (enabled=true, scope=provider, ttl=10m, max=3, notify=toast, restore=manual)",
		);
		defaultsLogged = true;
	} else {
		// Once we see ANY field, future defaults resolution shouldn't spam
		// even if a later config update removes them again — we trust the
		// user has touched the feature.
		defaultsLogged = true;
	}
}

export function getAutoFallbackConfig(): AutoFallbackConfig {
	const cfg = loadConfigFile();
	const result: AutoFallbackConfig = {
		enabled:
			cfg.auto_fallback === undefined ? DEFAULTS.enabled : cfg.auto_fallback === true,
		scope: parseScope(cfg.auto_fallback_scope),
		whitelistProviders: parseWhitelist(cfg.auto_fallback_providers),
		blacklistTtlMs:
			typeof cfg.auto_fallback_blacklist_ttl_ms === "number" &&
			cfg.auto_fallback_blacklist_ttl_ms > 0
				? cfg.auto_fallback_blacklist_ttl_ms
				: DEFAULTS.blacklistTtlMs,
		blacklistMaxStrikes:
			typeof cfg.auto_fallback_blacklist_max === "number" &&
			cfg.auto_fallback_blacklist_max > 0
				? cfg.auto_fallback_blacklist_max
				: DEFAULTS.blacklistMaxStrikes,
		notifyLevel: parseNotifyLevel(cfg.fallback_notify),
		restoreMode: parseRestoreMode(cfg.fallback_restore),
		autoContinue:
			cfg.auto_fallback_auto_continue === undefined
				? DEFAULTS.autoContinue
				: cfg.auto_fallback_auto_continue === true,
		autoContinueMax:
			typeof cfg.auto_fallback_auto_continue_max === "number" &&
			cfg.auto_fallback_auto_continue_max > 0
				? cfg.auto_fallback_auto_continue_max
				: DEFAULTS.autoContinueMax,
	};
	logDefaultsOnce(result);
	return result;
}

function parseScope(raw: unknown): FallbackScope {
	if (raw === "global" || raw === "whitelist") return raw;
	return DEFAULTS.scope;
}

function parseNotifyLevel(raw: unknown): FallbackNotifyLevel {
	if (
		raw === "silent" ||
		raw === "toast" ||
		raw === "status_bar" ||
		raw === "both"
	) {
		return raw;
	}
	return DEFAULTS.notifyLevel;
}

function parseRestoreMode(raw: unknown): FallbackRestoreMode {
	if (
		raw === "manual" ||
		raw === "auto_next_turn" ||
		raw === "auto_session_end"
	) {
		return raw;
	}
	return DEFAULTS.restoreMode;
}

function parseWhitelist(raw: unknown): string[] {
	if (!Array.isArray(raw)) return DEFAULTS.whitelistProviders;
	const out: string[] = [];
	for (const entry of raw) {
		if (typeof entry === "string" && entry.length > 0) out.push(entry);
	}
	return out;
}