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
| #353–#386 | Native provider lifecycle, filtering, and startup import-graph cleanup | All migrated providers use Pi's native lifecycle; compiled import p50 improved ~1.14s → ~0.43s and total p50 ~1.18s → ~0.47s; measured graph 904 → 226 modules |
| #387–#388 | StepFun native provider and paid-by-default behavior | StepFun uses Pi's native model store and OpenAI Chat Completions at `api.stepfun.ai/step_plan/v1` |
| Qoder follow-up | Qoder native provider migration | Native auth/model-store lifecycle preserves OAuth/PAT, COSY signing, static catalog, custom stream, and basic/all filtering |
| #380–#384 | Generic DeepSeek/Cline DSML and custom-tool schema compatibility | Registered extension-tool schemas are preserved; mixed DSML forms are normalized without provider-specific allowlists |
| Follow-up | Session-start and fetch observability | `/free-startup` reports per-provider attempts, failures, handler durations, and detached post-handler work; background work remains non-blocking |

Current focus: all pi-free providers use Pi's native lifecycle; remaining work is optional built-in filtering and compatibility hardening. Compiled `dist/` packaging is shipped and is the Pi/npm entry. The startup numbers above are controlled compiled extension benchmarks; a full Pi-host A/B result has not been claimed.

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

### Phase 0 — Provider migration (completed)

Cline and Qoder now use the native `Provider` surface. Cline retains its custom
XML wire API and adapted OAuth flow; Qoder retains its PAT exchange, COSY
signing, static catalog, and custom stream while using Pi-owned auth and model
stores.

**Completed criteria:** native refresh/store tests, credential reuse coverage,
filtering and toggle coverage, and cross-platform CI for the migration PRs.

### Phase 1 — API-key provider batch (completed)

The former candidates — `zenmux, sambanova, deepinfra, novita, routeway,
crofai, llm7, tokenrouter, anyapi, bai, openmodel, ollama-cloud`, and Qoder — now
use the native lifecycle. The value was architectural uniformity (Pi-owned refresh,
credentials, cancellation, and models-store persistence), not a promise of a
fixed startup speed.

The migration was intentionally batched because its main benefit is
architectural uniformity (one registration form, Pi-managed refresh,
credentials, cancellation, and models-store persistence), not a promise of a
fixed user-visible startup speed. Keyless-provider auth and the `>=0.81.0`
peer surface were covered by the migration tests and CI; the lockfile was kept
unchanged.

### Phase 2 — Qoder (completed)

Qoder's OAuth device flow, PAT exchange, COSY signing, static catalog, and
custom stream now run behind the native `Provider` and `ProviderAuth` surfaces.
Pi owns credential persistence, offline model restoration, refresh scheduling,
and catalog persistence; Qoder's compatibility cache remains only for optional
stream metadata.

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
availability snapshot; Pi-built-in providers retain their specialized
built-in catalog surfaces by design.

### Parking lot (unordered, low urgency)

+ **Free-filter toggle ports** for the 5 retired fetchers (mistral, groq,
  cerebras, xai, huggingface) on top of Pi's built-ins, à la openrouter —
  only if users miss them. Requires a pricing check per native catalog first
  (Route A/B detection depends on it; opencode-go's native catalog has zero
  free models, illustrating the risk).
+ **Free-filter toggle ports** for Pi-built-in Mistral, Groq, Cerebras, xAI, and
  Hugging Face catalogs — only if users request them. pi-free would layer a
  filter/toggle over Pi's catalog without duplicating discovery; pricing
  metadata must be checked first to avoid false free classifications.
+ **Preventive XML-tool-leak handling** — MOOT: the Cline XML bridge was deleted
  entirely when Cline's endpoint became standard OpenAI Chat Completions (#433);
  the reactive XML/DSML recovery it hosted no longer exists.
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

---

## Kiro auth-flow follow-up (post #485) — SHIPPED in #487

