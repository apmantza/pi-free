# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.2.0] - 2026-06-19

### Added

- **b.ai** provider (`api.b.ai/v1`) — OpenAI-compatible gateway with 29 models
  (Claude Opus 4.x / Sonnet 4.x, GPT-5.x family, Gemini 3.x family, DeepSeek
  V4 / V3.2, GLM-5.x, Kimi K2.5, Qwen 3.6-27B, MiniMax M3 / M2.7). Currently
  advertises `MiniMax-M3` as a limited-time free promotional model; all
  other models default to paid (visible by default). Static API key auth via
  `BAI_API_KEY` env var or `bai_api_key` in `~/.pi/free.json`. New commands:
  `/toggle-bai`.

### Security

- Bumped `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, and
  `@earendil-works/pi-tui` to `^0.79.8` — resolves Dependabot advisories
  #19 and #21 (high-severity protobufjs, ws, undici vulnerabilities in
  `@earendil-works/pi-coding-agent`).
- Bumped `typescript` devDep to `^6.0.3`.
- Removed now-redundant `overrides` for `protobufjs` and `ws` (fixed
  upstream).

## [2.1.1] - 2026-06-15

### Fixed

- **Cline XML bridge**:
  - Preserve JSON file content as string in `write_to_file` XML — prevents file bodies from being parsed as JSON objects and corrupted ([#244](https://github.com/apmantza/pi-free/pull/244)).
  - Recover heredoc file writes (Model `cat << 'EOF'` pattern in `execute_command`) as `write`/`write_to_file` tool calls ([#246](https://github.com/apmantza/pi-free/pull/246)).
  - Recover XML tool calls from the reasoning stream when MiMo nests tools inside thinking blocks ([#249](https://github.com/apmantza/pi-free/pull/249)).
  - Surface reasoning-only responses: when MiMo puts the entire answer in reasoning with no visible text, surface it as best-effort visible output instead of a blank stop ([#251](https://github.com/apmantza/pi-free/pull/251)).
  - Strip Unicode math-italic XML tag decorations (`<𝑎𝑛𝑡𝑚𝑙:thinking>`, `<𝑎𝑛𝑡𝑚𝑙:read_file>`) that MiMo emits instead of standard Cline XML tags ([#252](https://github.com/apmantza/pi-free/pull/252)).
  - Hide internal planning phrases and restrict hidden-tool recovery to the reasoning channel only — never leak raw LLM planning as user-visible text ([#252](https://github.com/apmantza/pi-free/pull/252)).
  - Retry MiMo stream errors with reasoning disabled on the second attempt ([#252](https://github.com/apmantza/pi-free/pull/252)).
  - Parse MiMo Pi SDK `<function=name>` tool-call syntax directly — no double conversion through Cline XML ([#255](https://github.com/apmantza/pi-free/pull/255)).
  - Auto-retry reasoning-only MiMo responses with a "continue" nudge instead of showing a dead-end error to the user ([#256](https://github.com/apmantza/pi-free/pull/256)).

- **TokenRouter**:
  - Patch nested MiniMax `<think>` blocks that appear inside `reasoning_content` deltas ([#247](https://github.com/apmantza/pi-free/pull/247)).
  - Scope MiniMax thinking patches to active MiniMax models only, avoiding interference with other model families ([#248](https://github.com/apmantza/pi-free/pull/248)).
  - Patch MiniMax payloads in the stream wrapper to prevent malformed SSE from breaking the parser ([#250](https://github.com/apmantza/pi-free/pull/250)).
  - Retry high-load 2064 errors from TokenRouter with automatic backoff ([#254](https://github.com/apmantza/pi-free/pull/254)).

- **UI**: Remove provider-count footer status text unconditionally — reduces status bar clutter ([#245](https://github.com/apmantza/pi-free/pull/245)).

## [2.1.0] - 2026-06-15

### Added

- **Cline XML tool bridge** — Replaced Cline's native OpenAI tool-message path with a custom `streamSimple` XML bridge. Cline-trained models now receive Cline-style XML tool instructions and emit XML tool calls that pi-free converts back to Pi `toolCall` blocks. This fixes strict upstream errors such as `Tool message must have tool_call_id` and `missing field "tool_call_id"` on models like `xiaomi/mimo-v2.5` and `nex-agi/nex-n2-pro:free` ([#232](https://github.com/apmantza/pi-free/pull/232)).

- **Cline-native tool name mapping** — The XML bridge maps Cline-native tool names to Pi runtime tools:
  - `read_file` → `read`
  - `write_to_file` → `write`
  - `replace_in_file` → `edit` (supports multi-block SEARCH/REPLACE diffs as one Pi `edit` call with multiple edits)
  - `execute_command` → `bash`
  - `list_files`, `search_files`, `list_code_definition_names` → `bash` (safe command generation)
  - Unknown Pi tools pass through by their original names ([#235](https://github.com/apmantza/pi-free/pull/235), [#237](https://github.com/apmantza/pi-free/pull/237)).

- **Cline XML thinking-tag hardening** — Strips `<thinking>...</thinking>` blocks, orphan `</thinking>` close tags, and dangling planning text before tool parsing, so Cline models don't emit visible plan text instead of tool calls ([#239](https://github.com/apmantza/pi-free/pull/239), [#240](https://github.com/apmantza/pi-free/pull/240)).

- **Live Cline smoke test** — Added `npm run smoke:cline` gated test that hits the real Cline API and verifies Cline `read_file` XML is converted into a Pi `read` tool call ([#232](https://github.com/apmantza/pi-free/pull/232)).

### Fixed

- **TokenRouter MiniMax-M3 `<think>` leak** — The model sometimes emits DeepSeek-style `<think>` reasoning tags inline in assistant text. Added a `message_end` handler scoped to TokenRouter that extracts these blocks (including unclosed dangling tags) and promotes them to proper `ThinkingContent`, so Pi renders them as reasoning instead of visible text ([#243](https://github.com/apmantza/pi-free/pull/243)).

- **TokenRouter provider** — OpenAI-compatible API gateway at `api.tokenrouter.com/v1` with 88 text chat models. 1 free via hardcoded `KNOWN_FREE_MODELS` + 1 `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` model. Set `TOKENROUTER_API_KEY` or add `tokenrouter_api_key` to `~/.pi/free.json` ([#222](https://github.com/apmantza/pi-free/pull/222)).

- **Generic probe system** — New `lib/provider-probe.ts` factory `createProviderProbe()` handles batching, probe-cache integration, auto-hiding, and re-registration. Enables consistent probe commands across providers ([#218](https://github.com/apmantza/pi-free/pull/218)).

- **Probe commands** — New `/probe-deepinfra`, `/probe-sambanova`, `/probe-together`, `/probe-novita` commands test model availability and auto-hide broken models ([#218](https://github.com/apmantza/pi-free/pull/218)).

- **OpenCode probe commands** — `/probe-opencode` and `/probe-opencode-go` detect expired free promotions (reports only, no auto-hide) ([#218](https://github.com/apmantza/pi-free/pull/218)).

- **Session timing metrics** — `wrapSessionStartHandler()` logs wall-clock time per handler in `lib/session-start-metrics.ts`. Wrapped: cline, kilo, routeway, built-in-toggle, dynamic-built-in auto-probe ([#218](https://github.com/apmantza/pi-free/pull/218)).

### Changed

- **Refactored `recordModelCall` signature** — Replaced 5 positional args with an options object (`RecordModelCallOptions`) for `success`, `stopReason`, and `errorMessage` ([#221](https://github.com/apmantza/pi-free/pull/221)).

- **Extracted `sleep` helper and simplified `cleanModelName`** — Shared utilities in `lib/util.ts` ([#221](https://github.com/apmantza/pi-free/pull/221)).

- **Cleanup pass on `lib/` utilities (Sprint B)** — 8 categories of code-quality refactors in [#224](https://github.com/apmantza/pi-free/pull/224):
  - `open-browser.ts`: `rundll32 url.dll,FileProtocolHandler` replaces `cmd /c start` (CodeQL fix) + strict URL validation (`isSafeUrl`)
  - `logger.ts`: `parseLogLevel()` validates `LOG_LEVEL` / `PI_FREE_LOG_LEVEL` env vars
  - `telemetry.ts`: 1h TTL cleanup for `_inFlight` map; migrated to `createJSONStore` (drops ~80 LOC of `load`/`save`/`Lock` boilerplate)
  - `util.ts`: `OpenAIModelCallbacks` parameter decouples `fetchOpenAICompatibleModels` from `lib/provider-compat.ts` (DIP fix)
  - `provider-compat.ts`: extracted `isDeepSeekStyleModel()` and `isKimiModel()` predicates + new `KIMI_PROXY_COMPAT` constant
  - `model-detection.ts`: removed duplicate `isModelFree` (canonical `isFreeModel` in `registry.ts` already exists)
  - `registry.ts`: removed dead `_pi` parameter from `applyGlobalFilter`
  - `built-in-toggle.ts`: lazy `_opencodeSession` initialisation (only created when an OpenCode provider is actually captured)

### Removed

- **NVIDIA NIM provider** — Now a built-in Pi provider. Set `NVIDIA_API_KEY` to use directly. Removed `providers/nvidia/`, constants, config re-exports, and tests ([#218](https://github.com/apmantza/pi-free/pull/218)).

### Security

- **CI/release hardening** — Added production dependency audit, lockfile drift check, tarball content/artifact verification, installed entry smoke-load, and pinned-action workflows. Added Dependabot config for npm and GitHub Actions. Hardened helper scripts against PATH-lookup Sonar hotspots by resolving `npm` and `tar` to fixed locations (#236).

- **open-browser: `rundll32` + strict URL validation** — Replaced `cmd /c start "" <url>` with `rundll32 url.dll,FileProtocolHandler <url>` to fix GitHub Advanced Security CodeQL `js/uncontrolled-command-line` (Critical). rundll32 does NOT parse the command line, so the URL is handed to ShellExecute as a literal. Defense-in-depth: `isSafeUrl()` allows only `http`/`https`, rejects control characters, malformed URLs, and overlong URLs (>2048 chars) ([#223](https://github.com/apmantza/pi-free/pull/223), [#224](https://github.com/apmantza/pi-free/pull/224)).

- **Path-validate env-var file overrides** — New `lib/paths.ts` centralises `PI_DATA_DIR`, `ensureDir()`, and `resolveSafeDataFile()` (rejects path separators, null bytes, dot-only, >128-char). Applied to `PI_FREE_LOG_PATH`, `PI_FREE_PROVIDER_CACHE`, `PI_FREE_TELEMETRY_FILE` ([#223](https://github.com/apmantza/pi-free/pull/223)).

- **json-persistence: lock `save`/`load` + atomic `update()`** — `Lock` mutex serialises RMW operations. `clearProviderCache` / `clearAllProviderCaches` now async, use `_cache.update()` ([#218](https://github.com/apmantza/pi-free/pull/218), [#223](https://github.com/apmantza/pi-free/pull/223)).

- **JSONL `append`/`clear` lock** — `createJSONLStore` operations are now async and lock-serialised, preventing `clear` from truncating mid-`append` ([#223](https://github.com/apmantza/pi-free/pull/223)).

- **telemetry: concurrent-write safety** — `Lock` mutex around telemetry writes; `recordModelCall` and `clearTelemetry` are now async and serialized. File path overridable via `PI_FREE_TELEMETRY_FILE` ([#218](https://github.com/apmantza/pi-free/pull/218)).

- **provider-cache: isolated copies** — `loadProviderCache` returns `structuredClone(cached.models)`; `saveProviderCache` uses `update()` for atomic RMW ([#218](https://github.com/apmantza/pi-free/pull/218)).

- **provider-probe: config RMW lock** — `config.ts` `updateConfig()` uses internal `ConfigLock` (promise-chained mutex); provider-probe auto-hide now uses it ([#223](https://github.com/apmantza/pi-free/pull/223)).

- **Prototype pollution reviver** — `safeJsonReviver()` strips `__proto__` / `constructor` keys at every `JSON.parse` level. Applied in `lib/json-persistence.ts`, `config.ts`, `lib/telemetry.ts` ([#223](https://github.com/apmantza/pi-free/pull/223)).

- **Log sanitization** — `scripts/update-benchmarks.ts` now sanitizes external API data before passing to `console.log`/error, preventing log injection (SonarCloud S5693) ([#219](https://github.com/apmantza/pi-free/pull/219)).

## [2.0.15] - 2026-06-02

### Fixed

- **Qwen 3.7 reasoning compat** — `qwen/qwen3.7-max` on Cline/OpenRouter uses DeepSeek-style `reasoning_content` format. Added `DEEPSEEK_PROXY_COMPAT` so Pi preserves and replays reasoning tokens correctly, preventing plan-mode hangs ([#213](https://github.com/apmantza/pi-free/pull/213)).

- **Kimi K2.6 reasoning compat** — Kimi models on NVIDIA/OpenRouter need `requiresReasoningContentOnAssistantMessages: true` to correctly replay reasoning tokens in assistant messages. Without it, the model gets stuck when trying to call tools or produce output after thinking. Refs [earendil-works/pi#5309](https://github.com/earendil-works/pi/issues/5309) ([#213](https://github.com/apmantza/pi-free/pull/213)).

- **MiniMax reasoning compat** — MiniMax M3 and other MiniMax models now have full DeepSeek-style compat (`thinkingFormat: "deepseek"`, `requiresReasoningContentOnAssistantMessages: true`). Previously, models marked `reasoning: true` without `thinkingFormat` caused Pi to enter plan mode but couldn't parse the reasoning tokens, resulting in hangs ([#212](https://github.com/apmantza/pi-free/pull/212), [#213](https://github.com/apmantza/pi-free/pull/213)).

### Added

- **`/probe-routeway` command** — Tests each Routeway model with a minimal chat request and auto-hides models that return 5xx or 404 errors. Runs lazily on first `session_start` with 24h probe cache TTL. Follows the same pattern as `/probe-nvidia` ([#213](https://github.com/apmantza/pi-free/pull/213)).

## [2.0.14] - 2026-06-02

### Added

- **Routeway provider** — OpenAI-compatible gateway (`api.routeway.ai/v1`) with 219 models, 16 free (`:free` suffix). Set `ROUTEWAY_API_KEY` or add `routeway_api_key` to `~/.pi/free.json`. Toggle with `/toggle-routeway` ([#209](https://github.com/apmantza/pi-free/pull/209)).

### Fixed

- **Cline free model merging** — Free-to-try models (e.g. `qwen3.7-plus`) from Cline's recommended list now appear in the free model picker even when absent from the main catalog ([#209](https://github.com/apmantza/pi-free/pull/209)).

- **`_pricingKnown` / `_freeKnown` authoritatve flag** — Providers can now signal whether pricing data is authoritative via `_pricingKnown`. When `false`, `isFreeModel` falls back to name-based detection. Kilo's `isFree` API flag now flows through as `_freeKnown` ([#209](https://github.com/apmantza/pi-free/pull/209)).

- **MiniMax reasoning compat** — MiniMax M3 and other MiniMax models now have `supportsReasoningEffort: true` compat settings. Previously, models marked `reasoning: true` without compat caused Pi to enter plan mode without knowing the thinking format, resulting in hangs.

## [2.0.13] - 2026-05-21

### Added

- **OpenCode static headers injection** — pi-free now injects required OpenCode headers (`x-opencode-client`, `x-opencode-session`, `x-opencode-request`, `x-opencode-project`, `User-Agent`) when capturing/re-registering pi's built-in OpenCode models **and** when dynamically fetching/registering OpenCode models from `opencode.ai/zen/v1`. Prevents requests from hanging indefinitely when pi's model generation omits these headers ([pi#4680](https://github.com/earendil-works/pi/issues/4680), [#171](https://github.com/apmantza/pi-free/issues/171), [#173](https://github.com/apmantza/pi-free/issues/173), [#174](https://github.com/apmantza/pi-free/issues/174)). Headers are now regenerated per-call with fresh session and request IDs. Uses native `ses_`/`msg_` prefixed ULID identifiers matching OpenCode's `Identifier.descending()` format to avoid daily rate-limit throttling ([#175](https://github.com/apmantza/pi-free/issues/175)).

- **OpenCode endpoint detection** — Replaced regex-based OpenCode endpoint check with a simple string comparison, reducing overhead on every streaming request.

### Fixed

- **Lazy-load Pi AI stream providers** — Pi-ai's OpenAI completions and Anthropic stream modules are now imported lazily on first use rather than at extension load time. Eliminates start-up failures when pi-ai exports are not yet resolvable ([#177](https://github.com/apmantza/pi-free/issues/177)).

- **Subpath resolution for isolated extension context** — Pi loads pi-free from a directory tree that does not contain `@earendil-works/pi-ai` in its `node_modules`. `createRequire().resolve()` only understands CJS resolution, but pi-ai is ESM-only with strict exports. The new fallback resolves a pi-ai dependency from Pi's entry point, walks up to `node_modules`, reads `pi-ai/package.json`, and maps the `exports` field to the actual file path. Fixes module resolution for both `anthropic` and `openai-completions` subpaths. Includes integration test.

- **Security: shell injection in test** — Replaced `execSync` with `execFileSync` in the OpenCode session integration test to avoid shell injection risk.

### Security

- **Bump `brace-expansion` 5.0.5 → 5.0.6** — Patches minor dependency vulnerability. Fixes `npm audit`. ([#172](https://github.com/apmantza/pi-free/issues/172))

## [2.0.12] - 2026-05-13

### Added

- **Novita AI provider** — OpenAI-compatible API at `api.novita.ai/openai/v1` with 100+ open-source models. Non-standard but rich metadata: per-model pricing (`input_token_price_per_m`), context size, max output tokens, reasoning/vision features, and model descriptions. 3 free models, 99 paid.

- **FastRouter provider** — OpenRouter-compatible API at `api.fastrouter.ai/api/v1` with 170+ models. Always discovered (no auth needed for model listing). Full pricing, context lengths, and feature metadata. 129 text models (6 free, 123 paid) after filtering image/video. Set `FASTROUTER_API_KEY` for chat completions.

- **Dynamic model fetching for OpenCode and OpenRouter** — Pi's built-in providers now get their models fetched dynamically from the API (`opencode.ai/zen/v1/models` and `openrouter.ai/api/v1/models`), same as Mistral, Groq, Cerebras, and xAI. Overwrites Pi's defaults with the full model list. OpenCode uses name-based free detection (API returns no pricing); OpenRouter uses full cost-based detection.

- **API key reading from `~/.pi/agent/auth.json`** — `getOpencodeApiKey()` and `getOpenrouterApiKey()` now fall back to Pi's auth.json when the env var isn't set, matching how Pi's built-in providers read their keys.

### Changed

- **`_pricingKnown` guard in `isFreeModel`** — Providers can now signal whether pricing data is authoritative. When `_pricingKnown` is explicitly `false` (API returned no pricing), `isFreeModel` falls back to name-only detection (checks for "free" in the model name). This eliminates false positives where missing pricing data was treated as $0 cost. All affected providers (ZenMux, Together, CrofAI, dynamic-built-in, fetchOpenAICompatibleModels, deepinfra, sambanova, novita) now set this flag correctly.

- **All providers now use `isFreeModel` consistently** — Together switched from hardcoded `cost===0` check to `isFreeModel`. DeepInfra and SambaNova switched from manual free lists to `isFreeModel` with proper `_pricingKnown` metadata. NVIDIA, Codestral, and Ollama explicitly documented as free-tier providers (`freeModels = allModels`).

- **Unified OpenRouter-based providers** — Kilo, OpenRouter, and Cline now share the same `fetchOpenRouterCompatibleModels` / OpenRouter API logic.

### Removed

- **`DEFAULT_MIN_SIZE_B` (30B minimum model size filter)** — Removed from `model-fetcher.ts` and `cline-models.ts`. All models are now shown regardless of parameter count. NVIDIA still uses its own 70B threshold (`NVIDIA_MIN_SIZE_B`).

### Fixed

- **ZenMux false free classifications** — Models without `pricings` data (DeepSeek Chat V3.1, Kimi K2 0711, Claude 3.7 Sonnet) were incorrectly classified as free because missing pricing defaulted to $0. Fixed to 3 genuinely free models (down from 6 false positives).

- **Together AI, CrofAI, dynamic-built-in missing-pricing false positives** — Same `?? 0` pattern across multiple providers could mark unpriced models as free. All now set `_pricingKnown: false` when pricing is absent from the API response.

## [2.0.10] - 2026-05-08

### Fixed

- **Config wipe on JSON parse failure** — `saveConfig` used `loadConfigFile()` which returns `{}` on any parse error, causing `{ ...{}, ...updates }` to write a partial config that permanently destroyed all API keys. Now reads the raw file directly and refuses to save if corrupt. `ensureConfigFile` also refuses to overwrite corrupt files.

- **Built-in provider keys removed from pi-free config** — `mistral_api_key`, `groq_api_key`, `cerebras_api_key`, `xai_api_key`, and `hf_token` are no longer in `~/.pi/free.json`. These are pi's own built-in providers; their keys come from environment variables only.

## [2.0.9] - 2026-05-08

### Added

- **Together AI provider** — Fast inference on 200+ open-source models (Llama, DeepSeek, Qwen, etc.) through an OpenAI-compatible API. $1 trial credit on signup, no credit card required. Set `TOGETHER_AI_API_KEY`.

- **Per-model metadata for Ollama Cloud** — Fetches `/api/show` details for every Ollama Cloud model to detect real capabilities: thinking/vision support, actual context windows (up to 1M tokens), and thinking level maps (`reasoning_effort`). Models now show parameter size and quantization in display names.

- **Thinking level maps** — Four curated maps (`DEFAULT`, `GPT_OSS`, `QWEN3`, `NO_OFF`) for Ollama Cloud models that map Pi's thinking levels to Ollama's `reasoning_effort` values, based on per-model API testing.

- **`/ollama-cloud-refresh` command** — Re-fetch Ollama Cloud models from the API and update the provider live, no restart needed.

- **Persistent Ollama Cloud cache** — Models cached via `provider-cache.ts` for fast startup. Stale cache auto-refreshes on `session_start`. Fallback models used when cache is unavailable.

### Fixed

- **ZenMux pricing** — Fixed `pricings` key (was reading `pricing`, always returned $0). Now correctly extracts per-model pricing (per-million-tokens ÷ 1M). Also uses `display_name`, `input_modalities` (vision detection), and `capabilities.reasoning` from API.

- **CrofAI model metadata** — Custom fetch now reads per-model `name`, `custom_reasoning`, `context_length`, `max_completion_tokens`, and per-million-token `pricing` from the API.

- **DeepInfra model metadata** — Extracts real model data from the `metadata` sub-object (context_length, max_tokens, pricing, reasoning tags). Filters non-chat models (embedding, rerank, whisper).

- **Ollama Cloud model names** — Enriched with parameter size and quantization (e.g., `deepseek-v4-pro (671B, Q4_0)`). Set `supportsDeveloperRole: false` (fixes GLM models silently ignoring prompts). Bumped `maxTokens` from 4096 to 32768.

- **SambaNova model accuracy** — `fetchOpenAICompatibleModels` now reads per-model `context_length`, `max_completion_tokens`, and `pricing` from SambaNova's extended API response. Also reads `reasoning`, `input_modalities`, and accepts plain array responses.

### Changed

- **Package scope migration** — Updated all peer dependency imports from `@mariozechner/*` to `@earendil-works/*` (`pi-ai`, `pi-coding-agent`, `pi-tui`) to match the upstream scope rename in `@earendil-works/pi` v0.74.0.

## [2.0.8] - 2026-05-07

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

### Fixed

- **Toggle commands persist across sessions for all providers** — Providers using
  `setupProvider` (zenmux, crofai, llm7, sambanova, deepinfra) were always
  registering `freeModels` on startup, ignoring the persisted `show_paid` config.
  Now each provider reads its config getter and registers the correct initial
  model set. Fixes #149.

### Security

- **Log injection prevention** — `scripts/update-benchmarks.ts` sanitizes external
  API data (CRLF stripping) before logging. Fixes SonarCloud S1075.

### Reliability

- **Prefer `String#replaceAll()` over `String#replace()`** — Replaced all 7 flagged
  instances. Where regex is unnecessary (2/7), switched to string literal form.
  Fixes SonarCloud S4144.

### Added

- **`agents.md`** — Codebase guide for AI agents covering architecture, patterns,
  conventions, testing, and the Pi extension API.

### Added

- **Passive quota monitoring** — Extracts rate-limit headers from every
  provider response via `after_provider_response` event (no extra API calls).
  Tries 6 header format variants (`x-ratelimit-remaining`,
  `ratelimit-remaining-requests-day`, etc.). Shows remaining quota in the
  status bar with warning icons when ≤25% or ≤10%. Fixes #147.

### Fixed

- **Missing `g` flag on `replaceAll` regexps broke model filtering** —
  `String.prototype.replaceAll()` requires a global RegExp; 20+ patterns in
  `benchmark-lookup.ts` were missing it, causing a `TypeError` that prevented
  models from appearing for providers like cline and kilo. Added `/g` flag to
  all affected patterns. Fixes #151.

### Changed

- **Resolved ~280 SonarCloud issues across 21 files** — Bulk code-quality
  cleanup including: stripping trailing zeros from `toFixed()` (S7748),
  `global` → `globalThis` (S7764), `parseFloat` → `Number.parseFloat` (S7773),
  naming unnamed async exports (S7726), `String.raw` for path strings (S7780),
  top-level await over promise chains (S7785), re-export from source (S7763),
  `.at(-1)` over `[length-1]` (S7755), `node:fs` protocol imports (S7772),
  and logging user-controlled data sanitization (S5145). Fixes #148.

### Security

- **Bump `basic-ftp` 5.3.0 → 5.3.1** — Patches GHSA-rpmf-866q-6p89 (high
  severity): malicious FTP server could cause client-side DoS via unbounded
  multiline control response buffering. Fixes `npm audit` finding.

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

- **CrofAI provider (PAID)** — Added new **paid** provider for CrofAI (<https://crof.ai>), an OpenAI-compatible LLM inference API. **Note: CrofAI is a paid provider** — users must have a CrofAI API key with credits. The provider uses Route B detection (name-only) since CrofAI's API doesn't expose per-model pricing. Only models with `"free"` in their names are marked as free (none currently).

- **ZenMux provider (PAID)** — Added new **paid** provider for ZenMux AI gateway (<https://zenmux.ai>), a unified API for 200+ models from OpenAI, Anthropic, Google, etc. **Note: ZenMux is a paid provider** — users must have a ZenMux API key with credits. The provider uses Route A detection (OR logic) since ZenMux exposes pricing. Models marked as free only if `cost === 0` OR `"free"` in name (2 free models identified: GLM 4.7 Flash Free, GLM 4.6v Flash Free).

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
  - Create token at <https://dash.cloudflare.com/profile/api-tokens>

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
