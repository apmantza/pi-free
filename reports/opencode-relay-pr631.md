# PR #631 relay correction evidence

## Scope and state design

CodeRabbit's three findings were reproduced through `getOpenCodeRelay()` and a
real Bun 1.4.4 child. The active-stream regressions drive
`createOpenCodeStreamSimple` with real pi-ai and a local HTTP/SSE upstream.
No live inference or credentials are used. Test HOME/data/cache paths are
under `.smoke-artifacts/relay-home`.

| State / actor | Identity and ownership rule |
| --- | --- |
| Singleton factory | One generation per process until retirement. |
| Spawn failure | Stop and cache that unavailable generation; later readiness rejects immediately. |
| Anonymous stream | Acquire before readiness; release in the stream's single outer `finally`, including error/abort. |
| Overlapping streams | Parent owns the activity count; no idle timer while any lease exists. |
| Last release | Start the five-minute idle clock. |
| Idle callback | Stop its generation and clear singleton only if still that instance. |
| Stopped child | No published port or timer resurrection. |
| Parent lifetime | Anonymous stdin pipe closes on parent death; child EOF stops its server and exits. Parent unrefs child/output pipes, but active readiness deadlines remain referenced. |
| Concurrent startup callers | Separate waiters/timeouts share one child's readiness; no superseding another turn. |
| Response forwarding | Preserve encoded wire bytes with `decompress:false`; downstream owns decompression. |

The concurrency change is contained scope growth: a real child-start probe
showed the prior single waiter rejecting an overlapping caller as `superseded`.
The stale setup-node pin in the Windows job was also aligned with merged #626.
No durable record shapes change.

The proposed response-header workaround was intentionally simplified: Bun can
retain compressed bytes, so the relay returns its `Response` directly. This
removes the unreachable header-copy block and avoids inventing a second owner
of response decoding/metadata. The gzip test proves both decoded text and raw
wire bytes independently.

## Call-tree diff and sweep

```text
createOpenCodeStreamSimple
  -> maybeRelayBaseUrl
     + Relay.acquire (before readiness)
     -> Relay.ready
        - single superseding waiter
        + independent waiter set
  -> existing four protocol loaders -> pipeStream
  + outer finally releases the generation
Relay.fail -> + stop (negative cache)
Relay.armIdleTimer -> + activity/stopped gate; idle generation retirement
Relay.stop -> + clear published port
OPENCODE_RELAY_SCRIPT -> fetch
  + decompress:false
  - unreachable header reconstruction
```

LSP references found one production relay caller (`maybeRelayBaseUrl`). AST
search found three timer-arm callers (PORT, touch, release), and one shared
release-finally for all protocols. A tree-wide AST sweep of `lib/` and
`providers/` for `instanceof Response` found no sibling early-return pattern;
the embedded child script was inspected directly. Consolidation verdict: keep
all activity/timer ownership in `Relay`, and all protocol cleanup in the one
stream `finally`; no new cross-provider helper or state store.

## Fail-before proof

With production source temporarily restored to the pre-fix PR version while
keeping the new tests, then restoring the fix:

```text
vitest run tests/opencode-relay.test.ts
Tests  6 failed | 8 passed (14)
missing Bun: Expected "not running"; Received "opencode-relay did not become ready within 20ms"
idle expiry: expected Relay not to be Relay
compressed SSE: TypeError: terminated / incorrect header check (Z_DATA_ERROR)
overlapping finish/abort/error: opencode-relay is not running
```

The contained concurrent-start probe separately failed before its fix:

```text
parses PORT from the child, resolves ready(), and stops the child
Error: superseded
```

The final relay suite passed against source and compiled output (17/17).
Source targeted relay/session/compat tests also passed before the shutdown
extension. The final full shipping-source suite (excluding throwaway review
fixtures under `.smoke-artifacts/**`) reported:

```text
RUN v5.0.5
Test Files  104 passed | 1 skipped (105)
Tests       1025 passed | 2 skipped (1027)
```

An earlier unfiltered full run included two throwaway fixture suites and
reported 1034 passes; that is not the final shipping-suite count.

The skipped suite is `built-in-toggle.live.test.ts` (live endpoint checks are
opt-in), not the real-Bun relay cases. `tsc --noEmit`, oxlint, knip,
`oxfmt --check .`, and `git diff --check` passed. Active LSP checks initially
confirmed all three changed TypeScript files clean; the final repeated probe
confirmed two and marked one push-only recheck inconclusive, so the successful
TypeScript compiler run is the final type-check proof.

## Parent shutdown: second review round

The independent reviewer proved an orphan Bun child after explicit parent exit.
This existed in the original PR, not master, so it was fixed before shipping.
A JS exit hook was insufficient: an additional self-SIGKILL probe still left
the child responding. The final design uses the platform's pipe lifetime:
parent-owned anonymous stdin stays open while the parent lives; EOF in the Bun
child closes its server and exits. No PID polling, heartbeat, or process
registry was added. The unused JS exit-hook design was removed.

