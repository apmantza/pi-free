# Providers

Provider catalog, authentication, and setup for pi-free. Catalog contents and provider free tiers can change; this document intentionally does not publish model counts.

---

## Provider categories

| Category | Meaning |
| --- | --- |
| **Free/free-tier** | The provider offers free models or a free/basic plan. |
| **Freemium** | A free quota or tier exists alongside paid usage. |
| **Paid/trial** | Credits, payment, or a trial balance is required. |
| **Built-in/native** | Pi owns the catalog lifecycle, including native model-store refresh. |

## Model visibility

Providers you have not logged into do not appear in `/model`. Pi hides
any provider whose auth does not resolve, and pi-free resolves undefined
without a stored credential or ambient key — a visible-but-unchattable
catalog is clutter, not discovery. Only a provider whose models work
without a key stays visible logged out: LLM7, whose anonymous tier
answers chat. A public catalog alone is not enough: Cline and FastRouter
serve their model lists without an account but refuse chat without one,
so they stay hidden until you log in (#697). Logging in
(`/login <provider>` or the provider's API-key variable) makes its models
appear after the next refresh.

## Native providers

These providers use Pi's native provider surface and model store. Their toggles remain available even though Pi owns catalog refresh and credential persistence.

### Kilo

Kilo supports free models and paid catalog entries. Authenticate with OAuth or an API key:

```text
/login kilo
```

```bash
export KILO_API_KEY="..."
```

Or set `kilo_api_key` in `~/.pi/free.json`. Kilo credentials are persisted by Pi in `~/.pi/agent/auth.json`. Use `/toggle-kilo` to change the visible catalog. Free/paid follows Kilo's own `isFree` flag; models whose outputs include image, audio or video are not listed, and routers priced "-1" are treated as unpriced.

### Cline

Cline's models appear after login (or with `CLINE_API_KEY`); chat needs the credential even though the catalog endpoint is public:

```text
/login cline
```

Cline also accepts `CLINE_API_KEY` or `cline_api_key`; without one of these, or a login, Cline stays hidden. OAuth/API-key credentials are stored by Pi in `~/.pi/agent/auth.json`. Cline's endpoint speaks standard OpenAI Chat Completions; the provider uses the `openai-completions` api with Cline identity headers. Only models whose outputs are all text are listed (music and image models are dropped).

### LLM7

LLM7 provides free selector-based access (`default`, `fast`; the paid `pro` selector is hidden in the free view) through an OpenAI-compatible endpoint. It is the only provider that works without a key: logged out, pi-free sends a placeholder key that LLM7's anonymous tier accepts. A free token from dash.llm7.io raises the limits; set it as `LLM7_API_KEY` or `llm7_api_key`. Toggle with `/toggle-llm7`.

```bash
export LLM7_API_KEY="..."
```

### Ollama Cloud

Ollama Cloud is pay-as-you-go with no free tier, so its free view is empty. Get a key from [Ollama](https://ollama.com/settings/keys):

```bash
export OLLAMA_API_KEY="..."
```

Or set `ollama_api_key` in `~/.pi/free.json`. Use `/toggle-ollama-cloud`, `/probe-ollama`, and `/ollama-cloud-refresh`. Although Ollama is native, it retains `~/.pi/provider-cache.json` for `/api/show` capability reuse and the compatibility refresh command; Pi's native model store remains authoritative for native lifecycle initialization. Only models that support tool calling are listed. The cache guard refuses a shrunken or empty catalog only while the last healthy write is within the one-hour cache lifetime, so a stale cache cannot pin an old list forever.

### AnyAPI

AnyAPI is an OpenAI-compatible gateway with a free plan and free-model entries:

```bash
export ANYAPI_API_KEY="..."
```

Or set `anyapi_api_key`. Toggle with `/toggle-anyapi`.

### SambaNova

SambaNova lists every model with a per-token price, so it has no free models in pi-free:

```bash
export SAMBANOVA_API_KEY="..."
```

Or set `sambanova_api_key`. Toggle with `/toggle-sambanova`; `/probe-sambanova` checks availability.

### TokenRouter

TokenRouter is an OpenAI-compatible gateway with free and paid models:

```bash
export TOKENROUTER_API_KEY="..."
```

Or set `tokenrouter_api_key`. Toggle with `/toggle-tokenrouter`.

### StepFun

StepFun Step Plan is a native, paid OpenAI-compatible provider. Pi uses the Chat Completions endpoint at `https://api.stepfun.ai/step_plan/v1/chat/completions`; the same base also exposes an Anthropic-compatible Messages endpoint at `/messages` for clients such as Claude Code. Set `STEPFUN_API_KEY` or `stepfun_api_key` and toggle with `/toggle-stepfun`. StepFun shows its paid catalog by default because its catalog has no free models; hide it with `/toggle-stepfun`, `"model_view_overrides": {"stepfun": "free"}`, or `STEPFUN_SHOW_PAID=false`.

### GMI Cloud

GMI Cloud is a native, paid OpenAI-compatible provider. Pi uses the Inference API at `https://api.gmi-serving.com/v1/chat/completions` (one OpenAI-compatible endpoint for chat, vision, tools, and reasoning across 200+ open and frontier models); the same base also exposes `GET /v1/models`. Set `GMI_API_KEY` or `gmi_api_key` and toggle with `/toggle-gmi`. GMI Cloud shows its full paid catalog by default because the gateway lists no free models outside promotions; restrict the view with `/toggle-gmi`, `"model_view_overrides": {"gmi": "free"}`, or `GMI_SHOW_PAID=false`. GMI runs time-limited promotions by publishing a second row for a model with zeroed pricing and `is_free: true`; pi-free folds the two rows into one model per id, free while the promotional row is listed, so a promotion ends on its own when GMI drops the row. No promotion was listed in the 2026-11-15 audit (the MiniMax Week promotion ended 2026-09-06).

### Agnes AI

Agnes AI is a native OpenAI-compatible provider mixing free and paid chat models. Pi uses the gateway at `https://apihub.agnes-ai.com/v1/chat/completions` (an omni-modal API covering text, image, and video models under one `sk-` key); the same base also exposes `GET /v1/models`. The `/v1/models` endpoint exposes no pricing, and its `supported_endpoint_types` cannot tell text models from generators (image and video generators list `openai` too), so admission and free status come from Agnes's documented text-model list (llms.txt and the pricing page, checked 2026-11-15; revisit at each audit): `agnes-2.5-flash` and `agnes-3.0-flash` are free on promotional terms with no published end date, and the pro models (`agnes-2.5-pro`, `agnes-2.5-pro-beta`, `agnes-2.5-pro-theta`, and `agnes-3.0-pro` once released) are paid. A catalog row not on that list, such as `agnes-2.5-pro-alpha`, is not published. Set `AGNES_API_KEY` or `agnes_api_key` and toggle with `/toggle-agnes`. The catalog defaults to the free-only view; `/toggle-agnes` reveals the paid pro models.

### Venice AI

Venice AI is a native OpenAI-compatible provider mixing free-classified and paid chat models. Pi uses the inference API at `https://api.venice.ai/api/v1/chat/completions` (100+ text models billed in USD or DIEM per million tokens); the same base also exposes `GET /models?type=text`. The model catalog endpoint is public, but models appear only after login — chat requires `VENICE_API_KEY` or `venice_api_key`; toggle with `/toggle-venice`. Free/paid classification follows the published pricing (zero-priced models count as free; a model counts as priced only when both prices are published); no model was free on 2026-11-15. Only models whose capabilities declare tool calling are listed, and each model's thinking levels map to the `reasoning_effort` values it declares (`reasoningEffortOptions`). Every request sends `venice_parameters.include_venice_system_prompt: false`, because Venice otherwise injects its own system prompt; this applies to compaction and summaries too. When Venice sends `x-venice-balance-usd` / `x-venice-balance-diem`, the status bar shows the balance (`venice: $4.21 + 12.50 DIEM balance`). **Balance gate:** Venice requires a positive account balance for all inference — including zero-priced models, which answer HTTP 402 on unfunded keys — so a model classified as free can still fail at request time until the account is funded.

### Infron AI

Infron AI (infron.ai) is a unified AI gateway with passthrough pricing and pooled upstream uptime; its OpenAI-compatible API runs on the OneRouter gateway at `https://llm.onerouter.pro/v1/chat/completions`. The catalog endpoint is public (anonymous `/models` returns 200), but models appear only after login; chat requires `INFRON_API_KEY` or `infron_api_key`; toggle with `/toggle-infron`. Embedding, image and video entries are filtered out, and only models served over Chat Completions (`supported_endpoint_types` includes `openai`) are listed; Responses-only models are dropped. Prices are USD per million tokens and zero-priced entries classify as free. A model's context window is the smaller of its own value and the largest window its serving providers publish (ignoring windows of 4096 or less), because the gateway rejects requests sized beyond the serving provider's limit. The catalog's `supports_function_calling` flag is an unfilled placeholder (models with working tools list `false`), so Infron is not tool-gated. After Pi's retries are exhausted on a TPM rate limit, pi-free continues the same model after the advertised delay (see the README).

### Merge Gateway

[Merge](https://merge.dev) is a multi-vendor LLM gateway with an OpenAI-compatible chat shim at `https://api-gateway.merge.dev/v1/openai/chat/completions`. Model discovery uses Merge's **native Gateway API** (`GET /v1/models`) rather than the minimal OpenAI shim catalog, because the native endpoint carries display names, per-vendor routes with availability status, context windows, max output tokens, capability flags (text/image input, reasoning, streaming), and pricing in USD per million tokens — all of which pi-free maps directly. A model's price comes from a single route (the cheapest available one), never the cheapest input and cheapest output taken from different vendors, which could add up to a $0/$0 nobody sells. Only models whose outputs are `text` and `tool_use` are listed (image-output hybrids are dropped). The catalog is keyed — anonymous requests return HTTP 401 — so `MERGE_API_KEY` (or `merge_api_key`) is required before models appear; toggle with `/toggle-merge`. A positive account balance may be required even on a $0 route (the 2026-11-15 audit account answered 402 when out of credits).

### CommandCode

[CommandCode](https://commandcode.ai) is an AI subscription gateway routing to ~60 models (OpenAI GPT-5.6 family, Claude Opus/Sonnet, Gemini 3.x, Grok 4.6, Kimi K3, Qwen 3.7/3.8, GLM 5.x, DeepSeek V4) through one Provider API at `https://api.commandcode.ai/provider/v1/chat/completions`. The catalog endpoint is public (anonymous `/models` returns 200), but models appear only after login; chat requires an account whose plan includes **Provider API access** (`COMMAND_CODE_API_KEY` or `commandcode_api_key`; Go plans answer `upgrade_required`) — toggle with `/toggle-commandcode`. Prices come from a curated USD-per-M table ported from the MIT-licensed patlux/pi-commandcode-provider extension, because the catalog publishes none; free is exactly the ids ending in `:free` (`thinkingmachines/inkling-2-small:free`, `stealth/glyph-cluster:free` on 2026-11-15), and a "free" display name or `-free` id does not count. Wire note: `claude-*` models route over Anthropic Messages at `/provider/v1/messages`, everything else over OpenAI Chat Completions — the provider dispatches transports per model.

### FastRouter

FastRouter is a native OpenAI-compatible provider. Pi restores its model store first and refreshes the catalog asynchronously. Chat needs a key, so its models appear only once one is set. Set `FASTROUTER_API_KEY` or `fastrouter_api_key`, then use `/toggle-fastrouter`. Only models with text input and text-only output are listed (speech-to-text models are dropped), and free follows FastRouter's own `free_slug_enabled` flag, so the billed `fastrouter/auto` router and $0-listed models without the flag count as paid.

### Requesty

Requesty is an OpenAI-compatible router with inline per-model pricing:

```bash
export REQUESTY_API_KEY="..."
```

Or set `requesty_api_key`. Toggle with `/toggle-requesty`. Models appear only once a key resolves. Zero-priced chat models classify as free, and a price that fails to parse is pricing-unknown, never $0. Image-generation models, models past their published `retires` date, and models the catalog marks as unable to call tools are not listed; an unpublished output limit falls back to 16,384 tokens.

## Paid and trial providers

### ZenMux

Gateway for models from multiple upstream vendors. Requires an API key and available credits:

```bash
export ZENMUX_API_KEY="..."
```

Or set `zenmux_api_key`. Toggle with `/toggle-zenmux`. ZenMux publishes each model's own `max_tokens` output limit, and cache-write prices follow the catalog's flat tier, then the 5-minute tier, then the 1-hour tier.

The catalog also lists non-chat endpoints (image/video generation, speech/transcription, embeddings, rerank); pi-free registers only chat-capable entries, dropping any model whose `output_modalities` is present and does not include `text` and keeping rows with no modality info.

### DeepInfra

DeepInfra offers trial credits and paid inference. Its environment variable is intentionally `DEEPINFRA_TOKEN` (not `DEEPINFRA_API_KEY`):

```bash
export DEEPINFRA_TOKEN="..."
```

Or set `deepinfra_api_key`. Toggle with `/toggle-deepinfra`; `/probe-deepinfra` checks availability. Only rows the catalog tags `chat` are listed (embedding and media models are dropped); no chat model is free.

### Novita AI

OpenAI-compatible inference provider with a paid catalog (no free chat models on 2026-11-15):

```bash
export NOVITA_API_KEY="..."
```

Or set `novita_api_key`. Toggle with `/toggle-novita`; `/probe-novita` checks availability. Only models with the `function-calling` feature are listed, and image/video/audio generators are dropped. Rows with `pricing: null` (including the `nvrouter/*` routers) are pricing-unknown, not free. Novita quotes prices in 1/10,000 USD per million tokens; pi-free converts them, and publishes cache read and write prices.

### Routeway

OpenAI-compatible gateway with `:free` model entries and paid models:

```bash
export ROUTEWAY_API_KEY="..."
```

Or set `routeway_api_key`. Toggle with `/toggle-routeway`; `/probe-routeway` checks availability. Models the catalog marks `function_call: false` are not listed. Cache-write prices come from the 5-minute tier, else the only listed tier.

### OpenGateway

[Gitlawb OpenGateway](https://gitlawb.com/opengateway) is an OpenAI-compatible gateway with smart routing, paid models, and changing promotional/free entries. Its base URL is `https://opengateway.gitlawb.com/v1`:

```bash
export OPENGATEWAY_API_KEY="ogw_live_..."
```

Or set `opengateway_api_key`. Toggle with `/toggle-opengateway`. The catalog is refreshed through Pi's native model lifecycle; the startup seed carries only the live-verified free id. OpenGateway now operates as Twigpine: `api.twigpine.com/v1` serves an identical catalog and the old host sends no deprecation headers, so pi-free keeps the gitlawb URL. OpenGateway documents balance headers on non-streaming responses only, and pi-ai always streams, so the status bar shows no OpenGateway balance.

### B.AI

B.AI is an OpenAI-compatible paid provider. The three models it once described as "currently free" (`deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`, `mimo-v2.5`) are priced on [docs.b.ai](https://docs.b.ai/llmservice/pricing-and-usage/) ($0.14–0.60 per million tokens), so pi-free no longer marks them free; only a `:free` id would count:

```bash
export BAI_API_KEY="..."
```

Or set `bai_api_key`. Toggle with `/toggle-bai`.

### OrcaRouter

OrcaRouter is an OpenAI-compatible gateway with free `-free`-suffixed models:

```bash
export ORCAROUTER_API_KEY="sk-orca-..."
```

Or set `orcarouter_api_key`. Toggle with `/toggle-orcarouter`. Free models are the `-free`/`free`-named entries and those priced per request at zero, which pi-free detects explicitly. When a row names its `endpoint_capabilities`, only `chat_completions` models are listed, so TTS and per-request-priced image generators stay out of the free view.

### InferX

InferX is a serverless GPU inference platform whose shared, token-billed OpenAI-compatible surface is `https://model.inferx.net/endpoints/v1`:

```bash
export INFERX_API_KEY="ix-..."
```

Or set `inferx_api_key`. Toggle with `/toggle-inferx`. The catalog endpoint is keyed (anonymous requests answer 401 `no tenant context`), so models appear only after a credential resolves. It is vLLM-shaped — entries carry only `id`, `object`, `created`, and `owned_by` — so context windows, output limits, modalities, and reasoning come from models.dev enrichment over the same endpoint ids, with 128K/16K fallbacks. Two catalog facts are not in the payload: the embedding endpoint (`Qwen3-Embedding-8B`) is dropped by id, and the `-no-thinking` variants are excluded from the reasoning-family heuristic (their ids contain the literal "thinking"). No price is published anywhere in the public catalog (each endpoint page states usage is billed per token), so entries are stamped pricing-unknown and **no InferX model classifies as free** — the catalog appears in the paid view. InferX's own "InferX Free" plan is a billing-layer tier the catalog does not expose.

### AMD Token Lab

AMD Token Lab serves open models on AMD Instinct GPUs through an OpenAI-compatible surface at `https://api.tokenlab.amd.com/v1` (it also speaks Anthropic `/v1/messages`; pi-free uses chat completions). Get a key at https://notebooks.amd.com/tokenlab after signing in with the AMD AI Developer Program:

```bash
export AMD_TOKENLAB_API_KEY="tl-..."
```

Or set `amd_tokenlab_api_key`. Toggle with `/toggle-amd-tokenlab`. The catalog is keyed (anonymous requests answer 401 `Invalid Token Lab API key`), so models appear after a credential resolves and the session-start refresh runs. It is OpenRouter-shaped (`context_length`, `architecture` modalities, `supported_parameters`) with no prices and no output limits; models.dev enrichment supplies output limits. The aux routers listed beside the chat models (`Clef`, `d3`, `d3-flash`, output `decision`) are dropped. **Every chat model is free**: usage draws on a per-user budget AMD grants (observed 2026-11-14: $10, resetting monthly, 20 requests per minute, reported in `x-ratelimit-*-user-budget-usd` / `-user-rpm` headers; the status bar shows the remaining budget in dollars). Thinking is controlled only through `reasoning_effort`; Token Lab rejects DeepSeek's `thinking` field, so the DeepSeek proxy format models.dev implies is removed.

### Xkiro

Xkiro is an OpenAI-compatible gateway with a catalog `access_tier` (free, paid, premium) per model:

```bash
export XKIRO_API_KEY="sk-xt-..."
```

Or set `xkiro_api_key`. Toggle with `/toggle-xkiro`. Free follows the catalog's `access_tier`; on 2026-11-15 the free tier was the Cohere and Mistral families, `sensenova/sensenova-6.8-flash-lite` and `stealth/big-pickle` (full list in [free_models.md](free_models.md)). Only models whose `capabilities.tools` is true are listed, and each model's thinking levels map to the `reasoning_efforts.levels` it declares; a reasoning model that declares none sends no effort. Note the gateway can paywall individual models per key/plan server-side, so paid entries may refuse chat without a funded plan.

## Removed: Qoder

pi-free no longer registers Qoder ([#689](https://github.com/apmantza/pi-free/issues/689)). Qoder moved its inference API: the OpenAI-compatible endpoint pi-free used no longer resolves, and every current client signs each request with Qoder's proprietary scheme. pi-free does not ship reverse-engineered signing for an undocumented private API. A Qoder login stored in Pi's `~/.pi/agent/auth.json` is left in place and is harmless; leftover `qoder_*` keys in `~/.pi/free.json` and `~/.pi/agent/qoder-models-cache.json` are ignored and can be deleted.

## Pi built-in providers

### OpenRouter

OpenRouter is Pi's built-in provider. Configure it using Pi's auth flow or:

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
```

Pi's own provider, catalog, refresh and credentials serve OpenRouter. pi-free adds one thing: a free view, on by default under `free_only` like every other provider's. `/toggle-openrouter` (or `/toggle-free`) switches it.

- **Free view:** a snapshot of Pi's OpenRouter catalog entries (each with the endpoint and header fields Pi resolved for it), without the paid chat models. Free means a zero prompt and completion price and a model published as free (a `:free` id, or "free" in its name, such as the `openrouter/free` router). The `$0` routers (`openrouter/auto`, `openrouter/fusion`, `openrouter/pareto-code`, …) bill the model they route to, so they count as paid. Image and classifier models are left alone. pi-free fetches nothing and adds nothing of its own (no key, header, endpoint or stream): your stored OpenRouter credential, OAuth login or `OPENROUTER_API_KEY` is resolved by Pi as usual.
- **All view:** pi-free registers nothing for OpenRouter; you see Pi's provider exactly as Pi ships it.
- The free list is taken from Pi's catalog when a session starts and when you toggle. Models Pi's own refresh adds or prices later in the same session show up after `/reload`, a new session, or a toggle.

### OpenCode free and OpenCode Go

`opencode-free` is pi-free's own provider: it captures Pi's built-in `opencode` catalog and re-registers it under that id with the free-tier behavior below. Credentials stay Pi-owned (`OPENCODE_API_KEY`, or `/login opencode-free`); a key stored under Pi's `opencode-go` id is reused for the captured catalog. OpenCode Go is Pi's own `opencode-go` provider and pi-free does not override it. After session start `opencode-free` performs one **detached** refresh against OpenCode's public, credential-free `GET https://opencode.ai/inference/v1/models` endpoint, so models OpenCode ships between Pi releases appear without waiting for Pi's own catalog mirror. IDs already in Pi's built-in catalog keep Pi's curated metadata and wire protocol; newer IDs are synthesized with the OpenCode protocol defaults. The refresh never blocks startup, is deduplicated per process, and retains the cached catalog when the endpoint fails or returns nothing — the failure lands in `~/.pi/free.log` rather than surfacing as Pi's `Could not refresh …; showing cached models` warning. The refresh is anonymous by design; a stored credential would not change it, because free-tier inference is itself anonymous (see below).

**Free-tier inference.** `opencode-free` requests are sent with Zen's anonymous `public` bearer rather than the stored account credential: the account-keyed free-tier lane is rejected upstream (`403 Model access is disabled`) while the anonymous bearer is accepted, so attaching the key removes the only working path. For client compatibility, pi-free registers Pi's `find` tool as `glob` and selects `glob` + `grep` on free turns. Every `opencode-free` model also gets the small system metadata frame `<env>Working directory: .</env>` by default, through both provider and compat dispatch. Dot is relative to Pi's tool working directory; Pi's complete instructions, sections, tool declarations and history remain intact. The frame is request-only and does not accumulate in saved conversations. No native OpenCode persona, captured paths, skills or tool catalog is copied, and no OpenCode CLI installation is required. Pi's native `opencode-go` requests receive no frame. Bun remains the free transport; headers/tools alone do not guarantee upstream acceptance, and service policies can change. See [features](features.md#glob-tool-and-opencode-zen-free-tier-compatibility).

**Bun requirement.** `opencode-free` needs Bun: requests sent from other clients get `429 FreeUsageLimitError`, which reads like an exhausted quota. pi-free does not bundle or download Bun. It uses the first of `PI_FREE_OPENCODE_BUN`, a `bun` executable on `PATH`, `$BUN_INSTALL/bin`, `~/.bun/bin`, npm's global package on Windows (`%APPDATA%\npm\node_modules\bun\bin\bun.exe`), and a Bun-compiled Pi's own binary. On Windows, npm's `bun.cmd` shim can make `bun` work in a terminal while Node cannot spawn it, so pi-free looks for the real `bun.exe`. pi-free starts the relay when an `opencode-free` model is selected, at session start or on a later switch, and stops it after five idle minutes. If the relay cannot start, you get a warning right away, the 429 says why, and `/pi-free-health` reports it. After installing Bun or setting the variable, restart Pi. Requests through Pi's built-in `opencode` provider never use this relay and can still get the 429, so pi-free warns once when you select a free model there. Select the `opencode-free` model instead. A Zen or Go key does not change free-tier behavior.

Command:

```text
/toggle-opencode-free
```

### Other Pi-built-in providers

Pi owns the following providers; pi-free does not register duplicate catalogs or config keys for them: Fireworks, NVIDIA NIM, Mistral, Groq, Cerebras, xAI, Hugging Face, and Together. Use Pi's current documentation for their credentials, including `NVIDIA_API_KEY`, `MISTRAL_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `XAI_API_KEY`, `HF_TOKEN`, and `TOGETHER_API_KEY`.

## Storage summary

- Native providers: `~/.pi/agent/models-store.json` and Pi's `~/.pi/agent/auth.json`.
- Legacy catalog cache: `~/.pi/provider-cache.json`.
- Ollama compatibility data: `~/.pi/provider-cache.json` in addition to the native store.
