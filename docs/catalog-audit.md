# Catalog audit

Point-in-time verification of pi-free's free/paid classification against every registered provider's real `/models` endpoint. Maintained per [AGENTS.md convention 18](../agents.md): re-audit before each release and whenever a provider is added or changed. Per-model lists with usage conditions live in [free_models.md](free_models.md); this document holds the methodology and the counts table.

## Methodology

Each provider's live `/models` endpoint is fetched (stored credential from `~/.pi/agent/auth.json` where available; anonymous where the catalog is public) and every entry is classified with pi-free's own detection semantics:

- **Route A (cost-based)** — explicit pricing fields; zero price means free.
- **Route B (name-based)** — `:free` suffixes and free-named models where pricing is absent.
- **Promotional stamps** — time-boxed free windows recorded with revisit notes.
- **Authoritative stamps** — `_freeKnown`/`_isFree` overrides where the endpoint cannot tell (documented per case).

Counts drift as providers change their catalogs — treat every audit below as a verified snapshot, never a guarantee. Providers whose credentials are unavailable are listed as "not audited" rather than guessed. Never print or commit API keys during an audit.

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
| CrofAI | 21 | 0 | |
| SambaNova | 7 | 0 | Free tier is at the billing layer; list prices nonzero |
| Agnes AI | 4 | 2 | Flash class free, pro paid per Agnes pricing docs |
| OpenGateway | 14 | 2 | Promotional free entries |
| StepFun | 2 | 2 | Step Plan free tier |

Not audited this cycle (no credential available): Kilo (OAuth-gated catalog), Ollama Cloud, AnyAPI, B.AI, Qoder.
