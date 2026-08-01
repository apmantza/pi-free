# Telemetry & Logging Audit

A review of pi-free's observability surfaces — logging, timing, telemetry, quota
monitoring, and health reporting — assessing whether they are unified, whether
they cause performance issues, and what was improved.

> Audit date: 2026-08-01 · covers the codebase at `v2.3.0` plus the unreleased
> changes described under "Work completed" below.

---

## 1. Inventory — what exists

| Surface | File | Sink | Clock | Trigger |
| --- | --- | --- | --- | --- |
| **Structured logger** | `lib/logger.ts` | console + `~/.pi/free.log` (buffered async `WriteStream`) | `Date.now()` (ISO ts) | 38 `createLogger` sites |
| **Startup timing** | `lib/startup-timing.ts` | in-memory only | `performance.now()` (monotonic) | `piFreeEntry` phases + per-provider |
| **Session-start metrics** | `lib/session-start-metrics.ts` | in-memory → feeds startup-timing | `performance.now()` | `session_start` handlers |
| **Model telemetry** | `lib/telemetry.ts` | `~/.pi/free-telemetry.json` (sync `writeFileSync`) | `Date.now()` | `before_agent_start` + `turn_end` |
| **Quota monitor** | `lib/quota-monitor.ts` | in-memory `Map` | `Date.now()` | `after_provider_response` |
| **Health report** | `lib/health.ts` | `/pi-free-health` (aggregates registry + startup) | — | command |
| **Benchmark debug log** | `provider-failover/benchmark-lookup.ts` | `~/.pi/modelmatch.log` (sync `appendFileSync`) | `Date.now()` (ISO) | `enhanceWithCI` per model, opt-in |
| **JSON persistence** | `lib/json-persistence.ts` | sync `writeFileSync` + lock | — | telemetry, probe-cache, config |

User-facing commands: `/free-startup`, `/pi-free-health`, `/free-telemetry`,
`/clear-free-telemetry`.

---

## 2. Is it unified?

**Logging: mostly yes.** `createLogger(namespace)` is the single surface, adopted
across 38 sites with a consistent `const _logger = createLogger("…")` pattern.
Console defaults to error-only, file to debug — sensible. The buffered async
`WriteStream` (lazy open, dir ensured once, sync fallback) is well done and
already removed ~15–20ms from warm startup per the v2.3.0 changelog.

**Fragmentation points found:**

1. **A second, parallel logging system** — `benchmark-lookup.ts` wrote
   `~/.pi/modelmatch.log` with raw `appendFileSync` and a pipe-delimited format,
   bypassing `createLogger` entirely (it even imported `createLogger` for its own
   error warnings but did not use it for the debug entries). Two log files, two
   formats, two code paths. **Fixed** (see below).

2. **Two overlapping timing APIs** — `timeAsync()` in `session-start-metrics.ts`
   vs `measurePhase()`/`timeProvider()` in `startup-timing.ts`. Both wrap a
   function and record duration. `timeAsync` is generic but used in one place;
   the startup-timing trio is the real API. Not yet consolidated (low value).

3. **Two clock primitives with no codified rule** — `performance.now()`
   (monotonic) for startup/session durations, `Date.now()` (wall) for telemetry
   latency, quota timestamps, cache TTL, auth expiry. This is *mostly* correct by
   convention, but **telemetry used `Date.now()` to measure call latency**
   (`startModelCall`/`recordModelCall` diff), which is wrong for a duration — NTP
   adjustments or system suspend corrupt it. The `MAX_SANE_LATENCY_MS` (10 min)
   guard caught the worst cases, but the monotonic clock is the correct fix.
   **Fixed** (see below).

4. **`util.ts:539`** creates `createLogger(providerId)` *inside*
   `fetchOpenAICompatibleModels` — a fresh logger object per call. Minor (the
   object is tiny), inconsistent with the module-level `_logger` convention
   everywhere else. Not yet addressed (low value).

---

## 3. Does it cause perf issues?

**Logger: no.** Already optimized — buffered stream, no per-line sync I/O. ✓

**Startup/session timing: no.** In-memory arithmetic, no I/O, best-effort
try/catch everywhere. ✓

**Quota monitor: no.** Pure in-memory, header parse per response. ✓

