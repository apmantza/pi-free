# Provider lazy-loading strategy

> Proposal only. This document describes a future optimization; it does not
> change the provider lifecycle or promise a startup win without measurements.

## Decision summary

Use staged, leaf-first lazy loading rather than replacing the provider factory
with awaited dynamic imports. The first experiment deferred Cline's XML
bridge (since superseded by #433, which deleted the bridge and moved Cline to
the standard OpenAI api via the resulting lazy compat bridge), then applied the
same boundary to TokenRouter and OpenModel. A later
phase may introduce full provider stubs, but only if they preserve Pi's native
provider contract. Qoder now uses the native provider lifecycle; its custom auth
and protocol remain request-time concerns.

## Goals

- Reduce import-time module graph work and, where possible, the work Pi awaits
  before flushing the extension registration.
- Preserve model-picker visibility from the native models store, including
  keyless Cline catalog discovery.
- Preserve authentication and `/login`, per-provider toggles, global
  `/toggle-free`, `filterModels`, hidden-model policy, and stable provider
  identity.
- Preserve Pi-owned native store restoration, session-start refresh nudges,
  cancellation, and the existing `Promise.allSettled` error isolation.
- Measure source and compiled startup separately from first-use latency.

## Non-goals

- Do not add a second model cache, freshness policy, or background refresh
  scheduler. Native providers remain governed by Pi's `refreshModels` and
  `~/.pi/agent/models-store.json`.
- Do not make global commands, quota/telemetry handlers, the registry, or
  built-in provider toggles lazy. They are cross-provider infrastructure and
  must be available immediately.
- Do not hide configured providers until the user selects a model or logs in.
- Do not migrate Qoder as part of this optimization. Its PAT exchange, COSY
  signing, static catalog, and custom stream remain legacy by design.
- Do not treat a smaller JavaScript graph as a user-visible improvement until
  the import-inclusive benchmark demonstrates one.

## Current baseline

### Structural facts

`index.ts` has 17 static provider imports and 17 entries in `UNIQUE_PROVIDERS`.
`piFreeEntry()` maps every entry through `timeProvider()` and awaits the whole
set with `Promise.allSettled()` before finalizing startup. Therefore, replacing
an import with:

```ts
const provider = await import("./providers/foo/foo.ts");
await provider.default(pi);
```

only moves the same work into the awaited factory. It may reduce the initial
module graph, but it does not reduce `factoryMs` and can add dynamic-import
overhead. This is the naive design to reject.

Global setup is deliberately eager in `piFreeEntry()`:

- `setupGlobalCommands()`, `setupQuotaMonitoring()`, and `setupTelemetry()` are
  registered in the `global-handlers` phase.
- The module-level registry in `lib/registry.ts` is populated by provider
  factories and is read immediately by `/free-providers`, `/toggle-free`, and
  the initial `applyGlobalFilter()`.
- `setupBuiltInProviderToggles()` in `lib/built-in-toggle.ts` registers toggle
  commands and a `session_start` capture for Pi-owned OpenCode/OpenRouter
  models. It is independent of extension-provider loading.

Native provider factories are already network-free in the inspected paths.
`lib/native-provider.ts` centralizes store restoration, refresh persistence,
free filtering, same-object re-registration, and session-start refresh nudges.
Consequently, lazy loading targets module initialization and optional protocol
code, not a new catalog lifecycle.

### Measured facts versus hypotheses

| Statement | Status |
| --- | --- |
| There are 17 static provider imports and all 17 setup functions are awaited. | Measured from `index.ts` source. |
| `scripts/bench-startup.ts` reports `importMs`, `factoryMs`, and import-inclusive `totalMs` in warm, cold, and fast-cold modes. | Existing measurement capability. |
| Native Cline, TokenRouter, and OpenModel setup paths do not fetch a catalog in their factory; Pi calls `refreshModels` later. | Observed in `providers/cline/cline-provider.ts`, `providers/tokenrouter/tokenrouter-provider.ts`, and `providers/openmodel/openmodel.ts`. |
| A lazy boundary will reduce startup enough to matter to users. | Hypothesis; measure before and after. |
| First-use dynamic-import latency will be imperceptible. | Hypothesis; measure and set a budget. |
| Historical native migration measurements are the current baseline. | False. The roadmap's Kilo 7.0-second result and the old cold-path 66-to-8-second result are historical, not attribution for this change. |

