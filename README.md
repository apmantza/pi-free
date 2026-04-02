# pi-free-providers

Free AI model providers for [Pi](https://pi.dev). Access **free models** from multiple providers in one install.

---

## What does pi-free do

**pi-free is a Pi extension that unlocks free AI models from 8 different providers.**

When you install pi-free, it:

1. **Registers 7 AI providers** with Pi's model picker — OpenCode Zen, Kilo, OpenRouter, NVIDIA NIM, Cline, Mistral, and Ollama Cloud

2. **Filters to show only free models by default** — You see only the models that cost $0 to use, no API key required for some providers

3. **Provides a toggle command** — Run `/{provider}-toggle` (e.g., `/zen-toggle`, `/kilo-toggle`) to switch between free-only mode and showing all models including paid ones

4. **Handles authentication for you** — OAuth flows (Kilo, Cline) open your browser automatically; API keys are read from `~/.pi/free.json` or environment variables

5. **Adds Coding Index scores** — Model names include a coding benchmark score (CI: 45.2) to help you pick capable coding models at a glance

6. **Persists your preferences** — Your toggle choices (free vs all models) are saved to `~/.pi/free.json` and remembered across Pi restarts

---

## How to use

### 1. Install the extension

```bash
pi install git:github.com/apmantza/pi-free
```

### 2. Open the model picker

Start Pi and press `Ctrl+L` to open the model picker.

Free models are shown by default — look for the provider prefixes:
- `zen/` — OpenCode Zen models (no setup required)
- `kilo/` — Kilo models (free models available immediately, more after `/login kilo`)
- `openrouter/` — OpenRouter models (free account required)
- `nvidia/` — NVIDIA NIM models (free API key required)
- `cline/` — Cline models (run `/login cline` to use)
- `mistral/` — Mistral models (API key required)
- `ollama/` — Ollama Cloud models (API key required)

### 3. Toggle between free and paid models

Want to see paid models too? Run the toggle command for your provider:

```
/zen-toggle      # Toggle Zen free/paid models
/kilo-toggle     # Toggle Kilo free/paid models
/openrouter-toggle  # Toggle OpenRouter free/paid models
/nvidia-toggle   # Toggle NVIDIA zero-cost/credit-costing models
/cline-toggle    # Toggle Cline free/paid models
/mistral-toggle  # Toggle Mistral free/paid models
/ollama-toggle   # Toggle Ollama models (requires SHOW_PAID=true)
```

You'll see a notification like: `zen: showing free models` or `zen: showing all models (including paid)`

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
  "ollama_api_key": "...",
  "fireworks_api_key": "...",
  "mistral_api_key": "..."
}
```

Or set environment variables instead (same names, uppercase: `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`, etc.)

See the [Providers That Need Authentication](#providers-that-need-authentication) section below for detailed setup instructions per provider.

### 5. Quick commands reference

| Command | What it does |
|---------|-------------|
| `/{provider}-toggle` | Switch between free-only and all models for that provider |
| `/login kilo` | Start OAuth flow for Kilo |
| `/login cline` | Start OAuth flow for Cline |
| `/logout kilo` | Clear Kilo OAuth credentials |
| `/logout cline` | Clear Cline OAuth credentials |

---

## Using Free Models (No Setup Required)

### OpenCode Zen — Easiest Start

Works immediately with zero setup:

1. Press `Ctrl+L`
2. Search for `zen/`
3. Pick any model (e.g., `zen/mimo-v2-omni-free`)
4. Start chatting

No account, no API key, no OAuth.

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

---

## Providers That Need Authentication

Some providers require free accounts or OAuth to access their free tiers:

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
- After login, run `/kilo-toggle` to switch between free-only and all models

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

Then in Pi:
```
/openrouter-all   # Show all models (free + paid)
```

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

Toggle anytime with `/nvidia-toggle`

### Cline

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

### Mistral

Add API key to `~/.pi/free.json` or environment variables:

```bash
export MISTRAL_API_KEY="..."
```

---

## Slash Commands

Each provider has toggle commands to switch between free and all models:

| Command | Action |
|---------|--------|
| `/zen-toggle` | Toggle between free/all Zen models |
| `/kilo-toggle` | Toggle between free/all Kilo models |
| `/openrouter-toggle` | Toggle between free/all OpenRouter models |
| `/nvidia-toggle` | Toggle between free/all NVIDIA models |
| `/cline-toggle` | Toggle between free/all Cline models |
| `/mistral-toggle` | Toggle between free/all Mistral models |
| `/ollama-toggle` | Toggle between free/all Ollama models |

**The toggle command:**
- Switches between showing only free models vs. all available models
- **Persists your preference** to `~/.pi/free.json` for next startup
- Shows a notification: "zen: showing free models" or "zen: showing all models (including paid)"

---

## Configuration

Create `~/.pi/free.json` in your home directory:

```json
{
  "openrouter_api_key": "YOUR_OPENROUTER_KEY",
  "nvidia_api_key": "YOUR_NVIDIA_KEY",
  "fireworks_api_key": "YOUR_FIREWORKS_KEY",
  "mistral_api_key": "YOUR_MISTRAL_KEY",
  "opencode_api_key": "YOUR_ZEN_KEY",
  "ollama_api_key": "YOUR_OLLAMA_KEY",
  "ollama_show_paid": true,
  "hidden_models": ["model-id-to-hide"]
}
```

Or use environment variables (same names, uppercase):

```bash
export OPENROUTER_API_KEY="..."
export NVIDIA_API_KEY="..."
```

---

## License

MIT — See [LICENSE](LICENSE)

**Questions?** [Open an issue](https://github.com/apmantza/pi-free/issues)
