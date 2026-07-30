# Providers

Full catalog of providers registered by pi-free, how to authenticate, and per-provider setup.

---

## Provider Categories

| Category | Emoji | Description |
|---|---|---|
| **Free** | ✅ | Models cost $0, no payment required |
| **Freemium** | 🔄 | Free tier with limits, paid after |
| **Paid** | 💳 | Requires credits or payment |
| **Dynamic** | 🔧 | Fetched only when API key configured |

---

## ✅ Free Providers

### Kilo

Free models available immediately. More models after `/login kilo`.

- No credit card required
- Free tier: 200 requests/hour

```
/login kilo
```

This opens your browser to Kilo's authorization page, shows a device code, and completes automatically once approved.

After login, run `/toggle-kilo` to switch between free-only and all models.

### Cline

Free account required (no credit card). Uses local ports 48801-48811 for OAuth callback.

```
/login cline
```

### OpenRouter

Free models available with a free API key. Get one at [openrouter.ai/keys](https://openrouter.ai/keys).

Set via environment variable:

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
```

OpenRouter reads its key from Pi's built-in auth storage. Run `/toggle-openrouter` to switch between free-only and all models.

### OpenModel

6 free models including `deepseek-v4-flash` during the current free event (1M context, MoE; 10 RPM / 100K TPM daily quota).

Requires API key — add to `~/.pi/free.json`:

```json
{
  "openmodel_api_key": "YOUR_KEY"
}
```

### LLM7

Free gateway routing across multiple providers through a single OpenAI-compatible endpoint.

- Free tier: default/fast selectors, 100 req/hr, 20 req/min
- Get free token at [token.llm7.io](https://token.llm7.io/)

```bash
export LLM7_API_KEY="..."
```

### TokenRouter

1 free model (`MiniMax-M3`); requires API key with credits for the rest.

```bash
export TOKENROUTER_API_KEY="..."
```

---

## 🔄 Freemium Providers

### AnyAPI

Free plan with 100K ANY tokens per day and no credit card. AnyAPI is an OpenAI-compatible gateway with explicitly free models plus paid models.

```bash
export ANYAPI_API_KEY="..."
```

Use `/toggle-anyapi` to switch between free models and the full catalog. Details: [anyapi.ai/pricing](https://anyapi.ai/pricing).

### Ollama Cloud

Usage-based free tier, resets every 5 hours + 7 days.

```bash
export OLLAMA_API_KEY="..."
```

Or in `~/.pi/free.json`:

```json
{
  "ollama_api_key": "YOUR_KEY",
  "ollama_show_paid": true
}
```

### SambaNova

Free tier: 20-480 RPM, 400-9600 RPD (no credit card). Models include Llama 3.3 70B, DeepSeek-V3/R1, Llama 4 Maverick.

```bash
export SAMBANOVA_API_KEY="..."
```

---

## 💳 Paid Providers

### ZenMux

200+ models from OpenAI, Anthropic, Google, etc.

```bash
export ZENMUX_API_KEY="..."
```

### CrofAI

OpenAI-compatible API with streaming and reasoning models.

```bash
export CROFAI_API_KEY="..."
```

### DeepInfra

$5 one-time trial credit, no credit card. ~5M tokens, expires after 90 days. 60 RPM.

```bash
export DEEPINFRA_TOKEN="..."
```

### Novita

100+ open-source models, OpenAI-compatible, 3 free models.

```bash
export NOVITA_API_KEY="..."
```

### Routeway

OpenAI-compatible gateway with `:free` models.

```bash
export ROUTEWAY_API_KEY="sk-..."
```

### b.ai

Paid provider.

```bash
export BAI_API_KEY="..."
```

---

## 🔧 Dynamic API Providers

Fetched only when the corresponding API key is configured.

| Provider | Env Var | Config Key |
|---|---|---|
| OpenRouter | `OPENROUTER_API_KEY` | (uses Pi auth) |
| FastRouter | always discovered | `fastrouter_api_key` |

---

## Built-in Pi Providers

These are now built into Pi — no extension needed:

- **Fireworks** — set `FIREWORKS_API_KEY`
- **NVIDIA NIM** — set `NVIDIA_API_KEY`

---

## Removing a Provider

To remove a provider that is no longer working (e.g., free tier expired):

1. Open an issue describing the problem
2. The provider will be removed in the next release and noted in [CHANGELOG.md](../CHANGELOG.md)

See Naraya AI Router as an example — removed in v2.0.9 because their `/v1/*` gateway went down.
