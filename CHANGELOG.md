# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Codestral provider** — Mistral's code-focused model via codestral.mistral.ai.
  Free tier (Experiment plan): 2 req/min, 500K tokens/min, 1B tokens/month.
  Uses pi's built-in Mistral SDK (`mistral-conversations` API type).

- **LLM7.io provider** — OpenAI-compatible API gateway routing across
  multiple providers (OpenAI, Mistral, Google, DeepSeek, etc.). Free tier:
  default/fast selectors, 100 req/hr, 20 req/min.

- **DeepInfra provider** — AI inference cloud with 100+ open-source models.
  $5 one-time credit on signup (no credit card). Models fetched dynamically.
  Shown as trial credit provider in `/free-providers`.

- **SambaNova provider** — Fast inference on custom RDU hardware with
  OpenAI-compatible API. All models accessible on free tier (no credit card):
  20-480 RPM. Models include Llama 3.3 70B, DeepSeek-V3/R1, Llama 4 Maverick.
  Shown as freemium provider in `/free-providers`.

### Changed

- **Codestral: fixed HTTP 422 error** — Switched API type from
  `openai-completions` to `mistral-conversations`. The OpenAI completions
  adapter was sending unrecognized fields (`stream_options`, `store`,
  `max_completion_tokens`) that Mistral's API rejects with 422.

### Refactored

- **Extracted shared model-fetch helper** — `fetchOpenAICompatibleModels()`
  in `lib/util.ts` eliminates ~120 lines of duplicated fetch→parse→map
  boilerplate across CrofAI, DeepInfra, and SambaNova providers.

## [2.0.6] - 2026-05-02

### Security

- **5x S5852 regex super-linear runtime** — Replaced all flagged regex patterns
  (nested quantifiers in model size extraction) with manual char-by-char string
  parsing in `parseModelSize()`, `normalizeSizeTokenOrder()`, and test helpers.
  Eliminates catastrophic backtracking risk.

- **4x S4036 PATH variable security** —

  - `open-browser.ts`: Added `resolveExe()` helper that prefers known absolute
    paths (`/usr/bin/open`, `C:\Windows\System32\...\powershell.exe`) before
    falling back to PATH lookup
  - `check-extensions.mjs`: Removed hardcoded PATH override; resolved `npm` via
    `execFileSync` with known absolute paths

- **1x S4721 command injection** — Replaced `execSync` with `execFileSync` in
  `resolveExe()` helper. `execFileSync` takes separate arguments and never
  spawns a shell, eliminating the injection vector.

### Changed

- **Banner image** — Converted `banner.svg` to `banner.png` for reliable
  rendering across all GitHub surfaces (mobile, email, dark mode readers).

## [2.0.5] - 2026-05-02

### Added

- **NVIDIA model probe auto-discovery** — Lazy auto-probe for NVIDIA models on
  first `session_start` (once per session). Broken 404 models detected and
  auto-hidden without requiring manual `/probe-nvidia`.

### Changed

- **Ollama provider updates** — Improved cloud model detection and configuration.

## [2.0.4] - 2026-05-02

### Fixed

- **OpenRouter key resolution no longer falls back to `free.json`** —
  `getOpenrouterApiKey()` now only checks the `OPENROUTER_API_KEY` environment variable.
  Previously it fell back to `~/.pi/free.json`, which could contain stale/revoked keys
  that conflict with pi's built-in OpenRouter provider (which reads from
  `~/.pi/agent/auth.json`).

- **Removed `openrouter_api_key` from `PiFreeConfig` interface and config template** —
  Prevents future persistence of OpenRouter keys in `free.json`, eliminating the
  source of stale key conflicts for built-in providers.

## [2.0.3] - 2026-05-02

### Added

- **Consistent `isFreeModel` helper with Route A/B logic** — Created a unified helper for free model detection that automatically detects whether a provider exposes pricing:

  - **Route A (pricing-exposed)**: Model is free if `cost === 0` OR `"free"` in name (OR logic)
  - **Route B (non-pricing-exposed)**: Model is free only if `"free"` in name
  - Dynamic detection: If ALL models have cost === 0, assumes pricing not exposed → uses Route B
  - If ANY model has cost > 0, assumes pricing exposed → uses Route A
  - All providers (Cline, Kilo, NVIDIA, Ollama, dynamic built-in) now use this consistent helper