The baseline for this proposal is a fresh run of the benchmark in both source
and compiled modes, with repeated samples and the same Node/Pi versions. Do not
infer a provider's import cost from its catalog or network timing.

## Provider-specific boundaries

- **Cline:** `providers/cline/cline-provider.ts` streams through the shared
  lazy compat bridge (`lazyOpenAICompletionsApi()`), like every other
  OpenAI-compatible native provider — the custom XML bridge was removed when
  Cline's endpoint became standard OpenAI Chat Completions (#433). The native
  provider object, `clineAuth`, public catalog refresh, `filterModels`, stored
  catalogs, and `registerNativeProviderRefresh()` must remain available before
  compat is loaded, and `rotateClineTaskId()` keeps mutating the shared
  headers record exposed as `provider.headers`.
- **TokenRouter:** `providers/tokenrouter/tokenrouter.ts` combines model mapping,
  enrichment/fetching, reasoning normalization, payload patching, and the
  high-load retry stream. `tokenrouter-provider.ts` owns the native Provider,
  auth, store, toggle, registry, and session refresh. These responsibilities
  should be split before attempting a full stub. The `before_provider_request`
  and `message_end` hooks in `registerTokenRouterProvider()` must not disappear
  while the implementation is unloaded.
- **OpenModel:** `providers/openmodel/openmodel.ts` combines public/protocol
  catalog merging with the native Anthropic provider. Its `refreshModels` must
  still restore the native store offline, and its `stream`/`streamSimple` must
  retain `anthropicMessagesApi()`. Preserve the terms notification and the
  key-required online refresh behavior.
- **Qoder:** `providers/qoder/qoder.ts` now owns only native registration,
  toggle invalidation, and session-start refresh wiring. Its custom OAuth/PAT
  adapter and `streamQoder` remain request-time dependencies; preserve them
  when considering further leaf-level lazy loading.

## Candidate designs

### A. Static imports (baseline)

Keep the current graph and use the existing native lifecycle. This has the
lowest risk and remains the fallback if import time is not user-visible.

### B. Awaited dynamic provider imports (reject)

Dynamically import each provider from `UNIQUE_PROVIDERS` and await each setup
inside `piFreeEntry()`. This reduces static graph reachability but shifts
provider initialization into the awaited factory. It cannot improve the
critical factory boundary and complicates provider names in `timeProvider()`.

### C. Leaf/protocol lazy loading (recommended first)

Keep a small eager provider shell and dynamically import code needed only on
first request or online refresh. Cache the import promise so concurrent calls
share one load. This was first applied to Cline's XML bridge (since deleted by
# 433; Cline now uses the shared lazy compat bridge) and can later be
used for TokenRouter/OpenModel stream and catalog helpers. Errors must be
converted through the existing provider stream/error paths, not become an
unhandled rejected import.

This design keeps provider identity and native registration unchanged. It is
not a full provider stub: auth, `getModels`, filtering, toggles, registry
entries, and session hooks remain eager.

### D. Full native lazy provider stub (later, conditional)

Register one stable `Provider` object whose methods delegate to a cached,
loaded implementation. The stub must be complete enough for Pi before the
implementation is loaded:

1. `id`, `name`, `baseUrl`, and the correct `auth` object must be present so
   configured providers and `/login` remain discoverable.
2. `getModels()` must return the restored catalog (or an empty result) without
   loading the protocol implementation; Pi's store restoration must populate
   the same in-memory catalog used by `filterModels`.
3. `filterModels()` must apply global/per-provider free state and hidden models
   through the existing `lib/native-provider.ts` policy.
4. Toggle commands and `registerWithGlobalToggle()` must operate on the same
   `stored` object. Invalidation must re-register the same Provider object,
   not replace it, so selection and Pi's availability snapshot remain stable.
