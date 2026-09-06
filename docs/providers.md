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

Or set `kilo_api_key` in `~/.pi/free.json`. Kilo credentials are persisted by Pi in `~/.pi/agent/auth.json`. Use `/toggle-kilo` to change the visible catalog.

### Cline

Cline's model catalog is public, so models can appear before login. Login is required for chat requests:

```text
/login cline
```

Cline also accepts `CLINE_API_KEY` or `cline_api_key`. OAuth/API-key credentials are stored by Pi in `~/.pi/agent/auth.json`. Cline's endpoint speaks standard OpenAI Chat Completions; the provider uses the `openai-completions` api with Cline identity headers.

### LLM7

LLM7 provides free selector-based access through an OpenAI-compatible endpoint. Set `LLM7_API_KEY` or `llm7_api_key` as required by the service, then use `/toggle-llm7`.

```bash
export LLM7_API_KEY="..."
```

### Ollama Cloud

Ollama Cloud provides usage-based free access alongside other catalog entries. Get a key from [Ollama](https://ollama.com/settings/keys):

```bash
export OLLAMA_API_KEY="..."
```

Or set `ollama_api_key` in `~/.pi/free.json`. Use `/toggle-ollama-cloud`, `/probe-ollama`, and `/ollama-cloud-refresh`. Although Ollama is native, it retains `~/.pi/provider-cache.json` for `/api/show` capability reuse and the compatibility refresh command; Pi's native model store remains authoritative for native lifecycle initialization.

### AnyAPI

AnyAPI is an OpenAI-compatible gateway with a free plan and free-model entries:

```bash
export ANYAPI_API_KEY="..."
```

Or set `anyapi_api_key`. Toggle with `/toggle-anyapi`.

### SambaNova

SambaNova offers a free tier with rate limits:

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

StepFun Step Plan is a native, paid OpenAI-compatible provider. Pi uses the Chat Completions endpoint at `https://api.stepfun.ai/step_plan/v1/chat/completions`; the same base also exposes an Anthropic-compatible Messages endpoint at `/messages` for clients such as Claude Code. Set `STEPFUN_API_KEY` or `stepfun_api_key` and toggle with `/toggle-stepfun`. StepFun shows its paid catalog by default because its catalog has no free models; set `stepfun_show_paid` or `STEPFUN_SHOW_PAID=false` to hide it.

### GMI Cloud

GMI Cloud is a native, paid OpenAI-compatible provider. Pi uses the Inference API at `https://api.gmi-serving.com/v1/chat/completions` (one OpenAI-compatible endpoint for chat, vision, tools, and reasoning across 200+ open and frontier models); the same base also exposes `GET /v1/models`. Set `GMI_API_KEY` or `gmi_api_key` and toggle with `/toggle-gmi`. GMI Cloud shows its full paid catalog by default because the gateway lists no free models; set `gmi_show_paid=false` or `GMI_SHOW_PAID=false` to restrict the view. GMI runs time-limited "free week" promotions where specific models are free at the billing layer despite nonzero list prices — during the active window those models are stamped authoritatively free so they appear in the free-only view and `/free-providers` counts, and the stamp auto-expires when the promotion ends. The current promotion is **MiniMax Week (2026-08-24 → 2026-09-06)**: `MiniMaxAI/MiniMax-M3` and `MiniMaxAI/MiniMax-M2.7` are free.

### Agnes AI

Agnes AI is a native OpenAI-compatible provider mixing free and paid chat models. Pi uses the gateway at `https://apihub.agnes-ai.com/v1/chat/completions` (an omni-modal API covering text, image, and video models under one `sk-` key); the same base also exposes `GET /v1/models`. Per the Agnes pricing docs, the flash-class models (`agnes-2.0-flash`, `agnes-2.5-flash`) are free while the pro models (`agnes-2.5-pro`, `agnes-2.5-pro-alpha`) are billed at list price. The `/v1/models` endpoint exposes no pricing, so the free flash models are stamped authoritatively free and the paid pro models are left to the default paid classification; image/video generation models are filtered out so only text chat models are published. Set `AGNES_API_KEY` or `agnes_api_key` and toggle with `/toggle-agnes`. The catalog defaults to the free-only view (the two free flash models); `/toggle-agnes` reveals the paid pro models.

### Venice AI

Venice AI is a native OpenAI-compatible provider mixing free-classified and paid chat models. Pi uses the inference API at `https://api.venice.ai/api/v1/chat/completions` (100+ text models billed in USD or DIEM per million tokens); the same base also exposes `GET /models?type=text`. The model catalog is public, so models appear before login, but chat requires `VENICE_API_KEY` or `venice_api_key`; toggle with `/toggle-venice`. Free/paid classification follows the published pricing (zero-priced models count as free). **Balance gate:** Venice requires a positive account balance for all inference — including zero-priced models, which answer HTTP 402 on unfunded keys — so a model classified as free can still fail at request time until the account is funded.

### Infron AI

Infron AI (infron.ai) is a unified AI gateway with passthrough pricing and pooled upstream uptime; its OpenAI-compatible API runs on the OneRouter gateway at `https://llm.onerouter.pro/v1/chat/completions`. The catalog is public (anonymous `/models` returns 200), so models appear before login; chat requires `INFRON_API_KEY` or `infron_api_key`; toggle with `/toggle-infron`. The catalog mixes ~285 chat LLM entries with embeddings/image/video entries (filtered out); min prices are USD per million tokens, and the zero-priced entries (currently five, including three explicit `:free` ids) classify as free via Route A

### Merge Gateway

[Merge](https://merge.dev) is a multi-vendor LLM gateway with an OpenAI-compatible chat shim at `https://api-gateway.merge.dev/v1/openai/chat/completions`. Model discovery uses Merge's **native Gateway API** (`GET /v1/models`) rather than the minimal OpenAI shim catalog, because the native endpoint carries display names, per-vendor routes with availability status, context windows, max output tokens, capability flags (text/image input, reasoning, streaming), and pricing in USD per million tokens — all of which pi-free maps directly (cheapest available vendor's price, largest window, OR-ed capabilities). The catalog (~275 chat-capable entries after filtering non-text routes) is keyed — anonymous requests return HTTP 401 — so `MERGE_API_KEY` (or `merge_api_key`) is required before models appear; toggle with `/toggle-merge`. Free models: `nvidia/nemotron-3.5-lightning-30b-a3b` is published at $0/$0 per million via its nvidia route and classifies free via Route A pricing detection (verified live 2026-08-26).

### CommandCode

[CommandCode](https://commandcode.ai) is an AI subscription gateway routing to ~60 models (OpenAI GPT-5.6 family, Claude Opus/Sonnet, Gemini 3.x, Grok 4.6, Kimi K3, Qwen 3.7/3.8, GLM 5.x, DeepSeek V4) through one Provider API at `https://api.commandcode.ai/provider/v1/chat/completions`. The catalog is public (anonymous `/models` returns 200), so models appear before login; chat requires an account whose plan includes **Provider API access** (`COMMAND_CODE_API_KEY` or `commandcode_api_key`; Go plans answer `upgrade_required`) — toggle with `/toggle-commandcode`. Pricing comes from a curated USD-per-M table ported from the MIT-licensed patlux/pi-commandcode-provider extension (verified against CommandCode's official pricing page 2026-08-25); zero-priced entries (`poolside/laguna-s-2.1-free`, `stealth/ox-alpha`) classify as free. Wire note: `claude-*` models route over Anthropic Messages, everything else over OpenAI Chat Completions — the provider dispatches transports per model.

### FastRouter

FastRouter is a native OpenAI-compatible provider with a public catalog. Pi restores its model store first and refreshes the catalog asynchronously; a key is required for chat requests but not model listing. Set `FASTROUTER_API_KEY` or `fastrouter_api_key`, then use `/toggle-fastrouter`.

## Paid and trial providers

### ZenMux

Gateway for models from multiple upstream vendors. Requires an API key and available credits:

```bash
export ZENMUX_API_KEY="..."
```

Or set `zenmux_api_key`. Toggle with `/toggle-zenmux`.

### CrofAI

OpenAI-compatible provider requiring a CrofAI key and credits:

```bash
export CROFAI_API_KEY="..."
```

Or set `crofai_api_key`. Toggle with `/toggle-crofai`.

### DeepInfra

DeepInfra offers trial credits and paid inference. Its environment variable is intentionally `DEEPINFRA_TOKEN` (not `DEEPINFRA_API_KEY`):

```bash
export DEEPINFRA_TOKEN="..."
```

Or set `deepinfra_api_key`. Toggle with `/toggle-deepinfra`; `/probe-deepinfra` checks availability.

### Novita AI

OpenAI-compatible inference provider with free-tier and paid catalog entries:

```bash
export NOVITA_API_KEY="..."
```

Or set `novita_api_key`. Toggle with `/toggle-novita`; `/probe-novita` checks availability.

### Routeway

OpenAI-compatible gateway with free-tier model entries and paid models:

```bash
export ROUTEWAY_API_KEY="..."
```

Or set `routeway_api_key`. Toggle with `/toggle-routeway`; `/probe-routeway` checks availability.

### OpenGateway

[Gitlawb OpenGateway](https://gitlawb.com/opengateway) is an OpenAI-compatible gateway with smart routing, paid models, and changing promotional/free entries. Its base URL is `https://opengateway.gitlawb.com/v1`:

```bash
export OPENGATEWAY_API_KEY="ogw_live_..."
```

Or set `opengateway_api_key`. Toggle with `/toggle-opengateway`. The catalog is refreshed through Pi's native model lifecycle and includes the `auto` smart-routing model plus the models advertised by `/v1/models`. The gateway accepts the short `mimo-v2.5-pro` alias as well as its Xiaomi-qualified model ID.

### B.AI

B.AI is an OpenAI-compatible paid provider:

```bash
export BAI_API_KEY="..."
```

Or set `bai_api_key`. Toggle with `/toggle-bai`.

Three models are currently documented as free on the B.AI API and are stamped free in the catalog: `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`, and `mimo-v2.5` (source: [B.AI pricing](https://docs.b.ai/llmservice/pricing-and-usage/), audited 2026-08-26). This is a time-limited promotion — revisit the pricing page before relying on it.

## Qoder (native)

Qoder has a basic Community/free tier and premium models that consume plan credits. Its static curated catalog is restored and persisted through Pi's native models-store lifecycle; the legacy cache is retained only for optional stream metadata.

Authenticate with either method:

```text
/login qoder
```

- Browser OAuth uses Qoder's device/PKCE flow.
- PAT authentication can use `QODER_PERSONAL_ACCESS_TOKEN` or the alias `QODER_PAT`.

`/toggle-qoder` switches between basic and all Qoder models. Qoder's API remains OpenAI-compatible, while its authentication and custom stream integration remain Qoder-specific.

## Pi built-in providers

### OpenRouter

OpenRouter is Pi's built-in provider. Configure it using Pi's auth flow or:

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
```

pi-free adds the `/toggle-openrouter` filter but does not own OpenRouter's credentials. After session start it performs one detached refresh of the catalog view against OpenRouter's public `GET /api/v1/models` endpoint: model IDs already present in Pi's built-in catalog keep Pi's curated metadata, while newer models are synthesized from the endpoint's pricing, context-window, modality, and reasoning data. The refresh never blocks startup and is deduplicated per process.

### OpenCode and OpenCode Go

These are Pi-built-in providers wrapped by pi-free for filtering; Pi owns their credentials (`OPENCODE_API_KEY`, or `/login opencode-free`). After session start each tier performs one **detached** refresh against OpenCode's public, credential-free model endpoint — `GET https://opencode.ai/zen/v1/models` for `opencode-free` and `GET https://opencode.ai/zen/go/v1/models` for `opencode-go` — so models OpenCode ships between Pi releases appear without waiting for Pi's own catalog mirror. IDs already in Pi's built-in catalog keep Pi's curated metadata and wire protocol; newer IDs are synthesized with the OpenCode protocol defaults. The refresh never blocks startup, is deduplicated per process, and retains the cached catalog when the endpoint fails or returns nothing — the failure lands in `~/.pi/free.log` rather than surfacing as Pi's `Could not refresh …; showing cached models` warning. Known limitation: the refresh is anonymous by design (the Go catalog was identical anonymous vs. authenticated in a 2026-09-06 audit), but Zen's free-tier catalog is account-scoped when authenticated — if either tier scopes per-account in the future, the anonymous refresh could list models the account cannot call; sending the stored credential when one exists would fix that at the cost of a behavior change. Commands:

```text
/toggle-opencode-free
/toggle-opencode-go
```

### Other Pi-built-in providers

Pi owns the following providers; pi-free does not register duplicate catalogs or config keys for them: Fireworks, NVIDIA NIM, Mistral, Groq, Cerebras, xAI, Hugging Face, and Together. Use Pi's current documentation for their credentials, including `NVIDIA_API_KEY`, `MISTRAL_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `XAI_API_KEY`, `HF_TOKEN`, and `TOGETHER_API_KEY`.

## Storage summary

- Native providers: `~/.pi/agent/models-store.json` and Pi's `~/.pi/agent/auth.json`.
- Legacy catalog cache: `~/.pi/provider-cache.json`.
- Ollama compatibility data: `~/.pi/provider-cache.json` in addition to the native store.
- Qoder's native static catalog is stored in Pi's model store; its optional stream metadata may use `~/.pi/agent/qoder-models-cache.json`.
