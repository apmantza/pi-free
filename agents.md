# pi-free — Agents.md

> This file helps AI agents understand the codebase quickly. Read it before making changes.

## What is pi-free?

A **Pi extension** (`@earendil-works/pi-coding-agent`) that registers free and paid AI model providers with Pi's model picker. It shows free models by default and lets users toggle per-provider between free-only and all-models view via `/toggle-{provider}` commands.

**Package:** `pi-free` v2.2.10
**Author:** Apostolos Mantzaris  
**License:** MIT  
**Repo:** `github.com/apmantza/pi-free`  
**Peer deps:** `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui` (all `>=0.81.0` — the native `createProvider` / `registerProvider(provider)` surface)

---

## Architecture at a Glance

```
index.ts                          ← Extension entry point (piFreeEntry)
  ├─ lib/registry.ts              ← Global provider registry + isFreeModel detection
  ├─ lib/toggle-state.ts          ← Generic toggle state machine (free ↔ all)
  ├─ lib/built-in-toggle.ts       ← Toggles for Pi's built-in providers (opencode, openrouter)
  ├─ lib/quota-monitor.ts         ← Rate-limit header extraction → status bar
  ├─ lib/startup-timing.ts        ← Startup phase + per-provider timing observability
  ├─ lib/logger.ts                ← Structured logging (console + ~/.pi/free.log)
  ├─ lib/json-persistence.ts      ← Generic JSON/JSONL file stores
  ├─ lib/model-detection.ts       ← Model family grouping, name normalization
  ├─ lib/model-enhancer.ts        ← CI score name decoration (thin wrapper)
  ├─ lib/provider-cache.ts        ← Disk cache for fetched model lists
  ├─ lib/provider-compat.ts       ← DeepSeek proxy compat flag detection
  ├─ lib/util.ts                  ← fetchWithRetry, model size parsing, OpenRouter mapping
  │
  ├─ config.ts                    ← ~/.pi/free.json + env var resolution (ALL config lives here)
  ├─ constants.ts                 ← Provider IDs, base URLs, timeouts, thresholds
  ├─ provider-helper.ts           ← registerOpenAICompatible, createReRegister, enhanceWithCI, setupProvider
  │
  ├─ provider-failover/           ← Benchmark lookup (Coding Index scores)
  │   ├─ benchmark-lookup.ts      ← Multi-strategy benchmark matching + debug logging
  │   ├─ hardcoded-benchmarks.ts  ← Benchmark data
  │   └─ benchmarks.json           ← Lazy-loaded benchmark catalog
  │
  └─ providers/                   ← Per-provider extensions (each exports default async fn)
      ├─ kilo/kilo.ts             ← Kilo Gateway (native createProvider port: auth + refreshModels)
      ├─ kilo/kilo-provider.ts    ← assembles the native Provider (offline-init store + toggle view)
      ├─ kilo/kilo-auth.ts        ← native ProviderAuth (API key + OAuth device flow)
      ├─ kilo/kilo-models.ts      ← catalog fetch + Model conversion + compat shaping
      ├─ cline/cline.ts           ← Cline (native createProvider port: factory, toggle wiring)
      ├─ cline/cline-provider.ts  ← assembles the native Provider (offline-init store + toggle view)
      ├─ cline/cline-auth.ts      ← native ProviderAuth (API key + OAuth callback-server flow)
      ├─ cline/cline-models.ts    ← public catalog fetch + Model conversion
      ├─ cline/cline-xml-bridge.ts ← message reshaping for the Cline API (stream + streamSimple)
      ├─ novita/novita.ts         ← Novita AI (paid credits)
      ├─ ollama/ollama.ts         ← Ollama Cloud (usage-based free tier, 403 probing)
      ├─ routeway/routeway.ts     ← RouteWay AI (paid)
      ├─ sambanova/sambanova.ts   ← SambaNova (free tier)
      ├─ zenmux/zenmux.ts         ← ZenMux AI gateway (paid)
      ├─ crofai/crofai.ts         ← CrofAI (paid)
      ├─ llm7/llm7.ts             ← LLM7 (free default/fast selectors)
      ├─ deepinfra/deepinfra.ts   ← DeepInfra ($5 trial credit)
      ├─ tokenrouter/tokenrouter.ts ← TokenRouter API gateway (paid + free models)
      ├─ anyapi/anyapi.ts         ← AnyAPI gateway (free plan + free models)
      ├─ model-fetcher.ts         ← Shared OpenRouter-compatible model fetching
      ├─ opencode-session.ts      ← OpenCode session handling
      ├─ openmodel/openmodel.ts   ← OpenModel Anthropic-compatible gateway
      ├─ qoder/                   ← Qoder/Cosy OAuth and streaming provider
      ├─ bai/bai.ts               ← BAI gateway provider
      └─ dynamic-built-in/        ← Dynamic fetchers for OpenCode, OpenCode Go, FastRouter
          └─ index.ts

tests/                            ← Vitest test suite
```

