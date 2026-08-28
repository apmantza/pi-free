# pi-free-providers

<p align="center">
  <img src="banner.svg" alt="pi-free" width="100%" max-width="900">
</p>

Free and paid AI model providers for [Pi](https://pi.dev). Access models from multiple providers in one install.

---

## What does pi-free do

**pi-free is a Pi extension that registers additional providers and applies free/all model filters.**

When you install pi-free, it:

1. Registers native providers such as Kilo, Cline, LLM7, FastRouter, Ollama Cloud, StepFun, and more.
2. Registers Qoder through Pi's native provider surface and supports Pi's built-in OpenCode, OpenCode Go, and OpenRouter integrations.
3. Uses Pi's native model and auth stores for all extension providers; Ollama Cloud and Qoder retain documented compatibility caches only for auxiliary behavior.
4. Applies the global free-only filter by default, while preserving provider-specific paid/trial behavior.
5. Provides per-provider toggle commands — `/toggle-{provider}` switches between the provider's free/basic view and its full catalog.
6. Supports OAuth and API-key authentication where a provider offers them.
7. Adds Coding Index scores to model names and can probe and hide unavailable models.
8. Provides `/pi-free-health` and `/free-startup` diagnostics without exposing credentials.
9. Auto-fallbacks to another free model when the current one errors (see [Auto-fallback](#auto-fallback)).

## Install

Install the published npm package:

```bash
pi install npm:pi-free
```

For the latest unreleased GitHub changes instead:

```bash
pi install git:github.com/apmantza/pi-free
```

Press `Ctrl+L` to open the model picker. The global free-only setting is enabled by default.

## Quick Start

### Use free models

Cline exposes a public catalog before login. Kilo requires an OAuth credential or API key for authenticated refreshes and chat:

```text
/login cline
/login kilo
```

Qoder supports `/login qoder` with PAT or browser OAuth, then `/toggle-qoder` switches between its basic free tier and full catalog.

### Toggle between free and paid

```text
/toggle-kilo
/toggle-openrouter
/toggle-free
/toggle-auto-fallback
/free-providers
/free-fallback-history
/reset-fallback-blacklist
/pi-free-health
```

### Add API keys (optional)

First run creates `~/.pi/free.json`. Add extension-provider keys there or use the environment variables documented in [Provider catalog & auth](docs/providers.md). For example:

```json
{
  "ollama_api_key": "...",
  "anyapi_api_key": "..."
}
```

## Auto-fallback

When `/toggle-free` is **ON** and the current free model errors, pi-free automatically switches to another free model so the conversation keeps moving. The feature is event-driven: every `429 / 5xx / quota / network / timeout` is detected at `after_provider_response` + `message_end`; the actual switch fires from `agent_end` once Pi has finished its own same-model backoff retries (so we don't fight Pi's retries).

Three commands:

- `/toggle-auto-fallback` — on/off switch (persists in `~/.pi/free.json`).
- `/free-fallback-history` — list of session switches + current blacklist.
- `/reset-fallback-blacklist` — clear the in-memory blacklist (escape hatch after an exhaustion).

Configuration (`~/.pi/free.json`, all optional, defaults shown):

```jsonc
{
  "auto_fallback": true,                          // master switch
  "auto_fallback_scope": "provider",             // "provider" | "global" | "whitelist"
  "auto_fallback_providers": [],                 // only when scopes="whitelist"
  "auto_fallback_blacklist_ttl_ms": 600000,      // 10-min soft ban window
  "auto_fallback_blacklist_max": 3,              // strikes → permanent session ban
  "fallback_notify": "toast",                    // "silent" | "toast" | "status_bar" | "both"
  "fallback_restore": "manual"                   // "manual" | "auto_next_turn" | "auto_session_end"
}
```

How it picks the next one: highest Coding Index score among free models not currently blacklisted, scoped to the failing provider by default. The blacklist uses a counter + time dual rule — a single transient quota error expires after the TTL, but `max` strikes in the window promotes the model to a hard session ban.

Caveats:

- **Mid-flight switching is not possible from extensions** (Pi does not expose a turn-replay hook; issue #1248, `not_planned`). The failed turn is shown to the user as an error; the *next* turn uses the new model.
- **`setModel()` rewrites the global default** (issue #1248). Recovery can optionally restore the user's pre-fallback pick via `fallback_restore: "auto_next_turn"`.
- Errors are classified by HTTP status (4xx recoverable set: 429/402/408/425; 5xx all) and `errorMessage` regex (mirrors pi-ai's `isRetryableAssistantError`). 401/403/404/422 are *not* recoverable — switching would only burn candidates.
- All classifications run without reading response bodies (AGENTS.md wire-signature convention).

## Provider Catalog

| Category | Providers |
| --- | --- |
| Free/free-tier | Kilo, Cline, LLM7, TokenRouter, Agnes AI, Qoder basic tier, and eligible models from other catalogs |
| Freemium | AnyAPI, Ollama Cloud, SambaNova |
| Paid/trial | ZenMux, CrofAI, DeepInfra trial, Novita, Routeway, OpenGateway, B.AI, StepFun, GMI Cloud, Venice AI, Infron AI, and paid catalog entries from other providers |
| Native lifecycle | Kilo, Cline, LLM7, Ollama Cloud, AnyAPI, SambaNova, TokenRouter, ZenMux, CrofAI, DeepInfra, Novita, Routeway, OpenGateway, B.AI, FastRouter, StepFun, GMI Cloud, Agnes AI, Venice AI, Infron AI |
| Built-in | OpenCode, OpenCode Go, OpenRouter — captured from Pi and refreshed in place after session start (OpenCode Zen catalog + public OpenRouter endpoint), so new models appear without waiting for a Pi release |

Provider availability, authentication, and exact API-key names are maintained in [docs/providers.md](docs/providers.md). pi-free does not publish model counts as guarantees because provider catalogs change — but a dated **free-model snapshot** (per-provider model lists + usage conditions) is maintained in [docs/free_models.md](docs/free_models.md).

### Live catalog audit

Snapshot from **2026-08-26**, fetched directly from each provider's real `/models` endpoint and classified with pi-free's own detection semantics (cost-based Route A, name-based Route B, promotional stamps). Counts drift as providers change their catalogs — treat this as a verified point-in-time audit, not a promise.

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

### Catalog and credential storage

Native providers use Pi's `~/.pi/agent/models-store.json` and `~/.pi/agent/auth.json`. Qoder's static catalog is persisted in the native model store; it retains its legacy cache only for optional stream metadata. Ollama Cloud retains `~/.pi/provider-cache.json` only for capability reuse and its compatibility refresh command. `/free-startup` also reports per-provider fetch attempts and post-start session work.

### Startup packaging

Pi and npm load the compiled `dist/` entry. The compiled import-inclusive benchmark improved from roughly **1.14s to 0.43s p50** (total from **1.18s to 0.47s p50**) after reducing the measured import graph from **904 to 226 modules**. These are controlled extension benchmarks, not a full Pi-host A/B result; host startup also includes Pi and its peer dependencies.

## Docs

| Topic | Link |
| --- | --- |
| Provider catalog & auth | [docs/providers.md](docs/providers.md) |
| Slash commands | [docs/commands.md](docs/commands.md) |
| Configuration & logging | [docs/configuration.md](docs/configuration.md) |
| Features deep dive | [docs/features.md](docs/features.md) |
| Compiled packaging | [docs/build-strategy.md](docs/build-strategy.md) |
| Adding new providers | [CONTRIBUTING.md](CONTRIBUTING.md) |

## License

MIT — See [LICENSE](LICENSE)

**Questions?** [Open an issue](https://github.com/apmantza/pi-free/issues)
