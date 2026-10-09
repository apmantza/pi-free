# TLA+ models: refresh storm + toggle lifecycle (refs #573)

Formal models of pi-free's session-start catalog refresh and the
free/all toggle lifecycle, checked with TLC. They pin the failure modes
behind issue #573 and prove the shipped fixes.

## Models

| File | Scope |
|---|---|
| `Refresh.tla` | One provider's refresh vs Pi's abort-on-reregister semantics + the re-register storm |
| `RefreshR.tla` | Refresh + session reloads (new runner, same process) vs the nudge epoch guard |
| `Toggle.tla` | Free/all toggle vs restore-subset / in-flight-fetch interplay |
| `Capture.tla` | Built-in capture lifecycle: sync-cache registration vs async capture, dedup, reload drops, view-syncing reapply |
| `FetchJoin.tla` | Shared-catalog fetch join: join-or-start, no consumer cancel, pre-abort issues nothing, detached always resolves |
| `CacheGuard.tla` | Disk-cache poisoning guards: shrink-gate persist, never-empty, retain-on-failure/empty |
| `GlobalFilter.tla` | Global free-only filter vs per-provider overrides: fresh resolve per entry, strict empty, toggle TOCTOU |
| `RestoreOrder.tla` | Deferred saved-model restore: lookup, single refresh join + retry, restore/warn/skip, post-join recheck |
| `Fallback.tla` | Auto-fallback settled-run orchestration vs the fire-and-forget recovery restore |
| `Session.tla` | Extension load / session_start / reload ordering vs nudge scope completeness |

## Configs and expected outcomes

Holding configs (must verify clean — the shipped behavior):

