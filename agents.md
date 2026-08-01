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
  ├─ lib/built-in-toggle.ts       ← Toggles for Pi's built-in providers (opencode, opencode-go, openrouter)
  ├─ lib/quota-monitor.ts         ← Rate-limit header extraction → status bar
  ├─ lib/startup-timing.ts        ← Startup, cache/network, and session-start timing observability
  ├─ lib/session-start-metrics.ts ← Monotonic handler + detached session-start timing
  ├─ lib/health.ts                ← Credential-free `/pi-free-health` diagnostic report
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
      ├─ opengateway/opengateway.ts ← Gitlawb OpenGateway (paid + promotional free models)
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
      └─ fastrouter/              ← FastRouter native provider (public catalog + API-key chat)

tests/                            ← Vitest test suite
```

---

## Key Concepts

### Extension Entry Point

`index.ts` exports `piFreeEntry(pi: ExtensionAPI)` — the single entry point Pi calls. It:

1. Sets up global commands (`/toggle-free`, `/free-providers`, `/pi-free-health`)
2. Sets up quota monitoring (passive, listens to `after_provider_response`)
3. Loads all unique providers via `Promise.allSettled`
4. Sets up built-in provider toggles (OpenCode, OpenCode Go, OpenRouter)
5. Applies initial global filter if `free_only` is enabled

No dynamic catalog discovery runs during extension startup.

### Provider Registration Pattern

Provider setup has two lifecycle patterns:

- **Native providers** register a Pi `Provider` object (usually through `lib/native-provider.ts`). They expose the complete catalog from `getModels()`, apply free/paid and hidden-model policy in `filterModels`, and implement `refreshModels(context)` so Pi owns the models store, credentials, refresh timing, abort signal, and offline initialization.
- **Legacy providers** may still fetch a catalog during setup and use `createReRegister`, `setupProvider`, and `lib/provider-cache.ts`. Qoder intentionally remains on this surface for now; built-in catalogs are owned by Pi and FastRouter uses the native lifecycle.

For a new OpenAI-compatible native provider, use `registerNativeOpenAIProvider()` with a `ProviderAuth`, a catalog fetcher, and `getShowPaid`. For a custom wire protocol, assemble the public `Provider` interface directly, following OpenModel or Cline. Do not add a second freshness policy or copy native catalogs into `provider-cache.json`.

**Cache-first loading.** Legacy network-fetching extension providers register from the disk cache (`~/.pi/provider-cache.json`, 1-hour TTL via `lib/provider-cache.ts`) first and only hit the network on a cold or stale cache. Built-in OpenCode, OpenCode Go, and OpenRouter catalogs are owned by Pi; FastRouter is native and refreshes asynchronously through Pi's model store. **Native providers** use Pi's models store (`~/.pi/agent/models-store.json`) via `refreshModels`; remaining legacy providers use `lib/provider-cache.ts` (see below). Ollama Cloud additionally retains that cache only for `/api/show` capability reuse and its manual refresh compatibility path.

### Native `Provider` providers

Kilo, Cline, LLM7, ZenMux, TokenRouter, Ollama Cloud, B.AI, AnyAPI, CrofAI, SambaNova, Novita, DeepInfra, Routeway, OpenGateway, OpenModel, and FastRouter use Pi's modern provider API (Pi `>=0.81.0`). Instead of the legacy `registerProvider(id, { baseUrl, apiKey, models, oauth })` form, each builds a native pi-ai `Provider` object and registers it via the single-argument `registerProvider(provider)`. Pi then owns credential refresh, background model refresh (4h throttle, abortable), and offline initialization — so these extension factories perform no catalog network I/O on startup.

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

- The `Provider` is assembled **directly against the public `Provider` interface** (the same shape as the native provider surface), rather than using the legacy registration helpers. Native providers keep the complete catalog in `getModels()` and apply the free/paid policy through `filterModels`, so refreshes cannot clobber the selected view.
- `refreshModels(context)`: always `await context.store.read()` first (offline init — `allowNetwork:false` stops here); when `allowNetwork:true`, fetch with `context.credential` (Pi refreshes OAuth before calling), honor `context.signal`, retain the previous list on an empty/failed fetch (poisoning guard), then `context.store.write({ models, checkedAt })`. No internal freshness gating — Pi owns the throttle and `force` (`pi update --models`), so the two never double-throttle.
- Native session-start hooks nudge Pi's model registry without awaiting detached refresh work; `lib/session-start-metrics.ts` records both handler return time and eventual refresh/probe completion or failure so `/free-startup` does not hide post-finalize work.
- Native `auth`: `apiKey.resolve` returns `credential?.key ?? getKiloApiKey()` (ambient env/config); `oauth` implements `login(interaction)` (device flow via `interaction.notify`), `refresh(credential)` (Kilo tokens are long-lived; expired → throw, re-login fixes), and `toAuth(credential)` → `{ apiKey: credential.access }`. Credentials persist to `~/.pi/agent/auth.json` — the same store the legacy `/login kilo` already used, so existing OAuth users need no migration.
- The free/paid toggle stays coordinated by `registerWithGlobalToggle`: native `reRegister()` re-registers the **same** provider object (upsert by id) only to invalidate Pi's availability snapshot, while `filterModels` selects the complete catalog view. This keeps per-provider toggles and the global `/toggle-free` working without rebuilding model arrays.
- Because the dev lockfile can lag the declared peer minimum, `kilo.ts` and `cline.ts` register through a small documented `NativeRegistrar` type bridge; the source type-checks against both the pinned dev snapshot and the declared `>=0.81.0` runtime.

Cline-specific deviations from the Kilo reference (porting recipe supplements):

- **Custom wire api.** Cline models use the custom `"cline-xml-tools"` api, not `openai-completions`. The native `Provider` requires both `stream` and `streamSimple`; both dispatch to the XML bridge (`streamClineXml`) with per-request headers — exactly how the legacy composer routed both entry points to the extension's `streamSimple` for a custom api. The bridge (the outgoing-message reshaping) is carried over verbatim and is registration-shape-independent.
- **Public catalog auth.** Cline's model catalog needs no credential (legacy fetched it logged-out, so models appeared before `/login cline`). Pi's `Models.refresh()` skips providers whose auth does not resolve — a Kilo-style `resolve` (undefined when unconfigured) would leave logged-out users with no models at all. So Cline's `apiKey.resolve` always succeeds, returning an empty `auth` when no key exists (Pi's sanctioned keyless pattern — the pi-ai `faux` provider does the same), and intentionally has no `apiKey.check`: Pi runs that check before availability filtering and would hide the public catalog before `/login cline`. Chat requests without a token still fail fast in the XML bridge with an actionable message.
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

Debug logging writes to `~/.pi/free.log` under the `benchmark-lookup` namespace: opt-in via `PI_FREE_BENCHMARK_DEBUG=1` (off by default for startup speed). Routed through the shared structured logger (buffered async stream, no per-model synchronous writes).

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

| Category | Providers | Auth | Notes |
| ----------- | -------------------------------------------------- | ----------------- | -------------------------------- |
| ✅ Free / free-tier | kilo, cline, llm7, openmodel, tokenrouter, qoder basic | OAuth, API key, or none | Free models or tier; toggles can expose paid models |
| 🔄 Freemium | anyapi, ollama-cloud, sambanova | API key | Free allowance with limits |
| 💳 Paid / trial | zenmux, crofai, deepinfra, novita, routeway, opengateway, bai, qoder premium | API key, OAuth, or credits | Paid access, trial credit, or premium tier |
| 🔧 Native | fastrouter | API key or none | Public catalog; Pi owns store refresh |
| 🔧 Built-in | opencode, opencode-go, openrouter | Built-in Pi auth | Built-in toggles; Pi owns catalogs |

---

## File Locations (User-Facing)

- **Config:** `~/.pi/free.json` (auto-created)
- **Extension log:** `~/.pi/free.log` (includes opt-in `benchmark-lookup` debug diagnostics)
- **Provider cache:** `~/.pi/provider-cache.json` (legacy providers only)
- **Native models store:** `~/.pi/agent/models-store.json` (all native providers, owned by Pi)
- **Native auth store:** `~/.pi/agent/auth.json` (native-provider credentials, owned by Pi)

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
9. **Model filtering is provider-specific** — native providers filter complete catalogs with `filterModels`; catalog fetchers may apply provider-specific modality or quality filters (NVIDIA retains its own 70B threshold)
10. **All pi-free-registered catalogs use `enhanceWithCI()`** before registration to add CI scores
11. **Legacy network-fetching extension providers are cache-first** (1h TTL via `lib/provider-cache.ts`); native providers, including FastRouter, use Pi's models store + `refreshModels` instead. Pi's built-in OpenCode, OpenCode Go, and OpenRouter providers are not managed by either extension cache.
12. **Startup and session-start work are observable and bounded** — legacy `loadCachedOrFetchModels` network attempts use `STARTUP_FETCH_DEADLINE_MS` (8s, override `PI_FREE_STARTUP_FETCH_TIMEOUT_MS`) via `withFetchDeadline` in `lib/util.ts`; failed and timed-out attempts are counted with duration and per-provider status. Native providers, including FastRouter, restore from Pi's store and their session-start refresh nudges and detached probes are measured without making intentionally background work block the event. `/free-startup` exposes the post-finalize handler/task timings.
13. **Compiled packaging is not shipped yet** — the proposed plain-TypeScript `dist` strategy, peer externalization, JSON asset layout, and validation plan live in [`docs/build-strategy.md`](docs/build-strategy.md). Keep source-mode loading until an import-inclusive benchmark justifies the change.
14. **Health output is credential-free** — `/pi-free-health` reports provider counts, timing/failure labels, and the configured log path; it must not print API keys, OAuth tokens, model payloads, or raw log contents.

---

## Commands Reference

| Command              | Scope        | Description                               |
| -------------------- | ------------ | ----------------------------------------- |
| `/toggle-free`       | Global       | Toggle free-only mode for ALL providers   |
| `/free-providers`    | Global       | Show free/paid counts for all providers   |
| `/free-startup`      | Global       | Show last startup timing breakdown        |
| `/pi-free-health`    | Global       | Show diagnostic status and log path      |
| `/free-telemetry`    | Global       | Show local free-model performance data   |
| `/clear-free-telemetry` | Global    | Clear local telemetry data               |
| `/toggle-{provider}` | Per-provider | Toggle between free and all models        |
| `/toggle-ollama-cloud` | Ollama Cloud | Toggle native free/all catalog view |
| `/probe-deepinfra`   | DeepInfra    | Test all models, auto-hide broken       |
| `/probe-novita`      | Novita       | Test all models, auto-hide broken        |
| `/probe-ollama`      | Ollama       | Test all models for 403 errors, auto-hide |
| `/probe-routeway`    | RouteWay     | Test all models, auto-hide broken        |
| `/probe-sambanova`   | SambaNova    | Test all models, auto-hide broken        |
| `/login kilo`        | Kilo         | Start OAuth flow                          |
| `/login cline`       | Cline        | Start OAuth flow                          |
| `/login qoder`       | Qoder        | Start browser OAuth or PAT flow           |
| `/logout kilo`       | Kilo         | Clear OAuth credentials                   |
| `/logout cline`      | Cline        | Clear OAuth credentials                   |

**Authentication notes:**

- **Kilo** and **Cline** support both OAuth (`/login`) and direct API keys. Set `KILO_API_KEY` / `CLINE_API_KEY` (or `kilo_api_key` / `cline_api_key` in `~/.pi/free.json`) to authenticate directly. Both are native providers: their native auth carries both methods, and Pi's resolution order applies — a stored credential (from `/login`) wins, then the ambient API key. Cline's catalog is public and can refresh without a credential.
- **Qoder** remains a legacy provider intentionally. Use `/login qoder`, or set `QODER_PERSONAL_ACCESS_TOKEN` / `QODER_PAT` for headless PAT authentication; its COSY signing and custom stream remain outside the native-provider migration.
- **OpenCode and OpenCode Go** remain Pi-built-in providers. pi-free only captures Pi's available catalogs for filtering after session start; it performs no startup or on-demand catalog discovery.

---

## Testing

- **Framework:** Vitest (`vitest` v4.1.10)
- **Run:** `npm test` (watch), `npm run test:run` (once)
- **Startup perf:** `npx tsx scripts/bench-startup.ts <warm|cold|fastcold>` times the awaited `piFreeEntry` factory in a sandboxed `HOME` with mocked `fetch` (warm = no legacy network, cold = dead API worst case). Import/transpile time is intentionally outside that benchmark; include it before evaluating a compiled `dist` package. Native Pi model refresh and session-start detached work are reported separately.
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
3. **Update `agents.md`** if architecture, commands, or conventions changed.
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

- `session_start` — New session begins; Pi restores/refreshes native catalogs, while pi-free measures handler and detached work
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
