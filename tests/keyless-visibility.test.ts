/**
 * #697: with no credential anywhere, the only pi-free provider that shows
 * models is one whose models work without a key (llm7).
 *
 * Recurrence this prevents (live, 2026-11-15, `pi --mode rpc` over an empty
 * agent dir and a fresh HOME, no keys): `get_available_models` listed
 * cline (18) and fastrouter (6) beside llm7 (2), and a turn on either
 * failed "No API key for provider". Both resolved auth without a credential
 * (cline returned an empty `auth`, fastrouter the same plus
 * `allowUnauthenticated`) so Pi treated them as available and fetched their
 * public catalogs.
 *
 * Drives Pi's real loader, ModelRuntime, credential store, models store and
 * refresh dispatcher with the whole pi-free extension. Only the host network
 * boundary is substituted: each provider's captured public catalog where a
 * fixture exists (tests/fixtures/catalogs), 401 for everything else.
 */
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";

let home: string | undefined;
const sessions: { dispose(): void }[] = [];

afterEach(async () => {
	for (const session of sessions.splice(0)) session.dispose();
	(await import("../lib/logger.ts")).flushLogsSync();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	if (home) rmSync(home, { recursive: true, force: true });
	home = undefined;
});

function fixture(name: string): unknown {
	return JSON.parse(
		readFileSync(
			new URL(`./fixtures/catalogs/${name}`, import.meta.url),
			"utf8",
		),
	);
}

/** Public catalog endpoints with a captured fixture, by host and path suffix. */
const CATALOGS: { host: string; suffix: string; body: unknown }[] = [
	{
		host: "api.cline.bot",
		suffix: "/ai/cline/models",
		body: fixture("cline-models-2026-11-14.json"),
	},
	{
		host: "api.cline.bot",
		suffix: "/ai/cline/recommended-models",
		body: fixture("cline-recommended-2026-11-14.json"),
	},
	{
		host: "api.fastrouter.ai",
		suffix: "/models",
		body: fixture("fastrouter-2026-11-14.json"),
	},
	{
		host: "api.deepinfra.com",
		suffix: "/models",
		body: fixture("deepinfra-2026-11-14.json"),
	},
	{
		host: "api.kilo.ai",
		suffix: "/models",
		body: fixture("kilo-2026-11-14.json"),
	},
];

/** Credential-shaped env vars the host may carry (e.g. DEEPSEEK_API_KEY). */
const CREDENTIAL_ENV =
	/(API_KEY|_TOKEN|_SECRET|_KEY$|^AWS_|^GOOGLE_|^AZURE_|^GEMINI_|^VERTEX)/;

function pinHome(): string {
	const artifacts = resolve(".smoke-artifacts");
	mkdirSync(artifacts, { recursive: true });
	home = mkdtempSync(resolve(artifacts, "keyless-visibility-"));
	const agentDir = resolve(home, ".pi/agent");
	mkdirSync(agentDir, { recursive: true });
	for (const name of Object.keys(process.env)) {
		if (CREDENTIAL_ENV.test(name)) vi.stubEnv(name, undefined);
	}
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("PI_OFFLINE", "");
	writeFileSync(resolve(agentDir, "settings.json"), "{}");
	writeFileSync(resolve(agentDir, "auth.json"), "{}");
	return agentDir;
}

function stubNetwork(): void {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			const hit = CATALOGS.find(
				(c) => url.hostname === c.host && url.pathname.endsWith(c.suffix),
			);
			if (hit) return Response.json(hit.body);
			return Response.json(
				{ error: { message: "unauthorized" } },
				{ status: 401 },
			);
		}),
	);
}

async function boot(agentDir: string): Promise<ModelRuntime> {
	vi.resetModules();
	const { default: piFreeEntry } = await import("../index.ts");
	const settingsManager = SettingsManager.inMemory({});
	const runtime = await ModelRuntime.create({
		authPath: resolve(agentDir, "auth.json"),
		modelsPath: resolve(agentDir, "models.json"),
		modelsStorePath: resolve(agentDir, "models-store.json"),
	});
	const loader = new DefaultResourceLoader({
		cwd: home as string,
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		extensionFactories: [piFreeEntry],
		agentsFilesOverride: () => ({ agentsFiles: [] }),
	});
	await loader.reload();
	expect(loader.getExtensions().errors).toEqual([]);
	const { session } = await createAgentSession({
		cwd: home as string,
		agentDir,
		resourceLoader: loader,
		settingsManager,
		modelRuntime: runtime,
		sessionManager: SessionManager.inMemory(home as string),
	});
	sessions.push(session);
	await session.bindExtensions({});
	return runtime;
}

/**
 * Settle startup before the measured refresh. Pi aborts a provider's
 * in-flight refresh whenever any provider (re-)registers, and the
 * opencode-free capture re-registers once its detached endpoint refresh
 * ends; a refresh it supersedes publishes nothing and would make the
 * keyless assertion pass vacuously.
 */
async function settledRefresh(runtime: ModelRuntime): Promise<void> {
	const { getStartupSummary } = await import("../lib/startup-timing.ts");
	await vi.waitFor(() => {
		expect(
			getStartupSummary().detachedSessionWork.map((task) => task.label),
		).toContain("built-in-toggle-refresh-opencode-free");
	});
	const result = await runtime.refresh({ allowNetwork: true, force: true });
	expect([...result.errors]).toEqual([]);
}

async function providerCounts(
	runtime: ModelRuntime,
): Promise<Record<string, number>> {
	const counts: Record<string, number> = {};
	for (const model of await runtime.getAvailable()) {
		counts[model.provider] = (counts[model.provider] ?? 0) + 1;
	}
	return counts;
}

it("with no credential, only llm7 shows models after a full network refresh", async () => {
	const agentDir = pinHome();
	stubNetwork();
	const runtime = await boot(agentDir);
	await settledRefresh(runtime);

	const counts = await providerCounts(runtime);
	expect(Object.keys(counts).sort()).toEqual(["llm7"]);
	expect(counts.llm7).toBeGreaterThan(0);
}, 60_000);

it("a logged-in Cline and a keyed FastRouter publish, and hide again once the credentials are gone", async () => {
	// Positive control for the keyless case (a superseded refresh would also
	// show nothing) and the logged-in half of #697. The second session is the
	// logout / key-removal sequence: Pi's models store still holds both
	// catalogs, so only the auth gate keeps them out of the list.
	const agentDir = pinHome();
	writeFileSync(
		resolve(agentDir, "auth.json"),
		JSON.stringify({
			cline: {
				type: "oauth",
				access: "fixture-access",
				refresh: "fixture-refresh",
				expires: Date.now() + 3_600_000,
			},
			fastrouter: { type: "api_key", key: "fixture-fastrouter-key" },
		}),
	);
	stubNetwork();
	const keyed = await boot(agentDir);
	await settledRefresh(keyed);
	const keyedCounts = await providerCounts(keyed);
	expect(keyedCounts.cline).toBeGreaterThan(0);
	expect(keyedCounts.fastrouter).toBeGreaterThan(0);

	writeFileSync(resolve(agentDir, "auth.json"), "{}");
	const loggedOut = await boot(agentDir);
	await settledRefresh(loggedOut);
	expect(Object.keys(await providerCounts(loggedOut)).sort()).toEqual(["llm7"]);
}, 60_000);
