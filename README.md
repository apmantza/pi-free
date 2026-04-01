# pi-free-providers

Free AI model providers for [Pi](https://pi.dev). Access **60+ free models** from multiple providers in one install.

## What This Extension Does

This extension registers multiple AI providers with Pi, **filtering to show only free models by default**. If you have API keys, you can toggle to see paid models too.

| Provider | Free Models | Auth Required | Rate Limit |
|----------|-------------|---------------|------------|
| **OpenCode Zen** | 11 | None | 1000/day |
| **Kilo** | 14 | OAuth (free) | 200/hour |
| **OpenRouter** | 29 | Free account | 1000/day |
| **NVIDIA NIM** | Curated 70B+ | Free credits | 1000 credits/mo (some models cost more) |
| **Cline** | Free tier | Free account | Varies |
| **Fireworks** | Free tier | API key | Varies |
| **Mistral** | Free tier | API key | Varies |
| **Ollama** | Cloud models | Free API key | Resets every 5hrs + 7 days |

---

## Quick Start

### 1. Install Pi

```bash
npm install -g @mariozechner/pi-coding-agent
```

### 2. Install This Extension

```bash
pi install git:github.com/apmantza/pi-free
```

### 3. Start Pi

```bash
pi
```

### 4. Select a Free Model

Press `Ctrl+L` to open the model picker. Free models are shown by default.

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

### Kilo (14 free models)

```
/login kilo
```

- Opens browser for one-time OAuth
- No credit card required
- 14 free models unlocked (200 req/hour limit)
- After login, use `/kilo-all` to see 300+ models

### OpenRouter (29 free models)

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

```
/login cline
```

Browser sign-in required. Uses local ports 48801-48811.

### Fireworks / Mistral

Add API keys to `~/.pi/free.json` or environment variables:

```bash
export FIREWORKS_API_KEY="..."
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
| `/fireworks-toggle` | Toggle between free/all Fireworks models |
| `/mistral-toggle` | Toggle between free/all Mistral models |
| `/ollama-toggle` | Toggle between free/all Ollama models |

**The toggle command:**
- Switches between showing only free models vs. all available models
- **Persists your preference** to `~/.pi/free.json` for next startup
- Shows a notification: "zen: showing 11 free models" or "zen: showing all 47 models (including paid)"

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

## Understanding Rate Limits

Free tiers have limits. When you hit them:

- **Kilo**: 200 requests/hour
- **Zen**: 1000 requests/day  
- **OpenRouter**: 1000 requests/day (free tier)
- **NVIDIA**: 1000 credits/month. Some models consume credits faster — toggle with `/nvidia-toggle`
- **Ollama**: Resets every 5 hours + 7 days
- **Fireworks/Mistral/Cline**: Varies by account

The extension will notify you when you hit limits. Switch providers with `/model` or wait for the limit to reset.

---

## Troubleshooting

### Models not appearing in Ctrl+L

1. Check if the provider needs authentication (see table above)
2. For OAuth providers (Kilo, Cline), run `/login {provider}`
3. For API key providers, check your key is set correctly
4. Press `Ctrl+L` again to refresh

### "Rate limit exceeded" errors

- Use `/model` to switch to a different provider
- Wait for the rate limit to reset (times vary by provider)
- Some providers allow more requests if you add a payment method

### Authentication issues

**Kilo OAuth not working:**
- Try `/logout kilo` then `/login kilo` again
- Check browser allows popups

**Cline login fails:**
- Ensure ports 48801-48811 are not blocked by firewall
- Try `/logout cline` then `/login cline`

### Provider-specific issues

**OpenRouter showing no models:**
- Verify your key starts with `sk-or-v1-`
- Run `/openrouter-free` to see free models without key

**NVIDIA showing no models:**
- Verify your key starts with `nvapi-`
- Check key is still valid at build.nvidia.com
- By default, only zero-cost models are shown. Run `/nvidia-toggle` to see all models (uses credits faster)

**Ollama showing no models:**
- Get API key from [ollama.com/settings/keys](https://ollama.com/settings/keys)
- **Required:** Set `OLLAMA_SHOW_PAID=true` (env var) or `"ollama_show_paid": true` (config)
- Ollama requires this flag because they have usage limits

---

## How It Works

This extension registers providers with Pi using the standard OpenAI-compatible API format. Each provider:

1. Fetches available models from the provider's API
2. Filters to free-only by default (checking `cost.input === 0`)
3. Registers with Pi's model registry
4. Provides toggle commands to switch between free/all models
5. Handles errors (rate limits, auth failures, network issues)

The extension doesn't proxy or modify requests — it just makes the providers available in Pi's model picker.

---

## Development

```bash
git clone https://github.com/apmantza/pi-free
cd pi-free
npm install
npm test
```

### Project Structure

```
providers/          # Provider implementations
  kilo.ts          # Kilo gateway (300+ models)
  zen.ts           # OpenCode Zen (11 free)
  openrouter.ts    # OpenRouter (29 free, 300+ paid)
  nvidia.ts        # NVIDIA NIM (70B+ models)
  cline.ts         # Cline.bot
  fireworks.ts     # Fireworks AI
  mistral.ts       # Mistral AI
  ollama.ts        # Local Ollama

provider-failover/  # Error handling
  errors.ts        # Error classification
  index.ts         # Failover coordinator
  hardcoded-benchmarks.ts  # Model scoring data

usage/             # Usage tracking
  tracking.ts      # Per-model request counts
  cumulative.ts    # Persistent storage
  formatters.ts    # Display formatting

config.ts          # Configuration loading
constants.ts       # Provider URLs, etc.
provider-helper.ts # Shared provider setup
```

---

## License

MIT — See [LICENSE](LICENSE)

**Questions?** [Open an issue](https://github.com/apmantza/pi-free/issues)
