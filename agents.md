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

**Package:** `pi-free` v2.8.6 · MIT · Apostolos Mantzaris · `github.com/apmantza/pi-free`
**Peer deps:** `@earendil-works/pi-ai` (`^1.1.0` — floor tracks pi-coding-agent's minor, defect shape 10), `@earendil-works/pi-coding-agent` (`>=0.86.0`; 0.86 introduced the `TranscriptContext` provider contract), `@earendil-works/pi-tui` (`>=0.81.0`; the native `createProvider` / `registerProvider(provider)` surface)

---

## Architecture at a Glance

```text
index.ts                          ← Extension entry (piFreeEntry)
  ├─ lib/registry.ts              ← provider registry, isFreeModel, resolveModelView
  ├─ lib/glob-tool.ts             ← `glob` tool (Pi find under the Zen gate name)
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
  ├─ lib/opencode-relay.ts        ← loopback Bun TLS byte pipe (anonymous OpenCode only)
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
      opengateway sambanova zenmux llm7 deepinfra tokenrouter anyapi
      model-fetcher.ts (shared OpenRouter fetching) opencode-session.ts qoder/
      bai agnes commandcode infron merge/ fastrouter/ requesty stepfun/
      (gmi/ mirrors this structure for GMI Cloud; full per-file map under
      "Native `Provider` providers" below)

tests/                            ← Vitest test suite
tla/                              ← TLA+ specs + TLC gate (see TLC Model Checking)
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
- A restore is a **fallback, never a downgrade**: Pi fires a global `allowNetwork:false` refresh on every `registerProvider` (so every toggle/hide `reRegister()`), carrying whatever the last persist wrote — under a free view that is the view-filtered subset (#519), e.g. 1 of 92. Once a network generation published the catalog in this session (`stored.complete`), `refreshNativeProviderModels` skips the restore so the picker keeps the paid catalog (defect shape 17).
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

### Infron Timed Continuation

`providers/infron/infron-continuation.ts` observes actual HTTP 429 assistant errors in `message_end`, parses their JSON TPM code/message and advertised seconds, and lets Pi perform its own retries unchanged. Synchronous `agent_before_settle` is the exhaustion authority: it arms one native custom-message continuation for the final same-model failure. The following `agent_start` holds that continuation on Pi's active abort signal for the **last** advertised delay before any HTTP request. One canonical ticket moves observed → armed → waiting; later assistant results supersede observations. No user-prompt replay, model switch, retry-count emulation or nudge cap. Model/session/input changes and Escape cancel the automatic request; an already committed nudge entry may remain in the transcript. Never await settlement without a signal, and never match `Retry failed after …` as assistant error text: Pi renders that summary only in the UI. `/free-infron-retry` exposes bounded reason counters/phase; `infron-retry` file logs record each finite reason once per session, with no error text/payloads/credentials. The cooldown notice is swallowed locally (`notify-failed`): a throwing host UI must not reject `agent_start` before the timer/abort listener exists, which would skip the cooldown and hit the rate-limited endpoint at once. Tests must drive actual HTTP 429s and native retries through real loader/runtime/session services (`tests/infron-continuation.test.ts`), not fabricate an SSE error containing the UI summary.

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
| 💳 Paid / trial | zenmux, deepinfra, novita, routeway, opengateway, bai, stepfun, gmi, venice, merge, qoder premium | API key, OAuth, or credits | Trial credit or premium tier |
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
16. **pi-ai compat must never load at startup** (~1.5s module-load cost) — dynamic imports only, via `loadPiAiEntry` (`lib/pi-ai-loader.ts`: bare specifier → on-disk fallbacks → vendored `dist/vendor` bundle as LAST resort, loaded on first use). Provider streams go through the lazy bridge (`lib/lazy-compat.ts`: sync compat-free shell, real stream piped in once compat resolves). Never add a static value-import of compat (type-only imports are fine); keep `scripts/check-runtime-imports.mjs` green. The vendored bundle excludes `registerApiProvider` (registry lives in the HOST's pi-ai — registering into a copy is a silent no-op) and `isRetryableAssistantError` (classifier uses local regexes). Fallback triggers on `ERR_MODULE_NOT_FOUND` **or** `ERR_PACKAGE_PATH_NOT_EXPORTED` for the allow-listed subpaths (a stale shadowing pi-ai copy, #581), and resolution is **entry-aware**: a candidate root must define the requested entry, so a copy whose `exports` predates it is skipped instead of shadowing a good copy further down. Full resolution order and Bun-binary rationale: HISTORY.md.
17. **Wire-signature logs are header NAMES only — never values** (`lib/wire-signature.ts`, debug level). `headerNames` holds KEYS only; a token/value there leaks credentials into `~/.pi/free.log`. Same rule for any new header-touching observability; health output stays bodies/keys/tokens/tails-free (#437).
18. **Live catalog audits gate each release and each new provider** — fetch every registered `/models` endpoint and verify free/paid classification before release notes (stored credential where available, anonymous where public). Dated counts go in `docs/catalog-audit.md` — a snapshot, never a guarantee; unauditable = "not audited"; never print keys. **`docs/free_models.md` must be regenerated from the same audit** — stale docs block the release; carry-over needs an explicit dated note in CHANGELOG + audit doc.
19. **Detached log streams stay quiet after intentional teardown** — `attachLogStream` ignores errors from a stream that is no longer `logStream`; rotation and `flushLogsSync()` detach before ending/destroying, while errors from the active stream still enter the synchronous fallback.

## Recurring Defect Shapes

Screen against these BEFORE writing code — each one cost a real incident:

1. **Stale extension context across awaits.** Snapshot what you need at handler entry; stale throw after `await` = session moved on (log debug/info, stop). Never user-visible (`lib/stale-ctx.ts`; #393/#394/#509).
2. **Registration-time values going stale.** Never freeze prefs/views/handles at registration — resolve live. (#510 saga: HISTORY.md.)
3. **Detached session-start work must resolve, never reject, on expected races.** Replacement, reload, supersede, missing creds are routine — resolve quietly. Only real errors reject.
4. **Refresh supersede races.** Scope refreshes to owned providers, retry once when aborted, seed static catalogs. (Narrative: HISTORY.md.)
5. **Template-materialized defaults destroy presence info.** `ensureConfigFile` writes every key, so presence ≠ choice — use a sparse explicit-choice map (`model_view_overrides`).
6. **Load-only smokes miss lazy paths.** Lazy code needs executing smokes (`smoke-pi-ai-entries`), not bare imports or RPC loads.
7. **`import.meta.resolve` parent argument is ignored on some Node builds.** Tree-scoped resolution uses `createRequire`.
8. **NOSONAR markers must sit on sink lines.** Build log messages into consts so the marker trails an unsplittable sink call. In workflows the marker takes only on single-line `run:` values — inside a folded `run:` block it never suppresses, wherever placed (S8543, #589).
9. **Optional credentials must not become required environment references.** Never install an unconditional `$VAR` for an optional credential; omit absent keys. Screen via real `ModelRuntime.refresh`. (#504: HISTORY.md.)
10. **Dual pi-ai copies with skewed versions.** Keep the pi-ai peer floor in lockstep with pi-coding-agent's minor. No devDependency pin (kills the prod peer install); no `overrides` on peers. (#539: HISTORY.md.)
11. **"Not found" classifiers must cover every failure code of the same lookup.** `loadPiAiEntry` recognized only `ERR_MODULE_NOT_FOUND`, but a stale pi-ai copy shadowing the walk-up (right name and version, `exports` predating the entry) makes Node throw `ERR_PACKAGE_PATH_NOT_EXPORTED` instead — so the disk fallback never ran and every provider stream died at first use on an otherwise-healthy install (#581). Screen every resolution/fallback classifier against the full error-code set the runtime emits for that lookup, and every fallback target against the *thing being looked up* (here: the entry), not just the package. Guards: `smoke-pi-ai-shadowed` (hostile layout) + `isPiAiNotFoundError`/`piAiRootDefinesEntry` tests.
12. **Tests must run in a worker thread — the mutation lane says so, the normal suite does not.** `@stryker-mutator/vitest-runner` hardcodes `pool: 'threads'` with no config surface, while vitest's default pool is `forks`; so `process.chdir(x)` (or `setuid/setgid/setgroups/initgroups/umask(arg)`) is green in `npm test` and reds the Stryker **dry run** the first time its module enters the mutated set — killing a lane that has nothing to do with your change (#583, found shipping #582). Screen: no worker-hostile `process` call anywhere vitest loads in-process; model a CWD-dependent rejection without `chdir` by asserting both directions of the predicate instead. Guard: `tests/worker-thread-safety.test.ts` (scans `tests/`, `lib/`, `providers/` and the root modules over comment-and-literal-blanked source — see `tests/helpers/blanked-source.ts` for why a real parser is not available here).
13. **Host drift breaks load outside the tested tree.** Every lane resolved pi from the devDependency tree or a below-floor fixture, so #547 (host API removal) and #581 (host-era module layout) arrived as field reports, not CI reds. Screen: the extension must boot in a real pi on the oldest supported host (PR-gated floor lane) and the newest published host (nightly latest lane) — pack + `pi install` + RPC suites, never the loader alone. Guards: `host-smoke.yml` (`host-floor`, `host-latest`); floor fixtures pin the literal (kept in sync by comment), never an arbitrary old release.
14. **An in-process mutex does not serialize a second process.** `ConfigLock` and the store `Lock` were promise chains in module state: two pi processes sharing one home raced read-modify-write and the loser silently vanished (48/200 keys survived the two-process probe, #611). Screen: every shared-state write path must hold a cross-process lock with the read taken inside it, and every write must be tmp + rename so readers never see a torn file. Guards: `lib/atomic-file.ts` (single seam replacing both mutexes), `tests/atomic-file.test.ts`, cross-process regression in `tests/json-persistence.test.ts`.
15. **A defaulted cost is not a known price.** A catalog mapper that writes `cost: 0` when the price field is missing/non-numeric manufactures a free signal: Route A trusts cost numbers unless `_pricingKnown === false`, so one parse-miss beside priced siblings leaks a paid model into the free view (#610: requesty). Screen: every mapper stamps pricing provenance (`_pricingKnown`) exactly where it defaults — miss means `false`, never silent zero. Curated-static zeros (llm7/ollama, knowledge not parse) and name-derived zeros (discovery synthesis) are different shapes and stay unstamped. Guards: `tests/requesty-provider.test.ts` (stamp + leak + name-fallback).
16. **A chat-typed API tag says nothing about the output modality.** Gateways serve image/video/audio generators through the chat surface: Requesty returns 23 image models with `api: "chat"`, Novita returns `model_type: "chat"` entries outputting image/video/audio (#608). Screen every catalog mapper for a typed output-modality signal (`supports_image_generation`, `architecture.output_modalities`, `supported_endpoint_types`, a curated modality table) — and never blanket-drop by id substring: vision *understanding* is legitimate chat input and must survive. A guard on an endpoint that exposes no modality field is vacuous and does not ship. Guards: `tests/requesty-provider.test.ts`, `tests/novita-models.test.ts` (drop + vision-keep pairs; each drop fails pre-fix).
17. **An offline store restore must not downgrade a live catalog.** The view-filtered persist (#519) writes only the visible subset to Pi's store, and Pi re-runs an `allowNetwork:false` refresh on *every* `registerProvider` — so any toggle/hide re-register used to hand back the on-disk free subset and collapse `stored.all` (live: commandcode 92 → 1 on `/toggle-commandcode`, toast still saying "showing all 92 models"). Screen: every restore path must be dominated by an in-session network publication (`stored.complete`), and every re-register-triggered refresh must be probed for what it does to `getModels()` (a grow-only restore is the only safe shape). Guards: `tests/native-restore-clobber.test.ts` (clobber case fails pre-fix; restore-when-incomplete and toggle-notify cases pin the boundary).

18. **Idle is not request-start age, and decoded bytes are not wire bytes.** The Bun relay (#631) initially killed active streams on its idle timer, cached the stopped singleton forever, delayed later turns after ENOENT, and forwarded decompressed gzip under its original encoding header. Screen: hold a relay generation through the entire production stream with release in one `finally`; retire idle generations but cache missing-executable failures; let every startup waiter settle independently. A byte pipe must disable automatic decompression rather than forward stale encoding metadata. Fence child lifetime with a parent-owned stdin pipe (EOF stops the child even after parent SIGKILL); unref child/output pipes so they do not hold an idle parent open, but keep bounded readiness deadlines referenced until settled. Guards: `tests/opencode-relay.test.ts` (real child, overlapping production streams through finish/abort/error, virtual idle clock, raw gzip bytes and decoded text).

19. **A registered custom stream is not necessarily dispatched.** Pi's legacy composer calls `streamSimple` only when the selected model's API equals the provider's declared API (#635). Declaring `opencode-dynamic` at provider level while retaining per-model wire APIs bypassed the anonymous headers and Bun relay, despite passing callback-only tests. Screen: publish dispatch-tagged model copies on every registration/refresh path, retain original wire metadata in the existing catalog, and resolve it at request time. Prove network effects through real `ModelRuntime`, including discovery, refresh and re-registration; constructing/calling the wrapper directly is not a dispatch test. Also trace the real compat API registry used by auxiliary callers: dispatch-tagged models must recover the original wire API there too, not regress to model-name guessing. Guard: `tests/opencode-dispatch.test.ts` (all registered models, free/Go, authoritative Grok Responses, actual Bun child).

20. **A transport fix does not establish request-shape compatibility.** Bun alone still returned429 for Pi requests (#628); controlled native-prompt reductions isolated the small `<env>Working directory: .</env>` frame. Screen: compare full/partial/negative controls through the live service, then prove the real dispatcher and Pi-owned tool round-trip. Never copy a native persona, paths, skills or tool catalog when a clean metadata subset suffices. Merge the frame into a request-only copy of the leading system message, preserving sections, tools and later deltas; a new leading message can demote Pi instructions on in-place protocols. Guards: `tests/opencode-dispatch.test.ts` (all free models, Go exclusion, rich system/text-block metadata, compat dispatch and non-mutation).

21. **A final-settlement hook is not an abortable run.** PR #645 initially awaited an Infron cooldown in `agent_before_settle`, where supported hosts have already cleared `ctx.signal`; `abort()` and session replacement therefore waited the entire remote delay. Screen: every awaited lifecycle wait must retain a signal the production abort path actually signals. Keep slow work in an active phase (`agent_start` for the post-exhaustion Infron continuation) and final-settlement decisions synchronous. Tests must prove cancellation before advancing the cooldown; advancing all timers first hides the defect.

22. **Rendered errors are not provider errors.** The Infron gate (#646, #645/#648) required `Retry failed after 3 attempts`, but Pi's UI adds that wrapper only when rendering `auto_retry_end`; `message_end` and stored assistant errors contain raw `429: {...}`. The fixtures fabricated the UI wrapper inside an SSE error, so tests passed while the live handler never matched. Screen: reproduce the actual HTTP failure through Pi's native retry lifecycle, inspect the hook payload, and use lifecycle boundaries—not presentation strings or local retry counters—to decide exhaustion.

23. **A red gating check is never merged, and the formatter is not optional.** PR #648 merged while `Lint & type-check` was red on its own head, so master has failed `npm run format:check` on every push since: the changed file kept a long regex call oxfmt wants wrapped. Screen: read the gating checks on the exact head before merging (the format gate is deterministic, so a local `npm run format:check` with the pinned version reproduces CI exactly), and run it on every change that edits source — an editor or agent write is not "formatted" merely because it parses.

## Standing Invariants

- **Use Pi's lifecycle as the control-flow authority wherever possible.** Retry exhaustion, settlement, cancellation and queued work come from the native lifecycle, not formatted UI text or an extension's imitation of Pi's counters. Tests must exercise the real dispatcher and lifecycle with host-boundary fixtures (HTTP/process), not hand-shaped hook payloads that assume the behavior being proved.
- **Notifications are best-effort and never throw.** There is no UI left on a dead session; notify/status helpers swallow stale-context throws by design.
- **Abort is cancellation, not failure** (convention 15 extends everywhere: refresh supersedes, signal aborts, user Esc — none of these are strikes, errors, or warnings).
- **Health and log output stay credential-free** — counts, ages, status codes; never keys, tokens, bodies, header values, or log tails.
- **pi-ai compat never loads at startup** — dynamic imports only, via `loadPiAiEntry`; `check-runtime-imports` stays green.
- **pi-ai resolution is diagnosable without importing pi-ai.** `describePiAiResolution` (`lib/pi-ai-loader.ts`) reports the bare-specifier copy separately from the entry-aware result, with a per-probe trace and the `describeRejection` reason for every candidate it refused — filesystem-only, so it cannot trigger the compat load the loader exists to defer. `/pi-free-health` and `/free-telemetry` render it through one shared formatter (`formatPiAiResolutionLines`, `lib/health.ts`), and `recordPiAiDiagnostics` (`lib/telemetry.ts`) persists one record per session into the telemetry file. One rejection-reason source feeds both the usability guard and the trace, so the guard and the diagnosis can never disagree.
- **All `free.json` writes go through the locked RMW paths** (`saveConfig`/`updateConfig`) — never raw writes; concurrent toggles/probes must not clobber each other. The lock is cross-process (`withFileLock`, tmp + fsync + rename atomic writes, #611): an in-process promise chain does not serialize a second pi process.
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
| `/free-infron-retry` | Infron | Credential-free cooldown lifecycle counters and phase |
| `/free-telemetry`, `/clear-free-telemetry` | Global | Local performance data, clear it |
| `/toggle-{provider}` | Per-provider | Flip free↔all view |
| `/toggle-ollama-cloud` | Ollama Cloud | Flip native free/all catalog view |
| `/probe-{deepinfra,novita,ollama,routeway,sambanova}` | Provider | Test all models, auto-hide broken (ollama: 403s) |
| `/login {kilo,cline,qoder}` | Kilo/Cline/Qoder | Start OAuth flow (qoder: browser or PAT) |
| `/logout {kilo,cline}` | Kilo/Cline | Clear OAuth credentials |

**Authentication notes:**

- **Anonymous public catalogs** — Kilo, ZenMux, DeepInfra, Novita, Routeway, SambaNova, FastRouter, Cline resolve keyless (`public catalog (no account)`); chat still needs a key/login. StepFun, GMI Cloud, Agnes AI, TokenRouter, AnyAPI, B.AI, OpenGateway, Merge Gateway resolve `undefined` without a key (#421).
- **Kilo/Cline** support OAuth (`/login`) and API keys (`KILO_API_KEY` / `CLINE_API_KEY` or `~/.pi/free.json`); stored credential wins, then ambient key. Cline's catalog refreshes without a credential.
- **Qoder**: OAuth/PAT, Pi-owned stores, COSY signing, custom stream. `/login qoder` or `QODER_PERSONAL_ACCESS_TOKEN` / `QODER_PAT`.
- **OpenCode / OpenCode Go** are Pi-built-in; pi-free captures their catalogs for filtering, then runs one **detached** public-endpoint refresh per tier for models shipped between Pi releases. New IDs synthesize via `resolveOpenCodeModelApi`/`applyOpenCodeProtocolDefaults`. Failed/empty/aborted fetches retain cache and never rethrow. `resolveApiKey` omits absent credentials so logged-out providers read as unavailable, not refresh failures (defect shape 9; full #504 narrative in HISTORY.md). `opencode-free` inference sends Zen's anonymous `public` bearer (the keyed free-tier lane is rejected upstream with `Model access is disabled`) and activates `glob` + `grep` per turn for client compatibility. Every anonymous/free stream also adds the default request-only `<env>Working directory: .</env>` metadata frame while preserving Pi's complete prompt, tool state and history; no native persona, absolute paths, captured snapshots or CLI dependency. The frame does not modify saved transcripts or accumulate across turns; `opencode-go` keeps the credential and gets no frame (`lib/glob-tool.ts`).
- **Deferred saved-model restore** — Pi restores the session model before extension registrations flush, so resumes on toggle providers hit "Could not restore model". After capture, `built-in-toggle.ts` re-selects the persisted model via `pi.setModel` when in view; Pi's warning line is unavoidable.

---

## Testing

- **Framework:** Vitest (`vitest` v5)
- **Run:** `npm test` (watch), `npm run test:run` (once)
- **Drive pi-ai directly:** `npm run drive -- --provider <id> [--model <sub>] [--prompt "..."] [--anonymous] | --list` — realistic turn through `streamSimple` on Pi's native store (stored auth first, then `<PROVIDER>_API_KEY`); non-zero exit on errors, doubles as wire-behavior smoke.
- **Startup perf:** `npx tsx scripts/bench-startup.ts <warm|cold|fastcold> [source|compiled]` (sandboxed `HOME`, mocked `fetch`; build first for `compiled`). Reports `importMs`/`factoryMs`/total; refresh + detached work separately.
- **Tests:** `tests/*.test.ts` (registry, toggle, config, detection, compat; `vi.fn()` ExtensionAPI doubles)
- **OpenCode relay lifetime:** anonymous streams acquire a generation before readiness and release in `createOpenCodeStreamSimple`'s outer `finally`; five idle minutes starts only after the last stream ends. Idle generations are replaceable; missing Bun is cached unavailable until process restart. `PI_FREE_OPENCODE_BUN` selects the executable, `PI_FREE_OPENCODE_RELAY="0"` disables routing, and `PI_FREE_OPENCODE_RELAY_UPSTREAM` overrides the child's upstream for fixtures. The Go keyed lane never acquires the relay. All OpenCode models publish `opencode-dynamic` at the registration/refresh boundary so Pi invokes the wrapper; the canonical catalog/cache keeps original wire APIs, read at request time through `getModelApi`. This is provider-wide, not a model-id allowlist. The free stream adds the minimal environment frame through the same factory for both provider and compat calls; keyed Go is untouched. Context normalization is lazy, and the existing leading system is copied rather than demoted, preserving sections, text blocks and tool deltas. Upstream quota/policy/availability can still change; a successful live probe is a dated observation, not a guarantee. Encoded bytes pass unchanged (`decompress:false`); downstream owns decompression. Parent-owned stdin EOF fences Bun's lifetime across normal/explicit/killed-parent exit; the child and output pipes are unreferenced in the parent, while readiness deadlines stay referenced until settled. There is no hard RSS or concurrency quota; request bodies are buffered.
- **Windows OpenCode relay smoke:** CI's `windows-opencode-relay` job installs Bun 1.4.4 explicitly and runs the relay, session-integration, compat-stream, and real-dispatcher suites. The ordinary unit lane may skip real-Bun cases when Bun is absent; the dedicated lane requires it. The relay upstream is a local HTTP fixture, not the live service: this proves Windows process/forwarding compatibility, not upstream TLS acceptance.
- **Design the state space before coding.** For stateful/ordered/resource-mutating work, write invariants, transitions, and a cross-product matrix (order, failure atomicity, aborts) first — the refresh-supersede and restore bugs came from unmodeled orderings.
- **Native protocol-preservation tests follow the host catalog.** Compare copied endpoints against the installed Pi catalog, not a hardcoded host-version URL (Pi 1.3 moved OpenCode from `/zen` to `/inference`, #647). Keep independent API/compat assertions so preservation is not vacuous.
- **Wait on the right clock.** Poll for conditions (`waitFor`/`waitSettled`, bounded loops) — never fixed sleeps. Detached tasks mutating polled state get a targeted lint disable with reason.

---

## TLC Model Checking

- **Scope:** `tla/` models concurrency-shaped behavior only (refresh generations vs re-registration storms, toggle vs restore timing, fallback restore vs user picks, load/start ordering). Pure logic stays in unit tests; TLC is for interleavings.
- **Run:** `node scripts/check-tlc.mjs` (all plans), `--coverage` to add TLC's per-action evaluation counts, `--list` for the plan table without a toolchain. The toolchain (pinned Temurin JRE + tla2tools) bootstraps into `~/.cache`; `TLC_JAVA`/`TLC_JAR` reuse an existing one. CI job `tlc.yml` runs the `--coverage` form on `tla/**` changes; the unit suite never runs TLC (toolchain weight) — `tests/tlc-script.test.ts` pins the runner's CLI contract and `tests/tlc-coverage.test.ts` pins the coverage parser against real TLC output.
- **Every hazard ships a falsify plan and every fix a hold plan** (`RefreshA`/`RefreshB`); reload and session variants take the model suffix (`RefreshR-*`, `Session*`); boundary maps take the storm parameter (`RefreshR-F`). A falsify plan that stops failing means the spec no longer exercises the hazard — treat it like a dead mutation test.
- **Every hold gets a firing proof.** A hold is vacuous until a falsifying twin proves the guarded transition fires (the `FallbackLive` pattern: `CoverRepair` must violate). If the guarded action cannot fire, the hold proves nothing — and TLC reports nothing either way.
- **Action coverage is a diagnostic, never a gate.** `--coverage` prints per-action evaluation counts (`scripts/lib/tlc-coverage.mjs`); a suddenly-zero action is how a guard dies silently, which is the hazard the bullet above guards by hand. Do not assert on it: the counts say how often TLC *evaluated* a definition, not how many transitions used it, and `ToggleA` legitimately reports `FetchAborted: 0:8` for an action enabled in that config. The firing proof stays the falsifying twin. It does corroborate: `Fallback.RestoreLand` fires ~6.7k times in `FallbackB`/`FallbackC`.
- **Audit frames on every variable touch.** Each `X' = …` assignment must exclude `X` from every conjoined `UNCHANGED` tuple, or the action silently dies: no error, just a shrunken space. After adding or moving a variable, confirm state counts move in the expected direction; sudden shrinkage is a dead action until proven otherwise.
- **Trust the compiler over cached diagnostics.** When an editor/linter finding contradicts `tsc --noEmit` on a tree identical to a green base, re-verify the finding against current file contents before editing.

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
