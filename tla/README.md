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
| `Fallback.tla` | Auto-fallback settled-run orchestration vs the fire-and-forget recovery restore |
| `Session.tla` | Extension load / session_start / reload ordering vs nudge scope completeness |

## Configs and expected outcomes

Holding configs (must verify clean — the shipped behavior):

| Config | What it proves |
|---|---|
| `RefreshB` | Backoff x3 + completion-stamp check + strict logging survive a 3-kill storm |
| `RefreshR-B` | Full fix + epoch guard hold across reloads |
| `RefreshR-C` | Retries-without-guard hold at storm 3 (guard is defense-in-depth here, not load-bearing) |
| `ToggleA` | Display always matches the effective view; full display needs a fetch |
| `ToggleC` | `FlaggedHonesty`: a subset shown as "all" is always flagged by the honest notify |
| `FallbackB` | `BudgetSafe` (auto-continue budget never negative) + `SingleStrike` (every ban count covered by a failure settle or recorded collateral hit) |
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
| `FallbackA` | `ManualWins` (in-flight recovery restore overrides an explicit user model selection — trace: fail A→B, clean on B dispatches restore(A), user re-selects B, restore lands A) |
| `SessionA` | `ScopeComplete` without the emission contract (session_start observing a partial/empty loaded set — documents the Pi-side dependency, not a pi-free bug) |

## Running

- CI: `.github/workflows/tlc.yml` runs `node scripts/check-tlc.mjs` (toolchain bootstrapped automatically; pinned Temurin JRE 21.0.12.1+1 + tla2tools v1.7.4).
- Locally: same command. With an existing toolchain, skip the download:
  `TLC_JAVA=/path/to/java TLC_JAR=/path/to/tla2tools.jar node scripts/check-tlc.mjs`.
- `node scripts/check-tlc.mjs --list` prints the planned checks without needing a toolchain.