---

## Key Concepts

### Extension Entry Point

`index.ts` exports `piFreeEntry(pi: ExtensionAPI)` — the single entry point Pi calls. It:

1. Sets up global commands (`/toggle-free`, `/free-providers`)
2. Sets up quota monitoring (passive, listens to `after_provider_response`)
3. Loads all unique providers via `Promise.allSettled`
4. Sets up dynamic built-in providers (only if API keys configured)
5. Sets up built-in provider toggles (OpenCode, OpenRouter)
6. Applies initial global filter if `free_only` is enabled

### Provider Registration Pattern

Every provider follows this pattern:

```typescript
export default async function providerName(pi: ExtensionAPI) {
    // 1. Fetch models (from API, hardcoded list, or models.dev)
    const allModels = await fetchModels(...);
    const freeModels = allModels.filter(m => isFreeModel(m, allModels));
    const stored = { free: freeModels, all: allModels };

    // 2. Create re-register function (used by toggles)
    const reRegister = createReRegister(pi, { providerId, baseUrl, apiKey });

    // 3. Register with global toggle system
    registerWithGlobalToggle(providerId, stored, reRegister, hasKey);

    // 4. Register initial models with Pi
    pi.registerProvider(providerId, { models: enhanceWithCI(initialModels), ... });

    // 5. Register toggle command
    pi.registerCommand(`toggle-${providerId}`, { ... });

    // 6. Status bar + session refresh
    pi.on("model_select", ...);
    pi.on("session_start", ...);
}
```

**Cache-first loading.** Network-fetching extension providers register from the disk cache (`~/.pi/provider-cache.json`, 1-hour TTL via `lib/provider-cache.ts`) first and only hit the network on a cold or stale cache, so warm startups make no network calls. The dynamic built-in phase (including publicly discoverable FastRouter) runs concurrently with the static providers inside `piFreeEntry`'s single `Promise.allSettled`, not sequentially after it. OpenRouter is owned by Pi and is not dynamically registered by pi-free. **Kilo and Cline are the exceptions**: they use Pi's native models store (`~/.pi/agent/models-store.json`) via `refreshModels`, not `lib/provider-cache.ts` (see below).

### Native `createProvider` providers (Kilo + Cline)

Kilo and Cline are ports to Pi's modern provider API (Pi `>=0.81.0`) — Kilo is the original reference, Cline is the second data point proving the pattern. Instead of the legacy `registerProvider(id, { baseUrl, apiKey, models, oauth })` form, each builds a native pi-ai `Provider` object and registers it via the single-argument `registerProvider(provider)`. Pi then owns credential refresh, background model refresh (4h throttle, abortable), and offline initialization — so the extension factory performs **no network I/O** for these providers and no longer owns any of Pi's startup critical path.