- **CrofAI provider (PAID)** — Added new **paid** provider for CrofAI (https://crof.ai), an OpenAI-compatible LLM inference API. **Note: CrofAI is a paid provider** — users must have a CrofAI API key with credits. The provider uses Route B detection (name-only) since CrofAI's API doesn't expose per-model pricing. Only models with `"free"` in their names are marked as free (none currently).

- **ZenMux provider (PAID)** — Added new **paid** provider for ZenMux AI gateway (https://zenmux.ai), a unified API for 200+ models from OpenAI, Anthropic, Google, etc. **Note: ZenMux is a paid provider** — users must have a ZenMux API key with credits. The provider uses Route A detection (OR logic) since ZenMux exposes pricing. Models marked as free only if `cost === 0` OR `"free"` in name (2 free models identified: GLM 4.7 Flash Free, GLM 4.6v Flash Free).

- **Comprehensive `isFreeModel` test suite** — Added 30+ unit tests covering Route A, Route B, freemium behavior, and edge cases. Tests verify correct classification on actual OpenRouter API data (371 models, 30 free).

- **Toggle commands for dynamic built-in providers** — Added `/toggle-mistral`, `/toggle-groq`,
  `/toggle-cerebras`, `/toggle-xai`, and `/toggle-huggingface` commands. These providers were
  registered with the global toggle system but lacked per-provider toggle commands, making
  free/paid switching inaccessible without editing config files.

- **Lazy auto-probe for NVIDIA models** — Extracted `runNvidiaProbe()` into a shared function
  called automatically on first `session_start` (once per session). Previously, users had to
  manually run `/probe-nvidia` to discover 404 models. Now broken models are detected and
  auto-hidden on first use.

### Changed

- **Cline provider now uses `isFreeModel`** — Fixed Cline to use the consistent `isFreeModel` helper instead of `m.cost.input === 0`. Previously used cost-only filtering, now uses proper OR logic for pricing-exposed providers.

- **NVIDIA test expectations updated** — Updated tests to reflect strict Route B behavior (name-only detection for non-pricing-exposed providers). Added test for models with `"free"` in name being marked as free.

### Fixed

- **`provider-factory.ts` — `beforeProviderRequest` hook now scoped to owning provider** —
  The hook was firing for **all** provider requests regardless of which provider the factory
  was configuring. Now checks `evt.provider !== def.providerId` and returns early if the
  event doesn't belong to the owning provider.

- **`provider-factory.ts` — `reRegister` callback no longer corrupts stored model lists** —
  When toggling between free/paid modes, the callback was overwriting `stored.all` with only
  the filtered subset, losing the original full model list. Now preserves the original model
  lists for correct subsequent toggling.

- **`lib/types.ts` — Removed leftover `LspTestInterface`** — Removed a test interface that
  was left in production code.

- **`index.ts` — Removed redundant `.catch()` on deprecated Qwen provider** — The `.catch()`
  was unnecessary since `Promise.allSettled` already handles rejections.

### Removed

- **Qwen provider (deprecated)** — Removed Qwen OAuth provider as the 1,000 req/day free tier is no longer available. Provider remains functional for existing authenticated users but new free tier registrations are not supported.

- **Modal provider** — Removed single-model Modal provider (only had GLM-5.1 FP8). Users should use other providers for GLM models.

- **Cloudflare provider** — Removed Cloudflare Workers AI provider as it's now built into pi core. Users can use pi's built-in Cloudflare provider instead.

- **Qwen test file** — Removed `tests/qwen.test.ts` along with the deprecated provider.

## [2.0.2] - 2026-04-26

### Added

- **Model matching debug logging** — Added `~/.pi/modelmatch.log` to diagnose which models get Coding Index scores and which don't:

  - Logs every matching attempt with provider, model ID, normalization strategy, and result
  - CSV-like format: `timestamp|provider|modelId|modelName|action|strategy|normalizedId|matchKey|codingIndex|details`
  - Provider-specific normalizers for better matching:
    - **NVIDIA**: Strips vendor prefixes (`meta/`, `mistralai/`, `microsoft/`, `qwen/`, etc.)
    - **Cloudflare**: Strips `@cf/namespace/` prefixes
    - **Groq**: Removes `-versatile` and numeric context suffixes (`-32768`)
    - **Cerebras**: Normalizes `llama3.1` → `llama-3.1`, auto-adds `instruct` suffix
    - **Mistral**: Strips `-latest` suffix
    - **Ollama**: Converts `model:tag` → `model-tag`
  - Common suffix stripping: `:free`, date codes (`-20250514`), versions (`-v1.1`), `-it`, `-fp8`/`-bf16`

- **Enhanced benchmark lookup** — `enhanceModelNameWithCodingIndex()` now accepts optional `provider` parameter for provider-aware normalization

- **Static 404 model blocklist for NVIDIA** — Probed all 136 models from `integrate.api.nvidia.com/v1/models` and identified 57 that return 404 "Function not found" on `/v1/chat/completions`. These are now hard-filtered so they never appear in the model selector:

  - Covers discontinued models (`databricks/dbrx-instruct`, `meta/codellama-70b`, `meta/llama2-70b`, `ibm/granite-*`, etc.)
  - Covers embedding-only models listed as chat-capable (`nvidia/nv-embed-v1`, `nvidia/nv-embedqa-*`, `snowflake/arctic-embed-l`, etc.)
  - Covers stale API catalog entries (`mistralai/mistral-large`, `mistralai/mistral-large-2-instruct`, `writer/palmyra-*`, etc.)
  - Full list in `NVIDIA_KNOWN_404_MODELS` in `providers/nvidia/nvidia.ts`

- **`/probe-nvidia` command** — On-demand model health check. Tests every registered NVIDIA model with a minimal `max_tokens: 1` request, auto-hides any new 404s in `~/.pi/free.json`, and re-registers the provider immediately.

- **`scripts/probe-nvidia.mjs`** — Standalone Node.js script to reproduce the probe. Reads `~/.pi/free.json` for the API key, batches 20 requests at a time with 10s timeout, and prints all broken model IDs for adding to the blocklist.

- **Ollama Cloud 403 handling** — Same pattern as NVIDIA 404s for Ollama Cloud:

  - `OLLAMA_KNOWN_403_MODELS` blocklist for models that return 403 "access denied"
  - `/probe-ollama` command to test all models on-demand, auto-hide broken ones, and re-register
  - `scripts/probe-ollama.mjs` standalone script for blocklist maintenance

- **Provider-scoped hidden models** — Hidden models are now provider-specific:
  - Format: `"provider/model-id"` (e.g., `"ollama/kimi-k2.6"`, `"nvidia/broken-model"`)
  - A model hidden from one provider doesn't hide it from other providers
  - Backward compatible with old global `"model-id"` format
  - All providers updated: NVIDIA, Ollama, Cloudflare, Cline, Kilo, Modal

### Fixed

- **Probe commands timeout handling** — Added `fetchWithTimeout` with 10-second timeout to `/probe-nvidia` and `/probe-ollama` commands. Prevents the coding harness from freezing when individual model probe requests hang indefinitely.

- **NVIDIA provider now sends `authHeader: true`** — Explicitly enables `Authorization: Bearer` header injection. Previously relied on pi's implicit behavior which could fail in some configurations.

### Removed

- **NVIDIA 404 model warning log** — Removed the `console.warn("[nvidia] Skipping known 404 model: ...")` output when filtering out known broken models. The filter still works silently; use `/probe-nvidia` to identify new 404s if needed.

### Changed

- **Cloudflare provider now fetches models dynamically** — Replaced static 19-model hardcoded list with live API fetch from `api.cloudflare.com/client/v4/accounts/{account_id}/ai/models`:

  - Automatically discovers all 30+ text generation models (was manually maintaining 19)
  - Smart filtering excludes embeddings, image generation, speech, translation, and vision-only models via regex patterns
  - Metadata inference from model IDs: detects vision (`vision`/`multimodal`), reasoning (`r1`/`thinking`/`qwq`), context windows, and estimated costs
  - Fixed Mistral Small ID: changed from incorrect `@cf/mistralai/...` to correct `@cf/mistral/...`
  - Added new fallback models: Kimi K2.6, OpenAI GPT-OSS 120B/20B, Qwen 2.5 Coder 32B, QwQ 32B, Llama 3.2 11B Vision
  - Graceful fallback to expanded 18-model hardcoded list if API fetch fails

- **NVIDIA provider now queries NVIDIA's API directly** — Source of truth switched from `models.dev` curated JSON to `https://integrate.api.nvidia.com/v1/models`:
  - Eliminates 57 missing models and 25 stale entries from the old third-party source
  - Models not in `models.dev` get inferred metadata (128k context, 4k output, vision/reasoning heuristics)
  - Added regex-based non-chat model filtering for unknown models (embeddings, whisper, reward models, safety guards, parsers, detectors, etc.)
  - Graceful fallback to `models.dev` if NVIDIA API is unreachable
  - Removed paid/free toggle filtering — NVIDIA is freemium (all models use free credits)

## [2.0.1] - 2026-04-24

### Added

- **Built-in provider toggle support** (`lib/built-in-toggle.ts`) — Enables free/paid filtering for Pi's built-in providers that expose per-model pricing:
  - **OpenCode (`/toggle-opencode`)** — Captures built-in OpenCode models on session start and filters to free-only by default
  - **OpenRouter (`/toggle-openrouter`)** — Now uses the built-in toggle system for consistency
  - Toggle works in the current session (no restart needed)
  - Persisted via `opencode_show_paid` and `openrouter_show_paid` in `~/.pi/free.json`

### Changed

- **OpenRouter moved to built-in toggle system** — OpenRouter is now handled by `lib/built-in-toggle.ts` alongside OpenCode for a unified approach:

  - Removed from `providers/dynamic-built-in/index.ts`
  - Eliminated duplicate toggle command registration logic
  - Consolidated toggle persistence with other built-in providers

- **Standardized all toggle commands to `toggle-{provider}`** — Renamed from `{provider}-toggle` for consistency:
  - `/kilo-toggle` → `/toggle-kilo`
  - `/cline-toggle` → `/toggle-cline`
  - `/openrouter-toggle` → `/toggle-openrouter`
  - `/nvidia-toggle` → `/toggle-nvidia`
  - `/cloudflare-toggle` → `/toggle-cloudflare`
  - `/ollama-toggle` → `/toggle-ollama`
  - `/mistral-toggle` → `/toggle-mistral`
  - `/groq-toggle` → `/toggle-groq`
  - `/cerebras-toggle` → `/toggle-cerebras`
  - `/toggle-opencode` (new)

### Fixed

- **Ollama Cloud model fetching endpoint** — Corrected the `/v1/models` → `/models` endpoint path in `providers/ollama/ollama.ts`:
  - The previous fix (2.0.0) incorrectly used `/v1/models`; Ollama Cloud's models endpoint is `/v1/models` for chat completions but `/models` for listing
  - This ensures model fetching works correctly with the OpenAI-compatible API

### Removed

- **Global `/free` command** — Removed the global free-only toggle. Per-provider toggles (`/toggle-{provider}`) are now the only way to switch between free and paid models. The `/free-providers` status command remains.

## [2.0.0] - 2026-04-23

### Breaking Changes

- **Removed Fireworks provider** — Fireworks is now a built-in Pi provider (added in pi 0.68.1), so the extension's Fireworks provider has been removed to avoid conflicts:

  - Deleted `providers/fireworks/fireworks.ts` and `tests/fireworks.test.ts`
  - Removed all Fireworks configuration options from `config.ts` (`fireworks_api_key`, `fireworks_show_paid`)
  - Users should now use Pi's built-in Fireworks support with `FIREWORKS_API_KEY`

- **Renamed Ollama provider to `ollama-cloud`** — Changed provider ID from `"ollama"` to `"ollama-cloud"` to avoid collision with Pi's built-in local Ollama provider:
  - This prevents provider ID conflicts when both are registered
  - All log messages and documentation now reference "Ollama Cloud"

### Removed

- **Dropped `@sinclair/typebox` peer dependency** — Pi 0.69.0 migrated from `@sinclair/typebox` to `typebox` 1.x. The extension didn't directly import this package, so it was removed from `peerDependencies` to avoid potential conflicts.

### Fixed

- **Ollama Cloud API endpoint** — Fixed broken Ollama Cloud integration:
  - Changed `BASE_URL_OLLAMA` from `https://ollama.com` to `https://ollama.com/v1` — the OpenAI-compatible API endpoint
  - Fixed model fetching to use `/v1/models` instead of `/api/tags` — ensures model IDs work with chat completions endpoint
  - Previously calls went to HTML homepage instead of API endpoints, causing 404 errors

### Removed

- **Removed paid model warning on selection** — Deleted the `model_select` event handler that showed:

  - `⚠️ Paid model selected (${model.id}). Use "/free off" to enable paid models.`
  - This warning was redundant since the global `/free` toggle and provider toggles already control model visibility

- **Removed pointless `/modal-toggle` command** — Modal provider only has 1 free model (GLM-5.1 FP8), so there was nothing meaningful to toggle:
  - Added `skipToggle` option to `ProviderDefinition` and `ProviderSetupConfig` interfaces
  - Modal provider now sets `skipToggle: true` to prevent toggle command creation

### Changed

- **Marked Qwen provider as fully deprecated** — Updated messaging to clarify the provider is broken:
  - Changed model name from `"Qwen Coder — Free 1k/day"` to `"Qwen Coder — DEPRECATED (free tier discontinued)"`
  - Updated all JSDoc comments to clearly state auth is broken and free tier is no longer available
  - Provider remains for backward compatibility but should not be used

### Added

- **Cloudflare Workers AI provider** — New provider for Cloudflare's serverless GPU platform:

  - 50+ open-source models: Llama 4, Mistral Small 3.1, Qwen 2.5/3, DeepSeek R1, Gemma 4, Kimi K2.5/2.6, and more
  - **10,000 Neurons/day FREE tier** (resets daily at 00:00 UTC)
  - **$0.011 per 1,000 Neurons** beyond free allocation
  - Only requires `CLOUDFLARE_API_TOKEN` — account ID auto-derived from token
  - Toggle with `/cloudflare-toggle`
  - Create token at https://dash.cloudflare.com/profile/api-tokens

- **Unified dynamic built-in providers module** — New `providers/dynamic-built-in/` module that dynamically fetches models from Pi's built-in providers when users have API keys:

  - **Mistral** (`MISTRAL_API_KEY`) — Fetches from `api.mistral.ai/v1/models`
  - **Groq** (`GROQ_API_KEY`) — Fetches from `api.groq.com/openai/v1/models`
  - **Cerebras** (`CEREBRAS_API_KEY`) — Fetches from `api.cerebras.ai/v1/models`
  - **xAI** (`XAI_API_KEY`) — Fetches from `api.x.ai/v1/models`
  - **Hugging Face** (`HF_TOKEN` — optional) — Fetches public + authenticated models
  - **OpenRouter** — Moved from `index.ts` to unified module with dynamic fetch
  - All integrate with global `/free` toggle and have per-provider toggle commands (`/mistral-toggle`, `/groq-toggle`, etc.)

- **Global `/free` toggle system** — New centralized free/paid filtering across ALL providers:
  - `/free on/off/status` — Toggle free-only view globally
  - `/free-providers` — Show free/paid model counts by provider
  - `FREE_ONLY` config option and `PI_FREE_ONLY` environment variable
  - Providers register via `registerWithGlobalToggle()` for unified filtering

### Fixed

- **Toggle commands now actually filter models from UI** — Previously, toggle commands only showed notifications but didn't remove paid models from the model picker:
  - **OpenRouter (`/openrouter-toggle`)**: Now uses `registerProvider`/`unregisterProvider` to actually filter models from the picker UI
  - **NVIDIA (`/nvidia-toggle`)**: Added dynamic `showPaid` parameter to `fetchNvidiaModels()` so toggle properly switches between free and paid model sets
  - **Fireworks**: Removed broken toggle command — all models are paid with no free tier, so there was nothing to toggle

### Added

- **OpenRouter per-provider free model toggle** — Added `/openrouter-toggle` command for the built-in OpenRouter provider:
  - `/openrouter-toggle` — Switch between showing only free models vs all models (including paid)
  - New config flag `openrouter_show_paid` in `~/.pi/free.json` (default: `false`)
  - Environment variable: `OPENROUTER_SHOW_PAID=true` to show paid models by default
  - This brings OpenRouter (a built-in pi provider) in line with extension providers that have per-provider toggles

### Deprecated

- **Qwen provider** — The 1,000 requests/day free tier is no longer available from Qwen/DashScope. The provider code remains for backward compatibility but is now deprecated:
  - Added `@deprecated` JSDoc tags to all Qwen-related exports
  - Added deprecation warning when Qwen provider loads
  - Added warning when `QWEN_SHOW_PAID` config is used
  - Consider migrating to other free providers: Kilo, Cline, NVIDIA, or Modal

### Added

- **Go provider** — OpenCode Go subscription gateway (⚠️ paid only — $5 first month, then $10/month, no free tier) with models: GLM-5, Kimi K2.5, MiMo-V2-Pro, MiMo-V2-Omni, MiniMax M2.7, MiniMax M2.5
  - Set `OPENCODE_GO_API_KEY` or `opencode_go_api_key` in `~/.pi/free.json`
  - Toggle with `/go-toggle`

### Fixed

- **All providers now show Coding Index scores in model selector** — Added `enhanceWithCI()` to factory-based providers (nvidia, fireworks, mistral, modal, ollama) and cline. Now all providers display CI scores in `/models` command (pi-models extension).

- **All providers now show in `--list-models`** — Providers (zen, openrouter, go) that registered models only in `session_start` were missing from `pi --list-models` which runs before session starts. Added immediate registration for these providers:
  - **zen**: Added model caching to `~/.pi/provider-cache.json` for immediate registration + dynamic refresh
  - **openrouter**: Immediate model registration at extension load (like kilo/cline)
  - **go**: Immediate registration with static model list (no API to fetch from)
  - All 11 providers now visible in `--list-models`

### Changed

- Updated README with clear free vs paid provider distinction (9 free + 2 paid-only: Go, Fireworks)
- Added Go and Fireworks provider documentation under new "💳 Paid-Only Providers" section
- Added `opencode_go_api_key` to config file template
- Updated package.json description and keywords to include all 11 providers

### Added

- **Provider model cache** (`lib/provider-cache.ts`) — New utility for caching provider model lists to `~/.pi/provider-cache.json`. Used by zen provider for faster startup and offline access after first successful fetch.

## [1.0.9] - 2026-04-14

### Fixed

- **Qwen OAuth breaks other OAuth providers** — `modifyModels` receives all models across every registered provider, not just Qwen's. The previous `map()` stamped the Qwen dashscope `baseUrl` onto every model, causing other OAuth providers (Kilo, OpenRouter, etc.) to return 404 after a `/login qwen` flow. Now only models with `provider === PROVIDER_QWEN` are patched; others pass through unchanged.

## [1.0.8] - 2026-04-13

### Added

- **Modal provider** — Free access to GLM-5.1 FP8 (128k context, 16k max output) during promotional period (free until April 30, 2026)
  - Requires a free Modal API key (`MODAL_API_KEY` or `modal_api_key` in `~/.pi/free.json`)
  - Model: `zai-org/GLM-5.1-FP8` — 128k context window, 16k max output tokens
- **Qwen provider** — Free access to Qwen Coder (1,000 requests/day) via OAuth device flow
  - Run `/login qwen` to authenticate through Qwen Studio (chat.qwen.ai)
  - Uses `coder-model` alias (maps to Qwen3.6-Plus on the backend)
  - 131k context window, 16k max output tokens, zero cost

### Fixed

- **Qwen OAuth browser launch on Windows** — URLs with `&` query params were truncated by `cmd.exe`'s `&` command separator; switched to `powershell.exe Start-Process` which passes the URL as a literal string
- **Qwen API endpoint** — Replicates qwen-code's `getCurrentEndpoint()` logic: uses `resource_url` from OAuth token response (`dashscope.aliyuncs.com` for Chinese accounts, `portal.qwen.ai` for international), with fallback to `dashscope.aliyuncs.com/compatible-mode/v1`
- **Qwen DashScope headers** — Added all headers required by DashScope's OpenAI-compatible API: `X-DashScope-AuthType: qwen-oauth`, `X-DashScope-CacheControl: enable`, `X-DashScope-UserAgent`, `Client-Code: QwenCode`
- **Qwen modifyModels crash** — `modifyModels` must be synchronous; making it async caused the pi framework to receive a `Promise` instead of a `Model[]`, breaking `ModelRegistry.find()`

## [1.0.5] - 2025-04-03

### Fixed

- **NVIDIA provider non-chat model filtering** (comment/implementation mismatch)
  - Added modalities-based filtering to exclude embedding, speech-to-text, OCR, and image-gen models
  - Filters models where `output` is not `["text"]` (e.g., image generation like `black-forest-labs/flux.1-dev`)
  - Filters models where `input` lacks `"text"` (e.g., OCR like `nvidia/nemoretriever-ocr-v1`, speech-to-text like `openai/whisper-large-v3`)
  - Updated file comment to accurately describe the filtering behavior
  - Added 8 comprehensive unit tests for model filtering logic

## [1.0.4] - 2025-04-03

### Fixed

- **All tests now passing** (127/127)
  - Fixed mock paths in kilo.test.ts, zen.test.ts, ollama.test.ts
  - Fixed createCtxReRegister mocks in zen.test.ts and openrouter.test.ts
  - Fixed cline.test.ts to test actual provider re-registration behavior
  - Added missing DEFAULT_MIN_SIZE_B constant to openrouter mock

### Changed

- **Code quality improvements**
  - Refactored usage modules to break circular dependency (limits.ts ↔ formatters.ts)
  - Created usage/types.ts with shared interfaces (FreeTierLimit, FreeTierUsage)
  - Bumped version to 1.0.4

## [1.0.3] - 2025-04-03

### Changed

- Updated package.json metadata (name, description, keywords, repository URL)
- Updated .npmignore for cleaner publishes

## [1.0.0] - 2024-03-28

### Added

- Initial release with 6 providers: Kilo, Zen, OpenRouter, NVIDIA, Cline, Fireworks
- Free tier usage tracking across all sessions
- Provider failover with model hopping
- Autocompact integration for rate limit recovery
- Usage widget with glimpseui
- Command toggles for free/all model filtering
- Hardcoded benchmark data from Artificial Analysis

### Changed

- **Major refactoring**: Split free-tier-limits.ts into usage/\* modules
  - usage/tracking.ts - runtime session tracking
  - usage/cumulative.ts - persistent storage
  - usage/formatters.ts - display formatting
  - 77% line reduction (741 → 166 lines)
- **Major refactoring**: Split usage-widget.ts into widget/\* modules
  - widget/data.ts - data collection
  - widget/format.ts - formatting utilities
  - widget/render.ts - HTML generation
  - 74% line reduction (~350 → 90 lines)
- **Refactoring**: Extracted functions from cline-auth.ts
  - fetchAuthorizeUrl() - auth URL fetching
  - waitForAuthCode() - callback handling
  - exchangeCodeForTokens() - token exchange
  - parseManualInput() - manual input parsing
- **Refactoring**: Simplified model-hop.ts complexity
  - Extracted handleDowngradeDecision()
  - Extracted tryAlternativeModel()
- **Deduplication**: Created shared modules
  - lib/json-persistence.ts - file I/O with caching
  - lib/logger.ts - structured logging
  - providers/model-fetcher.ts - OpenRouter-compatible fetching
- Replaced ~30 console.log statements with structured logging
- Fixed all 9 pre-existing test failures
  - fetchWithRetry now throws after last retry
  - Fixed auth pattern matching (added key.*not.*valid)
  - Updated capability ranking tests
  - Added resetUsageStats() for test isolation

### Fixed

- fetchWithRetry() now properly throws after exhausting retries
- Auth error pattern matching now handles more message variants
- Test isolation for free-tier-limits tests
