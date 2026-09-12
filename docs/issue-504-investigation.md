# Issue #504: OpenCode refresh warning

## Finding and fix

Reproduced with published **pi-free 2.8.0 + Pi 0.85.1** in an empty,
credential-free HOME. The probe loaded the complete extension through Pi's real
`DefaultResourceLoader`, created and bound a real session, then called
`refreshModelCatalogs`, the coordinator used by the interactive selectors.
Network fetches were live. Both direct OpenCode catalog endpoints returned 200.

The hidden errors were:

```text
opencode-free: Failed to resolve API key for provider "opencode-free" from environment variable: OPENCODE_API_KEY
opencode-go: Failed to resolve API key for provider "opencode-go" from environment variable: OPENCODE_API_KEY
```

`resolveApiKey` installed `$OPENCODE_API_KEY` even when that optional variable
was absent. Pi's provider composer attempted to resolve it before invoking
pi-free's `refreshModels`. Catching catalog-fetch errors inside that callback
could not prevent this warning. Independent detached public-endpoint fetches
still succeeded, explaining the apparently contradictory health report.

Delete `getApiKeyEnvForProvider` and return `undefined` when there is no resolved
key. No new auth layer or anonymous credential is needed. The free alias keeps
its existing shared/stored/environment lookup; Go and OpenRouter retain Pi's
native authentication. Logged-out OpenCode providers remain unavailable in the
picker, rather than failing the refresh operation.

This reproduces and fixes the reported symptom locally; it does not establish
which credentials were present in the reporter's installation. The earlier
assertion that successful direct fetches established a Pi mirror defect was
not justified.

## Identity and call-tree review

Pi remains the only credential-store writer. Provider IDs, capture timing,
shared-key priority, and re-registration semantics are unchanged. No durable
record shape changes.

```text
setupBuiltInProviderToggles / registerToggleCommand
  -> tryCaptureProvider
     -> resolveApiKey
        = existing free-alias shared/own/config key lookup
        - getApiKeyEnvForProvider (required env references)
        + undefined (omit optional override)
  -> createProviderState -> reRegister -> Pi ModelRuntime.registerProvider
     -> composeApiKeyAuth -> ModelsImpl.resolveRefreshCredential
        = native/stored auth resolution; absent auth can return undefined
```

Sweep: `getApiKeyEnvForProvider` had only one caller. Searching runtime
`lib/` and `providers/` for `$[A-Z_]+_API_KEY` found only this helper's three
OpenCode entries. Consolidation verdict: delete the helper and reuse existing
Pi auth, rather than introduce another resolver. No new runtime guard, failure
path, logging, or configuration option was added.

## Regression and mutation proof

`tests/built-in-toggle-runtime.test.ts` exercises the real loader, session,
credential store, provider composer and refresh dispatcher. Only HTTP is
mocked. It covers no credentials, an environment key, a stored Go key, and a
stored free-provider key, including picker availability.

Final test against unmodified `lib/built-in-toggle.ts` (verified equal to HEAD):

```text
FAIL ... (absent)
Received: [
  ["opencode-free", "Failed to resolve API key for provider \"opencode-free\" from environment variable: OPENCODE_API_KEY"],
  ["opencode-go", "Failed to resolve API key for provider \"opencode-go\" from environment variable: OPENCODE_API_KEY"]
]
FAIL ... (stored-free)
Received: [
  ["opencode-go", "Failed to resolve API key for provider \"opencode-go\" from environment variable: OPENCODE_API_KEY"]
]
```

The environment-key and stored-Go cases passed before the fix: preservation
checks, not claimed regressions. With the fix, the runtime tests and existing
built-in-toggle unit tests passed (27 tests).

Compiled mutation: restore the unconditional environment reference at the end
of `dist/lib/built-in-toggle.js`'s `resolveApiKey` (compile-valid), then repeat
the live Pi 0.85.1 coordinator probe:

```text
REFRESH_RESULT {"aborted":false,"errors":[opencode-free missing OPENCODE_API_KEY, opencode-go missing OPENCODE_API_KEY]}
mutation exit: 1
```

After rebuilding from fixed source:

```text
REFRESH_RESULT {"aborted":false,"errors":[]}
REFRESH_RESULT {"aborted":false,"errors":[]}
```

Additional local probes:

- Injected direct-endpoint outages with a synthetic local credential:
  cached catalogs retained, both refresh results had no errors. No chat calls.
- Injected pi.dev 503 responses: the repeat refresh reported genuine mirror
  errors for `opencode` and `opencode-go`, not `opencode-free`. The first
  startup-overlapping attempt was superseded and had no errors; the probe was
  corrected to inspect the repeat. This is a distinct failure, not suppressed
  by the fix.
- Concurrent callers through Pi's real coordinator, cancelling one caller:
  `[{"status":"rejected","error":"AbortError"},{"status":"fulfilled","aborted":false,"errors":[]}]`.
- Pi 0.85.1 was also the npm latest version at verification time; the repository
  runtime tests use its installed Pi 0.84.4 dependency.

## Checks and limitations

Passed: build, TypeScript lint, format check, oxlint, knip, runtime-import check,
and targeted tests. Active LSP found no TypeScript errors in the changed source
or test; auxiliary source hints/warnings were on unchanged lines.

The full suite ran once: **866 passed, 11 failed, 2 skipped**. The 11 failures
were in `install-closure.test.ts` (2), `install-hoisting.test.ts` (1), and
`pi-ai-loader.test.ts` (8). With TMPDIR pinned under the checkout, their supposedly
isolated fixture trees can discover the checkout's ancestor `node_modules`.
The same 11 failures reproduced with the production source restored exactly
to HEAD in the same environment. They are not claimed green; CI must confirm
its normal fixture-isolation environment. The skipped tests were the opt-in
live catalog suite; the separate live coordinator probe above did run.

No maintainer credentials or real HOME were used. Local scripts, isolated
installs and raw transcripts are under `.smoke-artifacts/issue-504/` (ignored).
No issue comments, commits, release, or installation update were performed.

Detection retrospective: a credential-free live coordinator probe caught this;
a real-runtime missing-auth regression test would have caught it earlier in
roughly one second. Direct callback and live endpoint tests skipped the failing
auth/composition layer. The regression and agents.md defect shape now pin that
layer for this recurrence.