**Telemetry: yes — was the main concern.** On every `turn_end` for a free model:

- `addEntry` → `_store.update` → acquires lock, `load()` (cached, ok), then
  `save()` = **synchronous `writeFileSync`** of the entire store.
- Then `deriveModelTelemetry` **re-derived all stats from the `recentCalls`
  array** (O(n), n ≤ ~50) on every single call, even though only one entry was
  appended.
- `reapStaleInFlight` iterated the whole `_inFlight` map on every
  `startModelCall`.

Net: one sync disk write + an O(n) recompute per turn. On a fast SSD ~1–5ms; on
Windows with Defender scanning, more. **Fixed** the sync-write part (see below);
the O(~50) recompute is negligible (microseconds) and retained.

**Benchmark scoring at startup: second concern.** `enhanceWithCI` runs
`findHardcodedBenchmark` for **every model in every catalog** (24 call sites).
With **536 benchmark entries**, the first two strategies are **not indexed**:

- `tryDirectSubstringMatch` — loops all 536 entries, `search.includes(key)` per
  entry, per model.
- `tryVariantAliasMatch` — loops `MODEL_VARIANTS` (~40 entries) per model.
- Only strategy 4 (`findBestVariantByPrefix`) uses the `getBenchmarkIndex()`
  prefix index.

So for ~500 models across providers, that's ~270k substring scans at startup.
Bounded, but measurable. **Not yet addressed** (medium-value improvement #4 in
the recommendations).

**Benchmark debug logging: opt-in but heavy.** `PI_FREE_BENCHMARK_DEBUG=1`
enabled sync `appendFileSync` per model per attempt — hundreds–thousands of sync
writes at startup. **Fixed** (now routed through the buffered logger).

