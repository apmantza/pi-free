# Debugging tooling — ideas and analysis

> Scope: tools that would shorten the loop on pi-free's hard-to-reach defects, beyond what
> the repo already carries (script family, in-session commands, TLA+/TLC gate, mutation lane).
> This is a working document of **unshipped** ideas — nothing here is committed work.
> Rules live in [`agents.md`](agents.md); planning lives in [`docs/roadmap.md`](docs/roadmap.md);
> this file is the debugging-tooling companion to both.
>
> Every item states what it buys, what it costs, and whether it was **verified on this tree**
> or only **read about**. Provenance is in [Evidence log](#evidence-log).

## The framing: TLA+ checks the model, not reality

`tla/` proves properties over every interleaving *of the model*. It cannot tell whether
production ever takes those transitions. The repo already defends the model against itself —
"Audit frames on every variable touch" and "every hold gets a firing proof" (`agents.md`,
TLC Model Checking) — but nothing defends against the model drifting from the code.

The concrete instance: `RefreshR-F` documents the operating boundary as
"the fix holds iff per-session storm ≤ 3 (production showed 2)". That is an assumption about
production, not a checked fact. The tools below that matter most are the ones that turn such
assumptions into captured data, and the install-layout gap that has produced #448, #510, #581.

## What already exists (reach for these first)

| Surface | What it gives |
| --- | --- |
| `npm run drive` (`scripts/drive-pi-ai.ts`) | A realistic coding-agent turn through pi-ai's `streamSimple` — wire behavior without a live session |
| `scripts/check-*.mjs` | Install-tree integrity: `check-installed-closure`, `check-hoisting`, `check-prod-install-shape`, `check-extensions`, `check-runtime-imports`, `check-tarball` |
| `scripts/smoke-*.mjs` / `smoke:auto-fallback` | Execute real code paths: compiled entry, Pi's extension loader, pi-ai entries, the shadowed-walk-up layout |
| `scripts/rpc-*.mjs` | Load, restore, session and toggle checks over Pi's RPC surface |
| `bench:startup` + `PI_STARTUP_BENCHMARK=1` | Startup/session-start timings |
| `mutation:diff` (Stryker, diff-scoped) | Mutation score and survivors for changed `lib/` files |
| `/pi-free-health`, `/free-startup`, `/free-telemetry`, `/free-fallback-history`, `/free-providers` | In-session diagnostic surface (names verified against `docs/commands.md`) |
| `~/.pi/free.log` (+ `.1`–`.3`), `PI_FREE_LOG_LEVEL=debug`, `PI_FREE_BENCHMARK_DEBUG=1` | Structured logs, opt-in diagnostics |

The gaps below are what these do **not** cover.

## A. Close the model ↔ reality gap

### A1. Trace validation (model-based testing) — highest value

- **What:** record real session events in a vocabulary that maps 1:1 onto the spec actions, then
  check each recorded trace against `tla/`. The raw material already exists — `lib/action-log.ts`,
  `lib/telemetry.ts`, `lib/fallback-state.ts` and the action-log ring all persist
  `{provider, model, status}`-shaped events that `/free-telemetry` and `/free-fallback-history` read.
- **Buys:** proof that production takes (or cannot take) the modelled transitions; the storm ≤ 3
  boundary becomes measured data; model drift becomes a failing check when the code changes.
- **Cost:** a shared trace-event vocabulary (spec ↔ log), a converter, captured fixture corpora per
  supported version, and a CI run over them. Not small — but it is the only item here that closes
  the gap the TLA+ work deliberately leaves open.
- **Status:** not tried. Precedent: tlaplus issue #367, "Verify implementation-level execution
  traces against their high-level TLA+ specification".

### A2. TLC `-coverage <minutes>` in the gate

- **What:** TLC prints how many times each action fired (and how many distinct states each
  produced) — actions with zero fires are dead.
- **Buys:** generalizes the single manual non-vacuity probe (`FallbackLive` / `CoverRepair`) to all
  five specs, and catches the "audit frame" failure mode (`agents.md`: a shrunken space is a dead
  action until proven otherwise) without hand-built coverage configs.
- **Cost:** a `--coverage` mode in `scripts/check-tlc.mjs` mirroring the existing `--list` contract,
  plus a policy for what a zero-fire action means per spec.
- **Status:** flag semantics confirmed from the TLA+ docs/issue tracker (see Evidence log); **not
  executed here** — the toolchain is not bootstrapped on this machine and would download ~55 MB.

### A3. TLC `-simulate num=…,file=…` and `-dfid`

- **What:** simulation mode generates random traces (optionally longer/unbounded, optionally written
  to a file); `-dfid` explores a single deep trace instead of breadth-first.
- **Buys:** interleavings the bounded configs may not reach; a cheap fuzz lane for a spec that just
  changed.
- **Cost:** Triage. A violation found by simulation has no deterministic config until one is written,
  and only then is it a CI hold — otherwise it is noise. Pair every simulation finding with a twin.
- **Status:** flags confirmed, not executed.

## B. The install/host-layout class (#448, #510, #581)

### B1. `pi-free doctor` — one paste instead of an interview

- **What:** a script that reports what the **loader** actually resolves, by importing the real
  resolver rather than re-implementing it: `resolvePiAiPackageRoot`, `resolvePiAiEntryFile`,
  `isPiAiNotFoundError`, `resolveVendoredPiAiEntryFile` from `dist/lib/pi-ai-loader.js` — the same
  import style `scripts/smoke-pi-ai-entries.mjs` already uses.
- **Report:** each of the seven probes (hit/miss, and why: name/version/exports), the resolved pi-ai
  root with its version, each allow-listed entry's resolved file, whether `dist/vendor` exists
  (Bun-compiled host), and the host layout (node exec path, npm roots).
- **Buys:** the #581 support loop collapses from a multi-message interview to one paste; a `--json`
  mode would also be assertable from the test suite.
- **Cost:** one script, no new resolution logic — reuse is the point.
- **Status:** not built.
- **Related defect shape:** `scripts/check-installed-closure.mjs` carries its **own** `findPackageUp`
  walk-up, so it can disagree with the loader about which copy wins. A doctor that calls the loader
  removes the divergence; folding the closure check onto the same resolver is the consolidation.

### B2. Node's own resolution levers, with a reproduced caveat

- `import.meta.resolve(specifier)` answers "what does Node pick from **here**" — run it from the
  install under test (Evidence log has the command).
- **Caveat, reproduced on this tree:** its **parent argument is ignored** on Node 22.22.1 — passing
  `file:///tmp/elsewhere/entry.mjs` still resolved against the calling script. That is defect shape 7
  in the wild, so a doctor must run *inside* the install rather than pass a parent, and tree-scoped
  resolution stays `createRequire`.
- Also cheap: `NODE_DEBUG=module`, `node --trace-warnings`, `node --throw-deprecation`.

## C. Live-session async behavior

| Idea | Buys | Status |
| --- | --- | --- |
| `async_hooks` / `diagnostics_channel` probe | Proves real ordering (e.g. supersede lands before publish) instead of inferring it from log order — grounds `Refresh`/`RefreshR` | not tried |
| `why-is-node-running` | Names what keeps the process alive; pi-ai's own docs warn the Codex WebSocket pool does exactly this without `cleanupSessionResources` | not tried |
| `--inspect-brk` + DevTools | Step the extension inside a real pi session — today the host has no debugger story | not tried |
| `--cpu-prof` / `--heap-prof` | Cost profiles alongside `bench:startup`; separates import cost from runtime cost | not tried |
| `act` | Reproduce CI-only failures locally; smokes already upload artifacts on failure | not tried |

## D. Spec-side, interactive

- **TLC debugger / `-generate` step mode** — step through a trace interactively instead of reading
  a dumped counterexample.
- **VS Code TLA+ extension** — syntax/parsing, model checking, trace viewing from the editor.
- **Apalache** — symbolic model checking if an instance ever blows up combinatorially; also handles
  unbounded parameters that TLC configs currently pin (`RefreshR-F`'s storm bound).
- **TLA+ MCP server** (third-party) — drove a `tlc_coverage` tool; would need review before it goes
  anywhere near this repo.

## If only two get built

1. **B1 `pi-free doctor`** — smallest diff, reuses the shipped resolver, and retires the support loop
   that has already produced three layout issues. It is also the inverse of
   `smoke-pi-ai-shadowed`: that one builds a hostile layout in CI, this one explains a hostile layout
   in the field.
2. **A2 `-coverage`** — small, and it converts a documented hazard into an automated check across all
   five specs.

## Findings while looking (not ideas — small, actionable)

- **`tla/README.md` misclassifies `FallbackLive`.** The status table lists it under "Holding configs
  (must verify clean)", but the gate runs it as a falsification:
  `falsify FallbackLive (Fallback): must violate CoverRepair`. `agents.md` and
  `scripts/check-tlc.mjs` agree with each other; the README is the outlier. A reader would expect a
  clean verification that intentionally is not one.
- **Duplicate resolution walkers.** See B1.
- **`import.meta.resolve` parent argument ignored.** See B2 and the Evidence log.
- **Stale command name in comments.** `lib/built-in-toggle.ts` refers to `/free-health` in two
  comments; the registered command is `pi-free-health`. Comments only — `docs/commands.md` matches
  the code.
- **Verified consistent:** the five `/free-*` and `/pi-free-health` command names in `docs/commands.md`
  match their `pi.registerCommand` registrations.

## Evidence log

Point-in-time checks run against this tree (2026-09-26). Re-run them rather than trusting the text.

**TLC plan table — 17 checks, 8 hold / 9 falsify** (`node scripts/check-tlc.mjs --list`):

```text
hold    RefreshB (Refresh): must verify clean
hold    RefreshR-B (RefreshR): must verify clean
hold    RefreshR-C (RefreshR): must verify clean
hold    ToggleA (Toggle): must verify clean
hold    ToggleC (Toggle): must verify clean
hold    FallbackB (Fallback): must verify clean
hold    FallbackC (Fallback): must verify clean
hold    SessionB (Session): must verify clean
falsify RefreshA (Refresh): must violate NoFalseClean
falsify RefreshA-starve (Refresh): must violate EventualRefresh
falsify RefreshR-A (RefreshR): must violate NoFalseClean
falsify RefreshR-A-starve (RefreshR): must violate EventualRefresh
falsify RefreshR-F (RefreshR): must violate EventualRefresh
falsify ToggleB (Toggle): must violate NoSubsetAsAll
falsify FallbackA (Fallback): must violate ManualWins
falsify FallbackLive (Fallback): must violate CoverRepair
falsify SessionA (Session): must violate ScopeComplete
```

**TLA material is unchanged since the last green TLC CI run:**
`git log --oneline 19ac555..origin/master -- tla/ scripts/check-tlc.mjs .github/workflows/tlc.yml`
is empty, so run `success` at `19ac555` covers the current specs.

**`import.meta.resolve` does not honour its parent argument here** (Node 22.22.1, run from this
repo root, parent `file:///tmp/elsewhere/entry.mjs`):

```text
resolve(@earendil-works/pi-ai/compat)
  no parent    -> file:///home/akis/Desktop/pi-free/node_modules/@earendil-works/pi-ai/dist/compat.js
  parent arg   -> file:///home/akis/Desktop/pi-free/node_modules/@earendil-works/pi-ai/dist/compat.js
resolve(@earendil-works/pi-ai/providers/all)
  no parent    -> file:///home/akis/Desktop/pi-free/node_modules/@earendil-works/pi-ai/dist/providers/all.js
  parent arg   -> file:///home/akis/Desktop/pi-free/node_modules/@earendil-works/pi-ai/dist/providers/all.js
```

Both forms answer with the caller's tree, so a diagnostic must run *inside* the install under
test; the parent argument cannot redirect it.

**Not executed anywhere above:** TLC coverage/simulation runs (toolchain not bootstrapped; the
bootstrap writes ~55 MB into a cache directory outside the worktree), `async_hooks` probes,
`why-is-node-running`, inspector sessions, `act`.