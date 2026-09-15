# pi-free — Agents.md

> This file helps AI agents understand the codebase quickly. Read it before making changes.

## Maintaining This File (do this on every commit)

Durable context for every agent on pi-free. **Update it in the same commit that changes the world it describes** — never as a follow-up:

- **Kill staleness.** A stale claim is worse than none. If a commit changes documented behavior, structure, commands, or conventions, fix the lines now.
- **Capture decisions.** Non-obvious decisions/gotchas go in with the *why*.
- **Placement.** New invariants inside the matching section, never top/tail. Defect shapes append numbered.
- **Timeless wording.** No "new"/"recently"/"currently" in durable text; point-in-time records use absolute dates.
- **Shed to HISTORY.md, don't delete.** Completed sections and decision-settled narratives move there; the live rule stays. HISTORY.md updates ONLY on shedding.
- **Cite by symbol, not line.** Names (`resolveModelView`) and headings, never line numbers, outside point-in-time evidence.
- **Name consulted sections in PR bodies.**

## What is pi-free?

A **Pi extension** that registers free and paid AI model providers with Pi's model picker: free models by default, per-provider free↔all toggles via `/toggle-{provider}`.

**Package:** `pi-free` v2.8.1 · MIT · Apostolos Mantzaris · `github.com/apmantza/pi-free`
**Peer deps:** `@earendil-works/pi-ai` (`^0.85.1` — floor tracks pi-coding-agent's minor, defect shape 10), `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui` (both `>=0.81.0`; the native `createProvider` / `registerProvider(provider)` surface)

---

## Architecture at a Glance

```text
index.ts                          ← Extension entry (piFreeEntry)
  ├─ lib/registry.ts              ← provider registry, isFreeModel, resolveModelView
  ├─ lib/stale-ctx.ts             ← stale-context guard
  ├─ lib/native-provider.ts       ← native Provider factory/bridge
  ├─ lib/toggle-state.ts          ← free↔all state machine
  ├─ lib/built-in-toggle.ts       ← Pi built-in provider toggles
  ├─ lib/quota-monitor.ts         ← rate-limit headers → status bar
  ├─ lib/startup-timing.ts        ← startup/session-start timing
  ├─ lib/session-start-metrics.ts ← handler + detached-task timing
  ├─ lib/health.ts                ← /pi-free-health report (credential-free)
  ├─ lib/logger.ts                ← structured logging (console + ~/.pi/free.log)
  ├─ lib/json-persistence.ts      ← JSON/JSONL stores
  ├─ lib/pi-ai-loader.ts          ← runtime pi-ai loader (bare → on-disk → vendored)
  ├─ lib/model-detection.ts       ← model family grouping
  ├─ lib/provider-cache.ts        ← disk cache for model lists
  ├─ lib/provider-compat.ts       ← DeepSeek proxy compat flags
  ├─ lib/util.ts                  ← re-export shim (import focused modules instead)
  ├─ lib/fetch.ts                 ← retry/timeout/deadline/backoff
  ├─ lib/model-map.ts             ← size parsing + OpenRouter mapping
  ├─ lib/model-metadata.ts        ← models.dev enrichment
  ├─ lib/telemetry.ts             ← local model telemetry
  ├─ lib/action-log.ts            ← recent-actions ring for health
  ├─ lib/wire-signature.ts        ← header-names-only wire log (convention 17)
  ├─ lib/lazy-compat.ts           ← lazy pi-ai bridge (never at startup)
  ├─ lib/fallback-state.ts        ← last HTTP status per model
  ├─ lib/auto-fallback/           ← opt-in fallback on error (default off)
  │   ├─ index.ts                 ← event wiring (agent_settled decides)
  │   ├─ classifier.ts            ← failure classification
  │   ├─ settled-decision.ts      ← pure settled-run decisions (unit-tested)
  │   ├─ blacklist.ts             ← failure tracking, TTL + max-strikes
  │   ├─ selection.ts             ← CI-score ordering + scope filter
  │   ├─ notify.ts                ← windowed notification aggregation
  │   ├─ commands.ts              ← fallback slash commands
  │   └─ config.ts                ← auto_fallback_*/fallback_* accessors (env > file)
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
  └─ providers/                   ← per-provider extensions (default async fn each):
      kilo/ cline/ (native reference ports) novita venice ollama-cloud routeway
      opengateway sambanova zenmux crofai llm7 deepinfra tokenrouter anyapi
      model-fetcher.ts (shared OpenRouter fetching) opencode-session.ts qoder/
      bai agnes commandcode infron merge/ fastrouter/ requesty stepfun/
      (gmi/ mirrors this structure for GMI Cloud; full per-file map under
      "Native `Provider` providers" below)

tests/                            ← Vitest test suite
```

---

## Key Concepts

### Extension Entry Point

`index.ts` exports `piFreeEntry(pi: ExtensionAPI)` — the single entry point Pi calls: global commands, passive quota monitoring (`after_provider_response`), all providers via `Promise.allSettled`, built-in toggles, initial `free_only` filter. No catalog network I/O at startup.

### Provider Registration Pattern

All pi-free providers register through Pi's native lifecycle (single-argument `registerProvider(provider)`); Pi owns the models store, credentials, refresh timing, and offline init. Native `Provider` objects expose the complete catalog from `getModels()`, apply free/paid policy in `filterModels`, and implement `refreshModels(context)` — restore from `context.stored`/`context.store`, fetch with `context.credential` when `allowNetwork`, honor `context.signal`, retain the previous list on empty/failed fetch, publish via `context.publish`. No internal freshness gating (Pi owns throttle + `force`); never copy native catalogs into `provider-cache.json`. For a new OpenAI-compatible provider use `registerNativeOpenAIProvider()` (auth + catalog fetcher + `getShowPaid`); for custom wire protocols assemble the `Provider` interface directly. Built-in OpenCode/OpenCode Go/OpenRouter catalogs are owned by Pi; Qoder keeps only custom auth/stream plus optional stream-metadata cache.

### Native `Provider` providers

The native providers below build a pi-ai `Provider`, registered via single-argument `registerProvider(provider)` (Pi `>=0.81.0`). Pi owns credentials, refresh, offline init — no catalog network I/O at startup. (Membership: the Native row in Provider Categories.)

```text
providers/kilo/{kilo,kilo-provider,kilo-auth,kilo-models}.ts    ← assemble / auth+OAuth / catalog
providers/cline/{cline,cline-provider,cline-auth,cline-models}.ts  ← same shape (public catalog)
```

Key points of the pattern (the recipe for porting other unique providers):

- Assemble **directly against the public `Provider` interface**: complete catalog in `getModels()`, free/paid policy in `filterModels`.
- `refreshModels(context)`: restore from `context.stored` (`context.store` fallback ≤0.83); on `allowNetwork` fetch with `context.credential`, honor `context.signal`, retain on empty/failed fetch, publish via `context.publish`. No internal freshness gating.
- One global session-start nudge, never awaited; `session-start-metrics.ts` records handler + completion for `/free-startup`.
- `apiKey.resolve` → `credential?.key ?? getXApiKey()`; `oauth` = `login`/`refresh`/`toAuth`; creds persist to `~/.pi/agent/auth.json`.
- `registerWithGlobalToggle`: `reRegister()` re-registers the **same** object (upsert by id); `filterModels` selects the view.
- Register through the documented `NativeRegistrar` bridge (dev lockfile can lag peer minimum).

Cline-specific deviations from the Kilo reference:

- **Public catalog auth.** `apiKey.resolve` always succeeds (empty `auth` when keyless); no `apiKey.check`, or Pi hides the catalog before `/login cline`. Keyless chat still 401s.
- **Shared mutable headers.** Rotating `X-Task-ID` lives on one shared record (`providers/cline/cline-headers.ts`) stamped on every Cline **model** — pi-ai merges only model `headers`, so rotation applies without re-registration.
- Wire api (`openai-completions`) and the legacy OAuth adapter mapping follow the recipe above; details in HISTORY.md.

### Free Model Detection (isFreeModel)

Adaptive Route A/B detection in `lib/registry.ts`: if ANY model has cost > 0, free = zero input AND output cost (or name contains "free"); if ALL costs are 0, name-based detection only. Never trust all-zero costs as pricing.

### Coding Index (CI) Scores

`provider-failover/benchmark-lookup.ts` appends `[CI: X.X]` via substring → alias → provider-normalization → prefix-fallback matching. Debug logging to `~/.pi/free.log` is opt-in (`PI_FREE_BENCHMARK_DEBUG=1`).

### Config Resolution

`config.ts` holds ALL configuration, **env var > `~/.pi/free.json`** (auto-created from `CONFIG_TEMPLATE`). Keys via `resolve(envKey, fileVal)`, booleans via `resolveBool`; `applyHidden(models, providerId)` filters `hidden_models` (supports `provider/model-id` scope).

### Toggle State

One rule (`resolveModelView` in `lib/registry.ts`): **explicit per-provider choice wins, else the global `free_only` default**. No force flags, no preservation branches.

- Explicit choices live in the sparse `model_view_overrides` map (written only by `/toggle-<id>`; absent = follow global). Legacy `{id}_show_paid: true` counts as explicit-"all"; template-materialized `false` keys never count (defect shape 5).
- `/toggle-free` flips the global flag **and clears all per-provider choices**.
- Commands flip the *effective* view and persist it; captures/filters resolve live at call time, never frozen (defect shape 2).
- Strict free views: zero free models = *empty* view (provider hides), never the paid catalog.
- `lib/toggle-state.ts` provides the generic `createToggleState<T>()` machine; production paths persist through the overrides map.

### Quota Monitoring

`lib/quota-monitor.ts` passively extracts rate-limit headers from provider responses. Tries 5 header pair formats in priority order. Shows quota in status bar with warning icons when < 25%.

### Auto-Fallback

`lib/auto-fallback/` switches to another free model when the current one errors. **Opt-in** (`auto_fallback: false` by default — a switch rewrites the session's active model).

- `agent_settled` is the SINGLE decision point: clean run recovers (un-ban via `fromKey`, refill budget); failure = ONE strike + `pi.setModel()` + budget-capped auto-continue. Observers (`after_provider_response`, `message_end`) never strike. `before_agent_start` clears armed replays; `model_select` clears the restore marker.
- Switch on 402/408/425/429, 5xx, pi-ai retryable text (lazily loaded); never on fatal patterns, 400/401/403/404/422, or user aborts without a 5xx.
- Blacklist: failures expire after `auto_fallback_blacklist_ttl_ms` (10 min default); `auto_fallback_blacklist_max` strikes (3) in-window = session ban (`/reset-fallback-blacklist` clears).
- Selection: `auto_fallback_scope` (provider|global|whitelist), exclude current + banned, CI-score order (unscored last).
- Notify: first switch toasts, rest roll into one 5-minute summary (`🛟 Fallback active` until recovery).
- Hard limits: no replay hook (#1248); `setModel()` is sticky-global; failed turn stays visible, next turn uses the new model. No module-scope pi-ai import (convention 16); local regexes, pi-ai `src/utils/retry.ts` canonical. Full pipeline + matrix: HISTORY.md.

---

## Provider Categories

| Category | Providers | Auth | Notes |
| ----------- | -------------------------------------------------- | ----------------- | -------------------------------- |
| ✅ Free / free-tier | kilo, cline, llm7, tokenrouter, agnes, qoder basic | OAuth, key, or none | Toggles can expose paid |
| 🔄 Freemium | anyapi, ollama-cloud, sambanova, requesty | API key | Free allowance with limits |
| 💳 Paid / trial | zenmux, crofai, deepinfra, novita, routeway, opengateway, bai, stepfun, gmi, venice, merge, qoder premium | API key, OAuth, or credits | Trial credit or premium tier |
| 🔧 Native | (all above except built-ins) | API key, OAuth, or none | Pi owns catalog refresh + native stores |

| 🔧 Built-in | opencode-free, opencode-go, openrouter | Built-in Pi auth | Built-in toggles; Pi owns catalogs |

---

## File Locations (User-Facing)

- **Config:** `~/.pi/free.json` (auto-created) · **log:** `~/.pi/free.log` · **caches:** `~/.pi/provider-cache.json` (Ollama compat only), `~/.pi/agent/qoder-models-cache.json` (stream metadata), `~/.pi/agent/models-store.json` + `~/.pi/agent/auth.json` (Pi-owned native store/credentials). Auto-fallback blacklist is in-memory only.

---

## Important Conventions

1. **TypeScript only** — no transpilation needed (Pi runs `.ts` directly with Node)
2. **ES modules** (`"type": "module"` in package.json)
3. **Source dev has no emit step** — `tsconfig` `noEmit`; releases build the published `dist/` entry
4. **Node >= 20.0.0** required
5. **Provider IDs are constants** in `constants.ts`
6. **API keys are getters** in `config.ts` (re-read every call)
7. **Logging uses `createLogger(namespace)`** — never `console.log` directly
8. **Error handling is graceful** — providers failing at startup are silently skipped
9. **Filtering is provider-specific** — natives via `filterModels`; fetchers may add modality/quality filters
10. **Registered catalogs use `enhanceWithCI()`** before registration
11. **Legacy network-fetching providers are cache-first** (1h TTL, `lib/provider-cache.ts`); native providers use Pi's models store + `refreshModels`. Pi's built-in OpenCode/OpenCode Go/OpenRouter providers use neither extension cache.
12. **Startup/session-start work is observable and bounded** — legacy fetches use `STARTUP_FETCH_DEADLINE_MS` (8s, `PI_FREE_STARTUP_FETCH_TIMEOUT_MS` override) via `withFetchDeadline`; failures/timeouts counted with duration per provider. Natives restore from Pi's store; nudges/probes measured without blocking. `/free-startup` exposes post-finalize timings.
13. **Compiled packaging is shipped** — npm/Pi load `dist/index.js` (peers externalized); details in `docs/build-strategy.md`.
14. **Health output is credential-free** — counts/labels/paths only; never keys, tokens, payloads, or log contents.
15. **Abort is cancellation, not failure** — every fetch `catch` guards `if (signal?.aborted)` and **returns the empty error-path value** before logging (`[]`, `{ all: [], free: [] }`, bare `return`). Check `signal?.aborted`, not `error.name`. One shared fetch/`catch` shape — sweep cross-cutting fixes repo-wide.
16. **pi-ai compat must never load at startup** (~1.5s module-load cost) — dynamic imports only, via `loadPiAiEntry` (`lib/pi-ai-loader.ts`: bare specifier → on-disk fallbacks → vendored `dist/vendor` bundle as LAST resort, loaded on first use). Provider streams go through the lazy bridge (`lib/lazy-compat.ts`: sync compat-free shell, real stream piped in once compat resolves). Never add a static value-import of compat (type-only imports are fine); keep `scripts/check-runtime-imports.mjs` green. The vendored bundle excludes `registerApiProvider` (registry lives in the HOST's pi-ai — registering into a copy is a silent no-op) and `isRetryableAssistantError` (classifier uses local regexes). Full resolution order and Bun-binary rationale: HISTORY.md.
17. **Wire-signature logs are header NAMES only — never values** (`lib/wire-signature.ts`, debug level). `headerNames` holds KEYS only; a token/value there leaks credentials into `~/.pi/free.log`. Same rule for any new header-touching observability; health output stays bodies/keys/tokens/tails-free (#437).
18. **Live catalog audits gate each release and each new provider** — fetch every registered `/models` endpoint and verify free/paid classification before release notes (stored credential where available, anonymous where public). Dated counts go in `docs/catalog-audit.md` — a snapshot, never a guarantee; unauditable = "not audited"; never print keys. **`docs/free_models.md` must be regenerated from the same audit** — stale docs block the release; carry-over needs an explicit dated note in CHANGELOG + audit doc.

## Recurring Defect Shapes

Screen against these BEFORE writing code — each one cost a real incident:

1. **Stale extension context across awaits.** Snapshot what you need at handler entry; stale throw after `await` = session moved on (log debug/info, stop). Never user-visible (`lib/stale-ctx.ts`; #393/#394/#509).
2. **Registration-time values going stale.** Never freeze prefs/views/handles at registration — resolve live. (#510 saga: HISTORY.md.)
3. **Detached session-start work must resolve, never reject, on expected races.** Replacement, reload, supersede, missing creds are routine — resolve quietly. Only real errors reject.
4. **Refresh supersede races.** Scope refreshes to owned providers, retry once when aborted, seed static catalogs. (Narrative: HISTORY.md.)
5. **Template-materialized defaults destroy presence info.** `ensureConfigFile` writes every key, so presence ≠ choice — use a sparse explicit-choice map (`model_view_overrides`).
6. **Load-only smokes miss lazy paths.** Lazy code needs executing smokes (`smoke-pi-ai-entries`), not bare imports or RPC loads.
7. **`import.meta.resolve` parent argument is ignored on some Node builds.** Tree-scoped resolution uses `createRequire`.
8. **NOSONAR markers must sit on sink lines.** Build log messages into consts so the marker trails an unsplittable sink call.
9. **Optional credentials must not become required environment references.** Never install an unconditional `$VAR` for an optional credential; omit absent keys. Screen via real `ModelRuntime.refresh`. (#504: HISTORY.md.)
10. **Dual pi-ai copies with skewed versions.** Keep the pi-ai peer floor in lockstep with pi-coding-agent's minor. No devDependency pin (kills the prod peer install); no `overrides` on peers. (#539: HISTORY.md.)

## Standing Invariants

- **Notifications are best-effort and never throw.** There is no UI left on a dead session; notify/status helpers swallow stale-context throws by design.
- **Abort is cancellation, not failure** (convention 15 extends everywhere: refresh supersedes, signal aborts, user Esc — none of these are strikes, errors, or warnings).
- **Health and log output stay credential-free** — counts, ages, status codes; never keys, tokens, bodies, header values, or log tails.
- **pi-ai compat never loads at startup** — dynamic imports only, via `loadPiAiEntry`; `check-runtime-imports` stays green.
- **All `free.json` writes go through the locked RMW paths** (`saveConfig`/`updateConfig`) — never raw writes; concurrent toggles/probes must not clobber each other.
- **Every new `free.json` key or env flag needs a forcing function.** A knob shipped "for flexibility" is permanent public API plus test/doc/support burden. Name the consumer in the PR body.
- **Toggle flips the effective view.** Persisted choices live under provider ids in `model_view_overrides`; divergent snake_case keys are legacy-read-only.
- **Logged-out providers stay hidden.** Auth that doesn't resolve keeps the provider out of `/model`; only the keyless allowlist (cline, fastrouter, llm7) resolves without a credential. Never re-add an anonymous opt-in for a catalog whose chat needs a key (#530).

## PR Test Proof

- Regression fixes show **fail-before evidence**: the new test fails on pre-fix code (stash the fix, run, restore) and passes after. State this in the PR body.
- Name every new/edited test with one line on what it pins and why it exists. A reviewer who cannot see what changed about the tests cannot review the change.
- Prefer live verification where mocks would encode the assumption under test: RPC session/filter checks over mocked registries, real `ModelRuntime` over stubbed auth gates, fixture trees over hand-rolled module doubles. Mocks are legitimate only at true process boundaries (spawned Pi CLI, network fetches) and for pure-logic units.

---

## Commands Reference

| Command | Scope | Description |
| -------------------- | ------------ | ------------------------------------------ |
| `/toggle-free`, `/free-providers`, `/free-startup`, `/pi-free-health` | Global | Free-mode toggle, counts, startup timing, diagnostics |
| `/toggle-auto-fallback`, `/free-fallback-history`, `/reset-fallback-blacklist` | Global | Fallback toggle, switch log, clear bans |
| `/free-telemetry`, `/clear-free-telemetry` | Global | Local performance data, clear it |
| `/toggle-{provider}` | Per-provider | Flip free↔all view |
| `/toggle-ollama-cloud` | Ollama Cloud | Flip native free/all catalog view |
| `/probe-{deepinfra,novita,ollama,routeway,sambanova}` | Provider | Test all models, auto-hide broken (ollama: 403s) |
| `/login {kilo,cline,qoder}` | Kilo/Cline/Qoder | Start OAuth flow (qoder: browser or PAT) |
| `/logout {kilo,cline}` | Kilo/Cline | Clear OAuth credentials |

**Authentication notes:**

- **Anonymous public catalogs** — Kilo, ZenMux, CrofAI, DeepInfra, Novita, Routeway, SambaNova, FastRouter, Cline resolve keyless (`public catalog (no account)`); chat still needs a key/login. StepFun, GMI Cloud, Agnes AI, TokenRouter, AnyAPI, B.AI, OpenGateway, Merge Gateway resolve `undefined` without a key (#421).
- **Kilo/Cline** support OAuth (`/login`) and API keys (`KILO_API_KEY` / `CLINE_API_KEY` or `~/.pi/free.json`); stored credential wins, then ambient key. Cline's catalog refreshes without a credential.
- **Qoder**: OAuth/PAT, Pi-owned stores, COSY signing, custom stream. `/login qoder` or `QODER_PERSONAL_ACCESS_TOKEN` / `QODER_PAT`.
- **OpenCode / OpenCode Go** are Pi-built-in; pi-free captures their catalogs for filtering, then runs one **detached** public-endpoint refresh per tier for models shipped between Pi releases. New IDs synthesize via `resolveOpenCodeModelApi`/`applyOpenCodeProtocolDefaults`. Failed/empty/aborted fetches retain cache and never rethrow. `resolveApiKey` omits absent credentials so logged-out providers read as unavailable, not refresh failures (defect shape 9; full #504 narrative in HISTORY.md).
- **Deferred saved-model restore** — Pi restores the session model before extension registrations flush, so resumes on toggle providers hit "Could not restore model". After capture, `built-in-toggle.ts` re-selects the persisted model via `pi.setModel` when in view; Pi's warning line is unavoidable.

---

## Testing

- **Framework:** Vitest (`vitest` v5)
- **Run:** `npm test` (watch), `npm run test:run` (once)
- **Drive pi-ai directly:** `npm run drive -- --provider <id> [--model <sub>] [--prompt "..."] [--anonymous] | --list` — realistic turn through `streamSimple` on Pi's native store (stored auth first, then `<PROVIDER>_API_KEY`); non-zero exit on errors, doubles as wire-behavior smoke.
- **Startup perf:** `npx tsx scripts/bench-startup.ts <warm|cold|fastcold> [source|compiled]` (sandboxed `HOME`, mocked `fetch`; build first for `compiled`). Reports `importMs`/`factoryMs`/total; refresh + detached work separately.
- **Tests:** `tests/*.test.ts` (registry, toggle, config, detection, compat; `vi.fn()` ExtensionAPI doubles)
- **Design the state space before coding.** For stateful/ordered/resource-mutating work, write invariants, transitions, and a cross-product matrix (order, failure atomicity, aborts) first — the refresh-supersede and restore bugs came from unmodeled orderings.
- **Wait on the right clock.** Poll for conditions (`waitFor`/`waitSettled`, bounded loops) — never fixed sleeps. Detached tasks mutating polled state get a targeted lint disable with reason.

---

## Adding a New Provider

1. Constant (`constants.ts`) + key getter (`config.ts` template). 2. `providers/{name}/` per the registration pattern. 3. Wire into `index.ts` `Promise.allSettled` (toggles automatic via `registerWithGlobalToggle`). 4. Tests for provider-specific logic.

---

## Release Workflow

Releases are automated via `.github/workflows/release.yml`.

1. Bump `package.json` (semver). 2. Move `[Unreleased]` to `## [X.Y.Z] - date`. 3. Update `agents.md` if architecture/commands/conventions changed.
2. **Run the live catalog audit** (convention 18) and regenerate `docs/free_models.md` — stale docs block the release; carry-over needs a dated note in CHANGELOG + audit doc.
3. **Open a release PR** (`release/X.Y.Z`; `master` is protected) and merge on green — the merge fires tag, GitHub release (curated CHANGELOG section), and npm publish.
4. The CI workflow will: verify the CHANGELOG entry; run `check:lockfile`, `audit:prod`, `lint`, `test:run`, `npm publish --dry-run`, tarball + smoke checks; tag `vX.Y.Z`; publish via trusted publishing (no `NPM_TOKEN`). Release bullets must use `- **Title** — description` for the summary extractor.

Do **not** create the Git tag manually — the workflow creates it automatically on push to `master`.

### Backfilling release notes

`node scripts/backfill-github-releases.mjs [--apply] [--full] [--only vX.Y.Z,...]` (gh auth required).

## Pi Extension API (Key Methods)

```typescript
pi.registerProvider(id, config); pi.registerCommand(name, { handler }); pi.on(event, handler);
```

**Events:** `session_start` (Pi restores/refreshes catalogs; pi-free measures handler + detached work), `model_select`, `turn_end`, `before_agent_start` (re-register models), `context`, `after_provider_response` (quota monitoring).

**Context (`ctx`):** `ctx.ui.notify(message, type)`, `ctx.ui.setStatus(key, value)`, `ctx.model?.provider`, `ctx.modelRegistry.isUsingOAuth(ctx.model)`, `ctx.modelRegistry.getApiKeyForProvider(providerId)` (on-demand credential for authenticated requests).
