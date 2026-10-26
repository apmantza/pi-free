# #628 — default minimal free environment frame

## Delivered behavior

Every registered `opencode-free` model receives the request-only system metadata
`<env>Working directory: .</env>` by default. No model-id allowlist or opt-in.
Dot is relative to Pi's tool working directory; no captured absolute path,
identity/persona, date, skills, native tools or OpenCode CLI dependency is added.
Pi retains its entire prompt, sections, tools and history. Keyed Go is unchanged.
Bun remains the existing byte transport; its lifecycle/code is not changed here.

## Live premise and subset reduction

Actual installed Pi1.4 with merged #636 still returned429 for GLM while Bun
was invoked. Native CLI and a cached full native envelope worked, including a
Pi-owned nonce tool round-trip. Before adding a default, we reduced the prompt
through controlled live requests: fixed public auth/tracker, same model,
parameters/tools/Pi instructions, same Bun relay, no retries/account/IP rotation.
Each round kept full-envelope200/OK controls before and after.

| Added native subset | Chars | Actual result |
| --- | ---: | --- |
| None (Pi only) | 0 | 429 |
| Identity clause / sentence / first paragraph | 40 / 64 / 137 | 429 |
| Introductory static behavioral instructions | 1470 | 429 |
| Native model metadata alone | 94 | 429 |
| Native code-mode/tool catalog alone | 4815 | 429 |
| Native environment section | 766 | 200/OK |
| Environment XML block only | 422 | 200/OK |
| XML plus captured working-directory line | 117 | 200/OK |
| Date alone / environment heading alone / worktree guidance alone | 29 / 73 / 238 | 429 |
| `<env>\n  Working directory: .\n</env>` | 35 | 200/OK |
| Same without indentation | 33 | 200/OK |
| `<env>Working directory: .</env>` | 31 | 200/OK |
| Plain `Working directory: .` without XML | 20 | 429 |
| Empty `<env>\n</env>` | 12 | 429 |

31chars is the shortest **tested** clean form, not a mathematical minimum or a
permanent service-policy guarantee. The complete native prompt is unnecessary.
The full native controls and all tested subsets retain Pi's complete system text.
Raw bounded artifacts are under `.smoke-artifacts/opencode-envelope/round*/`,
`subsets.json`, response files and `selected-prefix.txt`; no captured prompt is
shipped in the implementation.

## Architecture, ownership and blast radius

```text
Built-in capture/cache -> registration/refresh/toggle (unchanged)
  -> createOpenCodeStreamSimple({anonymous:true})
Compat API registry -> anonymous free stream (same factory)
  + lazy supported normalizeContext (no startup value import)
  + request-owned array from existing sanitizer/normalizer
  + copy existing leading system; prefix string/text blocks
    retain sections, tool additions/removals, timestamp, later deltas
    no initial system -> metadata-only system message
  -> unchanged Completions / Responses / Anthropic / Google streams
  -> unchanged anonymous Bun relay
Go/keyed compat -> same old stream, no extra normalization/frame
```

Pi owns canonical history; the adapter owns only a request view. Catalog/cache,
credentials, provider/model/session identities and saved-record schemas are
unchanged. Old records need no migration. Reusing a context does not accumulate
frames. Adding a fresh system message before Pi's leading one is deliberately
avoided: it demotes Pi's instructions/tools on in-place Anthropic protocols.

Sweep: fresh LSP references to `createOpenCodeStreamSimple` show the built-in
registration callback, compat constructor/registration, and existing relay/session
integration tests. No other production writer/helper needs a sibling envelope.
Consolidation verdict: keep one insertion in the existing stream factory; no new
helper module, map, mirror, lifecycle state or permanent configuration knob.
The test-only wire-system extractor folds the representations from all four
protocols, so a user merely quoting metadata cannot satisfy a system assertion.

## Fail-before through real dispatch

Extended `tests/opencode-dispatch.test.ts` loads the real resource loader,
registration, ModelRuntime and compat API registry. HTTP/process boundaries
are the only fixtures. On pre-fix production code:

```text
Tests 3 failed | 1 passed (4)
Expected true; Received false — missing default free frame
expected array length2; got1 — no frame in rich system
compat dispatcher: Expected true; Received false
```

The red run also emitted an async logger-directory teardown warning; the test
failures above are explicit missing-frame assertions, not environmental failures.

Coverage added/strengthened:
- every registered free and Go model across capture/offline/network/toggle;
- original Pi instructions/tools, keyed Go absence and new-model discovery;
- rich text blocks, named sections, later system deltas and unmodified input;
- supported SDK Anthropic in-place system/tool overrides and system authority;
- real provider and compat dispatch with missing initial-system input;
- existing real Bun child case, endpoints, auth and fresh Go request IDs.