Real spawned-parent tests exercise the actual production Bun script, adding
only a fixture pid/port observation before readiness. Parent HOME/data/cache
are fixture-owned, and failing probes kill their observed child in `finally`.
These require a real process: in-process doubles cannot observe parent drain
or orphan descendants.

Quoted pre-fix failures:

```text
natural parent exit: spawnSync /usr/bin/node ETIMEDOUT
explicit parent exit: promise resolved Response { status: 404 } instead of rejecting
killed parent exit: promise resolved Response { status: 404 } instead of rejecting
```

All three now pass. Child/output-pipe refs no longer hold the parent open;
readiness deadlines remain referenced so an awaiting standalone parent does
not exit before Bun binds. An unnecessary writable-stdin `unref` call was
removed after its mutation survived; it is not retained as unproven machinery.

Resource scope: one singleton child per Pi process, no per-turn child spawn,
waiters removed on settle/timeout, activity leases released on
finish/abort/error, idle retirement after the last release, and parent-death
EOF teardown. There is no hard RSS cap or explicit concurrent-request cap;
request bodies are buffered and memory scales with active calls. No heap
retention trend or arbitrary-load memory-bound proof is claimed.

## Compile-valid built-output mutation proof

All 16 retained mutations rebuilt first, modified only `dist/`, passed `node --check`, and
ran the relay suite with a temporary Vitest config aliasing the production
imports to `dist/lib/opencode-relay.js` and
`dist/providers/opencode-session.js`. Each exited 1 with a behavioural assertion
failure; the built files were restored and rebuilt afterwards.

| Mutation | Quoted red (test names shortened) |
| --- | --- |
| Remove stop after spawn failure | `fails consecutive readiness calls`: Expected `not running`; Received `did not become ready within 20ms`. |
| Remove idle singleton retirement | `restarts a real relay after idle expiry`: `expected Relay ... not to be Relay`. |
| Disable active-count idle gate | overlapping finish/abort/error: `promise rejected "Error: opencode-relay is not running" instead of resolving`. |
| Disable stopped-state idle gate | child exit during acquisition: `expected 1 to be +0` at `expect(vi.getTimerCount()).toBe(0)`. |
| Remove stream finally release | overlapping finish/abort/error after completion: `expected Relay ... not to be Relay`. |
| Do not decrement activity count | overlapping finish/abort/error after completion: `expected Relay ... not to be Relay`. |
| Do not clear idle timer on acquisition | overlapping finish/abort/error: `promise rejected "Error: opencode-relay is not running" instead of resolving`. |
| Re-enable Bun decompression | gzip test: `promise rejected "TypeError: terminated" instead of resolving`; `incorrect header check`, `Z_DATA_ERROR`. |
| Supersede an existing readiness waiter | concurrent PORT lifecycle test: `Error: superseded`. |
| Keep stopped port published | PORT lifecycle test: `AssertionError: expected 19853 to be undefined`. |
| Keep child referenced | natural parent exit: `spawnSync /usr/bin/node ETIMEDOUT`. |
| Keep stdout pipe referenced | natural parent exit: `spawnSync /usr/bin/node ETIMEDOUT`. |
| Keep stderr pipe referenced | natural parent exit: `spawnSync /usr/bin/node ETIMEDOUT`. |
| Replace stdin pipe with ignore | real relay passthrough: `TypeError: fetch failed`, `ECONNREFUSED` after premature EOF teardown. |
| Ignore child stdin EOF | natural/explicit/killed parent: `promise resolved Response { status: 404 } instead of rejecting`. |
| Unref readiness deadline | all standalone parent cases: `ENOENT ... child.json` (parent drains before child readiness). |

Raw command logs and the repeatable mutation driver are retained locally under
`.smoke-artifacts/631-*`.

## Independent review

DeepSeek Free independently confirmed the original correction with 14/14 real
Bun tests and four extra production-path probes, reproduced fail-before, and
identified the parent-exit orphan that prompted the second round.

The maintainer-requested CHEAP Luna 5.6/Codex review found no blocking code
findings in the final pipe-lifetime design and independently observed stdin
EOF on parent drain in a non-network probe. Its real-network suite was blocked
by sandbox `listen EPERM`; later follow-up admissions also lost their synthetic
temp mount, so those follow-up executions/report writes did not run. No
independent 17/17 claim is made for that reviewer. The coordinator's actual
17/17 source/compiled runs and 16 killed built mutations are recorded above;
Windows exact-head CI remains the cross-platform proof.

## Detection retrospective and limits

CodeRabbit static review caught the original lifecycle/encoding defects; real
probes confirmed them. The earlier smoke's plain-body/happy-path tests should
have caught them through a state-space matrix and a gzip fixture (under one
second for the targeted local suite). Recurrence guidance now lives in
`agents.md`, defect shape 18.

Windows CI must rerun on the pushed fix head. A local fixture proves Windows
process/stream compatibility, not live acceptance of Windows Bun's TLS
fingerprint; no live-Windows-inference success is claimed.