**Context.** PR #485 (#485) fixed a 400 `REQUEST_BODY_INVALID` on the Kiro
streaming endpoint by replacing a silent placeholder `profileArn` with a
`getKiroProfileArn()` config knob. The user must now set `kiro_profile_arn`
(or `KIRO_PROFILE_ARN`) in `~/.pi/free.json` for chat to work. This is the
smallest fix that unblocks the user; the larger question of *why the OIDC
token doesn't carry a profileArn* is open and is a separate work item.

**Root cause (verified against a real Kiro credential).** Three independent
limits, none of which can be patched in our auth flow without one of the
following:

1. **The SSO OIDC token response doesn't include `profileArn`.** The
   `accessToken` JWT body carries `clientName: "pi-cli"`, `scopes: [...]`,
   `expiresAt` — no `applicationArn`, no `ownerAccountId`, no `profileArn`.
   The Cognito `https://oidc.{region}.amazonaws.com/token` response is
   `{ accessToken, refreshToken, idToken, tokenType, expiresIn, ... }` —
   `profileArn` is not in the spec.
2. **`ListAvailableProfiles` is out of scope for our OIDC client.** Both
   `management.{region}.kiro.dev` (403 "User is not authorized to access
   this feature") and the legacy `codewhisperer.{region}.amazonaws.com`
   (403 "AWS Builder ID is not supported for this operation") refuse. The
   Kiro account-manager project's region-aware fallback ARN
   (`arn:aws:codewhisperer:{region}:610548660232:profile/VNECVYCYYAWN`)
   also returns 403 against our token ("The bearer token included in the
   request is invalid"). The `pi-cli` OIDC client lacks the
   `codewhisperer:profile:List` scope that the kiro-cli's own public client
   carries.
3. **No public Builder-ID fallback ARN.** Enterprise IdC has the
   region-aware fallback above. Builder ID has none — the Kiro IDE uses an
   unpublished, client-specific ARN that's only valid for tokens obtained
   from the official kiro-cli OAuth flow.

**What the kiro-cli itself does** (reverse-engineered from
`keggin-CHN/kiro-auto-register/src/services/kiro_oauth.py`,
`ZyphrZero/kiro.rs` provider impl, `1070920013wh/kiro-gateway/docs/refresh-token.md`,
`kirodotdev/Kiro` docs, and the Kiro Web Portal's CBOR/Smithy RPC):

1. `InitiateLogin` (PKCE) at
   `https://app.kiro.dev/service/KiroWebPortalService/operation/InitiateLogin`
   → returns a `redirectUrl` (Kiro's own authorize page, not AWS Cognito).
2. User authenticates at `app.kiro.dev/signin/oauth?...` (browser flow).
3. `ExchangeToken` (CBOR, Smithy rpc-v2-cbor) at the same Kiro Web Portal
   endpoint → **returns `{ accessToken, csrfToken, expiresIn, profileArn }`**
   plus `RefreshToken` / `SessionToken` cookies. **This is the only place
   `profileArn` is exposed.**
4. Subsequent refresh at
   `https://prod.{region}.auth.desktop.kiro.dev/refreshToken` (json 1.0,
   `User-Agent: KiroIDE-0.6.18-{machineId}`) → returns a fresh
   `{ accessToken, refreshToken, profileArn, expiresIn, csrfToken }` on
   every refresh. The `profileArn` is stable across refreshes for a given
   credential.

**Proposed follow-up (separate PR, not part of #485).** Replace the current
SSO OIDC device-code flow with the Kiro Web Portal PKCE + `ExchangeToken`
flow. The new `kiro-auth.ts` would:

1. Generate PKCE `code_verifier` / `code_challenge` (S256) and `state`.
2. POST to `InitiateLogin` with `idp: "BuilderId" | "Google" | "Github" |
   "AWSIdC" | "Internal"` → get `redirectUrl` + a list of allowed `idp`s.
3. Surface the `redirectUrl` to the user (via Pi's `auth_url` notify) and
   start a local HTTP listener (or reuse Pi's existing `OAuthLoginCallbacks`
   surface) to capture the redirect back to `app.kiro.dev/signin/oauth?code=...&state=...`.
4. POST to `ExchangeToken` (CBOR) with `{ idp, code, codeVerifier, redirectUri, state }` →
   persist `{ accessToken, refreshToken, csrfToken, profileArn, expiresAt, idp, region }` to
   `auth.json` (kiro entry) + a new `kiro-desktop-cache.json` modeled on
   the kiro-cli's `~/.local/share/kiro-cli/data.sqlite3` `auth_kv` table.
5. On refresh (every ~1h), call
   `prod.{region}.auth.desktop.kiro.dev/refreshToken` (which we already
   half-implement for the `desktop` `authMethod` path) and update the
   cached `profileArn` if it changes (rare, but possible after subscription
   upgrades).

**Why this isn't in #485.** ~200-300 lines of new auth code that depend
on a third-party protocol (the Kiro Web Portal CBOR API), a public OIDC
client ID we don't own (the kiro-cli's, widely shared but not officially
public), and a browser-redirect UX that Pi's `AuthInteraction` already
supports but we haven't used. Risks: Kiro could change the Web Portal
protocol or revoke the public client at any time (the kiro-account-manager
project explicitly warns: "this project and its methods might be outdated
due to Kiro's updated account termination policies"). The current fix
unblocks the user today with 5 lines of config; the rewrite is a
multi-day investment that should ship behind a feature flag and a fallback
to the SSO OIDC path.

**Tracking.** ~~Will be filed as a separate issue once #485 lands, with a
detailed implementation plan, risk register, and rollback strategy
(keep the current `idc` flow as `authMethod: "idc"` opt-in for users who
already have a working `kiro_profile_arn` set).~~

**Status: shipped in #487** (Phases A through F of `docs/kiro-web-portal-auth.md`):

- **Phase A (#486)** — design document. The kiro Web Portal auth flow
  was reverse-engineered from `keggin-CHN/kiro-auto-register`,
  `ZyphrZero/kiro.rs`, `1070920013wh/kiro-gateway`,
  `kirodotdev/Kiro` docs, and live probes against `app.kiro.dev`. The
  protocol is Smithy `rpc-v2-cbor` with the 4 operations we need
  (`InitiateLogin`, `ExchangeToken`, `GetUserInfo`, and the
  `prod.{region}.auth.desktop.kiro.dev/refreshToken` JSON endpoint).
- **Phase B** — typed CBOR encode/decode wrapper in
  `providers/kiro/kiro-web-portal-cbor.ts` plus the `cbor-x@^1.6.6`
  dep. 16 unit tests.
- **Phase C** — PKCE helper (`kiro-pkce.ts`, RFC 7636, 10 unit tests
  including the Appendix B known-answer vector) + HTTP client
  (`kiro-web-portal.ts`, 15 unit tests with credential redaction
  enforcement).
- **Phase D** — the driver in `providers/kiro/kiro-desktop-auth.ts`
  (16 unit tests). Uses a manual-paste fallback for the browser
  redirect because the AWS SSO authorize URL hardcodes the
  `callback_url` to Cognito (not localhost), so a local listener
  can't catch the redirect. `refreshKiroCredential` in
  `kiro-auth.ts` got a new `web-portal` branch that delegates to
  `refreshKiroDesktopCredential`.
- **Phase E** — `kiro_auth_method` config knob
  (`"idc" | "web-portal" | "kiro-cli"`) with migration-safe defaults
  (users with a working `kiro_profile_arn` keep `"idc"`), plus the
  `readPersistedKiroProfileArn()` helper in
  `providers/kiro/kiro-credential.ts` that reads the persisted ARN
  from `~/.pi/agent/auth.json`. 15 new tests.
- **Phase F** — live API test driver at
  `scripts/test-kiro-desktop.mjs`. End-to-end protocol verified
  against the real Kiro Web Portal (HTTP 200, real `applicationArn`,
  real `redirectUrl` with all the right params).

The Kiro Web Portal auth flow is now the default for fresh installs.
Users who already had a working `kiro_profile_arn` keep the `"idc"`
flow unless they explicitly set `kiro_auth_method: "web-portal"`.
