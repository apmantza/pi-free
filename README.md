# pi-free-providers

Free AI model providers for [Pi](https://pi.dev). Access **free models** from multiple providers in one install.

---

## What does pi-free do

**pi-free is a Pi extension that unlocks free AI models from multiple providers.**

When you install pi-free, it:

1. **Registers free-tier providers** with Pi's model picker — Kilo, Cline, NVIDIA, Cloudflare, Modal, Ollama Cloud, and more

2. **Fetches models dynamically** from provider APIs — Cloudflare Workers AI (30+ models), NVIDIA NIM, and Pi's built-in providers (Mistral, Groq, Cerebras, xAI, Hugging Face, OpenRouter) when API keys are configured

3. **Filters to show only free models by default** for providers that expose pricing — You see only the models that cost $0 to use. Paid models are hidden until you explicitly toggle them on.

4. **Provides per-provider toggle commands** — Run `/toggle-{provider}` (e.g., `/toggle-kilo`, `/toggle-opencode`) to switch between free-only mode and showing all models including paid ones. Changes apply immediately and your preference is saved for the next Pi restart.

5. **Handles authentication for you** — OAuth flows (Kilo, Cline) open your browser automatically; API keys are read from `~/.pi/free.json` or environment variables

6. **Adds Coding Index scores** — Model names include a coding benchmark score (CI: 45.2) to help you pick capable coding models at a glance

7. **Persists your preferences** — Your toggle choices (free vs all models) are saved to `~/.pi/free.json` and remembered across Pi restarts

---

## How to use

### 1. Install the extension

```bash
pi install git:github.com/apmantza/pi-free
```

### 2. Open the model picker

Start Pi and press `Ctrl+L` to open the model picker.

Free models are shown by default — look for the provider prefixes:

**✅ Offers Free Models (no usage limits, no payment required):**

- `opencode/` — OpenCode models (no setup required; toggle with `/toggle-opencode`)
- `kilo/` — Kilo models (free models available immediately, more after `/login kilo`)
- `openrouter/` — OpenRouter models (free account required)
- `cline/` — Cline models (run `/login cline` to use)

**🔄 Freemium (free tier with limits, then paid):**

- `nvidia/` — NVIDIA NIM models (1,000 free requests/month, then credits)
- `cloudflare/` — Cloudflare Workers AI (10K Neurons/day free tier, then $0.011/1K Neurons)
- `modal/` — GLM-5.1 FP8 via Modal (free promotional period until April 30, 2026)
- `ollama-cloud/` — Ollama Cloud models (usage-based free tier, resets every 5 hours + 7 days)

**🔧 Dynamic API Providers (fetched when API key configured):**

- `mistral/` — Mistral models (when `MISTRAL_API_KEY` set)
- `groq/` — Groq models (when `GROQ_API_KEY` set)
- `cerebras/` — Cerebras models (when `CEREBRAS_API_KEY` set)
- `xai/` — xAI models (when `XAI_API_KEY` set)
- `huggingface/` — Hugging Face models (when `HF_TOKEN` set)

**Note:** Fireworks is now a [built-in Pi provider](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/CHANGELOG.md#0681---2026-04-22) — no extension needed. Set `FIREWORKS_API_KEY` to use it directly.

### 3. Toggle between free and paid models

Want to see paid models too? Run the toggle command for your provider:

```
/toggle-opencode   # Toggle OpenCode (✅ offers free models)
/toggle-kilo       # Toggle Kilo (✅ offers free models)
/toggle-openrouter # Toggle OpenRouter (✅ offers free models)
/toggle-cline      # Toggle Cline (✅ offers free models)
/toggle-nvidia     # Toggle NVIDIA (🔄 freemium)
/toggle-cloudflare # Toggle Cloudflare (🔄 freemium)
/toggle-ollama     # Toggle Ollama Cloud (🔄 freemium)
/toggle-mistral    # Toggle Mistral (🔧 dynamic - needs API key)
/toggle-groq       # Toggle Groq (🔧 dynamic - needs API key)
/toggle-cerebras   # Toggle Cerebras (🔧 dynamic - needs API key)
```

**Notes:**

- **Toggle commands are mainly for ✅ and 🔄 providers** — to switch between "free models only" vs "show paid models too"
- **🔧 Dynamic providers** show all fetched models by default — the toggle filters the list when you have an API key configured
- **Freemium providers** show all models by default; you manage your usage limits via their dashboards

You'll see a notification like: `opencode: showing free models` or `opencode: showing all models`

**Note:** Built-in provider toggles such as OpenCode and OpenRouter update in the current session — no restart needed.

### 4. Add API keys for more providers (optional)

Some providers require a free account or API key.

**The first time you run Pi after installing this extension, a config file is automatically created:**

- **Linux/Mac:** `~/.pi/free.json`
- **Windows:** `%USERPROFILE%\.pi\free.json`

Add your API keys to this file:

```json
{
  "openrouter_api_key": "sk-or-v1-...",
  "nvidia_api_key": "nvapi-...",
  "cloudflare_api_token": "...",
  "cloudflare_account_id": "...",
  "ollama_api_key": "...",
  "mistral_api_key": "...",
  "modal_api_key": "sk-modal-..."
}
```

Or set environment variables instead (same names, uppercase: `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`, etc.)

If `~/.pi/free.json` contains invalid JSON, pi-free now logs the parse error to `~/.pi/free.log` so you can fix the file quickly.

See the [Providers That Need Authentication](#providers-that-need-authentication) section below for detailed setup instructions per provider.

### 5. Quick commands reference

| Command              | What it does                                              |
| -------------------- | --------------------------------------------------------- |
| `/toggle-{provider}` | Switch between free-only and all models for that provider |
| `/free-providers`    | Show free/paid model counts for all providers             |
| `/login kilo`        | Start OAuth flow for Kilo                                 |
| `/login cline`       | Start OAuth flow for Cline                                |
| `/logout kilo`       | Clear Kilo OAuth credentials                              |
| `/logout cline`      | Clear Cline OAuth credentials                             |

---

## Features

### 🔍 NVIDIA: Pre-Filtering + 404 Detection

NVIDIA's API lists 130+ models, but 57+ return 404 "Function not found" when you try to use them. pi-free solves this:

- **57 known 404s hard-filtered** — Discontinued models (`dbrx-instruct`, `codellama-70b`), embedding models mislabeled as chat-capable (`nv-embed-*`), and stale catalog entries are silently excluded
- **Auto-discovery from NVIDIA's API** — Queries `integrate.api.nvidia.com/v1/models` directly for the ground-truth list
- **`/probe-nvidia` command** — On-demand health check: tests every model with a minimal request, auto-hides new 404s, and re-registers immediately

### 🌩️ Cloudflare: Dynamic Model Discovery

Cloudflare Workers AI offers 80+ models including embeddings, image generation, and speech. pi-free automatically finds the chat models:

- **Live API fetching** — Calls Cloudflare's `/ai/models` endpoint on startup to get the current catalog
- **Smart filtering** — Automatically excludes embeddings (`bge-*`, `embed-*`), image generation (`flux`, `stable-diffusion`), speech (`whisper`, `aura-*`), translation, and vision-only models via regex patterns
- **Metadata inference** — Detects vision support (`llava`, `vision` in name), reasoning (`r1`, `thinking`, `qwq`), context windows, and estimated costs from model IDs
- **Expanding fallback** — 18 hand-curated models (Kimi K2.6, GPT-OSS, Qwen 2.5 Coder, QwQ, Llama 3.2 Vision, etc.) if API is unreachable

### 🎯 Coding Index (CI) Scores

Every model shows a **Coding Index score** (e.g., `CI: 52.3`) in the model picker:

- **Benchmark-based** — Scores derived from Artificial Analysis coding benchmarks (HumanEval, MBPP, etc.)
- **Quality indicator** — Higher scores = better coding performance
- **All providers** — Applied to every model from every provider (NVIDIA, Cloudflare, Mistral, Groq, etc.)

### 🔄 Free/Paid Model Toggling

Providers have different pricing models. pi-free handles them all:

- **Free-only by default** — Shows only zero-cost models initially
- **Per-provider toggles** — Run `/toggle-{provider}` to switch between "free only" vs "all models"
- **Persists across sessions** — Your preference is saved to `~/.pi/free.json`
- **Instant updates** — Changes apply immediately; no Pi restart needed

**Provider types:**

- ✅ **Free providers** (OpenCode, Kilo, Cline) — Toggle between free-only vs paid models
- 🔄 **Freemium** (NVIDIA, Cloudflare, Modal, Ollama) — Free tier with limits, toggle shows all
- 🔧 **Dynamic API** (Mistral, Groq, Cerebras, xAI) — Fetched when API key configured, toggle filters the list

### 🔐 OAuth + API Key Handling

Authentication is handled automatically:

- **OAuth flows** — `/login kilo` and `/login cline` open your browser, wait for authorization, and complete automatically
- **Multiple auth sources** — API keys read from `~/.pi/free.json`, environment variables, or standard Pi auth files (`~/.pi/agent/auth.json`)
- **Smart fallbacks** — New env var names (e.g., `CF_API_TOKEN`) with legacy support (`CLOUDFLARE_API_TOKEN`)

---

## Using Free Models (No Setup Required)

### OpenCode

Works immediately with zero setup:

1. Press `Ctrl+L`
2. Search for `opencode/`
3. Pick any model (e.g., `opencode/big-pickle`)
4. Start chatting

No account, no API key, no OAuth. Run `/toggle-opencode` to switch between free and paid OpenCode models.

### Kilo (free models, more after login)

Kilo shows free models immediately. To unlock all models, authenticate with Kilo's free OAuth:

```
/login kilo
```

This command will:

1. Open your browser to Kilo's authorization page
2. Show a device code in Pi's UI
3. Wait for you to authorize in the browser
4. Automatically complete login once approved

- No credit card required
- Free tier: 200 requests/hour
- After login, run `/toggle-kilo` to switch between free-only and all models

### Cline (free account)

Cline models appear immediately in the model picker. To use them, authenticate with Cline's free account:

```
/login cline
```

This command will:

1. Open your browser to Cline's sign-in page
2. Wait for you to complete sign-in
3. Automatically complete login once approved

- Free account required (no credit card)
- Uses local ports 48801-48811 for OAuth callback

---

## Providers That Need Authentication

Some providers require a free account or API key to access their free tiers.

---

### 🆓 Free Providers

### OpenRouter (free models available)

Get a free API key at [openrouter.ai/keys](https://openrouter.ai/keys), then either:

**Option A: Environment variable**

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
```

**Option B: Config file** (`~/.pi/free.json`)

```json
{
  "openrouter_api_key": "sk-or-v1-..."
}
```

Then use `/toggle-openrouter` to switch between free-only and all models.

### NVIDIA NIM (Free Credits System)

NVIDIA provides **free monthly credits** (1000 requests/month) at [build.nvidia.com](https://build.nvidia.com).

**Important:** Models have different "costs" per token:

- **Zero-cost models**: Don't consume your credit balance (shown by default)
- **Credit-costing models**: Consume credits faster (hidden by default)

Get your API key and optionally enable all models:

**Option A: Show only free models (default)**

```bash
export NVIDIA_API_KEY="nvapi-..."
```

Uses only zero-cost models → your 1000 credits last the full month

**Option B: Show all models (uses credits faster)**

```bash
export NVIDIA_API_KEY="nvapi-..."
export NVIDIA_SHOW_PAID=true
```

Or in `~/.pi/free.json`:

```json
{
  "nvidia_api_key": "nvapi-...",
  "nvidia_show_paid": true
}
```

Toggle anytime with `/toggle-nvidia`

### Cloudflare Workers AI (10K Neurons/day Free Tier)

Cloudflare provides **30+ text generation models** (auto-discovered from their API) with a generous free tier:

- **10,000 Neurons per day FREE** (resets daily at 00:00 UTC)
- **$0.011 per 1,000 Neurons** beyond the free allocation
- **Models auto-fetched** — All available chat models are discovered dynamically from Cloudflare's API

Get your API token at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens):

1. Create a token with "Cloudflare AI" → "Read" permission
2. Or use "My Account" → "Read" for broader access

**Setup:**

```bash
# New short env vars (recommended)
export CF_API_TOKEN="your_token_here"
export CF_ACCOUNT_ID="your_account_id"

# Legacy env vars also work
export CLOUDFLARE_API_TOKEN="your_token_here"
export CLOUDFLARE_ACCOUNT_ID="your_account_id"
```

**Models available:** Llama 4/3.x, Mistral Small 3.1, DeepSeek R1, Gemma 4, Kimi K2.5/2.6, Qwen 3/2.5, OpenAI GPT-OSS, and more.

Toggle with `/toggle-cloudflare`

### Modal (GLM-5.1 FP8 — free promotional period until April 30, 2026)

Modal hosts GLM-5.1 FP8 with a free promotional period. Get an API key at [modal.com](https://modal.com), then:

**Option A: Environment variable**

```bash
export MODAL_API_KEY="sk-modal-..."
```

**Option B: Config file** (`~/.pi/free.json`)

```json
{
  "modal_api_key": "sk-modal-..."
}
```

Then select a `modal/` model in the model picker.

**Details:**

- Free promotional period until April 30, 2026
- Model: GLM-5.1 FP8 (128k context, 16k max output)
- No credit card required during the promotional period

### Ollama Cloud

Get an API key from [ollama.com/settings/keys](https://ollama.com/settings/keys), then:

**Option A: Environment variable**

```bash
export OLLAMA_API_KEY="..."
export OLLAMA_SHOW_PAID=true
```

**Option B: Config file** (`~/.pi/free.json`)

```json
{
  "ollama_api_key": "YOUR_KEY",
  "ollama_show_paid": true
}
```

**Note:** Ollama requires `OLLAMA_SHOW_PAID=true` because they have usage limits on their cloud API.

Free tier resets every 5 hours + 7 days.

### Mistral (free API key)

Add API key to `~/.pi/free.json` or environment variables:

```bash
export MISTRAL_API_KEY="..."
```

---

## Slash Commands

Each provider has toggle commands to switch between free and all models:

| Command              | Action                                               |
| -------------------- | ---------------------------------------------------- |
| `/toggle-opencode`   | Toggle between free/all OpenCode models              |
| `/toggle-kilo`       | Toggle between free/all Kilo models                  |
| `/toggle-openrouter` | Toggle between free/all OpenRouter models            |
| `/toggle-cline`      | Toggle between free/all Cline models                 |
| `/toggle-nvidia`     | Toggle between free/all NVIDIA models                |
| `/toggle-cloudflare` | Toggle between free/all Cloudflare models            |
| `/toggle-ollama`     | Toggle between free/all Ollama Cloud models          |
| `/toggle-mistral`    | Toggle between free/all Mistral models (🔧 dynamic)  |
| `/toggle-groq`       | Toggle between free/all Groq models (🔧 dynamic)     |
| `/toggle-cerebras`   | Toggle between free/all Cerebras models (🔧 dynamic) |

**The toggle command:**

- **For ✅ free providers**: Switches between showing only free models vs. all available models (including paid)
- **For 🔄 freemium providers**: Shows all models by default; toggle switches between filtered and full list
- **For 🔧 dynamic API providers**: Filters the model list when you have an API key configured
- **Persists your preference** to `~/.pi/free.json` for next startup
- Shows a notification: "opencode: showing free models" or "opencode: showing all models"

---

## Configuration

Create `~/.pi/free.json` in your home directory:

```json
{
  "openrouter_api_key": "YOUR_OPENROUTER_KEY",
  "nvidia_api_key": "YOUR_NVIDIA_KEY",
  "cloudflare_api_token": "YOUR_CLOUDFLARE_TOKEN",
  "cloudflare_account_id": "YOUR_ACCOUNT_ID",
  "mistral_api_key": "YOUR_MISTRAL_KEY",
  "opencode_api_key": "YOUR_OPENCODE_KEY",
  "ollama_api_key": "YOUR_OLLAMA_KEY",
  "ollama_show_paid": true,
  "modal_api_key": "YOUR_MODAL_KEY",
  "hidden_models": ["model-id-to-hide"]
}
```

Or use environment variables (same names, uppercase):

```bash
export OPENROUTER_API_KEY="..."
export NVIDIA_API_KEY="..."
```

---

## Logging & Debugging

pi-free now writes extension logs to:

- **Windows:** `%USERPROFILE%\.pi\free.log`
- **Linux/macOS:** `~/.pi/free.log`

Useful env vars:

If the extension fails to read `~/.pi/free.json`, check this log first — config parse errors are written here.

```bash
# Console log verbosity (default: error)
LOG_LEVEL=debug

# File log verbosity (default: debug)
PI_FREE_LOG_LEVEL=debug

# Custom log path (optional)
PI_FREE_LOG_PATH=/tmp/pi-free.log

# Disable file logging
PI_FREE_FILE_LOG=false
```

---

## License

MIT — See [LICENSE](LICENSE)

**Questions?** [Open an issue](https://github.com/apmantza/pi-free/issues)