5. `refreshModels()` must restore offline first, load the catalog implementation
   only for an allowed online refresh, honor `context.signal`, retain the old
   list on empty/failing fetches, and persist through `context.store`.
6. Session-start refresh handlers must be registered eagerly and must continue
   to be detached/non-blocking through `registerNativeProviderRefresh()`.
7. `stream` and `streamSimple` must load the implementation once, preserve
   request options and abort signals, and return the provider's normal error
   event if loading fails.

This design is more invasive and should not be generalized until the leaf
experiment proves that import cost, rather than catalog/network work, is the
remaining bottleneck.

## Recommended staged rollout

### Stage 0 — instrument and baseline

1. Run `scripts/bench-startup.ts` in warm, cold, and fast-cold modes, in source
   and compiled modes, with at least 10 samples per case.
2. Record `importMs`, `factoryMs`, `totalMs`, registered-provider count, factory
   network calls, and native offline-init results.
3. Add a first-use measurement for a Cline request and a store-restored model
   picker, because the existing benchmark does not exercise a real request.

### Stage 1 — defer Cline's XML bridge (SUPERSEDED)

Superseded by #433: the Cline XML bridge was deleted entirely when Cline's
endpoint became standard OpenAI Chat Completions; Cline now streams through
the shared lazy compat bridge (`lazyOpenAICompletionsApi()`) that this roadmap
produced.

Historical plan: in `providers/cline/cline-provider.ts`, replace the top-level
bridge import with a cached dynamic loader used by both stream entry points,
keep `createClineProvider()` synchronous and network-free, preserve
request-scoped headers and task-ID rotation, and ensure two concurrent first
requests share the same import promise.

### Stage 2 — apply the boundary to TokenRouter and OpenModel

1. Split protocol-heavy implementation from the eager shells. For TokenRouter,
   keep `createTokenRouterProvider()` and registration wiring in
   `tokenrouter-provider.ts`; load model fetching and stream/normalization
   dependencies from `tokenrouter.ts` only when refresh or a request needs
   them.
2. For OpenModel, keep the native Provider shape, auth, stored catalogs,
   filtering, terms notification, and refresh/store wrapper eager; defer
   catalog mapping/fetch helpers and stream construction only where that does
   not change the `anthropic-messages` contract.
3. Preserve TokenRouter's payload patch and `message_end` normalization hooks,
   including MiniMax handling, across the lazy boundary.
4. Add cached-loader race/error tests and repeat the benchmark plus first-use
   latency measurements. Stop if import savings are smaller than operational
   complexity or first-use cost is user-visible.

### Stage 3 — consider a reusable full-stub descriptor

Only after Stages 1–2 demonstrate a repeatable import win, define a typed lazy
provider descriptor and implement it for one provider at a time. Do not add a
registry placeholder that lacks catalogs, auth, or filtering: that would make
`/free-providers`, `/toggle-free`, and the picker report misleading state.

## Acceptance metrics and tests

A stage is accepted only when all of the following are compared with the same
baseline environment:

- **Startup:** report p50 and p95 `importMs`, `factoryMs`, and `totalMs` for
  warm/cold/fast-cold source and compiled runs. A proposed review gate is no
  more than 5% regression in `factoryMs` or `totalMs`; the import reduction
  target is empirical and must be recorded rather than assumed.
- **First use:** measure time from first request to first stream event for Cline,
  TokenRouter, and OpenModel. Set a documented budget from Stage 0; do not
  hide a meaningful regression behind a faster import.
- **Visibility:** with a seeded `models-store.json`, every native provider
  restores models before network access; free-only and all-model views match
  the static baseline.
- **Auth and commands:** `/login cline` remains available before the first
  request; API-key resolution and OAuth credentials are unchanged; all provider
  toggles, `/toggle-free`, `/free-providers`, and `/pi-free-health` behave as
  before.
- **Identity and lifecycle:** re-registration uses the same Provider object;
  session-start refresh remains non-blocking, abortable, and observable in
  `/free-startup`; one extension reload does not duplicate event handlers.
