# #635 — OpenCode provider-wide dispatcher correction

## Scope and remaining live blocker

This fixes dispatch for every model registered under `opencode-free`, not a
GLM allowlist. Newly discovered models take the same path. Go also reaches its
keyed wrapper, without acquiring Bun. **This is not a claim that the live free
service now accepts Pi requests.** GLM still returns 429 after correct routing;
the observations below remain tracked under #628. Pi's system prompt is not
replaced with native OpenCode's prompt.

## Production premise

The installed extension matched merged master byte-for-byte. Actual Pi1.4 RPC,
isolated HOME/session/auth (public anonymous fixture key), fresh conversation,
`opencode-free/glm-5.3-flash-free`, automatic retry disabled:

```text
Selected api: openai-completions
Assistant outcome: stopReason=error, 429 FreeUsageLimitError
Bun relay invoked: false
```

Both Pi1.1 (dev dependency) and Pi1.4 (actual CLI) gate legacy custom streaming
on `model.api === extension.api`. The provider declared `opencode-dynamic`, but
per-model explicit wire APIs overrode that declaration. Factory-only relay
tests did not exercise this gate.

## State, identity, publication and call-tree diff

| Actor | Data / timing |
| --- | --- |
| Capture and catalog update | Existing `stored.all` retains original wire APIs. No extra mirror/map. |
| Register and every refresh return | Dispatch-facing model copies use `opencode-dynamic` for OpenCode. |
| Per-request stream | `getModelApi` reads the current canonical catalog by model id; preserve authoritative protocols, not just model-family guesses. |
| Toggle / restore | Same provider and model identities; re-registration uses the same publication seam. |
| OpenRouter | No dispatch restamping or wire change. |

```text
setupBuiltInProviderToggles -> cache/capture -> createProviderState
  existing currentModels helper hoisted
  + publish OpenCode dispatch-tagged copies
  -> reRegister + refreshModels (all return paths share currentModels)
  -> createOpenCodeStreamSimple
     + read original wire API through getModelApi
     -> existing protocol stream -> free-only Bun relay
```

The existing `currentModels` helper was moved and reused, not supplemented
with a sibling mapper. The wire catalog/cache has no new fields/schema;
existing cache readers still read original APIs. The dispatch tag already
existed and is supported by Pi's custom API surface.

Sweep: inspected custom `streamSimple` registrations in `lib/`, `providers/`
and `index.ts`; the affected legacy registrations are the two OpenCode tiers
in `built-in-toggle.ts`. Other custom providers use native Provider objects;
the compat API registry is a separate existing fallback. Consolidation verdict:
registration and refresh share `currentModels`; original protocol lookup uses
the existing catalog rather than a second map. The static-header fallback does
not prove the dynamic wrapper ran, so Go tests assert distinct request ids
across consecutive turns.

## Fail-before and tests

New tests load the real extension factory through Pi's real resource loader,
create a real `ModelRuntime`, register/capture/refresh actual catalogs, and
stream through that runtime. Only HTTP/process boundaries are fixtures.

```text
vitest run tests/opencode-dispatch.test.ts
Tests 2 failed (2)
Expected: "public"
Received: "stored-free-fixture"
real Bun upstream: expected [] to deeply equal [{path, token, client}]
```

After the fix, both tests pass. The matrix iterates **all registered models**
under both OpenCode tiers across captured, offline refresh, network refresh and
toggle re-registration. It includes a new id synthesized from `/models`, checks
Grok uses Responses despite not having a gpt-* name, checks Claude Messages,
and observes fresh Go request ids. The real-Bun case observes the local
upstream receiving the anonymous request from the actual runtime dispatch.

`tests/built-in-toggle.test.ts` was adjusted to expect the public dispatch tag
rather than incorrectly treating it as the wire API; actual wire behavior is
now verified independently by the runtime test. Windows relay CI explicitly
includes the dispatcher test and installs Bun, avoiding a silent Bun skip.

```text
Targeted suites: 45 passed (6 files)
Final shipping suite: 1027 passed, 2 opt-in live tests skipped (105 files passed, 1 skipped)
Compiled dispatcher suite: 2 passed
```

Active LSP diagnostics clean; TypeScript compiler, oxlint, knip, formatting and
whitespace checks passed. The skipped suite is the opt-in built-in live catalog
suite, not the dispatcher or real-Bun cases in the local Bun-enabled run.

## Compile-valid built mutation proof

Each case rebuilt first, changed only `dist/`, passed `node --check`, then ran
real-runtime tests with imports aliased to compiled modules. Built output was
restored and rebuilt afterwards. All seven cases exited1 with behavioural red:

| Neutered change | Quoted failure |
| --- | --- |
| Registration publication | Expected `public`; Received `stored-free-fixture`. |
| Offline refresh publication | Expected `public`; Received `stored-free-fixture`; real Bun upstream stayed empty. |
| Network refresh publication | Expected `public`; Received `stored-free-fixture`. |
| Provider-wide stamping (restrict to GLM only) | Another registered model used `stored-free-fixture`; newly discovered Bun upstream stayed empty. |
| Go dispatch | `expected msg_... not to be msg_...` — consecutive requests reused the static id. |
| Catalog API lookup | Expected `/responses`; Received `/inference/v1/chat/completions`. |
| Stream consumes catalog API | Expected `/responses`; Received `/inference/v1/chat/completions`. |

Raw logs/config/driver are retained under `.smoke-artifacts/dispatch-*`.

## Live Pi and upstream differential observations

With the patched compiled extension loaded by the actual installed Pi1.4 CLI:

```text
Selected api: opencode-dynamic
Bun relay invoked: true
GLM live result: 429 FreeUsageLimitError
```

The same Pi production path pointed at a local observation endpoint proves:

```text
model=glm-5.3-flash-free
actual tools=[bash,edit,glob,grep,read,write]
anonymous=true, x-opencode-client=cli
fixture reply=OK
```

Native OpenCode2.1.4, private standalone server and isolated HOME, returned
`OK` from the live GLM model. Its captured request replayed through the same
installed Bun1.4.4 also returned200/OK. All Pi-body differential rows below
use the same captured native headers; the system-field result is not a claim
that changing only that field in the unmodified Pi request is sufficient.
Bounded differential probes observed:

| Request variant, same Bun transport | Result |
| --- | --- |
| Native request | 200/OK |
| Pi body with native headers | 429 |
| Pi body with native tool definitions | 429 |
| Pi body with native token/reasoning options | 429 |
| Pi body with text-only messages flattened to strings | 429 |
| Pi body with only system-message content replaced by native OpenCode's | 200/OK |
| Pi body with a transparent Pi/pi-free adapter prefix | 429 |

These observations refute transport fingerprint as the sole remaining cause.
They do not identify a supported minimal prompt change or justify silently
substituting another harness's identity/instructions. No such substitution,
quota/account rotation, retries, or prompt changes are included in the fix.
The live free-tier acceptance problem remains open under #628.

## Detection retrospective

The user's continued-session GLM report exposed the gap. The earlier tests
proved the stream callback and relay, but not host dispatch into them. A real
runtime wire-effect regression (under a second locally) should have caught it
before #631. `agents.md` defect shape19 records that screen. Fixture transport
success and CI green must never be reported as live free-tier acceptance.
