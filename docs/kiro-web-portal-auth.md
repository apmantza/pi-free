# Kiro Web Portal auth flow

> Design document for replacing the current Kiro SSO OIDC device-code flow
> with the Kiro Web Portal PKCE + `ExchangeToken` flow. This is the
> follow-up to PR #485 — the immediate fix is shipped; this document
> describes the long-term plan.
>
> **Status: proposed, Phase A (plan + spec) of six.**
> Phase tracker at the bottom of this document.

## Context

PR #485 fixed a 400 `REQUEST_BODY_INVALID` on the Kiro streaming endpoint
by replacing a silent placeholder `profileArn` with a manual config knob
(`kiro_profile_arn` / `KIRO_PROFILE_ARN`). The user must set it for chat
to work. End-to-end diagnosis (recorded in `docs/roadmap.md`) established
that the underlying limitation is that the pi-free `pi-cli` OIDC client
**lacks the `codewhisperer:profile:List` scope** needed to discover the
real `profileArn`, and the AWS SSO OIDC token response itself does not
include one.

The kiro-cli's own auth flow is different. It talks to a Kiro Web Portal
(`app.kiro.dev`) that exposes a Smithy `KiroWebPortalService` over the
`rpc-v2-cbor` protocol. That service runs a PKCE-based auth code flow
(separate from AWS Cognito's device-code flow) whose `ExchangeToken`
response **includes `profileArn`**. Subsequent refreshes against
`prod.{region}.auth.desktop.kiro.dev/refreshToken` return a fresh
`profileArn` on every call.

This document specifies the protocol, the proposed file layout, the
public-OIDC-client decision, the feature-flag design, and the fallback
path so the rewrite can be reviewed and merged in clear phases.

## Goals and non-goals

### Goals

- A user who runs `/login kiro` (with the new flow enabled) gets a working
  Kiro chat with no manual `kiro_profile_arn` setting.
- The persisted credential includes `profileArn` so the streaming path
  reads it automatically.
- The new flow coexists with the current SSO OIDC flow behind a
  `kiro_auth_method` config knob (no breaking change for users who
  already have a working `kiro_profile_arn` set).
- Refresh continues to surface the latest `profileArn` (rare, but
  possible after subscription upgrades).

### Non-goals

- Replacing the kiro-cli's `desktop` refresh path with a different
  endpoint. The Kiro Desktop refresh endpoint already returns `profileArn`
  in its response and we already use it for the `authMethod: "desktop"`
  path; we just need to extract the new field.
- Adding a web-IDE-style embedded auth UI inside Pi. The user opens
  `app.kiro.dev/signin/oauth?...` in their browser, the same way the
  kiro-cli does.
- Supporting the `Internal` IdP. The other four (`BuilderId`, `Google`,
  `Github`, `AWSIdC`) are sufficient for the user's reported need.
- A general CBOR helper for other providers. The Kiro Web Portal is the
  only known consumer; we keep the encoder/decoder local to the kiro
  module.

## Protocol spec

Reverse-engineered from `keggin-CHN/kiro-auto-register/src/services/kiro_oauth.py`,
`ZyphrZero/kiro.rs` provider impl, `1070920013wh/kiro-gateway/docs/refresh-token.md`,
`kirodotdev/Kiro` public docs, and live probes against
`https://app.kiro.dev/service/KiroWebPortalService/operation/{op}`.

### InitiateLogin (PKCE step 1)

```
POST https://app.kiro.dev/service/KiroWebPortalService/operation/InitiateLogin
Content-Type: application/cbor
Accept: application/cbor
smithy-protocol: rpc-v2-cbor

{
  "idp": "BuilderId" | "Google" | "Github" | "AWSIdC" | "Internal",
  "redirectUri": "https://app.kiro.dev/signin/oauth",
  "codeChallenge": "<base64url(SHA256(code_verifier))>",
  "codeChallengeMethod": "S256",
  "state": "<random-uuid>"
}
```

Response (CBOR, decoded):

```json
{
  "redirectUrl": "https://app.kiro.dev/signin/oauth?code_challenge=...&code_challenge_method=S256&state=...&idp=BuilderId&redirect_uri=..."
}
```

The user opens `redirectUrl` in their browser, authenticates with the
chosen IdP, and is redirected back to `app.kiro.dev/signin/oauth` with
the query parameters `code` and `state` populated.

### ExchangeToken (PKCE step 2)

```
POST https://app.kiro.dev/service/KiroWebPortalService/operation/ExchangeToken
Content-Type: application/cbor
Accept: application/cbor
smithy-protocol: rpc-v2-cbor

{
  "idp": "BuilderId",
  "code": "<authorization-code-from-redirect>",
  "codeVerifier": "<original-code-verifier>",
  "redirectUri": "https://app.kiro.dev/signin/oauth",
  "state": "<state-from-redirect>"
}
```

Response (CBOR, decoded):

```json
{
  "accessToken": "aoa...",
  "csrfToken": "abc123",
  "expiresIn": 604800
}
```

Plus `Set-Cookie` headers (the `RefreshToken`, `SessionToken`, `Idp`, and
`AccessToken` cookies). **The `profileArn` field in the response body is
the key piece of data we need.** (Note: the Python reference uses
`profile_arn` snake_case in its parsed return dict, but the actual CBOR
response uses `profileArn` camelCase, matching every other field in the
Smithy-generated contract.)

### GetUserInfo (post-exchange, optional)

```
POST https://app.kiro.dev/service/KiroWebPortalService/operation/GetUserInfo
Content-Type: application/cbor
Accept: application/cbor
smithy-protocol: rpc-v2-cbor
Authorization: Bearer <accessToken>
Cookie: Idp=<idp>; AccessToken=<accessToken>

{ "origin": "KIRO_IDE" }
```

Returns the user's email, userId, subscription tier, and quota usage.
We use it to populate the `/free-providers` display and `/login kiro`
status.

### Refresh (every ~1h)

```
POST https://prod.{region}.auth.desktop.kiro.dev/refreshToken
Content-Type: application/json
User-Agent: KiroIDE-0.6.18-{machineId}

{ "refreshToken": "<refreshToken-from-cookie-or-store>" }
```

Response (json 1.0):

```json
{
  "accessToken": "aoa...",
  "refreshToken": "aoa...",
  "profileArn": "arn:aws:codewhisperer:us-east-1:123456789:profile/XXXXX",
  "expiresIn": 3600,
  "csrfToken": "abc123"
}
```

The `profileArn` is stable across refreshes for a given credential. We
re-persist it on every refresh so subscription upgrades are picked up
without re-auth.

## Public OIDC client decision

**Recommendation: piggyback on the kiro-cli's widely-shared public client.**

Three options were considered:

| Option | Pros | Cons |
| --- | --- | --- |
| **A. Kiro-cli's public client** (the one every other Kiro proxy uses) | Zero setup, works today, matches `kiro-rs` / `kiro-gateway` / `kiro-openai-gateway` | Not officially ours; Kiro could revoke at any time (the kiro-account-manager project explicitly warns about this) |
| **B. Register our own OIDC client with AWS Cognito** | Officially ours, stable clientId | AWS paperwork, weeks of lead time, ongoing maintenance, requires a public clientSecret in our source |
| **C. Read from kiro-cli's local SQLite if installed** | No new client, no shared secret | Doesn't help users without kiro-cli; cross-process boundary fragility |

**Choice: A**, with a defensive fallback. If the public clientId/clientSecret
stop working (4xx from `InitiateLogin`), we surface a clear error
suggesting the user set `kiro_auth_method: "idc"` (the existing flow with
manual `kiro_profile_arn`) or `kiro_auth_method: "kiro-cli"` (the
SQLite-read fallback from option C) — see the feature-flag design below.

The public clientId/clientSecret is hardcoded in the source as a
constants block. If it ever rotates, the fix is a one-line constant
change plus a release note. We do not promise compatibility with future
Kiro protocol changes.

## File layout

```
providers/kiro/
├── kiro-auth.ts                  # existing — kept; only the refresh path gains profileArn extraction
├── kiro-desktop-auth.ts          # NEW — Web Portal + Kiro Desktop refresh
├── kiro-web-portal-cbor.ts       # NEW — minimal CBOR encode/decode for our payload types
├── kiro-pkce.ts                  # NEW — PKCE code_verifier / code_challenge / state
├── kiro-web-portal.ts            # NEW — InitiateLogin / ExchangeToken / GetUserInfo client
├── kiro-stream.ts                # existing — read credential.profileArn before getKiroProfileArn()
├── kiro-provider.ts              # existing — unchanged
├── kiro-models.ts                # existing — unchanged
├── ...                           # other existing files unchanged
```

`kiro-web-portal-cbor.ts` is a ~60-line wrapper around the
`cbor-x` dependency (added in Phase B). It exposes `encodeInitiateLogin(payload)`
and `decodeExchangeToken(buffer)` so the rest of the module never touches
CBOR directly. The wrapper also handles the `Output` / `Version` envelope
that Coral wraps successful Smithy responses in.

`kiro-pkce.ts` is a ~30-line PKCE helper. `generatePkce()` returns
`{ codeVerifier, codeChallenge, state }`; the caller persists `state` for
verification after the redirect.

`kiro-web-portal.ts` is the HTTP client. It takes an `AuthInteraction`
and drives the full login flow. It does **not** know about the local
HTTP listener — that's `kiro-auth.ts`'s responsibility, because the
listener is a generic OAuthLoginCallbacks concern shared with Kilo and
Cline.

`kiro-desktop-auth.ts` is the new top-level entry point. It exposes
`loginKiroDesktop(interaction)` and `refreshKiroDesktopCredential(credential)`.
Both go through `kiro-web-portal.ts` (for login) and the existing
`prod.{region}.auth.desktop.kiro.dev/refreshToken` endpoint (for refresh).

## Feature flag design

A new config field in `PiFreeConfig`:

```typescript
// (real TypeScript syntax below; reproduced verbatim in config.ts)
interface PiFreeConfig {
  // ... existing fields
  kiro_auth_method?: "idc" | "web-portal" | "kiro-cli";
}
```

Default: `"web-portal"` for new users. Existing users who have a
working `kiro_profile_arn` keep their `"idc"` flow until they explicitly
switch (we detect "has working kiro_profile_arn + has Kiro creds" at
startup and seed the default to `"idc"` for that case — see the
migration note below).

`"web-portal"`: the new flow. Replaces the current `loginKiro` body
with a PKCE + Web Portal exchange.

`"idc"`: the current flow. Unchanged. Requires the user to set
`kiro_profile_arn` for chat to work (per PR #485).

`"kiro-cli"`: the SQLite-read fallback. Reads `~/.local/share/kiro-cli/data.sqlite3`
(Linux) / `%APPDATA%/kiro-cli/data.sqlite3` (Windows) and copies the
profileArn from the kiro-cli's own credential store. Implemented as a
Phase G addition (out of scope for the first three phases).

`getKiroAuthMethod()` follows the same env > file resolution as the
other config getters: `KIRO_AUTH_METHOD` env > `kiro_auth_method` in
`~/.pi/free.json` > built-in default.

## Migration note for existing users

A user who installed pi-free before PR #485, ran `/login kiro`, and now
has a working `kiro_profile_arn` set in `~/.pi/free.json` will continue
to work with the default behavior **only if** we seed the
`kiro_auth_method` default to `"idc"` when `kiro_profile_arn` is set.

The seeding logic in `config.ts`:

```typescript
// (real TypeScript syntax below; reproduced verbatim in config.ts)
function defaultKiroAuthMethod(): "idc" | "web-portal" {
  const file = loadConfigFile();
  // If the user has a manual kiro_profile_arn, keep them on the working flow.
  if (file.kiro_profile_arn && file.kiro_profile_arn.length > 0) return "idc";
  return "web-portal";
}
```

This is the same "migrate gradually, never break a working setup"
pattern used by every other config default in the file.

## Persisted credential shape

The `kiro` entry in `~/.pi/agent/auth.json` gains a new shape. Old
shape (kept for `"idc"` mode, unchanged):

```jsonc
{
  "type": "oauth",
  "refresh": "...",
  "access": "...",
  "expires": 1787906008267,
  "clientId": "pHpUwOql-...",
  "clientSecret": "eyJ...",
  "region": "us-east-1",
  "authMethod": "idc"
}
```

New shape (for `"web-portal"` mode, adds `profileArn` + `csrfToken`):

```jsonc
{
  "type": "oauth",
  "refresh": "...",
  "access": "...",
  "expires": 1787906008267,
  "region": "us-east-1",
  "authMethod": "web-portal",
  "idp": "BuilderId",
  "clientId": "pHpUwOql-...",
  "clientSecret": "eyJ...",
  "profileArn": "arn:aws:codewhisperer:us-east-1:123456789:profile/XXXXX",
  "csrfToken": "abc123",
  "machineId": "<sha256-derived>"
}
```

`machineId` is a stable SHA-256 of the host's MAC address, used in the
`User-Agent: KiroIDE-0.6.18-{machineId}` refresh header. The kiro-cli
derives it the same way; reusing the same algorithm keeps the refresh
request indistinguishable from a kiro-cli refresh, which avoids
flagging the session as anomalous.

`kiro-stream.ts` gains a new first-line check in the profileArn
resolution:

```typescript
// (real TypeScript syntax below; reproduced verbatim in kiro-stream.ts)
const profileArn =
  modelMetadata.kiroProfileArn ||                    // per-model override
  (credential as KiroCredentials | undefined)?.profileArn ||  // ← new
  getKiroProfileArn();                               // user config knob (kept)
```

The credential is passed through `options.apiKey` by Pi's native auth
surface, so the stream function already has access to it. We just need
to plumb it through (the existing `modelMetadata` shape needs a
`credential` field added, or we pass `options.credential` directly).

## Browser-redirect UX

Three options were considered for capturing the redirect:

1. **Pi's `OAuthLoginCallbacks` surface** (used by Kilo and Cline) — Pi
   provides a local HTTP listener. The user is told to open a URL in
   their browser and the redirect is captured automatically.
2. **Manual copy-paste** — the user pastes the redirect URL back into
   Pi. Lower friction than option 1 for some users; higher friction
   for others.
3. **Embedded webview** — not available in Pi's extension surface.

**Choice: option 1**, with a fallback to option 2 if the local listener
fails to bind (port already in use, firewall, etc.). This matches what
Kilo and Cline already do; the user's existing mental model applies.

## Refresh path

`refreshKiroCredential(credential)` in the existing `kiro-auth.ts`
gains a new branch for `authMethod: "web-portal"`. It hits the same
`prod.{region}.auth.desktop.kiro.dev/refreshToken` endpoint that the
existing `desktop` branch uses, but the response now also carries
`profileArn` — we just need to persist it. No new endpoint.

The existing `desktop` branch is updated to extract `profileArn` from
the response (currently it ignores the field) so any existing user
with `authMethod: "desktop"` gets the new field too, for free.

## Errors and observability

New logger namespace: `kiro-web-portal`. Errors logged:

- `InitiateLogin` 4xx → fatal, surface to user via `ctx.ui.notify` with
  the raw 4xx body (truncated to 500 chars; never log access tokens or
  the `code_verifier`)
- `ExchangeToken` 4xx → fatal, same surface
- Browser-redirect timeout (5 min) → fatal with a hint to use the
  manual paste fallback
- Refresh failure → retry once, then surface with the existing
  `KiroManagementHttpError` shape

No credential material is ever logged (covered by convention #17 in
`agents.md` — wire-signature logs are header names only, no values).
The `profileArn` is logged at debug level on the first successful
exchange; subsequent refreshes log "profileArn unchanged" or
"profileArn updated: <old-arn-suffix> → <new-arn-suffix>" (truncated to
the last 20 chars of each to avoid PII).

## Test plan

| Test | File | What it covers |
| --- | --- | --- |
| `kiro-pkce.test.ts` | `tests/kiro-pkce.test.ts` | PKCE code_verifier is 43-128 chars base64url, code_challenge is SHA256(verifier) base64url, state is uuid v4 |
| `kiro-web-portal-cbor.test.ts` | `tests/kiro-web-portal-cbor.test.ts` | Round-trip encode/decode of an InitiateLogin and an ExchangeToken-shaped payload, including the `Output` envelope |
| `kiro-web-portal.test.ts` | `tests/kiro-web-portal.test.ts` | Mocked `fetch` for InitiateLogin (200 CBOR), ExchangeToken (200 CBOR with `profileArn`), 4xx errors propagate, no credential material in error logs |
| `kiro-desktop-auth.test.ts` | `tests/kiro-desktop-auth.test.ts` | Refresh extracts `profileArn` and `csrfToken` from the response, persists to credential shape |
| `kiro-stream.test.ts` (new) | `tests/kiro-stream.test.ts` | `profileArn` resolution order: `modelMetadata` > `credential` > `getKiroProfileArn()`; clear error when all three are unset |
| `config.test.ts` (extend) | `tests/config.test.ts` | `getKiroAuthMethod()` env > file > default; default is `"idc"` when `kiro_profile_arn` is set, else `"web-portal"` |
| Live API test (manual) | `scripts/test-kiro-desktop.mjs` | Run the real PKCE + ExchangeToken flow against the real Kiro Web Portal; verify `profileArn` ends up in the persisted credential; verify chat works |

The live API test is not run in CI (it requires user interaction and a
real browser). It lives in `scripts/` next to the other dev-only
helpers and is run by hand before each release that touches the kiro
auth flow.

## Phase tracker

| Phase | What | Status | PR |
| --- | --- | --- | --- |
| A | This design document | shipped | #486 |
| B | `kiro-web-portal-cbor.ts` + `cbor-x` dep + unit tests | **in progress** (this PR) | TBD |
| C | `kiro-pkce.ts` + `kiro-web-portal.ts` + unit tests | not started | — |
| D | `kiro-desktop-auth.ts` + browser redirect UX + refresh | not started | — |
| E | `kiro_auth_method` config + `kiro-stream.ts` credential read + `getKiroAuthMethod()` + tests | not started | — |
| F | End-to-end test, release notes, roadmap doc update | not started | — |

Each phase is its own PR. A through E are reviewable independently. F
is a final polish PR that just runs the live API test, updates the
roadmap entry, and writes the release notes.