## Eight compile-valid built mutations

Each case rebuilds, changes only compiled JS, passes `node --check`, runs the
real-dispatch suite aliased to dist, then restores/rebuilds. All eight red:

| Mutation | Quoted observed failure |
| --- | --- |
| Disable envelope block | `expected false to be true` (default free system frame) |
| Apply block to Go | `expected true to be false` (Go exclusion) |
| Prepend new head instead of merging Pi's head | Expected `PI_INITIAL_BLOCK`; system contained only env metadata/cache control |
| Drop original string prompt | Expected `PI_INSTRUCTIONS_MUST_SURVIVE`; received system with only env frame |
| Drop original text blocks | Expected `PI_INITIAL_BLOCK`; received env + later block + section only |
| Drop sections/tool metadata | Expected `"read"` and `PI_SECTION_KEEP`; missing |
| Remove missing-system insertion | compat dispatcher `expected false to be true` |
| Mutate original leading message | input JSON equality failed: original content acquired env prefix |

Raw transcripts: `mutation-*.log`; driver: `mutations.mjs` under the artifact root.

## Actual default Pi path and live model audit

The actual installed Pi1.4 CLI loaded the workspace compiled extension plus a
harmless nonce-only tool extension. It selected **opencode-free**, not a custom
prototype provider. No request adapter or full native snapshot was loaded.
Observed:

```text
Default GLM text: stop, OK
Default GLM tool: stop, starts1, ends1
```

Pi's callback generated an unpredictable128-bit value; it was absent before
execution, present in the subsequent tool message, and returned by GLM. Actual
provider-request hooks observe the31char frame and no OpenCode persona. Real Bun
PID was observed and gone after shutdown. All homes/data/logs/session paths were
pinned under the artifact tree; inference used public anonymous auth and did
not use or alter the maintainer's credential store.

Live free inventory after endpoint refresh:

| Model | Result |
| --- | --- |
| glm-5.3-flash-free | OK + Pi-owned tool round-trip |
| big-pickle | OK |
| beam-free | OK |
| flint-40b-free | OK (initial audit transient503; repeated audit succeeded) |
| mimo-v2.6-flash-free | Successful text `OKOK` |
| nemotron-3.5-super-vl-free | OK |
| nemotron-3.5-lightning-free | OK |
| deepseek-v4.1-flash-free | OK |
| jev-1.13-free | 400 ModelProtocolUnsupported — non-generative model, separate #637 |

An initial audit also saw an entry disappear during endpoint refresh; the audit
was corrected to read current inventory and record selection failures rather
than abort. It did not justify changing production catalog/lifecycle code.

Official OpenCode docs identify Jev as a typed decision/System One model, not a
text generator, using `/inference/systemone/v1/systemone`:
https://opencode.ai/v2/docs/console/models/#jev . Discovery synthesizing it as
chat is tracked in #637, not hidden or claimed solved by this envelope fix.

## Validation and limits

Locally: targeted source14/14, compiled dispatcher4/4, final full shipping suite
1029 passed with two opt-in live tests skipped (105 files passed, one skipped).
TypeScript, oxlint, knip, formatting, whitespace and runtime-import policy checks
pass; active LSP confirms both changed code files clean. A fresh rebuilt actual
Pi GLM text/tool run also passes. Independent CHEAP Luna review and exact-head CI
results are recorded in the PR. Windows Bun lane already runs
the dispatcher suite explicitly; it must pass on this change. Full suite excludes
`.smoke-artifacts/**` and its nested fixture trees. Paid Go inference is not called;
Go behavior is verified at real runtime HTTP boundaries with fixture credentials.
No live Windows/macOS upstream or actual OMP runtime acceptance claim.

Initial full-suite invocation forced TMPDIR inside the repository;14 loader/
closure/hoisting negative fixtures consequently found the real ancestor
node_modules instead of an isolated missing-package tree. The same14 failures
were reproduced on an unmodified built b3d2597 Git archive with the identical
TMPDIR (that archive's node_modules symlink also produced one unrelated healthy-
hoisting failure). Standard OS temporary placement with HOME/data/log directories
still isolated yields the full1029/2-skipped pass above. No production resolver or
test expectation was weakened to accommodate the bad temporary-directory setup.
Both red transcripts are retained under the artifact root.

Detection retrospective: the post-#636 actual Pi429 exposed that dispatch and TLS
transport alone do not establish message compatibility. Controlled subset probes
should precede a captured-prompt workaround; a native persona/tool catalog would
have added conflicting instructions for no benefit. `agents.md` defect shape20
records this screen and the leading-system preservation requirement.