```
providers/kilo/kilo-provider.ts   ← createKiloProvider(): assembles the Provider
providers/kilo/kilo-auth.ts       ← native ProviderAuth (apiKey + OAuth device flow)
providers/kilo/kilo-models.ts     ← fetchKiloCatalog + toKiloModel(s) + compat shaping
providers/kilo/kilo.ts            ← factory: register, toggle wiring, XML-leak handler

providers/cline/cline-provider.ts ← createClineProvider(): assembles the Provider
providers/cline/cline-auth.ts     ← native ProviderAuth (apiKey + OAuth callback-server flow)
providers/cline/cline-models.ts   ← fetchClineCatalog + toClineModel(s) (public catalog)
providers/cline/cline.ts          ← factory: register, toggle wiring, task-id rotation
providers/cline/cline-xml-bridge.ts ← unchanged message reshaping (stream + streamSimple)
```

Key points of the pattern (the recipe for porting other unique providers):

- The `Provider` is assembled **directly against the public `Provider` interface** (the same shape `createProvider()` returns) rather than via the `createProvider` helper: that helper unconditionally merges its stored dynamic overlay on top of the static baseline on every refresh, which would clobber pi-free's re-registration based free/paid toggle. Assembling directly keeps `getModels()` returning exactly the catalog pi-free chose to show.
- `refreshModels(context)`: always `await context.store.read()` first (offline init — `allowNetwork:false` stops here); when `allowNetwork:true`, fetch with `context.credential` (Pi refreshes OAuth before calling), honor `context.signal`, retain the previous list on an empty/failed fetch (poisoning guard), then `context.store.write({ models, checkedAt })`. No internal freshness gating — Pi owns the throttle and `force` (`pi update --models`), so the two never double-throttle.
- Native `auth`: `apiKey.resolve` returns `credential?.key ?? getKiloApiKey()` (ambient env/config); `oauth` implements `login(interaction)` (device flow via `interaction.notify`), `refresh(credential)` (Kilo tokens are long-lived; expired → throw, re-login fixes), and `toAuth(credential)` → `{ apiKey: credential.access }`. Credentials persist to `~/.pi/agent/auth.json` — the same store the legacy `/login kilo` already used, so existing OAuth users need no migration.
- The free/paid toggle stays on `registerWithGlobalToggle`: its `reRegister(models)` calls `setView(models)` and re-registers the **same** native provider object (upsert by id), which republishes the chosen catalog without dropping native auth. This keeps `/toggle-kilo` and the global `/toggle-free` working. Native `filterModels` is a possible follow-up but was not adopted because it must compose with the cross-provider global toggle.
- Because the dev lockfile can lag the declared peer minimum, `kilo.ts` and `cline.ts` register through a small documented `NativeRegistrar` type bridge; the source type-checks against both the pinned dev snapshot and the declared `>=0.81.0` runtime.

Cline-specific deviations from the Kilo reference (porting recipe supplements):