- **Errors:** a failed lazy import is logged with provider context, returns the
  provider's normal error result, and does not reject `piFreeEntry()` or break
  unrelated providers.
- **Packaging:** `npm run lint`, `npm run test:run`, `npm run build`, `npm run
  check`, tarball validation, and compiled smoke tests pass. Exercise the
  dynamic path from the packaged `dist/` entry, not only from tsx source.

Focused existing tests to extend include `cline-provider.test.ts`,
`tokenrouter-provider.test.ts`,
`openmodel.test.ts`, `native-filter-models.test.ts`, `registry.test.ts`, and
`qoder.test.ts` (the last one guards the eager/legacy boundary).

## Compiled-dist constraints

The published entry is `dist/index.js`; source TypeScript is not shipped.
`docs/build-strategy.md` specifies NodeNext compilation, peer externalization,
relative extension rewriting, and unbundled dynamic imports. Any new dynamic
specifier must therefore:

- be a statically resolvable relative source import that emits to the matching
  `.js` path under `dist/`;
- include the target module in the published `dist/**/*` output;
- work with the host Pi peer packages available at runtime; and
- be tested through `npm run build`, `npm run check`, `npm pack`, and
  `npm run smoke:compiled`.

Do not rely on bundler chunk naming, source-only `.ts` paths at runtime, or
unpublished files. Keep source and compiled benchmark results separate: source
`importMs` includes the tsx loader, while compiled `importMs` measures Node ESM
loading.

## Rollback and risks

- **Rollback:** retain the static implementation behind a small, removable
  loader boundary. If rollout uses a feature flag, default it to static and
  make the flag process-start-only; do not persist a half-loaded provider
  state. Revert the stage if picker, auth, or first-use acceptance fails.
- **Stable identity risk:** replacing a stub with a newly-created Provider can
  lose Pi's selection/auth/filter snapshot. Prefer one object with delegated
  methods and same-object invalidation.
- **Visibility risk:** a stub without `auth.apiKey`/OAuth or a restored
  `getModels()` can hide a provider from Pi's availability gate. Cline's
  keyless public catalog is a mandatory regression case.
- **Lifecycle risk:** deferring `refreshModels` or `session_start` registration
  can skip native store restoration or make detached work block startup.
- **Error/race risk:** concurrent first requests, aborts during import, and
  failed compiled paths need deterministic handling and no unhandled promise.
- **Behavior risk:** TokenRouter MiniMax payload and
  message normalization, and OpenModel Anthropic streaming are wire contracts;
  import timing must not change them. (Cline's XML/tool parsing risk is gone:
  the bridge was deleted by #433.)
- **Measurement risk:** a faster import can be offset by factory work,
  first-request latency, or Pi's own model refresh. Keep all three timings and
  first-use measurements in reports.

## Explicit implementation tasks

- [ ] Capture and commit a baseline table from the source/compiled startup
  benchmark; include Node and Pi peer versions and sample count.
- [ ] Define a typed cached dynamic-loader helper with abort/error semantics,
  or document why a provider-local loader is safer for Stage 1.
- [ ] Implement and test the Cline bridge-only boundary in
  `providers/cline/cline-provider.ts`; do not change `lib/native-provider.ts`
  semantics.
- [ ] Add first-use and concurrent-load tests for Cline, including failed import
  behavior and `streamSimple`.
- [ ] Split TokenRouter protocol/fetch code from native registration; preserve
  `registerTokenRouterProvider()` hooks and extend `tokenrouter-provider.test.ts`.
- [ ] Split OpenModel protocol/fetch/stream code from its eager Provider shell;
  extend `openmodel.test.ts` and compiled smoke coverage.
- [ ] Add a native lazy-stub contract test covering auth, store restoration,
  `getModels`, `filterModels`, toggle invalidation, stable identity, refresh,
  and stream errors before considering Stage 3.
- [ ] Run the full packaging checks and update `docs/build-strategy.md` only if
  the implementation changes its stated compiled-output constraints.
- [x] Migrate Qoder to native auth, model-store refresh, filtering, and stable
  provider registration while preserving OAuth/PAT and `streamQoder` behavior.
