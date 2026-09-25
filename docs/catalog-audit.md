# Catalog audit

Point-in-time verification of pi-free's free/paid classification against every registered provider's real `/models` endpoint. Maintained per [AGENTS.md convention 18](../agents.md): re-audit before each release and whenever a provider is added or changed. Per-model lists with usage conditions live in [free_models.md](free_models.md); this document holds the methodology and the counts table.

## Methodology

Each provider's live `/models` endpoint is fetched (stored credential from `~/.pi/agent/auth.json` where available; anonymous where the catalog is public) and every entry is classified with pi-free's own detection semantics:

- **Route A (cost-based)** — explicit pricing fields; zero price means free.
- **Route B (name-based)** — `:free` suffixes and free-named models where pricing is absent.
- **Promotional stamps** — time-boxed free windows recorded with revisit notes.
- **Authoritative stamps** — `_freeKnown`/`_isFree` overrides where the endpoint cannot tell (documented per case).

Counts drift as providers change their catalogs — treat every audit below as a verified snapshot, never a guarantee. Providers whose credentials are unavailable are listed as "not audited" rather than guessed. Never print or commit API keys during an audit.

## 2026-09-25 — upstream-wrapper probe (KTibow-style)

Prompted by the CrofAI precedent (an OpenRouter wrapper removed from this catalog after KTibow's fact-check), all less-known registered gateways holding a stored credential were probed black-box for upstream-resale tells. Methodology per provider, all with `max_tokens: 5`:

1. `GET /models` — catalog shape plus response-header markers (`x-openrouter-*`, id formats).
2. Chat on a free/first-listed model — records the echoed `model` id and completion-id prefix (OpenRouter uses `gen-`).
3. Chat with `model: "openrouter/auto"` — the discriminator: only an OpenRouter-backed stack serves it.
4. Chat with a bogus model id — error-text fingerprint (`"No endpoints found"` is OpenRouter's classic tell).

| Provider | Serves `openrouter/auto`? | Error/header fingerprint | Verdict |
| --- | --- | --- | --- |
| Agnes AI | No (503 `model_not_found`) | `AgnesAI_error`, `x-request-id` | Not OR-backed |
| B.AI | No (404) | `x-oneapi-request-id`, `(distributor)` suffix, upstream `minimax-request-id` | Not OR-backed; OneAPI relay stack |
| CommandCode | No (400 `unsupported_model`) | `x-powered-by: Hono`, OpenAI-style errors | Not OR-backed (one cosmetic note below) |
| GMI Cloud | No (404 `No matching target server`) | `x-gmi-request-id` | Not OR-backed |
| Infron AI | No (503, own `infron_ai_error`) | `x-infron-request-id` | Not OR-backed |
| Merge Gateway | No (404 `provider_credentials_missing` — tells the caller to add *their own* OpenRouter credentials) | `server-timing` exposes `gateway`/`upstream provider call` phases | BYOK router by design, not a model host |
| OrcaRouter | No (404 + console catalog link) | `x-orca-request-id`, TencentEdgeOne edge | Not OR-backed; echoes the real serving model (`deepseek-v4-flash-ga-...)` for router ids — transparent |
| Requesty | No (404) | `origin: router` | Not OR-backed (known router vendor) |
| TokenRouter | No (503) | Echoes upstream in-body (`"provider":"Nvidia"`); same `(distributor)` template as Agnes/B.AI | Not OR-backed; same white-label stack as Agnes/B.AI |
| Venice AI | No (404 + did-you-mean) | Account-balance 402 when unfunded | Not OR-backed (established vendor) |
| Xkiro | No (404 `not_found_error`) | Own error taxonomy | Not OR-backed |
| ZenMux | No (500 `invalid_model`, `x-zenmux-requestid`) | `x-server-id: tboxrouter-portal-*` | Not OR-backed |

Shared-stack finding (not OR-backed, but not own-GPU either): Agnes, B.AI, and TokenRouter return the identical `No available channel for model X under group default (distributor)` template, and B.AI sends `x-oneapi-request-id` headers — all three run on a common OneAPI-family white-label relay ("distributor") platform with per-model upstreams. That is ordinary reseller architecture, not model forgery: no provider echoed a foreign model id for a house id, and none served `openrouter/auto`.

Cosmetic note: CommandCode completion ids use a `gen_` prefix resembling OpenRouter's `gen-` format, but its endpoint behavior (strict allowlist, OpenAI-style errors, no OR-id serving) contradicts proxying — insufficient evidence either way, recorded for the next probe round.

Not probed (no credential available): AnyAPI, FastRouter, Routeway, OpenGateway, StepFun, LLM7, Novita. Kilo skipped — its OAuth API speaks no `/v1/models` (Vercel 404 on the guessed path); needs its native-protocol probe.

Bottom line: no second CrofAI found. The right question for most of these is not "do they own GPUs" (they are relays/routers and largely say so) but "do they serve what they advertise" — on current evidence, yes.

## 2026-09-22 — 2.8.2 carry-over

Carry forward the 2026-08-26 snapshot under the patch exception. Version 2.8.2 changes authentication routing (anonymous opencode-free bearer, compat-registry dispatch), host compatibility (OMP bridge discriminator), log-stream teardown handling, ZenMux output-modality picker filtering, and dependency floors; it does not change free/paid price-classification semantics, and the CrofAI removal is already reflected in the tables below. No fresh full-provider audit was run; counts and expired promotional windows below remain historical. The same carry-over is recorded in [free_models.md](free_models.md#2026-09-22--282-carry-over) and the 2.8.2 changelog.

## 2026-09-12 — 2.8.1 carry-over

Carry forward the 2026-08-26 snapshot under the authentication-only release exception. Version 2.8.1 removes an unconditional missing-key override; it does not change catalog fetching, model lists, pricing classification, or promotional rules. The OpenCode live refresh reproduction is recorded in [issue-504-investigation.md](issue-504-investigation.md), not presented as a full-provider audit. No fresh full-provider audit was run; counts and expired promotional windows below remain historical. The same carry-over is recorded in [free_models.md](free_models.md) and the 2.8.1 changelog.

## 2026-08-26 audit

Fetched directly from each provider's real `/models` endpoint. Carried over unchanged through 2.8.0 (no classification or catalog code changed in that window — `isFreeModel` received type widenings only).

| Provider | Models | Free-classified | Notes |
| --- | --- | --- | --- |
| Cline | 417 | 22 | OAuth/API key for chat; public catalog incl. `stealth/ox-alpha` |
| Requesty | 675 | 11 | Inline pricing |
| ZenMux | 165 | 14 | |
| FastRouter | 139 | 11 | |
| TokenRouter | 128 | 2 | `qwen3.8-max-free` upstream was flaky at audit time (gateway 503s) |
| GMI Cloud | 75 | 2 | MiniMax Week promotion through 2026-09-06 |
| Infron AI | 285 | 5 | New in this release |
| LLM7 | 46 | 46 | Entirely free gateway |
| DeepInfra | 188 | 0 | $5 trial-credit provider; no pricing exposed, no free-named models |
| Novita | 151 | 0 | Trial-credit posture, same as DeepInfra |
| Routeway | 246 | 6 | |
| Venice AI | 113 | 1 | `stealth-ox-alpha` is $0-listed but Venice gates inference behind account balance (402 when unfunded) |
| SambaNova | 7 | 0 | Free tier is at the billing layer; list prices nonzero |
| Agnes AI | 4 | 2 | Flash class free, pro paid per Agnes pricing docs |
| OpenGateway | 14 | 2 | Promotional free entries |
| StepFun | 2 | 2 | Step Plan free tier |

Not audited this cycle (no credential available): Kilo (OAuth-gated catalog), Ollama Cloud, AnyAPI, B.AI, Qoder.
