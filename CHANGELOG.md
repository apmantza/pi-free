# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- **Major refactoring**: Split free-tier-limits.ts into usage/* modules
  - usage/tracking.ts - runtime session tracking
  - usage/cumulative.ts - persistent storage
  - usage/formatters.ts - display formatting
  - 77% line reduction (741 → 166 lines)
- **Major refactoring**: Split usage-widget.ts into widget/* modules
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