**No log rotation anywhere.** `~/.pi/free.log`, `~/.pi/modelmatch.log` grew
unbounded. Telemetry is bounded (50×2 recentCalls per model), but the log files
were not. **Partially addressed** — `modelmatch.log` no longer exists; `free.log`
still has no rotation (medium-value improvement #5).

---

## 4. Recommendations (prioritized)

### High value — completed

1. **Telemetry: switch latency to `performance.now()`** — match startup-timing.
   Keep `Date.now()` only for the stored `timestamp` field. Correctness fix.
2. **Telemetry: stop the per-turn sync write.** Debounce disk writes so a chatty
   session does not perform one `writeFileSync` per `turn_end`. The in-memory
   cache stays fresh (reads return current data); only the disk flush is
   coalesced. `clearTelemetry` flushes immediately.
3. **Route benchmark debug logging through `createLogger`** — drop the parallel
   `appendFileSync`/pipe-format system; emit
   `createLogger("benchmark-lookup").debug(...)` which writes to `~/.pi/free.log`
   via the buffered stream. One log file, one format, no sync per-model writes.

### Medium value — not yet done

1. **Index the benchmark substring/alias strategies.** Build a lookup once
   (tokenize model IDs, or precompute a sorted key list for binary search) so
   `tryDirectSubstringMatch` isn't O(536) per model. Even a simple `Set` of
   lowercased keys + a longest-match trie would cut the startup scan
   dramatically.
2. **Add log rotation / size cap** to `~/.pi/free.log` (e.g. rotate at N MB,
   keep 1 backup). Cheap to add to the stream-open path in `logger.ts`.
3. **Consolidate the two timing APIs** — fold `timeAsync` into `startup-timing`'s
   `measurePhase`/`timeProvider` family, or document why `timeAsync` exists
   separately (currently used in one spot).

### Low value / polish — not yet done

1. **`util.ts:539`** — hoist `createLogger(providerId)` to module level or cache
   by providerId. Trivial.
2. **Quota state is memory-only** — lost on restart. Probably fine (refreshes on
   next response), worth a one-line note in the module doc.

---

## 5. Work completed (unreleased)

### 5.1 Telemetry latency uses a monotonic clock

**File:** `lib/telemetry.ts`

`startModelCall` now stores `performance.now()` (monotonic) as the in-flight
`startTime`; `recordModelCall` computes `latencyMs = performance.now() -
entry.startTime`. `Date.now()` is retained only for the stored entry `timestamp`
and the human-readable call-id correlation tag. `reapStaleInFlight` now compares
against the monotonic clock. The 10-minute `MAX_SANE_LATENCY_MS` guard remains
as a sanity backstop.

This matches the convention already used in `lib/startup-timing.ts` and
`lib/session-start-metrics.ts`: monotonic clock for durations, wall clock for
stored timestamps.

**Test:** `tests/telemetry.test.ts` — the "discards implausibly long latency
samples" test was updated to mock `performance.now` (instead of `Date.now`) to
exercise the discard path under the new clock.

### 5.2 Telemetry disk writes are debounced

**Files:** `lib/json-persistence.ts`, `lib/telemetry.ts`

`createJSONStore` gained an optional third argument `JSONStoreOptions` with
`debounceMs?: number`, plus a `flush(): Promise<void>` method on the
`JSONStore` interface:

- `debounceMs: 0` (default) — synchronous `writeFileSync` on every save
  (unchanged behavior; probe-cache, config, and all existing tests keep this).
- `debounceMs > 0` — `save` updates the in-memory cache immediately (so `load()`
  returns fresh data right away) and schedules a single coalesced `writeFileSync`
  after the burst settles. `flush()` clears the pending timer and writes
  immediately.

Telemetry creates its store with `{ debounceMs: 1500 }`. Effect: a chatty session
no longer blocks the event loop with one sync disk write per `turn_end`; writes
coalesce into one per ~1.5s gap. `/free-telemetry` still shows current data
(reads from the in-memory cache). `clearTelemetry` calls `flush()` after its
update so the explicit `/clear-free-telemetry` action is durable immediately.

The O(~50) `deriveModelTelemetry` recompute per add is retained — it is
microseconds and not worth the sliding-window-subtraction complexity of
incremental maintenance.

**Backward compatibility:** the `JSONStore` interface gains `flush()` (a no-op
for sync stores), and the 3rd argument is optional with a sync default. Existing
`createJSONStore(file, default)` calls and the `json-persistence.test.ts` suite
are unchanged and pass.

### 5.3 Benchmark debug logging routed through the structured logger

**File:** `provider-failover/benchmark-lookup.ts`

- `logDebug` now emits `_logger.debug(entry.action, { …structured data… })`
  through `createLogger("benchmark-lookup")`, which writes to `~/.pi/free.log`
  via the buffered async stream. The `debugEnabled` gate
  (`PI_FREE_BENCHMARK_DEBUG=1`, off by default) is preserved so the verbose
  per-model logging stays opt-in.
- Removed the parallel logging machinery: `LOG_DIR`, `LOG_FILE`, the
  `appendFileSync`/`writeFileSync`/`existsSync`/`mkdirSync` file-writing body,
  and the `node:fs` / `node:os` / `node:path` imports used only by it.
- Removed the dead stats/log-path helpers that parsed the old pipe format:
  `getMatchingStats`, `getMatchLogPath`, `clearMatchLog`, `parseLogLine`,
  `computeMatchRate`, the `LogStats` interface, and the trailing `readFileSync`
  import. These were never called anywhere in the codebase (verified by grep).
- Kept `setDebugLogging` (harmless public API) and `debugEnabled`.

**User-facing impact:** with `PI_FREE_BENCHMARK_DEBUG=1`, diagnostics now appear
in `~/.pi/free.log` under the `benchmark-lookup` namespace instead of a separate
`~/.pi/modelmatch.log`. Docs updated: `agents.md`, `docs/configuration.md`,
`docs/features.md`.

### 5.4 Validation

- `npm run lint` (`tsc --noEmit`) — clean
- `npm run test:run` — 53 files, 622 tests pass
- `npm run check:lockfile` — in sync
- `tests/benchmark-lookup.test.ts`, `tests/telemetry.test.ts`,
  `tests/json-persistence.test.ts` — all pass (40 tests)

---

## 6. Bottom line

Logging was already unified and performance-tuned; the fragmentation was the
benchmark module's parallel sync logger. The real perf risk was **telemetry's
per-turn sync write** and the **unindexed benchmark scan at startup**. This pass
fixed the telemetry sync write (debounced), the telemetry clock correctness
(monotonic), and the benchmark debug logging (routed through the buffered
logger). The unindexed benchmark scan (#4) and log rotation (#5) remain as
medium-value follow-ups.