- **Custom wire api.** Cline models use the custom `"cline-xml-tools"` api, not `openai-completions`. The native `Provider` requires both `stream` and `streamSimple`; both dispatch to the XML bridge (`streamClineXml`) with per-request headers — exactly how the legacy composer routed both entry points to the extension's `streamSimple` for a custom api. The bridge (the outgoing-message reshaping) is carried over verbatim and is registration-shape-independent.
- **Public catalog auth.** Cline's model catalog needs no credential (legacy fetched it logged-out, so models appeared before `/login cline`). Pi's `Models.refresh()` skips providers whose auth does not resolve — a Kilo-style `resolve` (undefined when unconfigured) would leave logged-out users with no models at all. So Cline's `apiKey.resolve` always succeeds, returning an empty `auth` when no key exists (Pi's sanctioned keyless pattern — the pi-ai `faux` provider does the same), while a side-effect-free `apiKey.check` reports configured only when a real key exists, keeping auth status honest. Chat requests without a token still fail fast in the XML bridge with an actionable message.
- **Legacy OAuth flow adapter.** Cline's OAuth is a local callback-server flow written against the legacy `OAuthLoginCallbacks` surface. Rather than rewrite it, `cline-auth.ts` adapts it to the native `AuthInteraction` with the exact mapping Pi's own legacy-OAuth adapter (`provider-composer` `adaptOAuth`) uses — `onAuth` → `auth_url` notify, `onProgress` → `progress` notify, `onManualCodeInput` → `manual_code` prompt — and tags results `type: "oauth"`. `refresh` delegates to the proven `refreshClineToken`; `toAuth` applies the `workos:` bearer prefix (legacy `getApiKey`).
- **Request-scoped headers.** Cline's VS Code-spoofing headers include a mutable `X-Task-ID`, so they are built per request inside the stream closures (not static `Provider.headers`); `before_agent_start` only rotates the task id — the legacy re-register-for-headers is redundant when headers are request-scoped.

### Free Model Detection (isFreeModel)

Located in `lib/registry.ts`. Uses **adaptive Route A/B detection**:

- **Route A** (pricing-exposed): If ANY model in the set has cost > 0, use cost-based detection. Free = both input AND output cost are 0 (OR name contains "free").
- **Route B** (non-pricing-exposed): If ALL models have cost === 0, use name-based detection only. Free = name contains "free" (case-insensitive).

This avoids false positives where providers default all costs to 0 without exposing real pricing.

### Coding Index (CI) Scores

`provider-failover/benchmark-lookup.ts` implements a multi-strategy benchmark matching system that appends `[CI: X.X]` to model names. Strategies (in order):

1. Direct substring match against hardcoded benchmarks
2. Variant alias matching (e.g., `gpt-4o` → `gpt-4-o`)
3. Provider-specific normalization (strip NVIDIA prefixes, Groq suffixes, etc.)
4. Prefix fallback with base model extraction + size token reordering

Debug logging writes to `~/.pi/modelmatch.log`: opt-in via `PI_FREE_BENCHMARK_DEBUG=1` (off by default for startup speed).

### Config Resolution

`config.ts` handles ALL configuration. Resolution order: **env var > `~/.pi/free.json`**.

- API keys: `resolve(envKey, fileVal)` — env wins, then config file
- Boolean flags: `resolveBool(envKey, fileVal)` — env `"true"`/`"false"` wins, then config file
- Config file is auto-created on first run with `CONFIG_TEMPLATE`
- `applyHidden(models, providerId)` filters models by `hidden_models` in config (supports provider-scoped format `provider/model-id`)

### Toggle State

`lib/toggle-state.ts` provides a generic `createToggleState<T>()` factory that manages:

- Mode: `"free"` | `"all"`
- Model storage: `{ free: T[], all: T[] }`
- Persistence: auto-saves to `~/.pi/free.json` on toggle
- Resolution: handles edge cases (empty `all` → fall back to `free`, etc.)

### Quota Monitoring

`lib/quota-monitor.ts` passively extracts rate-limit headers from provider responses. Tries 5 header pair formats in priority order. Shows quota in status bar with warning icons when < 25%.

---

## Provider Categories

| Category    | Providers                                          | Auth              | Notes                            |
| ----------- | -------------------------------------------------- | ----------------- | -------------------------------- |
| ✅ Free     | kilo, cline, openrouter, opencode, llm7            | OAuth, API key, or none | Toggle between free/paid         |
| 🔄 Freemium | anyapi, ollama-cloud, sambanova, tokenrouter       | API key                | Free tier with limits            |
| 💳 Paid     | zenmux, crofai, deepinfra, novita, routeway, qoder, bai, openmodel | API key, OAuth, or credits | Trial credits or pay-per-token |
| 🔧 Dynamic  | opencode, opencode-go, fastrouter | API key             | Fetched when configured or publicly discoverable |

