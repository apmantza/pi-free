# Roadmap — pi-free forward assessment

> Updated after the observability → native-provider → compiled-startup arc
> (PRs #350–#388). Supersedes the recommendations in `docs/opps.md`, which
> remains historical context for *why* the native-provider migration exists.
> This is a planning document, not a record of shipped model counts or provider
> promotions.

---

## Where we are

Merged and in production:

| PR | What | Evidence it worked |
| --- | --- | --- |
| #350 | Startup observability (`lib/startup-timing.ts`, `/free-startup`) | Production logs expose factory, provider, and detached session-start timings |
| #351 | 8s startup fetch deadline + buffered async logging | Cold network work is bounded; warm logging is effectively non-blocking |
| #352 | Built-in alignment and retired duplicate fetchers | Pi-owned built-ins no longer have duplicate pi-free catalog discovery |
| #353–#386 | Native provider lifecycle, filtering, and startup import-graph cleanup | All pi-free providers except Qoder use Pi's native lifecycle; compiled import p50 improved ~1.14s → ~0.43s and total p50 ~1.18s → ~0.47s; measured graph 904 → 226 modules |
| #387–#388 | StepFun native provider and paid-by-default behavior | StepFun uses Pi's native model store and OpenAI Chat Completions at `api.stepfun.ai/step_plan/v1` |
| #380–#384 | Generic DeepSeek/Cline DSML and custom-tool schema compatibility | Registered extension-tool schemas are preserved; mixed DSML forms are normalized without provider-specific allowlists |
| Follow-up | Session-start and fetch observability | `/free-startup` reports per-provider attempts, failures, handler durations, and detached post-handler work; background work remains non-blocking |

Current focus: **Qoder remains the only static legacy provider**; any future migration is a separate protocol/auth project. Compiled `dist/` packaging is shipped and is the Pi/npm entry. The startup numbers above are controlled compiled extension benchmarks; a full Pi-host A/B result has not been claimed.

---

## Verified architectural facts (ground truth from Pi 0.83 dist)

These drive every recommendation below. Re-verify on major Pi bumps.

1. **`pi.registerProvider(id, …)` with a built-in ID silently overrides the
   built-in** (`docs/extensions.md`: "Register or override"; `dist/core/model-runtime.js`
   `recomposeProvider` layers extension config above builtins). No duplicate
   picker entries, no errors. This is why shadowing built-ins is a hygiene
   problem, not a crash problem.
2. **Factory contract**: Pi awaits the async extension factory before flushing
   registrations (`extensions.md` L181) and forbids background resources from
   the factory (L222) because factories run in non-session invocations
   (`pi --list-models`). Fire-and-forget fetching from the factory is
   contract-violating; `refreshModels` is the sanctioned async path.
3. **`refreshModels(context)`**: Pi owns credential refresh (before the call),
   background refresh (4h throttle), `force` (`pi update --models`), abort
   signals, and offline init (`allowNetwork: false` → store-only). Extensions
   persist via `context.store` → `~/.pi/agent/models-store.json`.
4. **Auth gating** (`pi-ai/dist/models.js` `getAvailable` / `checkProviderAuth`):
   a provider is visible iff it has `auth.oauth` + stored OAuth credential, or
   `auth.apiKey` whose resolution yields a key (stored or ambient). **No
   `auth.apiKey` object → permanently hidden.** `filterModels` runs *after*
   this gate and can only subtract.
5. **`filterModels` invalidation** (`pi-coding-agent/dist/core/model-runtime.js`):
   the picker reads a cached availability snapshot; `registerProvider` is a
   mutation that queues `forceRefreshAvailability()`, which re-runs
   `getAvailable()` → re-runs `filterModels`. So a toggle = flip state +
   re-register the same provider object. No model-array rebuild needed, but
   re-registration remains the invalidation *signal* (no lighter
   extension-facing hook exists).
6. **Snapshot flicker subtlety**: the synchronous post-mutation snapshot
   (`updateModelSnapshot`) briefly serves unfiltered `all` (filtered only by
   `configuredProviders`) until the async availability refresh applies
   `filterModels`. Likely imperceptible (picker re-refreshes on open) but must
   be tested in the filterModels capstone.

---

## Phases

### Phase 0 — Cline migration (completed)

Cline now uses the native `Provider` surface with its custom XML wire API,
public keyless catalog, adapted OAuth flow, request-scoped headers, and Pi-owned
models store. The remaining static providers were migrated in the same arc;
Qoder is intentionally deferred because its PAT exchange, COSY signing, and
custom stream need a separate design.

**Completed criteria:** native refresh/store tests, credential reuse coverage,
filtering and toggle coverage, and cross-platform CI for the migration PRs.

### Phase 1 — API-key provider batch (completed)

The former candidates — `zenmux, sambanova, deepinfra, novita, routeway,
crofai, llm7, tokenrouter, anyapi, bai, openmodel, ollama-cloud` — now use the
native lifecycle. The value was architectural uniformity (Pi-owned refresh,
credentials, cancellation, and models-store persistence), not a promise of a
fixed startup speed.

The migration was intentionally batched because its main benefit is
architectural uniformity (one registration form, Pi-managed refresh,
credentials, cancellation, and models-store persistence), not a promise of a
fixed user-visible startup speed. Keyless-provider auth and the `>=0.81.0`
peer surface were covered by the migration tests and CI; the lockfile was kept
unchanged.

### Phase 2 — Qoder (deferred)

Qoder's OAuth device flow, PAT exchange, COSY signing, static catalog, and
custom stream remain intentionally legacy. Revisit only with a dedicated
protocol/auth migration plan and compatibility tests.

### Phase 3 — `filterModels` capstone (completed)

The toggle-system endgame is complete. The design (verified against Pi's
runtime — see facts 4–6) is:

+ `getModels()` returns the **full catalog** — no `stored.free/all` views, no
  `setView`.
+ `filterModels(models, credential)` is a **pure function of toggle state**
  (per-provider mode + global `free_only` + per-provider `show_paid`) — one
  shared implementation for all native providers.
+ Toggle handlers become **flip state + re-register same object**.
+ `registerWithGlobalToggle`'s array-rebuild logic and `lib/toggle-state.ts`'s
  model storage die for native providers.

Completed in the native-provider migration and cleanup PRs. The native
filter and re-registration paths have focused tests for the eventual filtered
availability snapshot; Qoder and Pi-built-in providers retain their
specialized legacy surfaces by design.

### Parking lot (unordered, low urgency)

+ **Free-filter toggle ports** for the 5 retired fetchers (mistral, groq,
  cerebras, xai, huggingface) on top of Pi's built-ins, à la openrouter —
  only if users miss them. Requires a pricing check per native catalog first
  (Route A/B detection depends on it; opencode-go's native catalog has zero
  free models, illustrating the risk).
+ **Qoder native migration** — requires a dedicated plan for PAT exchange,
  COSY signing, the static catalog, and its custom stream.
+ **Free-filter toggle ports** for Pi-built-in Mistral, Groq, Cerebras, xAI, and
  Hugging Face catalogs — only if users request them. pi-free would layer a
  filter/toggle over Pi's catalog without duplicating discovery; pricing
  metadata must be checked first to avoid false free classifications.
+ **Preventive XML-tool-leak handling** — the Cline bridge now recovers known
  XML/DSML and native tool-call forms reactively. A future `before_provider_headers`
  compatibility hook could prevent leaks for known model families, but needs
  reliable model-specific evidence before adding request complexity.
+ **Orphan cleanup** — old per-provider entries in users' `~/.pi/provider-cache.json`
  are cosmetic leftovers from the native migrations.

---

## Risks & operational lessons (today's scar tissue)

+ **OneDrive hosting the repo**: local `master` silently regressed mid-session
  (`.git/refs` interference suspected) and phantom CRLF modifications recur.
  Durable fix: move the repo out of the OneDrive folder. Until then: verify
  `git rev-parse HEAD` before important operations.
+ **npm lockfile landmine**: `overrides` do **not** constrain auto-installed
  *peer* entries. Offline or partial lockfile regeneration leaves
  `pi-coding-agent/node_modules/brace-expansion@5.0.7` (GHSA-mh99-v99m-4gvg,
  high) while the top-level copy is correctly 5.0.8 — and CI's
  `npm audit --omit=dev --audit-level=high` fails on it. Fix: mirror the
  top-level entry onto the nested peer entry (see commit `0bb7ce8`). Rule of
  thumb: migrations that don't change dependencies should never regenerate
  the lockfile.
+ **SonarCloud on new code**: flags `Math.random()` (S2245, as vulnerability),
  cognitive complexity >15 (S3776), consecutive `push()` (S7778), generic
  length assertions (S5906). All avoidable by construction; PR #353 passed
  clean.
+ **Subagent quota exhaustion**: a 429 mid-task purges the agent's resumable
  state. Recovery pattern that worked: the worktree survives if commits
  exist (else auto-cleaned) → restore the worktree at the same path +
  `node_modules` → mine the JSONL transcript for research dumps → relaunch a
  fresh agent briefed on both. Commits early, commit often should be in every
  agent brief.
+ **Windows worktree setup**: plain `cp -r node_modules` times out; bare
  `robocopy /E` gets MSYS-mangled (`/E` → `E:/`). The incantation:
  `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*" robocopy <src> <dst> /E /MT:16 /R:2 /W:2`
  (exit codes 0–7 = success).
+ **Network flakiness is environmental**: today's registry/API ECONNRESETs
  caused the original 7s Kilo startups, killed an agent's npm install, and
  showed up in bench cold-runs. Deadline + store-first architecture is the
  right posture; don't chase it per-provider.

---

## Suggested next decisions

1. Cut the next release with the merged StepFun, DSML, schema, and startup work.
2. Revisit Qoder only when its authentication and custom-stream compatibility can
   be migrated without reintroducing startup network work.
3. Consider built-in free-filter ports or preventive XML leak handling only when
   user demand and model-specific evidence justify the maintenance cost.
