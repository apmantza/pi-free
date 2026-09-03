# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **pi-free now works with Bun-compiled pi binaries (scoop/winget/standalone zip)** — fixed `ResolveMessage: Cannot find module '@earendil-works/pi-ai/compat'` when pi is installed as a compiled binary (e.g. via scoop) and pi-free via `pi install npm:pi-free` (#502). Bun compile mode disables bare-specifier resolution from external files entirely, so no on-disk pi-ai layout can serve the extension — even a correctly installed pi-ai dies on its own internal bare imports (`typebox`, `openai`, …). `scripts/build.mjs` now emits self-contained esbuild bundles to `dist/vendor/` (`pi-ai-compat.js` with the four lazy API factories, `pi-ai-providers-all.js` with the builtin-catalog readers) with every transitive dependency inlined, and `lib/pi-ai-loader.ts` imports them by absolute file path as a last resort when no real pi-ai package resolves on disk. Startup stays untouched: the bundles load on first use, only when every other resolution path failed. The stray direct pi-ai imports in `providers/opencode-session.ts` and `lib/auto-fallback/classifier.ts` now route through the shared loader, and the OpenCode session stream (`importPiAiSubpath`) falls back to the vendored API factories, so `opencode-free`/`opencode-go` stream normally on Bun-binary hosts. The compat-registry safety net (`registerApiProvider`) is skipped there by design: the registry lives in the host's bundled pi-ai instance, where no compiled extension can reach it — primary dispatch goes through the provider config's own `streamSimple` and is unaffected.

## [2.7.0] - 2026-09-02

### Removed

- **Kiro provider** — removed entirely. Login never recovered reliably: the Kiro Web Portal validates `redirect_uri` against a per-IdP allowlist that rejected every loopback callback URL on the BuilderId (AWS SSO) leg with `401 "Authentication required or access denied."`, and after the redirect-allowlist fix the flow still could not be made dependable end to end. The provider directory (`providers/kiro/`, 18 modules), its 7 test files, the `docs/kiro-web-portal-auth.md` design doc, and the `scripts/test-kiro-desktop.mjs` live driver are gone, along with the `kiro` constants, the `kiro_show_paid` / `kiro_profile_arn` / `kiro_auth_method` config keys and getters, and the kiro-only dependencies (`@smithy/core`, `@smithy/types`, `cbor-x`). Existing users: any `kiro*` keys left in `~/.pi/free.json` are ignored harmlessly; the `kiro` entry in `~/.pi/agent/auth.json` becomes inert and can be deleted; `/login kiro`, `/logout kiro`, and the provider itself no longer exist.

### Added

