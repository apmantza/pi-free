# pi-free — Agents.md

> This file helps AI agents understand the codebase quickly. Read it before making changes.

## What is pi-free?

A **Pi extension** (`@earendil-works/pi-coding-agent`) that registers free and paid AI model providers with Pi's model picker. It shows free models by default and lets users toggle per-provider between free-only and all-models view via `/toggle-{provider}` commands.

**Package:** `pi-free` v2.7.0
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
  ├─ lib/built-in-toggle.ts       ← Toggles for Pi's built-in providers (opencode-free, opencode-go, openrouter)
  ├─ lib/quota-monitor.ts         ← Rate-limit header extraction → status bar
  ├─ lib/startup-timing.ts        ← Startup, cache/network, and session-start timing observability
  ├─ lib/session-start-metrics.ts ← Monotonic handler + detached session-start timing
  ├─ lib/health.ts                ← Credential-free `/pi-free-health` diagnostic report
  ├─ lib/logger.ts                ← Structured logging (console + ~/.pi/free.log)
  ├─ lib/json-persistence.ts      ← Generic JSON/JSONL file stores
  ├─ lib/pi-ai-loader.ts          ← Robust runtime loader for pi-ai entry points (bare specifier + on-disk fallback incl. running-host entry + vendored dist/vendor bundle for Bun-compiled pi binaries)
  ├─ lib/model-detection.ts       ← Model family grouping, name normalization
  ├─ lib/provider-cache.ts        ← Disk cache for fetched model lists
  ├─ lib/provider-compat.ts       ← DeepSeek proxy compat flag detection
  ├─ lib/util.ts                  ← fetchWithRetry, model size parsing, OpenRouter mapping
  ├─ lib/fallback-state.ts        ← Shared in-memory store (last HTTP status per model) used by both quota-monitor and auto-fallback
  ├─ lib/auto-fallback/           ← Auto-fallback to another free model on error (since 2.7.0; opt-in, default off)
  │   ├─ index.ts                 ← Event wiring (message_end observer / agent_settled single decision point / model_select)
  │   ├─ classifier.ts            ← HTTP status + errorMessage regex classification (mirrors pi-ai's `isRetryableAssistantError`)
  │   ├─ blacklist.ts             ← In-memory failure tracking with TTL + max-strikes
  │   ├─ selection.ts             ← CI-score candidate ordering + scope filter (provider / global / whitelist)
  │   ├─ notify.ts                ← 5-minute windowed notification aggregation
  │   ├─ commands.ts              ← /toggle-auto-fallback / /free-fallback-history / /reset-fallback-blacklist
  │   └─ config.ts                ← Typed accessors for the 9 `auto_fallback_*` / `fallback_*` config fields (env > file)
  │
  ├─ config.ts                    ← ~/.pi/free.json + env var resolution (ALL config lives here)
  ├─ constants.ts                 ← Provider IDs, base URLs, timeouts, thresholds
  ├─ provider-helper.ts           ← enhanceWithCI, StoredModels, legacy cache-first fetcher
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
      ├─ novita/novita.ts         ← Novita AI (paid credits)
      ├─ venice/venice.ts         ← Venice AI (paid, public catalog)
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
      ├─ qoder/                   ← Qoder/Cosy OAuth and streaming provider
      ├─ bai/bai.ts               ← BAI gateway provider
      ├─ fastrouter/              ← FastRouter native provider (public catalog + API-key chat)
      ├─ requesty/requesty.ts     ← Requesty native provider (public catalog + inline pricing)
      └─ stepfun/                 ← StepFun Step Plan native provider (OpenAI-compatible chat)
      (gmi/ mirrors this structure for GMI Cloud)

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
- **All pi-free providers** register through Pi's native lifecycle. Built-in catalogs are owned by Pi; Qoder retains only its custom auth/stream implementation and optional metadata cache.

For a new OpenAI-compatible native provider, use `registerNativeOpenAIProvider()` with a `ProviderAuth`, a catalog fetcher, and `getShowPaid`. For a custom wire protocol, assemble the public `Provider` interface directly. Do not add a second freshness policy or copy native catalogs into `provider-cache.json`.

**Native loading.** All pi-free provider catalogs use Pi's models store (`~/.pi/agent/models-store.json`) via `refreshModels`. Qoder retains `~/.pi/agent/qoder-models-cache.json` only for optional stream metadata. Built-in OpenCode, OpenCode Go, and OpenRouter catalogs are owned by Pi; Ollama Cloud additionally retains `~/.pi/provider-cache.json` only for `/api/show` capability reuse and its manual refresh compatibility path.

### Native `Provider` providers

Kilo, Cline, LLM7, ZenMux, TokenRouter, Ollama Cloud, B.AI, AnyAPI, CrofAI, SambaNova, Novita, DeepInfra, Routeway, OpenGateway, FastRouter, StepFun, GMI Cloud, Agnes AI, Venice AI, Infron AI, and Qoder use Pi's modern provider API (Pi `>=0.81.0`). Instead of the legacy `registerProvider(id, { baseUrl, apiKey, models, oauth })` form, each builds a native pi-ai `Provider` object and registers it via the single-argument `registerProvider(provider)`. Pi then owns credential refresh, background model refresh (4h throttle, abortable), and offline initialization — so these extension factories perform no catalog network I/O on startup

Kilo, Cline, LLM7, ZenMux, TokenRouter, Ollama Cloud, B.AI, AnyAPI, CrofAI, SambaNova, Novita, DeepInfra, Routeway, OpenGateway, FastRouter, StepFun, GMI Cloud, Agnes AI, Venice AI, Merge Gateway, and Qoder use Pi's modern provider API (Pi `>=0.81.0`). Instead of the legacy `registerProvider(id, { baseUrl, apiKey, models, oauth })` form, each builds a native pi-ai `Provider` object and registers it via the single-argument `registerProvider(provider)`. Pi then owns credential refresh, background model refresh (4h throttle, abortable), and offline initialization — so these extension factories perform no catalog network I/O on startup.

```
providers/kilo/kilo-provider.ts   ← createKiloProvider(): assembles the Provider
providers/kilo/kilo-auth.ts       ← native ProviderAuth (apiKey + OAuth device flow)
providers/kilo/kilo-models.ts     ← fetchKiloCatalog + toKiloModel(s) + compat shaping
providers/kilo/kilo.ts            ← factory: register, toggle wiring, XML-leak handler

providers/cline/cline-provider.ts ← createClineProvider(): assembles the Provider
providers/cline/cline-auth.ts     ← native ProviderAuth (apiKey + OAuth callback-server flow)
providers/cline/cline-models.ts   ← fetchClineCatalog + toClineModel(s) (public catalog)
providers/cline/cline.ts          ← factory: register, toggle wiring, task-id rotation
```

Key points of the pattern (the recipe for porting other unique providers):

- The `Provider` is assembled **directly against the public `Provider` interface** (the same shape as the native provider surface), rather than using the legacy registration helpers. Native providers keep the complete catalog in `getModels()` and apply the free/paid policy through `filterModels`, so refreshes cannot clobber the selected view.
- `refreshModels(context)`: restore from Pi 0.84+'s `context.stored` snapshot when `context.publish` is available, with a `context.store` fallback for Pi <=0.83; when `allowNetwork:true`, fetch with `context.credential` (Pi refreshes OAuth before calling), honor `context.signal`, retain the previous list on an empty/failed fetch (poisoning guard), and publish `{ persist, update }` through Pi's generation-checked `context.publish` API. No internal freshness gating — Pi owns the throttle and `force` (`pi update --models`), so the two never double-throttle.
- A single native session-start hook nudges Pi's model registry without awaiting detached refresh work; registering one global nudge avoids Pi 0.84 superseding the same providers from multiple concurrent refreshes. `lib/session-start-metrics.ts` records both handler return time and eventual refresh/probe completion or failure so `/free-startup` does not hide post-finalize work.
- Native `auth`: `apiKey.resolve` returns `credential?.key ?? getKiloApiKey()` (ambient env/config); `oauth` implements `login(interaction)` (device flow via `interaction.notify`), `refresh(credential)` (Kilo tokens are long-lived; expired → throw, re-login fixes), and `toAuth(credential)` → `{ apiKey: credential.access }`. Credentials persist to `~/.pi/agent/auth.json` — the same store the legacy `/login kilo` already used, so existing OAuth users need no migration.
- The free/paid toggle stays coordinated by `registerWithGlobalToggle`: native `reRegister()` re-registers the **same** provider object (upsert by id) only to invalidate Pi's availability snapshot, while `filterModels` selects the complete catalog view. This keeps per-provider toggles and the global `/toggle-free` working without rebuilding model arrays.
- Because the dev lockfile can lag the declared peer minimum, `kilo.ts` and `cline.ts` register through a small documented `NativeRegistrar` type bridge; the source type-checks against both the pinned dev snapshot and the declared `>=0.81.0` runtime.

Cline-specific deviations from the Kilo reference (porting recipe supplements):

- **Standard OpenAI wire api.** Cline's endpoint (`https://api.cline.bot/api/v1/chat/completions`) speaks vanilla OpenAI Chat Completions, so models use the standard `"openai-completions"` api and both `stream`/`streamSimple` delegate to the lazy compat bridge (`lazyOpenAICompletionsApi()`), like every other OpenAI-compatible native provider. pi-ai maps `reasoning`/`reasoning_details` stream fields natively — no transform layer. Models restored from Pi's models store with the retired `cline-xml-tools` api are normalized to `openai-completions` + the Cline baseUrl on restore, until the next network refresh rewrites the store (#433).
- **Public catalog auth.** Cline's model catalog needs no credential (legacy fetched it logged-out, so models appeared before `/login cline`). Pi's `Models.refresh()` skips providers whose auth does not resolve — a Kilo-style `resolve` (undefined when unconfigured) would leave logged-out users with no models at all. So Cline's `apiKey.resolve` always succeeds, returning an empty `auth` when no key exists (Pi's sanctioned keyless pattern — the pi-ai `faux` provider does the same), and intentionally has no `apiKey.check`: Pi runs that check before availability filtering and would hide the public catalog before `/login cline`. Chat requests without a token still fail with a 401 from the gateway.
- **Legacy OAuth flow adapter.** Cline's OAuth is a local callback-server flow written against the legacy `OAuthLoginCallbacks` surface. Rather than rewrite it, `cline-auth.ts` adapts it to the native `AuthInteraction` with the exact mapping Pi's own legacy-OAuth adapter (`provider-composer` `adaptOAuth`) uses — `onAuth` → `auth_url` notify, `onProgress` → `progress` notify, `onManualCodeInput` → `manual_code` prompt — and tags results `type: "oauth"`. `refresh` delegates to the proven `refreshClineToken`; `toAuth` applies the `workos:` bearer prefix (required by the gateway; raw tokens 401).
- **Shared mutable headers.** Cline's VS Code-spoofing identity headers include a rotating `X-Task-ID`, so they live on a single shared mutable record (`providers/cline/cline-headers.ts`) that is stamped on every Cline **model** — pi-ai's `Models.getAuth` merges only the model's `headers` into requests (never `provider.headers`), so `rotateClineTaskId()` on `before_agent_start` takes effect by mutating that same object — no re-registration needed.

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

### Auto-Fallback

`lib/auto-fallback/` automatically switches to another free model when the current one errors, so the conversation keeps moving during quota outages / provider hiccups. **Opt-in** (`auto_fallback: false` by default — a switch rewrites the active model for the session).

**Pipeline (each event handler in `index.ts`):**

- `after_provider_response` — observation only: records `{provider, model, status}` into `lib/fallback-state.ts` (no body read, wire-signature convention). No strikes here — Pi's internal retries re-emit this event per attempt.
- `message_end` — observation only: stores the latest assistant message for the settled-time decision. No strikes (would multi-count one failure and burn strikes on user aborts).
- `agent_settled` — the SINGLE decision point (per Pi's contract: no further automatic retry/compaction/continuation will run). One pass, in order: (1) recovery — a clean run (last assistant stopReason not error/aborted) un-bans the failed model via the history entry's `fromKey` and refills the replay budget; (2) failure handling — classify the assistant message (delegates to pi-ai's `isRetryableAssistantError`, lazily loaded on the failure path; user aborts without a 5xx never strike), record ONE strike, `pi.setModel()`, arm the replay; (3) auto-continue dispatch — after a switch, re-issue the captured prompt on the new model (budget-capped). `before_agent_start` clears any armed replay when the user sends their own prompt.
- `model_select` — clears the restore marker when the user manually picks a different model.

**`classifier.ts` decision matrix:**

| signal | classification | action |
| --- | --- | --- |
| fatal pattern (invalid key, model not found, context length) | unrecoverable | no switch |
| HTTP 400/401/403/404/422 | unrecoverable | no switch |
| HTTP 402/408/425/429, 5xx (500-504, 521-527, 529) | recoverable | strike + switch |
| pi-ai retryable error text | recoverable | strike + switch |
| pi-ai non-retryable + quota pattern | recoverable | strike + switch |
| abort + last status >= 500 | recoverable | strike + switch |
| abort without 5xx (user Esc) | not a failure | no strike, no switch |

**`blacklist.ts` dual rule (Q9 = C):** single failures expire after `auto_fallback_blacklist_ttl_ms` (default 10 min); `auto_fallback_blacklist_max` strikes (default 3) within the window promote the model to a permanent session ban. `/reset-fallback-blacklist` clears everything (escape hatch after exhaustion).

**`selection.ts` strategy (Q3 = D):** filter by `auto_fallback_scope` (provider | global | whitelist), exclude current model + blacklisted, sort by CI score descending (uses `provider-failover/benchmark-lookup.ts`). Unscored candidates rank below any scored candidate, alphabetical tiebreaker.

**`notify.ts` aggregation (Q31 = B):** first switch toasts immediately; subsequent switches within a 5-minute window roll into a single summary ("Auto-fallback: tried N free models in last 5min, currently on X"). Status bar shows `🛟 Fallback active` until recovery.

**Hard limits (mid-flight switching is impossible from extensions):**

- Pi does not expose a turn-replay hook (issue earendil-works/pi #1248, `not_planned`).
- `pi.setModel()` always rewrites the global default — fallback is sticky.
- Failed turn is shown to the user as an error; the *next* turn uses the new model.
- The auto-fallback module deliberately does NOT import `@earendil-works/pi-ai` at module scope (convention 16); the classifier regex tables are kept locally with a comment pointing at pi-ai's `src/utils/retry.ts` as the canonical source.

---

## Provider Categories

| Category | Providers | Auth | Notes |
| ----------- | -------------------------------------------------- | ----------------- | -------------------------------- |
| ✅ Free / free-tier | kilo, cline, llm7, tokenrouter, agnes, qoder basic | OAuth, API key, or none | Free models or tier; toggles can expose paid models |
| 🔄 Freemium | anyapi, ollama-cloud, sambanova, requesty | API key | Free allowance with limits |
| 💳 Paid / trial | zenmux, crofai, deepinfra, novita, routeway, opengateway, bai, stepfun, gmi, venice, infron, qoder premium | API key, OAuth, or credits | Paid access, trial credit, or premium tier |
| 🔧 Native | Kilo, Cline, LLM7, Ollama Cloud, AnyAPI, SambaNova, TokenRouter, ZenMux, CrofAI, DeepInfra, Novita, Routeway, OpenGateway, B.AI, FastRouter, Requesty, StepFun, GMI Cloud, Agnes AI, Venice AI, Infron AI, Qoder | API key, OAuth, or none | Pi owns catalog refresh and native stores |
| 💳 Paid / trial | zenmux, crofai, deepinfra, novita, routeway, opengateway, bai, stepfun, gmi, venice, merge, qoder premium | API key, OAuth, or credits | Paid access, trial credit, or premium tier |
| 🔧 Native | Kilo, Cline, LLM7, Ollama Cloud, AnyAPI, SambaNova, TokenRouter, ZenMux, CrofAI, DeepInfra, Novita, Routeway, OpenGateway, B.AI, FastRouter, Requesty, StepFun, GMI Cloud, Agnes AI, Venice AI, Merge Gateway, Qoder | API key, OAuth, or none | Pi owns catalog refresh and native stores |

| 🔧 Built-in | opencode-free, opencode-go, openrouter | Built-in Pi auth | Built-in toggles; Pi owns catalogs |

---

## File Locations (User-Facing)

- **Config:** `~/.pi/free.json` (auto-created)
- **Extension log:** `~/.pi/free.log` (includes opt-in `benchmark-lookup` debug diagnostics)
- **Provider cache:** `~/.pi/provider-cache.json` (Ollama Cloud compatibility only)
- **Qoder stream metadata:** `~/.pi/agent/qoder-models-cache.json`
- **Native models store:** `~/.pi/agent/models-store.json` (all native providers, owned by Pi)
- **Native auth store:** `~/.pi/agent/auth.json` (native-provider credentials, owned by Pi)
- **Auto-fallback blacklist:** in-memory only (resets on extension reload). Session-start restores the blacklist to empty; `/reset-fallback-blacklist` clears manually.

---

## Important Conventions

1. **TypeScript only** — no transpilation needed (Pi runs `.ts` directly with Node)
2. **ES modules** (`"type": "module"` in package.json)
3. **Source development has no emit step** — `tsconfig.json` has `"noEmit": true`; release and Git installs build the published `dist/` entry
4. **Node >= 20.0.0** required
5. **Provider IDs are constants** in `constants.ts` — always import from there
6. **API keys are getters** in `config.ts` — re-read on every call for runtime changes
7. **Logging uses `createLogger(namespace)`** — never `console.log` directly
8. **Error handling is graceful** — providers that fail at startup are silently skipped
9. **Model filtering is provider-specific** — native providers filter complete catalogs with `filterModels`; catalog fetchers may apply provider-specific modality or quality filters (NVIDIA retains its own 70B threshold)
10. **All pi-free-registered catalogs use `enhanceWithCI()`** before registration to add CI scores
11. **Legacy network-fetching extension providers are cache-first** (1h TTL via `lib/provider-cache.ts`); native providers, including FastRouter and StepFun, use Pi's models store + `refreshModels` instead. Pi's built-in OpenCode, OpenCode Go, and OpenRouter providers are not managed by either extension cache.
12. **Startup and session-start work are observable and bounded** — legacy `loadCachedOrFetchModels` network attempts use `STARTUP_FETCH_DEADLINE_MS` (8s, override `PI_FREE_STARTUP_FETCH_TIMEOUT_MS`) via `withFetchDeadline` in `lib/util.ts`; failed and timed-out attempts are counted with duration and per-provider status. Native providers, including FastRouter, restore from Pi's store and their session-start refresh nudges and detached probes are measured without making intentionally background work block the event. `/free-startup` exposes the post-finalize handler/task timings.
13. **Compiled packaging is shipped** — npm and Pi load `dist/index.js`, generated from the TypeScript source with peer dependencies externalized. The validation plan and packaging details live in [`docs/build-strategy.md`](docs/build-strategy.md).
14. **Health output is credential-free** — `/pi-free-health` reports provider counts, timing/failure labels, and the configured log path; it must not print API keys, OAuth tokens, model payloads, or raw log contents.
15. **Abort errors are expected, not failures** — Pi 0.84+ aborts a superseded model refresh; `AbortError`/`"This operation was aborted"` is cancellation, not a provider error. Every provider fetch `catch` block must guard `if (signal?.aborted)` and **return the function's empty error-path value** *before* logging — `[]` for array fetches, `{ all: [], free: [] }` for `{all,free}` catalogs, bare `return` for `Promise<void>` — so expected aborts never surface as visible `ERROR`/`notify` to the user. Check `signal?.aborted`, not `error.name === "AbortError"` (narrowed deliberately — an unrelated AbortError must still be logged). When fixing this class of bug (or any cross-cutting convention violation), **examine the whole repo and fix every instance**, not just the reported provider — providers share a near-identical fetch/`catch` shape, so a missing guard in one is a missing guard in all.
16. **pi-ai compat must never load at startup** — `@earendil-works/pi-ai/compat` (and `@earendil-works/pi-ai/providers/all`) cost ~1.3–1.7s of module-load time and are only allowed as *dynamic* imports in runtime code. Provider `stream`/`streamSimple` get their pi-ai implementations through the lazy bridge in `lib/lazy-compat.ts` (`lazyOpenAICompletionsApi()`/`lazyAnthropicMessagesApi()`), which returns the local compat-free shell from `lib/assistant-message-event-stream.ts` synchronously and pipes the real stream in once the single-flight compat import resolves. Runtime pi-ai imports go through `lib/pi-ai-loader.ts` (`loadPiAiEntry`), which tries the bare specifier first and only on a genuine pi-ai-not-found error falls back to locating the package on disk (walk-up from this package, nested under pi-coding-agent, the running pi host's realpath-resolved entry script — covers pnpm virtual-store layouts, #448 — plus `~/.pi/agent/npm`, `%APPDATA%\npm`, and executable-relative roots). Never add a static value-import of compat (type-only imports are fine), and keep `scripts/check-runtime-imports.mjs` green. **Bun-compiled pi binaries (scoop/winget/standalone zip) break every one of those resolution paths**: Bun compile mode disables bare-specifier resolution from external files entirely, so no on-disk pi-ai layout can serve pi-free there — even a correctly installed pi-ai dies on its own internal bare imports (#502). For that case `scripts/build.mjs` emits self-contained esbuild bundles to `dist/vendor/` (`pi-ai-compat.js`: the four lazy API factories pi-free can stream through — OpenAI completions, Anthropic messages, OpenAI responses, Google generative AI; `pi-ai-providers-all.js`: the builtin-catalog readers), with every transitive dependency inlined and only `node:*` builtins external. `loadPiAiEntry` imports them by absolute file path as the LAST resort (their pi-ai version is frozen at pi-free's build time; any on-disk copy matches the running host). The bundles stay out of the startup path — they load on first use, only when nothing else resolved. The OpenCode session stream's `importPiAiSubpath` falls back to these factories, so `opencode-free`/`opencode-go` keep working on Bun-binary hosts. Two things the vendored bundle deliberately does not carry: `registerApiProvider` (the compat API registry lives in the HOST's pi-ai instance — provider-composer reads it — so registering into a vendored copy would be a silent no-op; primary dispatch uses the provider config's `streamSimple` instead) and `isRetryableAssistantError` (the auto-fallback classifier degrades to its local regex tables, as designed).
17. **Wire-signature logs are header NAMES only — never values** — the `before_agent_start` wire-signature log (`lib/wire-signature.ts`, namespace `wire-signature`, debug level) records the request contract (`provider`, `model`, `api`, `baseUrl`, `headerNames`) to diagnose headers that fail to reach the wire. `headerNames` must contain only header KEYS; an Authorization/apiKey/token/cookie VALUE in this line would leak credentials into the shared plain-text `~/.pi/free.log`. The same rule applies to any new observability that touches headers, and `/pi-free-health` output stays credential-free (counts, ages, status codes — never bodies, keys, tokens, or log tails) (#437).
18. **Live catalog audits are mandatory before each release and when adding a new provider** — fetch every registered provider's real `/models` endpoint (stored credential from `~/.pi/agent/auth.json` where available; anonymous where the catalog is public) and verify its free/paid classification against pi-free's actual detection semantics (Route A cost detection, Route B name fallback, promotional windows, authoritative `_freeKnown`/`_isFree` stamps) before writing release notes or README claims. Record the audit date next to any published counts and present them as a point-in-time snapshot, never a guarantee. Providers whose credentials are unavailable are listed as "not audited" rather than guessed. Never print or commit API keys during an audit. **`docs/free_models.md` is a hard release gate**: the dated free-model catalog must be regenerated from the same live audit (model lists + usage conditions per provider) before release notes are written — a stale `free_models.md` blocks the release.

---

## Commands Reference

| Command              | Scope        | Description                               |
| -------------------- | ------------ | ----------------------------------------- |
| `/toggle-free`       | Global       | Toggle free-only mode for ALL providers   |
| `/free-providers`    | Global       | Show free/paid counts for all providers   |
| `/free-startup`      | Global       | Show last startup timing breakdown        |
| `/pi-free-health`    | Global       | Show diagnostic status and log path      |
| `/toggle-auto-fallback` | Global    | Toggle auto-fallback on model errors      |
| `/free-fallback-history` | Global    | Show session switch log + blacklist       |
| `/reset-fallback-blacklist` | Global | Clear the in-memory fallback blacklist     |
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

- **Anonymous public catalogs** — Kilo, ZenMux, CrofAI, DeepInfra, Novita, Routeway, SambaNova, FastRouter, and Cline resolve a truthy keyless auth (`public catalog (no account)`) when no credential is configured, so Pi's model refresh populates their public catalogs with zero setup; chat still requires a real key or OAuth login. StepFun, GMI Cloud, Agnes AI, TokenRouter, AnyAPI, B.AI, OpenGateway, and Merge Gateway have auth-required catalogs and keep resolving `undefined` without a key ([#421](https://github.com/apmantza/pi-free/issues/421)).
- **Kilo** and **Cline** support both OAuth (`/login`) and direct API keys. Set `KILO_API_KEY` / `CLINE_API_KEY` (or `kilo_api_key` / `cline_api_key` in `~/.pi/free.json`) to authenticate directly. Both are native providers: their native auth carries both methods, and Pi's resolution order applies — a stored credential (from `/login`) wins, then the ambient API key. Cline's catalog is public and can refresh without a credential.
- **Qoder** is a native provider with OAuth/PAT authentication, Pi-owned credential/model stores, COSY signing, and its custom stream. Use `/login qoder`, or set `QODER_PERSONAL_ACCESS_TOKEN` / `QODER_PAT` for headless PAT authentication.
- **OpenCode and OpenCode Go** remain Pi-built-in providers. pi-free only captures Pi's available catalogs for filtering after session start; it performs no startup or on-demand catalog discovery.
- **Deferred saved-model restore** — Pi resolves a resumed session's model before extension provider registrations flush (queued `registerProvider` calls land when the runner binds, after `createAgentSession`'s restore), so sessions saved with a built-in-toggle provider (`opencode-free`, `opencode-go`, `openrouter`) hit Pi's "Could not restore model" fallback on every resume. After the capture applies its catalog view, `lib/built-in-toggle.ts` re-reads the session's persisted model (`buildSessionContext().model` — fresh, so a deliberate mid-startup switch is respected) and re-selects it via `pi.setModel` when present in the registered view. Pi's startup warning line itself is unavoidable from extension code.

---

## Testing

- **Framework:** Vitest (`vitest` v4.1.10)
- **Run:** `npm test` (watch), `npm run test:run` (once)
- **Drive pi-ai directly:** `npm run drive -- --provider <id> [--model <substr|exact>] [--effort <level>] [--simple] [--prompt "..."] [--anonymous] | --list` runs a realistic coding-agent turn (system prompt, thinking+toolCall history replay, tool result) through pi-ai's `streamSimple` against a model from Pi's native models store — the same code path Pi uses at runtime. Credential resolution mirrors Pi: stored `~/.pi/agent/auth.json` credential first, then `<PROVIDER>_API_KEY`; `--anonymous` drives keyless-by-design providers (chat then correctly fails for auth-required gateways). Exits non-zero on error events, so it works as an automated smoke check for provider wire behavior (e.g. after adding a normalizer or compat stamp). Exact model ids win over substring matches.
- **Startup perf:** `npx tsx scripts/bench-startup.ts <warm|cold|fastcold> [source|compiled]` runs in a sandboxed `HOME` with mocked `fetch` (warm = no legacy network, cold = dead API worst case) and reports `importMs`, `factoryMs`, and import-inclusive `totalMs`. Run `npm run build` before `compiled` mode. Source mode includes tsx loader/transpilation; compiled mode measures native Node ESM loading. `factoryMs` is the awaited `piFreeEntry` time; `lib/startup-timing.ts` records the import-inclusive total instead — its clock origin is a module-scope `performance.now()` capture (first import of the module), so the runtime startup total covers the module graph plus the factory. Native Pi model refresh and session-start detached work are reported separately.
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
4. **Run the live catalog audit** (convention 18): fetch every registered provider's real endpoint, re-verify free/paid classification, refresh the dated audit table in `README.md`, AND regenerate `docs/free_models.md` from the same data — this is a gate: stale free-model documentation blocks the release.
5. **Commit and push to `master`**.
6. The CI workflow will:
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
- `context` — Intercept/transform messages
- `after_provider_response` — After API response (quota monitoring)

**Context (`ctx`):**

- `ctx.ui.notify(message, type)` — Show notification (`"info" | "warning" | "error"`)
- `ctx.ui.setStatus(key, value)` — Set status bar text
- `ctx.model?.provider` — Currently selected model's provider
- `ctx.modelRegistry.isUsingOAuth(ctx.model)` — Check whether the active model uses OAuth
- `ctx.modelRegistry.getApiKeyForProvider(providerId)` — Resolve the provider credential for on-demand authenticated requests
