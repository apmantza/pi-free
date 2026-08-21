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

### OpenModel

OpenModel is an Anthropic Messages-compatible gateway. Free availability depends on the provider's current catalog and offers:

```bash
export OPENMODEL_API_KEY="..."
```

Or set `openmodel_api_key`. Toggle with `/toggle-openmodel`.

### StepFun

StepFun Step Plan is a native, paid OpenAI-compatible provider. Pi uses the Chat Completions endpoint at `https://api.stepfun.ai/step_plan/v1/chat/completions`; the same base also exposes an Anthropic-compatible Messages endpoint at `/messages` for clients such as Claude Code. Set `STEPFUN_API_KEY` or `stepfun_api_key` and toggle with `/toggle-stepfun`. StepFun shows its paid catalog by default because its catalog has no free models; set `stepfun_show_paid` or `STEPFUN_SHOW_PAID=false` to hide it.

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

These are Pi-built-in providers wrapped by pi-free for filtering. Pi owns their catalogs and credentials; pi-free does not perform startup discovery. Commands:

```text
/toggle-opencode
/toggle-opencode-go
```

### Other Pi-built-in providers

Pi owns the following providers; pi-free does not register duplicate catalogs or config keys for them: Fireworks, NVIDIA NIM, Mistral, Groq, Cerebras, xAI, Hugging Face, and Together. Use Pi's current documentation for their credentials, including `NVIDIA_API_KEY`, `MISTRAL_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `XAI_API_KEY`, `HF_TOKEN`, and `TOGETHER_API_KEY`.

## Storage summary

- Native providers: `~/.pi/agent/models-store.json` and Pi's `~/.pi/agent/auth.json`.
- Legacy catalog cache: `~/.pi/provider-cache.json`.
- Ollama compatibility data: `~/.pi/provider-cache.json` in addition to the native store.
- Qoder's native static catalog is stored in Pi's model store; its optional stream metadata may use `~/.pi/agent/qoder-models-cache.json`.