---

## File Locations (User-Facing)

- **Config:** `~/.pi/free.json` (auto-created)
- **Extension log:** `~/.pi/free.log`
- **Model match log:** `~/.pi/modelmatch.log`
- **Provider cache:** `~/.pi/provider-cache.json` (all cache-first providers except Kilo)
- **Native models store:** `~/.pi/agent/models-store.json` (Kilo + Cline, owned by Pi)
- **Native auth store:** `~/.pi/agent/auth.json` (Kilo + Cline OAuth/API key, owned by Pi)

---

## Important Conventions

1. **TypeScript only** — no transpilation needed (Pi runs `.ts` directly with Node)
2. **ES modules** (`"type": "module"` in package.json)
3. **No build step** — `tsconfig.json` has `"noEmit": true`
4. **Node >= 20.0.0** required
5. **Provider IDs are constants** in `constants.ts` — always import from there
6. **API keys are getters** in `config.ts` — re-read on every call for runtime changes
7. **Logging uses `createLogger(namespace)`** — never `console.log` directly
8. **Error handling is graceful** — providers that fail at startup are silently skipped
9. **Model filtering happens at fetch time** — small models (< 30B, < 70B for NVIDIA) are filtered
10. **All providers use `enhanceWithCI()`** before registration to add CI scores
11. **Network-fetching extension providers are cache-first** (1h TTL via `lib/provider-cache.ts`); the first run after install or after the TTL fetches live, subsequent runs serve cache. Pi's built-in OpenRouter provider is not managed by this cache. **Kilo and Cline are the exceptions** — they are native `createProvider` providers that use Pi's models store + `refreshModels` (see “Native createProvider providers”).
12. **Startup model fetches are deadline-bounded** — `loadCachedOrFetchModels` (and Cline's fetch) wrap the network fetch in `STARTUP_FETCH_DEADLINE_MS` (8s, override `PI_FREE_STARTUP_FETCH_TIMEOUT_MS`) via `withFetchDeadline` in `lib/util.ts`. On a cold/stale cache a dead provider API cannot stall Pi session start; the deadline falls back to the stale cache (or an empty list on a true cold start) and refreshes on `session_start`. Warm cache never touches the network.

---

## Commands Reference

| Command              | Scope        | Description                               |
| -------------------- | ------------ | ----------------------------------------- |
| `/toggle-free`       | Global       | Toggle free-only mode for ALL providers   |
| `/free-providers`    | Global       | Show free/paid counts for all providers   |
| `/free-startup`      | Global       | Show last startup timing breakdown        |
| `/toggle-{provider}` | Per-provider | Toggle between free and all models        |
| `/probe-deepinfra`   | DeepInfra    | Test all models, auto-hide broken       |
| `/probe-novita`      | Novita       | Test all models, auto-hide broken        |
| `/probe-ollama`      | Ollama       | Test all models for 403 errors, auto-hide |
| `/probe-opencode`    | OpenCode     | Test all models, report expired free     |
| `/probe-opencode-go` | OpenCode (Go)| Test all models, report expired free    |
| `/probe-routeway`    | RouteWay     | Test all models, auto-hide broken        |
| `/probe-sambanova`   | SambaNova    | Test all models, auto-hide broken        |
| `/login kilo`        | Kilo         | Start OAuth flow                          |
| `/login cline`       | Cline        | Start OAuth flow                          |
| `/logout kilo`       | Kilo         | Clear OAuth credentials                   |
| `/logout cline`      | Cline        | Clear OAuth credentials                   |

**Authentication notes:**

- **Kilo** and **Cline** support both OAuth (`/login`) and direct API keys. Set `KILO_API_KEY` / `CLINE_API_KEY` (or `kilo_api_key` / `cline_api_key` in `~/.pi/free.json`) to authenticate directly. Both are native `createProvider` providers: their native auth always carries both methods, and Pi's resolution order applies — a stored credential (from `/login`) wins, then the ambient API key. Cline's catalog fetch is public (unauthenticated) either way.

---

## Testing

- **Framework:** Vitest (`vitest` v4.1.10)
- **Run:** `npm test` (watch), `npm run test:run` (once)
- **Startup perf:** `npx tsx scripts/bench-startup.ts <warm|cold|fastcold>` times the `piFreeEntry` factory in a sandboxed `HOME` with a mocked `fetch` (warm = realistic steady state, cold = dead APIs worst case). Run in a loop for stable numbers.
- **Tests:** `tests/*.test.ts` — covers registry, toggle state, config, model detection, provider compat
- Tests use `vi.fn()` mocks for ExtensionAPI

---

## Adding a New Provider

1. Add provider constant to `constants.ts` (ID + base URL)
2. Add API key getter to `config.ts` + config file template
3. Create `providers/{name}/{name}.ts` following the registration pattern
4. Import and call from `index.ts` `Promise.allSettled([...])`
5. If it needs toggle support, it's automatic via `registerWithGlobalToggle`
6. Add tests to `tests/` if there's provider-specific logic worth testing

---

## Release Workflow

Releases are automated via `.github/workflows/release.yml`.

1. **Update version** in `package.json` (semver: patch for fixes, minor for features, major for breaking changes).
2. **Update `CHANGELOG.md`** — move content from `[Unreleased]` to a new `## [X.Y.Z] - YYYY-MM-DD` section.
3. **Update `AGENTS.md`** if architecture, commands, or conventions changed.
4. **Commit and push to `master`**.
5. The CI workflow will:
   - Read the version from `package.json`.
   - Verify a matching `CHANGELOG.md` entry exists.
   - Run `check:lockfile`, `audit:prod`, `lint`, `test:run`, `npm publish --dry-run`, tarball verification, and entry smoke-load.
   - Create and push the `vX.Y.Z` tag.
   - Extract the curated section from `CHANGELOG.md` via `scripts/changelog-extract.mjs --summary` and use it as the GitHub release body. Release-note bullets must use the `- **Title** — description` format for the summary extractor to include them.
   - Publish the package to npm through trusted publishing/OIDC; no `NPM_TOKEN` secret is required.

Do **not** create the Git tag manually — the workflow creates it automatically on push to `master`.

### Backfilling release notes

To retroactively update existing GitHub releases with curated notes from `CHANGELOG.md`:

```bash
# dry run
node scripts/backfill-github-releases.mjs

# actually edit releases
node scripts/backfill-github-releases.mjs --apply

# full prose instead of summary
node scripts/backfill-github-releases.mjs --apply --full

# only specific releases
node scripts/backfill-github-releases.mjs --apply --only v2.2.4,v2.1.1
```

Requires the `gh` CLI authenticated.

## Pi Extension API (Key Methods)

```typescript
pi.registerProvider(id, config); // Register a provider with models
pi.registerCommand(name, { handler }); // Register a slash command
pi.on(event, handler); // Subscribe to events
```

**Events:**

- `session_start` — New session begins (refresh models here)
- `model_select` — User picked a model (update status bar)
- `turn_end` — Conversation turn completed (error handling)
- `before_agent_start` — Before agent starts (re-register models)
- `context` — Intercept/transform messages (Cline uses this)
- `after_provider_response` — After API response (quota monitoring)

**Context (`ctx`):**

- `ctx.ui.notify(message, type)` — Show notification (`"info" | "warning" | "error"`)
- `ctx.ui.setStatus(key, value)` — Set status bar text
- `ctx.model?.provider` — Currently selected model's provider
- `ctx.modelRegistry.isUsingOAuth(ctx.model)` — Check whether the active model uses OAuth
- `ctx.modelRegistry.getApiKeyForProvider(providerId)` — Resolve the provider credential for on-demand authenticated requests