| Config | What it proves |
|---|---|
| `RefreshB` | Backoff x3 + completion-stamp check + strict logging survive a 3-kill storm |
| `RefreshR-B` | Full fix + epoch guard hold across reloads |
| `RefreshR-C` | Retries-without-guard hold at storm 3 (guard is defense-in-depth here, not load-bearing) |
| `ToggleA` | Display always matches the effective view; full display needs a fetch; chat slots exclude non-chat |
| `CaptureA` | Warm-cache steady state: sync registers, capture retired, view preserved, resolve |
| `CaptureD` | Cold first run: sync no-op, deduped capture resolves, no stranded state |
| `CaptureE` | Built-in absent: sync registration stands as fallback |
| `CaptureG` | Cold + built-in absent: miss, toggle retry, honest unregistered |
| `FJA` | Mixed session: detached + nudge share one request; aborts and failures retain |
| `FJF` | Pre-aborted-only session issues no request |
| `CGA` | Seeded steady state: mild shrinks persist, severe/empty/failure retained |
| `CGB` | Cold boot: first non-empty fetch seeds, empties refused |
| `GFA` | Toggle/global/loop interleavings: resolved entries agree, empty-free hides |
| `ROA` | Hit restores, miss+retry, honest give-up, stale skip, post-join recheck |
| `ToggleC` | `FlaggedHonesty`: a subset shown as "all" is always flagged by the honest notify; chat-only holds |
| `FallbackB` | `BudgetSafe` (auto-continue budget never negative) + `SingleStrike` (every ban count covered by a failure settle or recorded collateral hit) |
| `FallbackC` | All of the above + `ManualWins` with the #576 fix (generation ticket + landing repair; stale picks stay) |
| `FallbackLive` | Coverage probe: `CoverRepair` must fire (proves FallbackC's hold is non-vacuous -- caught a dead repair action during development) |
| `SessionB` | `ScopeComplete` under Pi's emission contract (session_start fires after all extensions load): the nudge scope is the full provider set |

Falsifying configs (must produce the named violation — they prove the
specs can catch the bug, and document its exact shape):

| Config | Expected violation |
|---|---|
| `RefreshA` | `NoFalseClean` (clean log, nothing published) |
| `RefreshA-starve` | `EventualRefresh` (`aborts=2, persisted=FALSE` — the production signature) |
| `RefreshR-A` | `NoFalseClean` across reloads |
| `RefreshR-A-starve` | `EventualRefresh` across reloads |
| `RefreshR-F` | `EventualRefresh` at storm 4 — the operating boundary: the fix holds iff per-session storm <= 3 (production showed 2) |
| `ToggleB` | `NoSubsetAsAll` (restored subset displayed as the whole catalog) |
| `ToggleD` | `ChatOnlyStored` (unfiltered fetch stores image/classifier as chat) |
| `CaptureB` | `SingleFlight` (duplicate session_start spawns a second capture) |
| `CaptureC` | `ViewPreserved` (reapply resurrects the creation-time view over a toggled one) |
| `CaptureF` | `SingleFlight` (toggle races a second capture without the pending-await) |
| `FJB` | `AtMostOneLive` (arrivals start their own fetch instead of joining) |
| `FJC` | `SharedSurvivesAbort` (a joiner's abort cancels the shared fetch) |
| `FJD` | `DetachedSettlesClean` (detached task rejects on failure) |
| `FJG` | `QuietWhenPreAborted` (pre-aborted arrival issues a request) |
| `CGC` | `ShrinkBounded` (severe shrink overwrites a healthy entry) |
| `CGD` | `NeverEmptyDisk` (empty response persisted) |
| `CGE` | `NeverEmptyDisk` (failed fetch clobbers the entry) |
| `GFB` | `FlipParity` (two rapid toggles collapse to one net flip) |
| `ROB` | `NoClobber` (post-join restore lands over a mid-join user pick) |
| `FallbackA` | `ManualWins` (in-flight recovery restore overrides an explicit user model selection — trace: fail A→B, clean on B dispatches restore(A), user re-selects B, restore lands A) |
| `SessionA` | `ScopeComplete` without the emission contract (session_start observing a partial/empty loaded set — documents the Pi-side dependency, not a pi-free bug) |

## Running

- CI: `.github/workflows/tlc.yml` runs `node scripts/check-tlc.mjs --coverage` (toolchain bootstrapped automatically; pinned Temurin JRE 21.0.12.1+1 + tla2tools v1.7.4).
- Locally: same command. With an existing toolchain, skip the download:
  `TLC_JAVA=/path/to/java TLC_JAR=/path/to/tla2tools.jar node scripts/check-tlc.mjs`.
- `node scripts/check-tlc.mjs --list` prints the planned checks without needing a toolchain.

## Reading action coverage

`--coverage` adds TLC's per-definition evaluation table to the run (parsed by
`scripts/lib/tlc-coverage.mjs`), which is how a guard that stops firing becomes
visible: a zero is the signature of the `Audit frames on every variable touch`
hazard in `agents.md`. Example from `ToggleA`:

```text
coverage ToggleA: 6 action(s)
  Toggle.Init: 1:1
  Toggle.Restart: 1:1
  Toggle.FetchStart: 8:8
  Toggle.FetchComplete: 2:8
  Toggle.FetchAborted: 0:8  <- never fired
  Toggle.Toggle: 5:16
  invariants/operators (no count): TypeOK, ViewDisplayAgree, FullDisplayNeedsFetch, FlaggedHonesty
```

**It is a diagnostic, not a gate.** The pair is `fired:total` as TLC evaluated
it, which is not the same as "transitions taken" — `ToggleA` reports
`FetchAborted: 0:8` for an action that is enabled in that config, so a zero
means *go read the spec*, not *the spec is broken*. Assertions stay with the
falsifying twins above. Two useful readings it does support:

- `FallbackB`/`FallbackC` show `Fallback.RestoreLand` firing ~6.7k times, so the
  repair action `FallbackLive` / `CoverRepair` guards is genuinely alive.
- Definitions without a count are invariants and operators (`TypeOK`), listed
  separately because they cannot fire.
