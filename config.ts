/**
 * Shared config for pi-free-providers.
 *
 * Keys and flags are resolved in this order (first wins):
 *   1. Environment variable
 *   2. ~/.pi/free.json
 *
 * All exported values are getter functions so that runtime changes
 * (e.g. after toggle-{provider}) are visible immediately.
 */

import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	PROVIDER_BAI,
	PROVIDER_CLINE,
	PROVIDER_FASTROUTER,
	PROVIDER_KILO,
	PROVIDER_OLLAMA,
	PROVIDER_OPENCODE,
	PROVIDER_OPENMODEL,
	PROVIDER_OPENROUTER,
	PROVIDER_ROUTEWAY,
	PROVIDER_TOKENROUTER,
	PROVIDER_ZENMUX,
	PROVIDER_CROFAI,
	PROVIDER_CODESTRAL,
	PROVIDER_LLM7,
	PROVIDER_DEEPINFRA,
	PROVIDER_SAMBANOVA,
	PROVIDER_TOGETHER,
	PROVIDER_NOVITA,
} from "./constants.ts";
export {
	PROVIDER_BAI,
	PROVIDER_CLINE,
	PROVIDER_FASTROUTER,
	PROVIDER_KILO,
	PROVIDER_MODAL,
	PROVIDER_OPENCODE,
	PROVIDER_OPENROUTER,
	PROVIDER_QWEN,
	PROVIDER_ROUTEWAY,
	PROVIDER_TOKENROUTER,
} from "./constants.ts";
import { createLogger } from "./lib/logger.ts";
import { ensureDir, PI_DATA_DIR } from "./lib/paths.ts";

/**
 * JSON.parse reviver that strips prototype-pollution payloads.
 */
function safeJsonReviver(_key: string, value: unknown): unknown {
	if (_key === "__proto__" || _key === "constructor") {
		return undefined;
	}
	return value;
}

const _logger = createLogger("config");

interface PiFreeConfig {
	nvidia_api_key?: string;
	ollama_api_key?: string;
	zenmux_api_key?: string;
	crofai_api_key?: string;
	codestral_api_key?: string;
	llm7_api_key?: string;
	deepinfra_api_key?: string;
	sambanova_api_key?: string;
	together_api_key?: string;
	novita_api_key?: string;
	routeway_api_key?: string;
	fastrouter_api_key?: string;
	tokenrouter_api_key?: string;
	bai_api_key?: string;
	openmodel_api_key?: string;
	kilo_free_only?: boolean;
	hidden_models?: string[];
	free_only?: boolean;
	kilo_show_paid?: boolean;
	ollama_show_paid?: boolean;
	cline_show_paid?: boolean;
	zenmux_show_paid?: boolean;
	crofai_show_paid?: boolean;
	codestral_show_paid?: boolean;
	llm7_show_paid?: boolean;
	deepinfra_show_paid?: boolean;
	sambanova_show_paid?: boolean;
	together_show_paid?: boolean;
	novita_show_paid?: boolean;
	routeway_show_paid?: boolean;
	fastrouter_show_paid?: boolean;
	tokenrouter_show_paid?: boolean;
	bai_show_paid?: boolean;
	openmodel_show_paid?: boolean;
	openrouter_show_paid?: boolean;
	opencode_show_paid?: boolean;
}

const CONFIG_TEMPLATE: PiFreeConfig = {
	nvidia_api_key: "",
	ollama_api_key: "",
	zenmux_api_key: "",
	crofai_api_key: "",
	codestral_api_key: "",
	llm7_api_key: "",
	deepinfra_api_key: "",
	sambanova_api_key: "",
	together_api_key: "",
	novita_api_key: "",
	routeway_api_key: "",
	fastrouter_api_key: "",
	tokenrouter_api_key: "",
	bai_api_key: "",
	openmodel_api_key: "",

	kilo_free_only: false,
	hidden_models: [],
	free_only: true,
	kilo_show_paid: false,
	ollama_show_paid: false,
	cline_show_paid: false,
	zenmux_show_paid: false,
	crofai_show_paid: false,
	codestral_show_paid: false,
	llm7_show_paid: false,
	deepinfra_show_paid: false,
	sambanova_show_paid: false,
	together_show_paid: false,
	novita_show_paid: false,
	routeway_show_paid: false,
	fastrouter_show_paid: false,
	tokenrouter_show_paid: false,
	bai_show_paid: false,
	openmodel_show_paid: false,
	openrouter_show_paid: false,
	opencode_show_paid: false,
};