- **Auto-fallback to another free model on error** — new `lib/auto-fallback/` module auto-switches to the next-best free model when the current one errors. **Off by default** (opt in via `/toggle-auto-fallback`, `auto_fallback: true`, or `AUTO_FALLBACK=true`) because a switch rewrites the active model choice for the session. The trigger is `agent_settled` — per Pi's contract, the point where no further automatic retry, compaction, or queued continuation will run — so pi-free never races Pi's own same-model retries; `after_provider_response` and `message_end` are observation-only. Strikes are recorded exactly once per settled run against the assistant message's own provider/model; user-initiated aborts (Esc, no 5xx) never strike (convention 15). Error-message classification delegates to pi-ai's `isRetryableAssistantError` (loaded lazily on the failure path, convention 16), complemented by HTTP-status classification: 429/402/408/425/5xx are recoverable; 400/401/403/404/422 are unrecoverable. Selection sorts free candidates by Coding Index score descending, scoped to the failing provider by default with a global fall-through, and pre-filters candidates via `modelRegistry.hasConfiguredAuth` so unconfigured (anonymous-catalog) providers are skipped. In-memory blacklist: 10-minute soft window, 3 strikes -> session ban; recovery after a clean run un-bans the failed model. Nine optional `~/.pi/free.json` fields, each with an env-var override (`AUTO_FALLBACK`, `AUTO_FALLBACK_SCOPE`, `AUTO_FALLBACK_PROVIDERS`, `AUTO_FALLBACK_BLACKLIST_TTL_MS`, `AUTO_FALLBACK_BLACKLIST_MAX`, `FALLBACK_NOTIFY`, `FALLBACK_RESTORE`, `AUTO_FALLBACK_AUTO_CONTINUE`, `AUTO_FALLBACK_AUTO_CONTINUE_MAX`). Commands: `/toggle-auto-fallback`, `/free-fallback-history`, `/reset-fallback-blacklist`. `/pi-free-health` shows an `auto_fallback` status line. **Caveat**: Pi exposes no turn-replay hook (earendil-works/pi #1248, `not_planned`), so the failed turn still shows as an error; with `auto_fallback_auto_continue: true` (default) the captured prompt is re-issued once on the new model, budget-capped at `auto_fallback_auto_continue_max` (3) consecutive replays, and any user-typed prompt cancels a pending replay. `fallback_restore` can switch back to the user's pre-fallback pick after recovery.

- **Agnes AI provider** — registered `agnes` as a native OpenAI-compatible provider against the Agnes AI gateway (`https://apihub.agnes-ai.com/v1`). Pi owns authentication, model-store persistence, refresh scheduling, and request streaming through the native provider lifecycle. The text chat catalog is fetched from `GET /v1/models`; image/video generation models are filtered out so only chat models are published. Agnes publishes a mix of free and paid chat models: per the Agnes pricing docs, the flash-class models (`agnes-2.0-flash`, `agnes-2.5-flash`) are free while the pro models (`agnes-2.5-pro`, `agnes-2.5-pro-alpha`) are billed at list price. The `/v1/models` endpoint exposes no pricing and no model id contains "free", so the adaptive Route A/B detector cannot tell them apart — the free flash models are stamped with the authoritative free flag (`_freeKnown`/`_isFree`, the same escape hatch used by the anyapi, bai, and gmi gateways) while the pro models are left unstamped so Route B classifies them as paid. The free-only view and `/free-providers` counts are correct as a result. Set `AGNES_API_KEY` or `agnes_api_key`; toggle with `/toggle-agnes`. The catalog defaults to the free-only view (`agnes_show_paid` defaults to `false`), showing the two free flash models; `/toggle-agnes` reveals the paid pro models.

- **GMI Cloud provider** — registered `gmi` as a native OpenAI-compatible provider against the GMI Cloud Inference API (`https://api.gmi-serving.com/v1`). Pi owns authentication, model-store persistence, refresh scheduling, and request streaming through the native provider lifecycle. Chat, vision, tools, and reasoning are served from one OpenAI-compatible Chat Completions endpoint across 200+ open and frontier models; the catalog is fetched from `GET /v1/models`, which exposes per-model pricing (`pricing.prompt`/`pricing.completion`) so pi-free's Route A cost-based free-detector is active. Set `GMI_API_KEY` or `gmi_api_key`; toggle with `/toggle-gmi`. GMI Cloud is a paid provider with per-token pricing, so its full catalog is shown by default (`gmi_show_paid` defaults to `true`). GMI runs time-limited "free week" promotions where specific models are free at the billing layer despite nonzero list prices — during the active window such models are stamped authoritatively free (`_freeKnown`/`_isFree`) so the free-only view and `/free-providers` counts are correct, and the stamp auto-expires when the promotion ends. The current promotion is **MiniMax Week (2026-08-24 → 2026-09-06)**: `MiniMaxAI/MiniMax-M3` and `MiniMaxAI/MiniMax-M2.7` are free.

### Fixed

- **opencode-free auth fallback** — `/login opencode-free` stores the key in `auth.json` under `opencode-free`, but `resolveApiKey()` only consulted Pi's `modelRegistry`, which does not expose the pi-free re-registered id. That caused a fallback to the literal `$OPENCODE_API_KEY` placeholder and a 401 from the OpenCode backend. The resolver now falls back to `getOpencodeApiKey()`, which reads `auth.json` directly under `opencode-free`, `opencode`, and `opencode-go`, while still respecting the repository's env-over-file precedence.

## [2.6.0] - 2026-08-21

### Removed

- **OpenModel provider** — live verification showed the gateway's entire zero-cost catalog (qwen3.5-plus, qwen3.6-flash/plus/max-preview, qwen3-max) rejects chat with `402 insufficient balance` even for accounts in good standing, so no usable free models exist. Config keys (`openmodel_api_key`, `OPENMODEL_API_KEY`) and `/toggle-openmodel` are gone; existing `openmodel` entries in `~/.pi/free.json` are ignored harmlessly.

### Changed

- **DeepInfra now defaults to the free-only model view** — it was the only public-catalog freemium provider seeded with `deepinfra_show_paid: true` (a leftover of its original trial-credit posture), so fresh installs saw the full paid catalog while Novita, SambaNova, and every other public-catalog provider defaulted to free models. The template default and the config getter's fallback are now `false`, matching the consistent free-by-default principle; an explicit `/toggle-deepinfra` choice still persists and wins.

### Added

- **Requesty provider** — new native OpenAI-compatible gateway (router.requesty.ai/v1) with a public ~670-model catalog fetched without a credential. Requesty exposes per-model pricing inline in `/models`, so the standard cost-based free detection applies: 11 free models (NVIDIA Nemotron 3 family, Poolside Laguna, Gemma 4, Leanstral, Ling) are shown by default and `/toggle-requesty` reveals the paid catalog. Capability flags (`supports_reasoning`, `supports_vision`, `context_window`, `max_output_tokens`) map straight onto model metadata; non-chat endpoints and NVIDIA content-safety classifiers are filtered out. Chat requires `REQUESTY_API_KEY` (or `requesty_api_key` in `~/.pi/free.json`).
- **OpenRouter's built-in catalog now refreshes from the live endpoint** — Pi ships a static OpenRouter catalog that only updates with a Pi release, so models added upstream stayed invisible until then. After session start, pi-free now performs one detached fetch of OpenRouter's public `GET /api/v1/models` endpoint and re-registers the captured catalog in place: known model IDs keep Pi's curated metadata, while newer models are synthesized from the endpoint's pricing, context-window, modality, and reasoning data. The refresh is deduplicated per process and never blocks startup; `/toggle-openrouter` free/paid filtering keeps working on the refreshed view.
- **pi-ai drive harness** — `npm run drive -- --provider <id> [--model <substr|exact>] [--effort <level>] [--simple] [--prompt "..."] [--anonymous] | --list` runs a realistic coding-agent turn (system prompt, thinking+toolCall history replay, tool result) through pi-ai's `streamSimple` against a model from Pi's native models store — the same code path Pi uses at runtime, so provider wire behavior can be verified without a live session. Credential resolution mirrors Pi (stored `~/.pi/agent/auth.json` credential first, then `<PROVIDER>_API_KEY`; `--anonymous` drives keyless-by-design providers); exact model ids win over substring matches; exits non-zero on error events so it doubles as an automated smoke check. Dispatches by the model's `api` (`openai-completions` vs `anthropic-messages`) and re-stamps gateway compat on restored store entries.

### Fixed

- **Deferred saved-model restore retries after the endpoint refresh lands** — the restore ran against the initially captured catalog, which can be a partial upstream list: a resume was observed where the saved `opencode-free` model was absent from the 61-model capture, the restore gave up ("keeping Pi's fallback"), and the endpoint refresh landed the full 64-model catalog two seconds later — leaving the session stuck on Pi's fallback despite the model being available. The refresh is now scheduled before the restore, and a not-found lookup waits for that in-flight refresh once and retries before giving up.

- **Deferred saved-model restore now explains its decisions in the log** — the restore's early-return paths (no saved model for this provider, or the persisted choice no longer present in the captured catalog) were completely silent, which is why the fallback-poisoned-resume bug (#460) required session-file forensics to diagnose. The no-saved-model path logs debug with the context provider/model id; a persisted model missing from the registered catalog now logs a warning naming the model and stating that Pi's fallback stays active.

- **Built-in-toggle providers restore correctly on session resume even when Pi's fallback poisoned the session context** — Pi's startup fallback ("Could not restore model opencode-free/… Using …") appends a `model_change` entry for the fallback model, so the deferred saved-model restore read the *fallback* from `buildSessionContext().model` and silently skipped the re-select, leaving every resume stuck on the fallback model. The restore now also reads the raw `model_change` trail via `sessionManager.getEntries()`: a trailing change naming another provider is treated as Pi's fallback only when it was stamped during the current run (the TUI cannot be interactive yet at capture time); a trailing change from a previous run remains a deliberate user switch and is honored.
- **Log writes lost to stream teardown now recover or count, instead of vanishing** — the persistent log file stream discarded any write still in flight when rotation ended it or shutdown destroyed it. The write's own callback fired with an error, but the code ignored it and dropped the line with no record — the source of the recurring `ERR_STREAM_DESTROYED` failures seen in pi-lens's monitoring ([pi-lens#1970](https://github.com/apmantza/pi-lens/issues/1970)). A lost write now retries once through the existing synchronous append fallback; a write that fails even after the retry is counted in a bounded, process-lifetime tally readable via `getLogWriteFailures()` and surfaced on `/pi-free-health` as `Log write failures: N (sink: ...; last: ...)`, which also flips health to WARN ([#456](https://github.com/apmantza/pi-free/issues/456)).
- **Gateway providers no longer send the OpenAI `developer` role to upstreams that reject it** — pi-ai defaults unknown providers to the `developer` system-role convention for reasoning models, and aggregating gateways forward it verbatim to upstreams like Qwen that reject it (reproduced live: TokenRouter answers a wrapped `422 openai_error / bad_response_status_code`, ZenMux `400: developer is not one of ['system'...]`). Generalized beyond the TokenRouter normalizer: every OpenAI-compatible model pi-free publishes now stamps `compat.supportsDeveloperRole: false` at its conversion point (`withGatewayCompat`, applied by all native OpenAI providers plus Kilo, Cline, LLM7, Ollama Cloud, and ZenMux), and models restored from Pi's store are re-stamped so pre-fix entries are covered during the offline window before the next refresh. This replaces the ad-hoc per-provider flags (Kilo compat, Ollama, DeepSeek/Kimi proxy compat) with one default; `system` is universally accepted.
- **TokenRouter no longer sends the OpenAI `developer` role to upstreams that reject it** — pi-ai defaults unknown providers to the `developer` system-role convention, and TokenRouter forwarded it verbatim to upstreams like Qwen, which answer every request with a wrapped `422 openai_error / bad_response_status_code` (reproduced deterministically: 5/5 failures with `developer`, 0/8 with `system`). The request normalizer now rewrites developer-role messages to `system` at the wire boundary.
- **TokenRouter requests work again across all reasoning models** — pi-ai's auto-detected compat defaults marked every non-DeepSeek/Kimi model as accepting `reasoning_effort`, so reasoning models were sent effort values derived from models.dev thinking maps (e.g. `"none"`) that TokenRouter's chat route rejects with `400: reasoning_effort must be low, medium, or xhigh`. All wire quirks now live in a single request normalizer at one boundary: `reasoning_split: true` is always requested (clean thinking/content separation), MiniMax-M3's `thinking` object is rewritten to `{ type: "adaptive" }`, and invalid `reasoning_effort` values are mapped onto the accepted set (`minimal → low`, `high → xhigh`) or dropped (`none`). Inline `<think>…</think>` tags in assistant text are extracted into proper thinking blocks on message end.
- **Kilo requests now carry honest client identity headers** — catalog requests stamped VS Code-spoofing headers (`X-VSCode-...`, a fake `User-Agent`) inherited from an early port. They are replaced with truthful `X-KILOCODE-EDITORNAME: Pi` / `User-Agent: pi-free-providers` headers on both live fetches and models restored from Pi's store. Genuine Kilo CLI identity remains tracked in [#449](https://github.com/apmantza/pi-free/issues/449).
- **Ollama Cloud's free/all toggle now survives a restart** — the provider registers under the id `ollama-cloud`, but its `/toggle-ollama-cloud` command persisted to the derived key `ollama-cloud_show_paid` while every read used `ollama_show_paid`, so the toggled view was lost on the next session. The native toggle now accepts an explicit config key and Ollama persists to `ollama_show_paid` to match its getter.
- **The OpenCode free/go built-in toggles now persist under keys their getters actually read** — `/toggle-opencode-free` and `/toggle-opencode-go` registered under dashed ids (`opencode-free`, `opencode-go`) but persisted to derived keys with those dashes (`opencode-free_show_paid`), while boot read the shared `opencode_show_paid` — so neither tier's toggled view survived a restart, and both tiers clobbered one shared flag. Each tier now persists and reads its own snake_case key (`opencode_free_show_paid`, `opencode_go_show_paid`, env `OPENCODE_FREE_SHOW_PAID` / `OPENCODE_GO_SHOW_PAID`), and the generic toggle-state helper accepts an explicit config key for id/key divergence. Pre-fix toggle choices were never readable and are not migrated; re-run `/toggle-opencode-free` or `/toggle-opencode-go` once — the choice now sticks.
- **DeepInfra's free/all toggle is now persisted instead of always resetting to the paid view** — the native provider seeded an in-memory `initialShowPaid: true` override that shadowed the config getter on every boot, so a persisted free toggle was silently lost on restart. The in-session override now starts unset (the config getter is authoritative on startup) and only takes over while the toggle is running; DeepInfra's paid-by-default is expressed in the config getter itself, so a deliberately toggled free view is respected across sessions. **Upgrade note:** installs seeded by the old config template carry `deepinfra_show_paid: false`, which the old override always discarded — after upgrading, those installs now boot to the free-only view. Run `/toggle-deepinfra` once to restore the all-models view; the choice then persists.
- **Ollama Cloud free-model classification survives store restore** — models restored from Pi's models store were classified by name alone instead of the adaptive pricing-aware detection, so paid models could leak into the free view after a restart. Restore and fetch callbacks now reclassify through the shared `isFreeModel`. A degenerate empty fetch also no longer overwrites the cached catalog (cache-poisoning guard).
- **Silent catch blocks in Cline catalog fetches and Ollama probe refreshes now log warnings** to `~/.pi/free.log` instead of swallowing errors.
- **Git installs no longer vendor two unused host-provided packages** — `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` were declared as required peer dependencies, so `npm install --omit=dev` (the `pi install git:...` path) auto-installed both plus their own dependency trees — about 140 extra packages (`@aws-sdk/client-bedrock-runtime`, `@google/genai`, `openai`, `chalk`, `diff`, `glob`, and more) that the compiled extension never imports: pi-coding-agent is `import type`-only everywhere in pi-free's source, and pi-tui is not referenced at all. Both are now optional peers (`peerDependenciesMeta.optional`), cutting a clean git install from 233 to 90 packages and roughly halving install time (28s → 12s measured locally). `@earendil-works/pi-ai` stays a required peer — it's a real, static value import in ~30 provider files — so its own dependency `typebox` still installs; removing that would need those imports migrated to the disk-fallback resolver `lib/pi-ai-loader.ts` already uses for `lib/lazy-compat.ts`, tracked separately in [#447](https://github.com/apmantza/pi-free/issues/447).
- **Resumed sessions get their saved built-in-toggle model back** — Pi resolves a resumed session's model *before* extension provider registrations take effect (`createAgentSession` restores from the session file; `pi.registerProvider` calls made during extension load are queued and only flush when the runner binds afterwards), so a session saved with a built-in-toggle provider (e.g. `opencode-free/deepseek-v4-flash-free`) always fell back to another model with a "Could not restore model" warning — even though the detached capture re-registered that exact model seconds later, and the fallback then stuck for the whole session. After the capture applies the catalog view, pi-free now re-reads the session's persisted model (`buildSessionContext().model`, so a deliberate mid-startup model switch is never clobbered) and re-selects it via `pi.setModel` when it is present in the registered view. The warning line itself is printed by Pi core before any extension code can run and still appears; what changes is that the correct model is restored automatically instead of the fallback sticking.
- **pi-ai compat now loads under Node-build pi installs where the extension tree and the host share nothing** ([#448](https://github.com/apmantza/pi-free/issues/448)) — on e.g. a pnpm global pi install with pi-free in `~/.pi/agent/npm`, every disk fallback of `lib/pi-ai-loader.ts` missed: no walk-up from pi-free reaches the host tree, the Node executable is a plain `node`, and the `%APPDATA%` probe is Windows-only, so the first model stream failed with `Cannot find package '@earendil-works/pi-ai'`. The loader now additionally resolves pi-ai relative to the running pi host's entry script (`process.argv[1]`, realpath-resolved so symlinked bin shims land in the real package tree — which also covers pnpm's virtual-store layout, where pi-ai sits as a sibling of the real agent package).
- **pi-ai disk-fallback resolution validates what it finds** — hardening from an adversarial review of the #448 fix: every fallback probe (walk-up, host entry script, home/APPDATA/executable roots) now rejects directories whose package.json does not name `@earendil-works/pi-ai` at or above the 0.81.0 peer floor, and relative `process.argv[1]` values are ignored outright so a compiled-binary host exposing a user argument as argv[1] can never pull an arbitrary project-local pi-ai copy. Failed resolutions are no longer cached for the process lifetime, matching lazy-compat's transient-error policy.

### Changed

- **TokenRouter is a clean native provider with no custom stream wrappers** — the 2064 high-load retry stream wrapper (a lazy compat bridge re-pipelining every event through a buffering shell) is removed; streaming goes straight through pi-ai's standard openai-completions implementation like every other OpenAI-compatible native provider. Trade-off: upstream 2064 "server cluster under high load" errors now surface immediately instead of being retried once after a 30s backoff.
- **Shared native-refresh skeleton** — the duplicated restore → gate → fetch → persist control flow in six provider modules (kilo, cline, llm7, zenmux, openmodel, qoder) is consolidated into one `refreshNativeProviderModels()` helper in `lib/native-provider.ts`; providers now supply only their fetch callback and free-split hook.
- **Removed dead legacy registration helpers** — `registerOpenAICompatible`, `createReRegister`, `setupProvider`, and related types were removed from `provider-helper.ts` along with their obsolete test; all providers use the native lifecycle.
- **Extension reload guard keyed on runner identity** — `index.ts` guards its global handlers against double-registration using the runner instance instead of a boolean, matching the pattern used elsewhere, so extension reloads rebind correctly.
- **Saved-model restore for already-captured built-in providers runs detached** — when a session-start event finds a provider already captured, the saved-model restore no longer blocks the handler.

## [2.5.1] - 2026-08-16

### Fixed

- **OpenCode free tier no longer rate-limited by Pi's third-party client identity** — Pi's runtime stamps every opencode/opencode-go request with its own attribution identity (`x-opencode-client: pi` + a UUID session, `provider-attribution.js`), which OpenCode's backend treats as a foreign client and drops to the fallback rate limit (`FreeUsageLimitError`, 429) — while the same models work in the real opencode app. pi-free's fixes never reached the wire because Pi registers a built-in `opencode` provider, so the built-in-toggle capture was skipped, our stream wrapper (the only place CLI-faithful headers are injected) never ran, and Pi strips `model.headers` before dispatch. The free tier is now registered under the distinct id **`opencode-free`** (`captureFrom: "opencode"` captures Pi's built-in catalog but re-registers it under the new id): Pi has no built-in provider with that id, so OUR provider — with the CLI identity (`x-opencode-client: cli`, `ses_`/`prt_` ULIDs, `opencode/1.18.18`) and the header wrapper — is the one Pi dispatches through, and the attribution merge lets our model headers override its stamp. The toggle command is now `/toggle-opencode-free` ([#441](https://github.com/apmantza/pi-free/issues/441)).

- **OpenCode wire headers aligned with the current CLI (v1.18.18)** — reverse-engineered from `packages/opencode/src/session/llm/request.ts`: `User-Agent` bumped `1.15.5 → 1.18.18`, `x-opencode-request` now uses the CLI's `prt_` PartID prefix (was `msg_`), `x-opencode-project` is now sent (was missing), and the session/request ULIDs replicate the CLI's `descending()`/`ascending()` encoding exactly. This keeps pi-free speaking the official CLI wire dialect (forward-compat if the Zen backend's `checkHeaders` gate is re-enabled); note the deployed gate is currently disabled, so today's free-tier freeze is IP-based, not header-based ([#440](https://github.com/apmantza/pi-free/issues/440)).

### Added

- **Refresh/abort outcome accounting** — every native `refreshModels` path now records per-provider outcomes into the startup-timing `cacheNetwork` map: aborts (cancelled via `context.signal` — counted, never logged as errors, per convention #15), empty-retains (fetch returned 0 models and the previous list was kept), refresh-oks with the published model count, and store restores with the entry's `checkedAt` age. `/free-startup` surfaces a `Native refresh flags` section (aborts, empty-retains, store age > 24h) plus a per-provider native outcome line, and `/pi-free-health` adds the same flags plus an `Empty catalogs` section that distinguishes a completed refresh that published 0 models from a refresh that never ran — the exact shape of the silent 0-model registration incident ([#437](https://github.com/apmantza/pi-free/issues/437)).
- **Structured failure classification** — telemetry entries now carry `statusCode` and a derived `errorClass` (`401`/`403`/`429`/`5xx`/`network`/`other`) alongside the existing free-form `errorMessage`, so a Cline `workos:` 401 vs a 403-vs-headers bug vs a gateway 5xx are distinguishable. `after_provider_response` status feeds per-provider auth-failure (401/403), rate-limit (429), and server-error (5xx) counters in the quota monitor, aggregated into `/pi-free-health` (`Response issues`) and `/free-telemetry` (`Failures by class`) — status codes only, never response bodies ([#437](https://github.com/apmantza/pi-free/issues/437)).
- **Wire-signature logging** — `before_agent_start` now debug-logs the request contract (`provider`, `model`, `api`, `baseUrl`, `headerNames`) so a header that failed to reach the wire leaves a trace. **Redaction rule: header NAMES only, never values** — an Authorization/apiKey/token value in this line would leak credentials into the shared `~/.pi/free.log` (see convention #17). Debug-only, so normal runs don't spam the log ([#437](https://github.com/apmantza/pi-free/issues/437)).
- **Stale store and silent normalization warnings** — `restoreNativeProviderModels` warns once per provider when the restored store entry is older than 7 days, and Cline warns once per refresh when ≥1 model was normalized from the retired `cline-xml-tools` api to `openai-completions` ([#437](https://github.com/apmantza/pi-free/issues/437)).
- **Quota header-format drift detection** — when a response carries rate-limit headers but none match a known pair, the quota monitor bumps a per-provider `quotaHeaderDrift` counter and debug-logs the present header names, surfacing the format drift that used to be silent ([#437](https://github.com/apmantza/pi-free/issues/437)).

## [2.5.0] - 2026-08-15

### Changed

- **Log lines now carry the process id** — `~/.pi/free.log` is shared by every pi process on the machine; concurrent sessions interleaved into one unreadable stream. Every line is now prefixed `[pid N]` so sessions are separable ([#429](https://github.com/apmantza/pi-free/issues/429)).

- **Cline migrated from the custom XML bridge to the standard OpenAI API** — Cline's endpoint (`https://api.cline.bot/api/v1/chat/completions`) now speaks vanilla OpenAI Chat Completions, so Cline models use the standard `openai-completions` wire api and stream through pi-ai's OpenAI implementation via the lazy compat bridge (`lib/lazy-compat.ts`) — the 1969-line `cline-xml-bridge.ts` message/tool reshaper, its 1487-line test suite, the live `smoke:cline` script, and the `cline-xml-tools` compat-API fallback registration are all deleted. The `workos:` bearer prefix, the Cline identity headers, and the rotating `X-Task-ID` are preserved: the headers live on a single shared mutable record (`providers/cline/cline-headers.ts`) that is stamped on every Cline model — pi-ai merges only the model's `headers` into requests — so `before_agent_start` rotation keeps working without re-registration. Models still sitting in users' model stores with the retired `cline-xml-tools` api are normalized to `openai-completions` + the Cline baseUrl on every store restore (both the Pi 0.84+ `context.stored` snapshot and the legacy `context.store` path) until the next network refresh rewrites the store. Anonymous public-catalog auth resolution, OAuth login/refresh, `/toggle-cline`, and `/toggle-free` interop are unchanged ([#433](https://github.com/apmantza/pi-free/issues/433)).

- **Lazy pi-ai compat loading removes ~2s from Pi boot** — `@earendil-works/pi-ai/compat` costs ~1.3–1.7s of module-load time and was eagerly value-imported at all seven native provider construction sites (`openAICompletionsApi`/`anthropicMessagesApi`) plus Pi's built-in catalog (`getBuiltinModels`) in the models.dev enrichment fallback. A new `lib/lazy-compat.ts` bridge keeps the sync `stream`/`streamSimple` Provider contract by returning the local compat-free stream shell immediately and piping the real compat stream into it once a single-flight dynamic compat import resolves, with import/call failures surfacing as proper stream error events; the built-in catalog import is likewise deferred to first fallback use, and Cline's legacy compat-API registration now happens on the first Cline agent start instead of at factory time. Boot no longer loads compat at all: dist entry import drops from ~2.2s to ~80ms ([#423](https://github.com/apmantza/pi-free/issues/423)).

### Fixed

- **Cline free list no longer zero-prices paid dated model variants** — the free-to-try matcher fuzzy-aliased catalog ids by stripping date suffixes, so `deepseek/deepseek-v4-flash-0731` inherited free pricing from `deepseek/deepseek-v4-flash` while the API actually bills it (402 insufficient credits at request time). Matching is now exact against Cline's authoritative `recommended-models` free list — both endpoints use provider-qualified ids, so the aliasing bought nothing and cost broken free models ([#431](https://github.com/apmantza/pi-free/issues/431)).

- **Built-in provider toggles no longer block session start** — the first catalog capture for OpenCode / OpenCode Go / OpenRouter (credential resolution can take seconds; observed 2.25s blocking a session resume) now runs detached and is reported under `Detached session_start work` in `/free-startup`. Duplicate `session_start` events reuse the in-flight capture instead of racing a second one; until capture completes the provider shows Pi's unfiltered built-in catalog, and `/toggle-{provider}` still retries capture on demand ([#427](https://github.com/apmantza/pi-free/issues/427)).

- **Public catalogs now populate without a configured API key** — Pi's `MutableModels.refresh()` gates every provider's `refreshModels()` behind auth resolution, so providers whose `apiKey.resolve()` returned `undefined` registered 0 models when no credential was configured. Providers with a public model catalog (Kilo, ZenMux, CrofAI, DeepInfra, Novita, Routeway, SambaNova, OpenModel) now resolve a truthy keyless result (`public catalog (no account)`) when no stored credential or ambient key exists — via a new opt-in `anonymousCatalog` option on the shared `createNativeApiKeyAuth` factory plus the same fallback in Kilo's and ZenMux's custom auth — and enable `allowUnauthenticated` refresh. Catalog fetches omit the `Authorization` header entirely when the key is empty (an empty `Bearer` header can be rejected by gateways that would otherwise serve the endpoint anonymously), and OpenModel's no-token refresh uses the public paginated `/web/v1/models` catalog while configured users keep the authenticated `/v1/models` protocol list. Chat still requires a real key (gateway 401), probe commands still only fire with a configured key, and auth-required catalogs (StepFun, TokenRouter, AnyAPI, B.AI, OpenGateway) are unchanged ([#421](https://github.com/apmantza/pi-free/issues/421)).

- **Startup timing now measures the real boot cost** — the startup clock previously started at the top of `piFreeEntry`, after the entire static module graph (18 provider imports) had already executed, so `/free-startup` and the log reported 7–20ms while pi-free actually added ~2s to Pi boot. The origin is now a module-scope `performance.now()` capture in `lib/startup-timing.ts` — imported first in `index.ts`, so it runs before every provider module — and `totalMs` includes module-graph evaluation. A new `moduleGraphMs` field and a header note in `/free-startup` make the origin explicit ([#424](https://github.com/apmantza/pi-free/issues/424)).

- **Startup log line survives Pi's hard exit** — Pi's main.js calls `process.exit(0)` right after extension startup, which dropped the logger's buffered async WriteStream writes and made the `[pi-free] startup complete` line vanish from `~/.pi/free.log`. A new `flushLogsSync()` recovers still-buffered lines (tracked via per-write callbacks), destroys the stream, and appends everything with `appendFileSync` (honoring the rotation size limit), switching subsequent logging to the synchronous path; `piFreeEntry` calls it right after `logStartupSummary()` ([#424](https://github.com/apmantza/pi-free/issues/424)).

## [2.4.6] - 2026-08-07

### Fixed

- **Abort errors no longer surface as visible failures across all providers** — Pi 0.84+ aborts superseded model refreshes, and `AbortError`/`"This operation was aborted"` is cancellation, not a provider failure. Every provider fetch `catch` block now guards `signal?.aborted` before logging, so expected aborts are silently swallowed instead of surfacing as visible `ERROR` notifications (routeway, openmodel, novita, bai, plus the central native-provider refresh path). A genuine (non-aborted) fetch failure is still logged ([#419](https://github.com/apmantza/pi-free/issues/419), [#420](https://github.com/apmantza/pi-free/pull/420)).

## [2.4.5] - 2026-08-06

### Fixed

- **Pi 0.84 model refresh lifecycle** — Native `refreshModels` now restores from Pi 0.84+'s immutable `context.stored` snapshot and publishes `{ persist, update }` through the generation-checked `context.publish` API, while retaining a `context.store` fallback for Pi <=0.83. Superseded refresh generations can no longer overwrite a newer provider catalog ([#417](https://github.com/apmantza/pi-free/pull/417)).
- **Session-start refresh abort storm** — A single shared session-start refresh nudge (keyed by the Pi instance) replaces one nudge per native provider registration. On Pi 0.84 — which aborts an in-flight refresh for each provider when a newer refresh starts — the per-provider handlers were aborting every provider's catalog fetch in a tight loop on session resume ([#417](https://github.com/apmantza/pi-free/pull/417)).
- **Stale catalog ingestion race** — Six native providers (Kilo, Cline, LLM7, ZenMux, OpenModel, Qoder) no longer mutate their shared catalog state before Pi accepts the generation-safe publication; ingestion now runs inside the `publish` callback only when the refresh generation is still current ([#417](https://github.com/apmantza/pi-free/pull/417)).
- **Abort suppression narrowed** — `AbortError` is now only swallowed when the provided request signal is actually aborted, so real provider fetch failures are no longer hidden behind a cancelled-signal heuristic ([#417](https://github.com/apmantza/pi-free/pull/417)).
- **Native auth abort-signal compatibility** — Native `apiKey.resolve` now accepts Pi 0.84's optional `signal` argument across all native providers ([#417](https://github.com/apmantza/pi-free/pull/417)).

### Changed

- **Security dependency updates** — Bumped the `brace-expansion` override to `^5.0.9` (high-severity ReDoS) and resolved the lockfile to Pi `0.84.0`, which brings `undici@8.9.0` (moderate-severity vulnerability). `npm audit` now reports zero vulnerabilities ([#417](https://github.com/apmantza/pi-free/pull/417)).

## [2.4.4] - 2026-08-05

### Fixed

- **OpenCode v1 API endpoint normalization** — Persisted OpenCode and OpenCode Go catalogs now normalize every model to OpenCode's current `/v1` gateway paths on re-registration, so stale Anthropic URLs like `/zen/messages` stop resolving to the website's HTML 404 page. Per-model base URLs are preserved when built-in provider toggles re-register models ([#415](https://github.com/apmantza/pi-free/pull/415)).

### Changed

- **Quiet automatic provider notices** — Routine free-model terms notices are now recorded through pi-free's structured logger instead of being sent to Pi's terminal UI; explicit command results and authentication prompts remain visible.

## [2.4.3] - 2026-08-04

### Fixed

- **Cline custom API registration** — Register the `cline-xml-tools` compatibility API so Pi's default agent stream path reaches the existing XML bridge instead of failing with `No API provider registered for api: cline-xml-tools` ([#409](https://github.com/apmantza/pi-free/issues/409), [#410](https://github.com/apmantza/pi-free/pull/410)).

## [2.4.2] - 2026-08-03

### Fixed

- **Pi extension-loader compatibility** — Native provider API factories now import through Pi's allowlisted `@earendil-works/pi-ai/compat` entrypoint instead of inaccessible `pi-ai/api/*` subpaths. This fixes extension startup failures on Pi 0.83.x where no pi-free providers registered (#397, #398, #399).

### Changed

- **Loader-boundary CI validation** — Added compiled-runtime import-policy checks and Pi loader smoke tests so unsupported extension imports fail before release.

## [2.4.1] - 2026-08-02

### Fixed

- **OpenCode built-in model toggles** — Free OpenCode models are now captured from Pi's full catalog, re-registered through the current session registry, and made available when the shared credential is stored under `opencode-go` (#393, #395).

## [2.4.0] - 2026-08-02

### Added

- **StepFun native provider** — Added the paid StepFun Step Plan provider using Pi's native model store and refresh lifecycle. Chat requests use the OpenAI-compatible endpoint at `https://api.stepfun.ai/step_plan/v1/chat/completions`; `STEPFUN_API_KEY` and `stepfun_api_key` are supported, and paid models are shown by default.

### Changed

- **Qoder native lifecycle** — Migrated Qoder to Pi's native Provider/ProviderAuth and models-store lifecycle while preserving its OAuth/PAT exchange, COSY signing, static catalog, custom stream, and basic/all filtering. Its legacy cache is now limited to optional stream metadata.
- **Bounded non-blocking logs** — Added asynchronous size-based rotation for `free.log` (10 MiB default, three backups) without synchronous rotation or startup blocking; `PI_FREE_LOG_MAX_BYTES` controls the threshold.
- **Compiled startup graph** — Removed startup-only Pi credential inspection and deferred the broad pi-ai compatibility graph. Controlled compiled import-inclusive benchmarks improved from roughly **1.14s to 0.43s p50**, total from **1.18s to 0.47s p50**, and the measured import graph from **904 to 226 modules**. These figures measure the extension benchmark, not a full Pi-host A/B result.

- **Cline native tool-call compatibility** — The custom Cline bridge now advertises the current OpenAI-compatible tool schema and parses streamed `delta.tool_calls` alongside the existing XML and `<function=...>` fallbacks. This prevents reasoning-capable models from stopping after planning text when their actual tool call arrives in the native stream format.
- **Telemetry latency uses a monotonic clock** — `startModelCall`/`recordModelCall` now measure elapsed latency with `performance.now()` instead of `Date.now()`, matching the startup-timing module. Wall-clock skew from NTP adjustments or system suspend can no longer corrupt recorded per-call latency; `Date.now()` is retained only for the stored entry timestamp. The 10-minute implausible-latency guard remains as a sanity backstop.
- **Telemetry disk writes are debounced** — `recordModelCall` no longer performs one synchronous `writeFileSync` of the whole telemetry store on every `turn_end`. The JSON store (`lib/json-persistence.ts`) gained an optional `debounceMs` (telemetry uses 1500ms) that updates the in-memory cache immediately — so `/free-telemetry` always shows current data — while coalescing the disk flush into a single write once the burst settles. `clearTelemetry` flushes immediately so the explicit `/clear-free-telemetry` action is durable. Removes the per-turn event-loop block from chatty sessions; probe-cache and config keep synchronous writes.
- **Benchmark debug logging routed through the structured logger** — Coding Index match diagnostics (`PI_FREE_BENCHMARK_DEBUG=1`) now flow through `createLogger("benchmark-lookup")` to `~/.pi/free.log` via the buffered async stream, instead of a parallel `appendFileSync`-based pipe-delimited `~/.pi/modelmatch.log`. Eliminates the per-model synchronous file writes when debug logging is enabled and consolidates diagnostics into the single extension log. The unused `getMatchingStats`/`getMatchLogPath`/`clearMatchLog` helpers were removed.
- **Compiled startup entry** — npm and Pi now load the generated `dist/index.js` entry, with peer dependencies externalized and build-time packaging checks covering Git installs and tarballs.

## [2.3.0] - 2026-08-01

### Added

- **Startup observability** — New `lib/startup-timing.ts` times the phases of `piFreeEntry` and each provider's setup duration (monotonic `performance.now()`, best-effort, negligible overhead). A structured summary (total entry time, per-provider timings slowest-first, cache-vs-network counts, failures) is logged once at the end of startup and surfaced via the new `/free-startup` command.
- **Session-start observability** — `/free-startup` now includes monotonic session-start handler timings and intentionally detached work that completes after startup finalization, without turning background refreshes or probes into blocking handlers. A synchronous session-start window keeps repeated Pi sessions from accumulating stale metrics.
- **Health diagnostics** — Added `/pi-free-health`, a credential-free report showing provider registration status, startup/session failures, network failures, and the configured `free.log` path for troubleshooting.
- **Startup benchmark script** — `scripts/bench-startup.ts` times the `piFreeEntry` factory (the exact work Pi awaits) under warm-cache, cold-cache, and network-degraded conditions in a sandboxed `HOME` with a mocked `fetch`, so startup regressions can be measured rather than guessed. Run with `npx tsx scripts/bench-startup.ts <warm|cold|fastcold>`.
- **Startup bench: native offline-init metric** — `scripts/bench-startup.ts` now understands the native `registerProvider(provider)` object form and, after timing the factory, seeds an in-memory models store (Pi's real one lives at `~/.pi/agent/models-store.json`) and drives Kilo's `refreshModels(allowNetwork:false)` to prove offline init populates the catalog with zero network. The `RESULT` line gains `kiloFactoryNetworkCalls`, `kiloOfflineInitMs`, and `kiloOfflineModels`.
- **Startup bench: Cline offline-init metric** — `scripts/bench-startup.ts` now seeds and exercises Cline's native offline-init path the same way (custom `cline-xml-tools` wire api). The `RESULT` line gains `clineFactoryNetworkCalls`, `clineOfflineInitMs`, and `clineOfflineModels`.
- **OpenGateway provider** — Added Gitlawb OpenGateway as a native OpenAI-compatible provider at `https://opengateway.gitlawb.com/v1`. It uses `OPENGATEWAY_API_KEY`, refreshes the gateway's live catalog through Pi's native model lifecycle, includes `auto` smart routing and current promotional/free models, and exposes `/toggle-opengateway` for switching between free-only and all models.

### Changed

- **Kilo native provider migration** — Kilo now registers as a native pi-ai `Provider` (the `createProvider` object form, via the single-argument `registerProvider(provider)`) with native `auth` (API key + OAuth device flow, persisted to `~/.pi/agent/auth.json` with token refresh owned by Pi) and `refreshModels(context)`. The extension factory no longer awaits any Kilo network I/O: models load via offline init from Pi's models store and a Pi-owned background refresh (4h throttle, abortable), so Kilo's cold-startup factory contribution drops from ~8.0s to ~33ms (bench-measured) and Kilo makes zero factory network calls. The free/paid toggle stays on `registerWithGlobalToggle` re-registration — it republishes the same native provider, so `/toggle-kilo` and `/toggle-free` keep working and native auth is preserved; the XML tool-leak handler, CI-score decoration, and Kilo compat overrides are unchanged. Kilo stops using `lib/provider-cache.ts` (the module remains for the other providers), and existing OAuth credentials are reused from `auth.json` with no destructive migration (re-login is the recovery path for malformed old credentials).
- **Cline native provider migration** — Cline now registers as a native pi-ai `Provider` (the `createProvider` object form, via the single-argument `registerProvider(provider)`), the second port of the proven Kilo pattern. Native `auth` (API key + the existing OAuth callback-server flow, adapted to Pi's `AuthInteraction` exactly as Pi's own legacy-OAuth adapter did) persists to `~/.pi/agent/auth.json` — the same store the legacy `/login cline` already wrote, so existing credentials work with no migration — with token refresh now owned by Pi. The extension factory no longer awaits any Cline network I/O: models load via offline init from Pi's models store plus a Pi-owned background refresh of Cline's public catalog, so Cline makes zero factory network calls (bench: warm factory ~44–63ms → ~37–47ms; cold/fastcold factory fetch counts drop by Cline's two catalog URLs) and offline init measures ~0.3ms. Cline-specific: its model catalog is public, so the apiKey auth resolves even when unconfigured (Pi's sanctioned keyless pattern, per the pi-ai `faux` provider) and intentionally has no `check()` — Pi's availability check runs before filtering and would hide the public catalog before `/login cline`. The XML bridge message reshaping is carried over verbatim: both `stream` and `streamSimple` dispatch to `streamClineXml` with per-request VS Code-spoofing headers (the `X-Task-ID` still rotates on `before_agent_start`, now without a re-registration). `/toggle-cline` and `/toggle-free` keep working via `registerWithGlobalToggle` re-registration of the same native provider; CI-score decoration is unchanged. Cline stops using `lib/provider-cache.ts` (the module remains for other providers; old `cline` entries in users' `provider-cache.json` become orphans), and the hand-rolled session-start cache refresh is replaced by Pi's throttled background refresh (the freshness window widens from 1h to Pi's 4h throttle, traded for unified store ownership).
- **Pi peer dependency minimum** — bumped the `@earendil-works/pi-*` peerDependencies from `>=0.80.8` to `>=0.81.0`, the first release that exposes the native `createProvider` / `registerProvider(provider)` extension surface publicly (verified: 0.80.10 lacks the overload, 0.83.0 has it). The range stays permissive (no upper bound) and the lockfile now resolves the peers to 0.83.0.
- **Non-blocking file logging** — the structured logger (`lib/logger.ts`) now writes through a lazily-opened buffered append stream and ensures the log directory once, instead of a synchronous `appendFileSync` plus a directory check on every line. Removes ~15–20ms of synchronous disk I/O from warm startup (logging now adds ~0ms to the factory); log format, destination, and levels are unchanged, with a synchronous fallback if streams are unavailable.
- **Startup fetch accounting** — legacy and dynamic model-fetch attempts now record per-provider cache/network attribution, elapsed wait time, and failures even when the startup deadline or provider API rejects. Cache persistence is no longer misreported as a network fetch.
- **Remaining providers migrated to native registration** — All remaining pi-free providers now register through Pi's native provider surface. LLM7, ZenMux, TokenRouter, Ollama Cloud, B.AI, CrofAI, AnyAPI, SambaNova, Novita, DeepInfra, Routeway, and OpenModel join Kilo and Cline as native pi-ai `Provider` objects: the extension factory performs no catalog network I/O on startup, credentials and catalogs persist to Pi's stores, and `refreshModels(context)` handles offline init, abort, and the empty-result poisoning guard via shared lifecycle helpers (`registerNativeOpenAIProvider`, registrar/store-restore extraction). LLM7 and OpenModel keep keyless public catalogs (the pi-ai `faux` pattern); Ollama Cloud retains `/api/show` capability discovery, its provider-cache reuse, `/probe-ollama`, and auto-hide; TokenRouter preserves its custom streaming api, MiniMax thinking payload patching, high-load retry, and `<think>` normalization; OpenModel keeps its Anthropic Messages wire format and public-pricing-plus-authenticated-protocol merge; DeepInfra, RouteWay, SambaNova, and Novita probes now share a common OpenAI probe helper.
- **Native free-model filtering capstone** — Native providers now expose their complete catalog from `getModels()`, with Pi applying the free/paid policy through each provider's native `filterModels` (`getShowPaid`), so catalog refreshes can never clobber the selected free/all view. Per-provider and global toggles re-register the same provider object only to invalidate Pi's availability snapshot, completing the native-provider migration across all extension providers.
- **OpenCode free-model preservation and protocol routing** — pi-free now preserves Pi's authoritative free-model metadata and per-model protocol routing for OpenCode discovery. `big-pickle` stays in the free-only view even though `/models` omits pricing and the ID lacks a `-free` suffix; GPT, Claude/Qwen, Gemini, and chat-completions models are routed through the matching pi-ai adapters (`openai-responses`, `anthropic-messages`, `google-generative-ai`, `openai-completions`); warm/stale cached catalogs get the same normalization as fresh discovery; and OpenCode probes reuse the CLI-compatible session/request headers the stream wrapper sends (per Pi issue #2824).

### Removed

- **Together AI provider** — Retired pi-free's `together` provider (including its `/probe-together` command). Pi 0.83 ships a built-in `together` provider, and because `pi.registerProvider()` with a built-in ID silently overrides the built-in, pi-free's registration was an accidental hard collision: setting pi-free's `TOGETHER_AI_API_KEY` silently replaced Pi's native Together catalog. Migrate to Pi's built-in provider by setting `TOGETHER_API_KEY` instead (note the renamed variable).
- **Dynamic fetchers for Mistral, Groq, Cerebras, xAI, and Hugging Face** — Retired the five `providers/dynamic-built-in` fetchers (and their `/toggle-mistral`, `/toggle-groq`, `/toggle-cerebras`, `/toggle-xai`, `/toggle-huggingface` commands). Pi now ships these as native built-in providers keyed on the identical env vars (`MISTRAL_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `XAI_API_KEY`, `HF_TOKEN`), so the fetchers were dormant redundancy that shadowed Pi's native catalogs; no env-var migration is needed. The OpenCode, OpenCode Go, and FastRouter fetchers are unchanged. A free-filter toggle port for these built-ins (à la OpenRouter) is a possible follow-up.

### Fixed

- **Cold-cache startup stall** — pi-free's extension factory awaits every provider model fetch, so on a cold or stale cache an unresponsive provider API could block Pi session start for tens of seconds (measured up to ~66s with several keyed providers). Startup model fetches are now bounded by an 8s deadline (`STARTUP_FETCH_DEADLINE_MS`, override with `PI_FREE_STARTUP_FETCH_TIMEOUT_MS`); on timeout a provider serves its stale cache — or an empty list on a true cold start — and refreshes on the next `session_start`. Worst-case cold startup drops from ~66s to ~8s; warm-cache startup (no network) is unaffected.
- **Benchmark malformed-cache reporting** — The startup benchmark now reports malformed provider-cache JSON with the offending path. A corrupt `~/.pi/provider-cache.json` previously failed the bench with an uncontextualized `JSON.parse` exception; the cache root, `providers` object, and per-provider entries are now validated and reported explicitly.

## [2.2.10] - 2026-07-28

### Fixed

- **Context window fallback for dynamic providers** — models fetched from endpoints that omit context-length fields (e.g. OpenCode) no longer stick at the generic 128K default. A new `enrichFromNativeCatalog()` fallback patches context windows and max tokens from Pi's build-time model catalog (`@earendil-works/pi-ai`), which is local, synchronous, and always available. Fixes `deepseek-v4-pro` showing 128K instead of 1M under `opencode-go` (#347).

## [2.2.9] - 2026-07-25

### Changed

- **Built-in OpenRouter provider** — Removed pi-free's duplicate OpenRouter model provider; Pi's built-in provider now owns model discovery and Pi-managed OAuth.
- **Dependency security overrides** — Updated dependency lockfile overrides for the latest security fixes required by CI audits.

### Fixed

- **OpenRouter authentication preservation** — Fixed the OpenRouter toggle so re-registering filtered models does not replace Pi-managed API-key or OAuth credentials.

### Contributors

- **[@kuuhaku-00](https://github.com/kuuhaku-00)** — contributed the fixes in [PR #341](https://github.com/apmantza/pi-free/pull/341).

## [2.2.8] - 2026-07-21

### Changed

- **Lazy benchmark loading** — replaced ~10k lines of eagerly-imported `benchmarks-chunk-*.ts` files with a lazily-loaded `benchmarks.json` catalog, reducing module parse cost at startup (#315, #316, #320).
- **Provider cache reads no longer clone** — removed `structuredClone` from provider cache reads while keeping write-side cloning and the poisoning guard (#317).
- **Benchmark regexes hoisted** — regexes previously compiled inside hot loops in `benchmark-lookup.ts` are now compiled once at module level (#318).
- **Ollama capabilities cached** — `/api/show` is now only fetched for models not already in the provider cache, avoiding redundant per-model capability probes (#327).
- **CI uses `npm ci`** — switched CI install step from `npm install` to `npm ci` for deterministic builds and correct lockfile-pinned dependency resolution.
- **Dead export cleanup** — removed 10 unused exports from `constants.ts` and `lib/types.ts` (leftover from provider removals).

### Fixed

- **Config write safety** — a corrupt `~/.pi/free.json` no longer blocks all config writes; the original file is backed up with a timestamp and reset from template. `saveConfig` is now async and serialised through `ConfigLock` to prevent concurrent writes from clobbering each other (#321, #324).
- **Telemetry call-id tracking** — replaced key-based in-flight tracking with unique call ids, preventing provider-id drift between start/record and TTL reaping from corrupting latency. Latency samples over 10 minutes are discarded (#322).
- **Structured logging for silent failures** — added `createLogger` and warn-level logging to cline-xml-bridge streaming errors, cline-auth token refresh failures, and benchmark-lookup debug FS operations that were previously silently swallowed (#326).
- **OAuth refresh retry** — `refreshClineToken` now retries once (1s delay) before throwing, with structured logging on both attempts (#326).
- **Persistence failure escalation** — consecutive provider cache write failures escalate from `warn` to `error` after 3+ failures (#326).
- **XML tool parse warning** — `parseXmlToolCalls` now warns when raw text contains tool XML tags but no tool calls are parsed (#326).
- **Handler duplication on reload** — global event handlers (`setupTelemetry`, `setupQuotaMonitoring`) are now guarded against duplicate registration when the extension is reloaded (#325).
- **Empty provider warning** — `loadCachedOrFetchModels` now logs at `warn` level when a provider registers with 0 models due to fetch failure and empty cache (#323).
- **Atomic probe config writes** — Ollama and Routeway probes now use `updateConfig()` instead of the non-atomic `loadConfigFile()` + `saveConfig()` pattern, preventing concurrent probes from overwriting each other's `hidden_models` updates (#319).
- **Guarded JSON.parse calls** — `benchmarks.json` load and SSE chunk parsing now catch and log malformed data instead of crashing (#339).
- **npm audit vulnerabilities** — pinned `brace-expansion@5.0.7` and `protobufjs@7.6.5` to fix GHSA-3jxr-9vmj-r5cp and GHSA-j3f2-48v5-ccww from peer-dep transitive dependencies.

## [2.2.7] - 2026-07-10

### Added

- **AnyAPI provider** — add AnyAPI's OpenAI-compatible gateway with dynamic model discovery, free-model filtering, a 100K-token daily free plan, and `/toggle-anyapi` for switching to the full catalog.

### Changed

- **Pi 0.80 compatibility** — update the Pi SDK peer requirements to `>=0.80.0` and refresh the development toolchain dependencies.

### Fixed

- **AnyAPI model limits** — enrich context and output limits from models.dev when AnyAPI omits them, avoiding incorrect 4K defaults and migrating existing caches once.
- **TokenRouter Pi AI compatibility** — use the supported lazy OpenAI completions API path for Pi 0.80.

## [2.2.6] - 2026-07-09

### Changed

- **Faster startup (~30x)** — warm-cache load dropped from ~2.1s to ~70ms: providers now serve from a 1-hour disk cache and fetch live only on cold/stale cache. Extends the cache-first pattern (already used by Cline) to kilo, fastrouter, and all OpenAI-compatible fetchers (tokenrouter, zenmux, crofai, deepinfra, sambanova, together, novita, routeway, bai, openmodel); the dynamic built-in phase runs concurrently with the static providers. Thanks @lmilojevicc
- **Coding-Index debug logging is now opt-in** — `~/.pi/modelmatch.log` previously received one synchronous `appendFileSync` per model per match attempt at startup. Now off by default; set `PI_FREE_BENCHMARK_DEBUG=1` to re-enable. Thanks @lmilojevicc
- **Config reads are memoized** — `~/.pi/free.json` is parsed once and reused while its mtime is unchanged. Thanks @lmilojevicc

### Fixed

- **Cache-poisoning guard** — a transient partial API response (a 200 returning a near-empty list) can no longer overwrite a healthy cached model list; fetches returning < 50% of the cached count keep the existing cache. Thanks @lmilojevicc

### Removed

- **Codestral provider** — removed the Codestral provider (`codestral.mistral.ai`). Codestral's free tier is no longer available; use `MISTRAL_API_KEY` with pi's built-in dynamic Mistral provider instead.

## [2.2.5] - 2026-06-28

### Fixed

- **Qoder api2-v2 migration** — Move Qoder to the OpenAI-compatible `https://api2-v2.qoder.sh/model/v1/chat/completions` endpoint, replacing the legacy proxy-style request path. Streaming and non-streaming responses are normalized through the shared stream wrapper, stale legacy model cache entries are ignored, and Qoder now uses the standard basic/all toggle state instead of bespoke toggle logic. The provider avoids logging request bodies or credentials, clamps `max_tokens` to a valid positive value, propagates SSE error payloads, and guards against unbounded SSE buffers. Live validation confirmed the `lite` model works with saved Qoder auth; other account-gated models returned provider quota errors rather than protocol failures ([#285](https://github.com/apmantza/pi-free/pull/285)).

- **OpenCode built-in toggle before registry load** — `/toggle-opencode` and `/toggle-opencode-go` now fall back to direct `/models` discovery with saved OpenCode credentials when Pi's built-in model registry has not populated yet, instead of warning `models not loaded yet. Start a session first.` OpenCode-discovered models preserve the dynamic stream wrapper and are run through `isFreeModel` with the full model set so only `*-free` models are marked free; non-free models no longer appear as free in the picker just because OpenCode's model-list endpoint omits pricing ([#286](https://github.com/apmantza/pi-free/pull/286), [#287](https://github.com/apmantza/pi-free/pull/287)).

## [2.2.4] - 2026-06-27

### Added

- **OpenModel AI provider** — Anthropic-compatible LLM gateway at `api.openmodel.ai` (24 models). Merges the public `/web/v1/models` catalog (real per-token pricing via `price_multiplier`, supports flags, max tokens) with the authed `/v1/models` protocol list. Registers only messages-protocol models. The current **DeepSeek V4 Flash Free Event** is automatically detected: `deepseek-v4-flash` has `price_multiplier=0` → free via Route A (no hardcoding required). 6 free models surface under `free_only`: `deepseek-v4-flash` (1M context, MoE), plus 5 DashScope Qwen models whose catalog entries have no per-token pricing. Set `OPENMODEL_API_KEY` or add `openmodel_api_key` to `~/.pi/free.json`. Toggle with `/toggle-openmodel` ([#269](https://github.com/apmantza/pi-free/pull/269)).

- `npm run smoke:openmodel` — Live end-to-end check for the OpenModel Anthropic-Messages wire format. Reads `OPENMODEL_API_KEY` from env or `~/.pi/free.json`; skips with exit 0 when neither is set, exits 1 on any non-200 or malformed response.

- **Kilo and Cline API key authentication** — Both providers now support direct API key auth alongside OAuth. Set `KILO_API_KEY` / `CLINE_API_KEY` (or `kilo_api_key` / `cline_api_key` in `~/.pi/free.json`) to skip the OAuth flow. When a key is configured, the provider registers without OAuth and uses the key for model fetching and chat requests ([#282](https://github.com/apmantza/pi-free/pull/282)).

### Removed

- **AgentRouter provider** — The `agentrouter.org` gateway is unreachable from Pi: its OpenAI-compatible path returns `unauthorized client detected` for every direct API client (Codex CLI only), and the Anthropic path returned the same error for every key we tested. The "free public-welfare" tier is therefore not accessible from this extension, so the provider has been removed. Files deleted: `providers/agentrouter/agentrouter.ts`, `tests/agentrouter.test.ts`. Cleaned up: `PROVIDER_AGENTROUTER` / `BASE_URL_AGENTROUTER` in `constants.ts`, the `agentrouter_api_key` and `agentrouter_show_paid` config fields, the `PROVIDER_META` entry, `getAgentrouterApiKey` / `getAgentrouterShowPaid`, the import + `UNIQUE_PROVIDERS` slot in `index.ts`, and the `agentrouter` entry in the `freemiumProviders` Set. The corresponding `### Added` entry for AgentRouter is also removed from this release.

- **Naraya AI Router provider** — The `router.naraya.ai` gateway's `/v1/*` namespace is broken (observed 2026-06-23 and counting): every request returns HTTP 200 with `content-length: 0` and no `content-type` — nginx is responding with a default 200 but the upstream API is unreachable. The marketing website (`router.naraya.ai/`) is still up, so the failure mode is the `/v1/*` reverse-proxy backend specifically. No working API = no usable provider, so Naraya has been removed. Files deleted: `providers/naraya/naraya.ts`, `tests/naraya.test.ts`. Cleaned up: `PROVIDER_NARAYA` / `BASE_URL_NARAYA` in `constants.ts`, the `naraya_api_key` and `naraya_show_paid` config fields, the `PROVIDER_META` entry, `getNarayaApiKey` / `getNarayaShowPaid`, the import + `UNIQUE_PROVIDERS` slot in `index.ts`, and the `naraya` entry in the `freemiumProviders` Set. Orphaned `MODEL_VARIANTS` entries (`mistral-medium-3-5` → `mistral-medium-3.5`, `deepseek-v4-flash-naraya` → `deepseek-v4-flash-reasoning-high-effort`) in `provider-failover/benchmark-lookup.ts` were also removed.

### Fixed

- **OpenModel 404 (`route not found`)** — The shared `createReRegister` / `registerOpenAICompatible` / `createCtxReRegister` helpers in `provider-helper.ts` hardcoded `api: "openai-completions"` regardless of the provider's actual wire protocol. This silently forced OpenModel to POST to `/v1/chat/completions` even though it is an Anthropic-protocol gateway, returning `404 {"code":"NOT_FOUND","msg":"route not found"}` on every chat call. Added an optional `api` field on `OpenAICompatibleConfig` (default `"openai-completions"` for backward compatibility with the 17 existing callers) and threaded it through all three helpers. OpenModel now passes `api: "anthropic-messages"` so pi-ai dispatches to the Anthropic SDK and POSTs to `/v1/messages` correctly. New test file `tests/provider-helper-api-field.test.ts` pins the new behaviour (6 tests covering default, anthropic-messages, ctx variant, and header preservation). Live-verified end-to-end against `https://api.openmodel.ai/v1/messages` with a real `OPENMODEL_API_KEY` via `scripts/smoke-openmodel-wire-format.ts` — both non-streaming JSON (200 with Anthropic Messages shape) and streaming SSE (200 with `text/event-stream`, `event: message_start` + `event: content_block_start` + thinking deltas) work.

(Removed: `mistral-medium-3-5` / `deepseek-v4-flash-naraya` CI matching fix and `mistral-medium-3-5` CI score fix entries — Naraya is gone, so the hyphen-form variants no longer need a benchmark lookup alias.)

### Verified clean (no fix needed)

The following recent model IDs correctly miss `all-strategies-failed` because the benchmark DB genuinely has no entry for them — no fabricated scores added (pending the next `scripts/update-benchmarks.ts` run against the Artificial Analysis API):

- `minimax-m3` — latest MiniMax generation, not yet in benchmark DB
- `claude-haiku-4-5` — Claude Haiku 4.5, not yet in benchmark DB
- `qwen3.6-flash` — Qwen 3.6 Flash variant, not yet in benchmark DB

(Removed: `mistral-large (bare, from Naraya)` and `deepseek-3.2 (bare, from Naraya)` notes — Naraya is gone.)

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

<!-- retrigger-ci -->