const CONFIG_PATH = join(PI_DATA_DIR, "free.json");

function ensureConfigFile(): void {
	try {
		ensureDir(PI_DATA_DIR);
		if (existsSync(CONFIG_PATH)) {
			let existing: PiFreeConfig;
			try {
				existing = JSON.parse(
					readFileSync(CONFIG_PATH, "utf8"),
				) as PiFreeConfig;
			} catch (_parseErr) {
				// File exists but is corrupt — DO NOT overwrite it.
				// The user needs to fix or delete it manually.
				_logger.error(
					"Config file exists but is corrupt — refusing to overwrite. Fix or delete ~/.pi/free.json.",
					{ path: CONFIG_PATH },
				);
				return;
			}
			// Always tighten permissions on startup, even if contents are
			// unchanged — older installs may have a world-readable file.
			restrictConfigFilePermissions();
			// Merge with template to add any missing keys, preserving existing values
			const merged = { ...CONFIG_TEMPLATE, ...existing };
			if (JSON.stringify(merged) !== JSON.stringify(existing)) {
				writeFileSync(
					CONFIG_PATH,
					`${JSON.stringify(merged, null, 2)}\n`,
					"utf8",
				);
				restrictConfigFilePermissions();
			}
		} else {
			writeFileSync(
				CONFIG_PATH,
				`${JSON.stringify(CONFIG_TEMPLATE, null, 2)}\n`,
				"utf8",
			);
			restrictConfigFilePermissions();
		}
	} catch (err) {
		_logger.warn("Could not create config file", {
			path: CONFIG_PATH,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

/**
 * Restrict `~/.pi/free.json` to owner read/write (0600). The file may
 * contain API keys for paid providers, so it must never be world-readable.
 * Best-effort: if chmod is not supported on the platform/filesystem,
 * log a warning and continue (the keys are still safe inside the user's
 * home directory).
 */
function restrictConfigFilePermissions(): void {
	try {
		chmodSync(CONFIG_PATH, 0o600);
	} catch (err) {
		_logger.warn("Could not restrict config file permissions to 0600", {
			path: CONFIG_PATH,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

export function loadConfigFile(): PiFreeConfig {
	try {
		return JSON.parse(
			readFileSync(CONFIG_PATH, "utf8"),
			safeJsonReviver,
		) as PiFreeConfig;
	} catch (err) {
		_logger.error("Could not parse config file — returning empty config", {
			path: CONFIG_PATH,
			error: err instanceof Error ? err.message : String(err),
		});
		return {};
	}
}

/**
 * Read the raw config file content without merging with template.
 * Returns the file content as string, or undefined if unreadable.
 */
function readRawConfigFile(): string | undefined {
	try {
		return readFileSync(CONFIG_PATH, "utf8");
	} catch {
		return undefined;
	}
}

ensureConfigFile();

// Resolve each value: env var takes priority over config file.
function resolve(envKey: string, fileVal?: string): string | undefined {
	return process.env[envKey] || (fileVal?.trim() ? fileVal : undefined);
}

// Resolve boolean flag: env var takes priority, then config file.
function resolveBool(envKey: string, fileVal?: boolean): boolean {
	const envValue = process.env[envKey];
	if (envValue === "true") return true;
	if (envValue === "false") return false;
	return fileVal === true;
}

// =============================================================================
// Per-provider metadata table
// Adding a new provider only requires a single entry here plus the
// corresponding field in the PiFreeConfig interface and CONFIG_TEMPLATE.
// Each entry pairs the provider ID with its env-var prefix (used for both
// the API key and show_paid flag) and the typed key on PiFreeConfig.
// =============================================================================

interface ProviderMeta {
	id: string;
	/** Env var prefix, e.g. "KILO" => KILO_SHOW_PAID and KILO_API_KEY */
	prefix: string;
	/** Typed accessor returning the show_paid value from PiFreeConfig */
	showPaidKey: keyof PiFreeConfig;
}

const PROVIDER_META: readonly ProviderMeta[] = [
	{ id: PROVIDER_KILO, prefix: "KILO", showPaidKey: "kilo_show_paid" },
	{ id: PROVIDER_CLINE, prefix: "CLINE", showPaidKey: "cline_show_paid" },
	{ id: PROVIDER_ZENMUX, prefix: "ZENMUX", showPaidKey: "zenmux_show_paid" },
	{ id: PROVIDER_CROFAI, prefix: "CROFAI", showPaidKey: "crofai_show_paid" },
	{
		id: PROVIDER_CODESTRAL,
		prefix: "CODESTRAL",
		showPaidKey: "codestral_show_paid",
	},
	{ id: PROVIDER_LLM7, prefix: "LLM7", showPaidKey: "llm7_show_paid" },
	{
		id: PROVIDER_DEEPINFRA,
		prefix: "DEEPINFRA",
		showPaidKey: "deepinfra_show_paid",
	},
	{
		id: PROVIDER_SAMBANOVA,
		prefix: "SAMBANOVA",
		showPaidKey: "sambanova_show_paid",
	},
	{
		id: PROVIDER_TOGETHER,
		prefix: "TOGETHER",
		showPaidKey: "together_show_paid",
	},
	{ id: PROVIDER_NOVITA, prefix: "NOVITA", showPaidKey: "novita_show_paid" },
	{
		id: PROVIDER_ROUTEWAY,
		prefix: "ROUTEWAY",
		showPaidKey: "routeway_show_paid",
	},
	{
		id: PROVIDER_TOKENROUTER,
		prefix: "TOKENROUTER",
		showPaidKey: "tokenrouter_show_paid",
	},
	{ id: PROVIDER_BAI, prefix: "BAI", showPaidKey: "bai_show_paid" },
	{
		id: PROVIDER_OPENMODEL,
		prefix: "OPENMODEL",
		showPaidKey: "openmodel_show_paid",
	},
	{
		id: PROVIDER_FASTROUTER,
		prefix: "FASTROUTER",
		showPaidKey: "fastrouter_show_paid",
	},
	{ id: PROVIDER_OLLAMA, prefix: "OLLAMA", showPaidKey: "ollama_show_paid" },
	{
		id: PROVIDER_OPENROUTER,
		prefix: "OPENROUTER",
		showPaidKey: "openrouter_show_paid",
	},
	{
		id: PROVIDER_OPENCODE,
		prefix: "OPENCODE",
		showPaidKey: "opencode_show_paid",
	},
];

const PROVIDER_META_BY_ID = new Map(PROVIDER_META.map((m) => [m.id, m]));

/**
 * Generic show_paid resolver backed by PROVIDER_META. Returns false
 * for unknown provider IDs (matches the previous switch default).
 */
function resolveShowPaidForProvider(providerId: string): boolean {
	const meta = PROVIDER_META_BY_ID.get(providerId);
	if (!meta) return false;
	const cfg = loadConfigFile();
	const fileVal = cfg[meta.showPaidKey];
	return resolveBool(
		`${meta.prefix}_SHOW_PAID`,
		fileVal as boolean | undefined,
	);
}

// =============================================================================
// Per-provider paid-model flags (getters so toggles reflect immediately)
// =============================================================================

export function getKiloShowPaid(): boolean {
	return resolveBool("KILO_SHOW_PAID", loadConfigFile().kilo_show_paid);
}

export function getClineShowPaid(): boolean {
	return resolveBool("CLINE_SHOW_PAID", loadConfigFile().cline_show_paid);
}

export function getZenmuxShowPaid(): boolean {
	return resolveBool("ZENMUX_SHOW_PAID", loadConfigFile().zenmux_show_paid);
}

export function getCrofaiShowPaid(): boolean {
	return resolveBool("CROFAI_SHOW_PAID", loadConfigFile().crofai_show_paid);
}

export function getCodestralShowPaid(): boolean {
	return resolveBool(
		"CODESTRAL_SHOW_PAID",
		loadConfigFile().codestral_show_paid,
	);
}

export function getLlm7ShowPaid(): boolean {
	return resolveBool("LLM7_SHOW_PAID", loadConfigFile().llm7_show_paid);
}

export function getDeepinfraShowPaid(): boolean {
	return resolveBool(
		"DEEPINFRA_SHOW_PAID",
		loadConfigFile().deepinfra_show_paid,
	);
}

export function getSambanovaShowPaid(): boolean {
	return resolveBool(
		"SAMBANOVA_SHOW_PAID",
		loadConfigFile().sambanova_show_paid,
	);
}

export function getTogetherShowPaid(): boolean {
	return resolveBool("TOGETHER_SHOW_PAID", loadConfigFile().together_show_paid);
}

export function getNovitaShowPaid(): boolean {
	return resolveBool("NOVITA_SHOW_PAID", loadConfigFile().novita_show_paid);
}

export function getRoutewayShowPaid(): boolean {
	return resolveBool("ROUTEWAY_SHOW_PAID", loadConfigFile().routeway_show_paid);
}

export function getTokenrouterShowPaid(): boolean {
	return resolveBool(
		"TOKENROUTER_SHOW_PAID",
		loadConfigFile().tokenrouter_show_paid,
	);
}

export function getBaiShowPaid(): boolean {
	return resolveBool("BAI_SHOW_PAID", loadConfigFile().bai_show_paid);
}

export function getOpenmodelShowPaid(): boolean {
	return resolveBool(
		"OPENMODEL_SHOW_PAID",
		loadConfigFile().openmodel_show_paid,
	);
}

export function getFastrouterShowPaid(): boolean {
	return resolveBool(
		"FASTROUTER_SHOW_PAID",
		loadConfigFile().fastrouter_show_paid,
	);
}

export function getOllamaShowPaid(): boolean {
	return resolveBool("OLLAMA_SHOW_PAID", loadConfigFile().ollama_show_paid);
}

export function getOpenrouterShowPaid(): boolean {
	return resolveBool(
		"OPENROUTER_SHOW_PAID",
		loadConfigFile().openrouter_show_paid,
	);
}

export function getOpencodeShowPaid(): boolean {
	return resolveBool("OPENCODE_SHOW_PAID", loadConfigFile().opencode_show_paid);
}

export function getProviderShowPaid(providerId: string): boolean {
	return resolveShowPaidForProvider(providerId);
}

// =============================================================================
// Global free-only mode
// =============================================================================

export function getFreeOnly(): boolean {
	return resolveBool("PI_FREE_ONLY", loadConfigFile().free_only);
}

export function getKiloFreeOnly(): boolean {
	return resolveBool("PI_FREE_KILO_FREE_ONLY", loadConfigFile().kilo_free_only);
}

// =============================================================================
// API Keys (getters so runtime config changes are visible)
// =============================================================================

export function getNvidiaApiKey(): string | undefined {
	return resolve("NVIDIA_API_KEY", loadConfigFile().nvidia_api_key);
}

export function getZenmuxApiKey(): string | undefined {
	return resolve("ZENMUX_API_KEY", loadConfigFile().zenmux_api_key);
}

export function getCrofaiApiKey(): string | undefined {
	return resolve("CROFAI_API_KEY", loadConfigFile().crofai_api_key);
}

export function getCodestralApiKey(): string | undefined {
	return resolve("CODESTRAL_API_KEY", loadConfigFile().codestral_api_key);
}

export function getLlm7ApiKey(): string | undefined {
	return resolve("LLM7_API_KEY", loadConfigFile().llm7_api_key);
}

export function getDeepinfraApiKey(): string | undefined {
	return resolve("DEEPINFRA_TOKEN", loadConfigFile().deepinfra_api_key);
}

export function getSambanovaApiKey(): string | undefined {
	return resolve("SAMBANOVA_API_KEY", loadConfigFile().sambanova_api_key);
}

export function getTogetherApiKey(): string | undefined {
	return resolve("TOGETHER_AI_API_KEY", loadConfigFile().together_api_key);
}

export function getNovitaApiKey(): string | undefined {
	return resolve("NOVITA_API_KEY", loadConfigFile().novita_api_key);
}

export function getRoutewayApiKey(): string | undefined {
	return resolve("ROUTEWAY_API_KEY", loadConfigFile().routeway_api_key);
}

export function getFastrouterApiKey(): string | undefined {
	return resolve("FASTROUTER_API_KEY", loadConfigFile().fastrouter_api_key);
}

export function getTokenrouterApiKey(): string | undefined {
	return resolve("TOKENROUTER_API_KEY", loadConfigFile().tokenrouter_api_key);
}

export function getBaiApiKey(): string | undefined {
	return resolve("BAI_API_KEY", loadConfigFile().bai_api_key);
}

export function getOpenmodelApiKey(): string | undefined {
	return resolve("OPENMODEL_API_KEY", loadConfigFile().openmodel_api_key);
}

export function getOllamaApiKey(): string | undefined {
	return resolve("OLLAMA_API_KEY", loadConfigFile().ollama_api_key);
}

/** Mistral is pi's built-in provider — key comes from env var only. */
export function getMistralApiKey(): string | undefined {
	return process.env.MISTRAL_API_KEY;
}

/** Groq is pi's built-in provider — key comes from env var only. */
export function getGroqApiKey(): string | undefined {
	return process.env.GROQ_API_KEY;
}

/** Cerebras is pi's built-in provider — key comes from env var only. */
export function getCerebrasApiKey(): string | undefined {
	return process.env.CEREBRAS_API_KEY;
}

/** xAI is pi's built-in provider — key comes from env var only. */
export function getXaiApiKey(): string | undefined {
	return process.env.XAI_API_KEY;
}

/** HuggingFace is pi's built-in provider — token comes from env var only. */
export function getHfToken(): string | undefined {
	return process.env.HF_TOKEN;
}

/**
 * Read an API key from ~/.pi/agent/auth.json.
 * Pi stores built-in provider keys there (opencode, openrouter, etc.).
 * Falls back to env var if auth.json is missing or key not found.
 */
function readAuthJsonKey(
	providerId: string,
	envVar: string,
): string | undefined {
	// Check env var first (fast path)
	const envVal = process.env[envVar];
	if (envVal) return envVal;

	// Check auth.json
	try {
		const authPath = join(PI_DATA_DIR, "agent", "auth.json");
		if (!existsSync(authPath)) return undefined;
		const raw = readFileSync(authPath, "utf8");
		const auth = JSON.parse(raw, safeJsonReviver) as Record<
			string,
			{ type?: string; key?: string }
		>;
		const entry = auth[providerId];
		if (entry?.key?.trim()) return entry.key;
	} catch {
		// auth.json missing or corrupt — silently skip
	}
	return undefined;
}

/**
 * OpenRouter key — pi's built-in provider reads from ~/.pi/agent/auth.json.
 * pi-free checks env var first, then auth.json.
 */
export function getOpenrouterApiKey(): string | undefined {
	return readAuthJsonKey("openrouter", "OPENROUTER_API_KEY");
}

/** OpenCode key — pi's built-in provider. Read from env or auth.json. */
export function getOpencodeApiKey(): string | undefined {
	return readAuthJsonKey("opencode", "OPENCODE_API_KEY");
}

// =============================================================================
// Hidden models (re-reads config on every call)
// =============================================================================

/**
 * Apply hidden models filter with provider scoping.
 * Hidden models can be specified as:
 *   - "model-id" (global, applies to all providers - deprecated)
 *   - "provider/model-id" (provider-specific, preferred)
 */
export function applyHidden<T extends { id: string }>(
	models: T[],
	providerId?: string,
): T[] {
	const hidden = new Set(loadConfigFile().hidden_models ?? []);
	if (hidden.size === 0) return models;

	return models.filter((m) => {
		// Check provider-scoped ID (preferred format: "provider/model-id")
		if (providerId && hidden.has(`${providerId}/${m.id}`)) {
			return false;
		}
		// Check global ID (legacy format, still supported for backward compat)
		if (hidden.has(m.id)) {
			return false;
		}
		return true;
	});
}

// =============================================================================
// Persistence
// =============================================================================

export function saveConfig(updates: Partial<PiFreeConfig>): void {
	try {
		// Read the raw file content — never use loadConfigFile() here because
		// if the file is unparseable, loadConfigFile() returns {} which would
		// cause us to write a partial config and WIPE all existing keys.
		const raw = readRawConfigFile();
		if (raw === undefined) {
			// File doesn't exist or can't be read — start from template
			const merged = { ...CONFIG_TEMPLATE, ...updates };
			writeFileSync(
				CONFIG_PATH,
				`${JSON.stringify(merged, null, 2)}\n`,
				"utf8",
			);
			_logger.info("Config saved (new file)", {
				path: CONFIG_PATH,
				keys: Object.keys(updates),
			});
			return;
		}

		let existing: PiFreeConfig;
		try {
			existing = JSON.parse(raw, safeJsonReviver) as PiFreeConfig;
		} catch (parseErr) {
			// File exists but is corrupt. REFUSE to overwrite it with a partial
			// config — that would permanently destroy the user's keys.
			_logger.error(
				"REFUSING to save config — existing file is corrupt. Fix or delete ~/.pi/free.json manually.",
				{
					path: CONFIG_PATH,
					error:
						parseErr instanceof Error ? parseErr.message : String(parseErr),
				},
			);
			return;
		}

		const merged = { ...existing, ...updates };
		writeFileSync(CONFIG_PATH, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
		_logger.info("Config saved", {
			path: CONFIG_PATH,
			keys: Object.keys(updates),
		});
	} catch (err) {
		_logger.error("Failed to save config", {
			path: CONFIG_PATH,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

/**
 * Serialise all config RMW operations to prevent concurrent updates
 * from clobbering each other (e.g. two provider probes finishing at the
 * same time both writing hidden_models and losing the other's update).
 */
class ConfigLock {
	private promise: Promise<void> = Promise.resolve();

	async acquire(): Promise<() => void> {
		let release: () => void;
		const newPromise = new Promise<void>((resolve) => {
			release = resolve;
		});
		const previous = this.promise;
		this.promise = previous.then(() => newPromise);
		await previous;
		return release!;
	}
}

const _configLock = new ConfigLock();

/**
 * Atomically read-modify-write the config file. The updater function
 * receives the current parsed config and returns the partial updates to
 * merge. Concurrent calls are serialised by an internal lock.
 *
 * If the config file is corrupt, the updater is NOT called and the file
 * is left untouched (matches saveConfig's safety behaviour).
 */
export async function updateConfig(
	updater: (current: PiFreeConfig) => Partial<PiFreeConfig>,
): Promise<void> {
	const release = await _configLock.acquire();
	try {
		const raw = readRawConfigFile();
		if (raw === undefined) {
			// File doesn't exist — start from template, apply updater once
			const updated = updater({ ...CONFIG_TEMPLATE });
			const merged = { ...CONFIG_TEMPLATE, ...updated };
			writeFileSync(
				CONFIG_PATH,
				`${JSON.stringify(merged, null, 2)}\n`,
				"utf8",
			);
			_logger.info("Config updated (new file)", {
				path: CONFIG_PATH,
				keys: Object.keys(updated),
			});
			return;
		}

		let existing: PiFreeConfig;
		try {
			existing = JSON.parse(raw, safeJsonReviver) as PiFreeConfig;
		} catch (parseErr) {
			_logger.error(
				"REFUSING to update config — existing file is corrupt. Fix or delete ~/.pi/free.json manually.",
				{
					path: CONFIG_PATH,
					error:
						parseErr instanceof Error ? parseErr.message : String(parseErr),
				},
			);
			return;
		}

		const updated = updater(existing);
		const merged = { ...existing, ...updated };
		writeFileSync(CONFIG_PATH, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
		_logger.info("Config updated", {
			path: CONFIG_PATH,
			keys: Object.keys(updated),
		});
	} catch (err) {
		_logger.error("Failed to update config", {
			path: CONFIG_PATH,
			error: err instanceof Error ? err.message : String(err),
		});
	} finally {
		release();
	}
}

export function getConfig(): PiFreeConfig {
	return loadConfigFile();
}

// =============================================================================
