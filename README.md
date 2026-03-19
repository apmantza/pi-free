# pi-free

All-in-one free model providers for [Pi](https://pi.dev) — the coding agent CLI.

Adds five providers in a single install:

| Provider | Free models | Needs key? |
|---|---|---|
| **Kilo** | 14 (no signup) | No — optional OAuth for paid |
| **OpenCode Zen** | 11 (no signup) | No — optional key for paid |
| **OpenRouter** | 29 | Yes (free account) |
| **NVIDIA NIM** | 70B+ models | Yes (free credits) |
| **Cline** | Free tier | Yes (free account) |

---

## Install

```bash
npm install -g @mariozechner/pi-coding-agent   # install Pi if you haven't
pi install git:github.com/apmantza/pi-free
```

---

## Quick start (no keys needed)

Kilo and OpenCode Zen work immediately with no account required:

```bash
pi
```

Press `Ctrl+L` to open the model selector and pick any Kilo or Zen model.

---

## Usage dashboard

Press `/usage` to open a floating dashboard showing free quota status across all providers:

- Request counts per provider (session + daily)
- Credit balances (Kilo, OpenRouter)
- Progress bars for daily limits (OpenRouter)
- Cumulative token usage and cost saved across all sessions

Requires [glimpseui](https://github.com/nicehash/glimpseui) — run `/usage` again to close.

---

## Adding API keys

Create `~/.pi/free.json` for persistent config:

```json
{
  "openrouter_api_key": "sk-or-v1-...",
  "nvidia_api_key":     "nvapi-...",
  "opencode_api_key":   "oc-...",
  "show_paid":          false,
  "kilo_free_only":     false,
  "hidden_models":      []
}
```

| Option | Description |
|--------|-------------|
| `show_paid` | Include paid models for providers where you have a key |
| `kilo_free_only` | Restrict Kilo to free models even after login |
| `hidden_models` | Array of model IDs to hide from the selector |

Or use environment variables (take priority over config file):

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
export NVIDIA_API_KEY="nvapi-..."
export OPENCODE_API_KEY="oc-..."
export PI_FREE_SHOW_PAID=true
export PI_FREE_KILO_FREE_ONLY=true
```

### Get your free keys

| Provider | Where to get a key |
|---|---|
| OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) — free account, no credit card |
| NVIDIA NIM | [build.nvidia.com](https://build.nvidia.com) — free credits on signup |
| OpenCode Zen | [opencode.ai/auth](https://opencode.ai/auth) — optional, free models work without one |
| Cline | [cline.bot](https://cline.bot) — free account |

---

## Kilo authentication (for paid / all models)

Kilo uses a browser-based device flow. Inside Pi:

```
/login kilo
```

This opens your browser. Approve the request and all 300+ Kilo models become available in the model selector. Your session is saved — you won't need to log in again.

To log out:

```
/logout kilo
```

Alternatively, set `KILO_API_KEY` directly if you have a Kilo API key.

---

## Cline authentication

Cline uses a browser-based OAuth flow. Inside Pi:

```
/login cline
```

A browser window opens for sign-in. Once approved, free Cline models are available. Auth flow is based on [pi-cline](https://github.com/sudosubin/pi-frontier/tree/main/pi-cline)'s implementation.

---

## Showing paid models

By default each provider only shows its **free** models. To unlock paid models for providers where you have a key, set `show_paid` in `~/.pi/free.json`:

```json
{
  "show_paid": true
}
```

Or via environment variable:

```bash
export PI_FREE_SHOW_PAID=true
```

### Dynamic toggle with commands

You can also toggle between free and all models **live** using slash commands:

| Command | Description |
|---------|-------------|
| `/kilo-free` | Show only free Kilo models |
| `/kilo-all` | Show all Kilo models (free + paid) |
| `/openrouter-free` | Show only free OpenRouter models |
| `/openrouter-all` | Show all OpenRouter models (free + paid) |
| `/zen-free` | Show only free Zen models |
| `/zen-all` | Show all Zen models (free + paid) |
| `/nvidia-free` | Show only free NVIDIA models |
| `/nvidia-all` | Show all NVIDIA models (free + paid) |

These commands let you switch instantly without restarting Pi.

---

## Existing Pi configuration

If you already have OpenRouter or OpenCode configured in Pi's settings **before** installing this extension:

1. **Your existing key is preserved** — the extension uses your key, not its own
2. **Models are filtered to free-only** — unless you run `/openrouter-all` or `/zen-all`
3. **No conflicts** — the extension works alongside your existing setup

This means you can install the extension and immediately get free model filtering without any configuration!

---

## Hiding specific models

Add model IDs to `hidden_models` in `~/.pi/free.json` to remove them from the selector:

```json
{
  "hidden_models": ["meta-llama/llama-3.1-8b-instruct", "some-unwanted-model"]
}
```

This works for all providers and persists across sessions.

---

## Provider model availability

| Provider | Free only | With key (show_paid: true) |
|----------|------------|----------------------------|
| Kilo | 14 free models | All 300+ models (after `/login kilo`) |
| OpenCode Zen | 11 free models | All models (requires `opencode_api_key`) |
| OpenRouter | 29 free models | 300+ models (requires `openrouter_api_key`) |
| NVIDIA NIM | All 70B+ models | Same (uses free credits) |
| Cline | Free tier models | Free tier only |

---

## NVIDIA model filter

NVIDIA NIM is filtered to keep only large, high-quality models:

- **Minimum size: 70B parameters** (or MoE models where size can't be inferred)
- **Excluded types:** embedding models, speech/audio, OCR, image generation

This removes noise like small Phi, Gemma, and 7B variants. If you want everything, this threshold is defined as `MIN_SIZE_B` in `nvidia.ts`.

---

## File layout

```
~/.pi/free.json       ← your API keys and config (create this)
~/.pi/free-cache.json ← model cache (auto-managed, 1hr TTL)
~/.pi/free-usage.json ← cumulative usage stats (auto-managed)

# Extension files (managed by Pi):
kilo.ts               ← Kilo provider entry point
kilo-auth.ts          ← Kilo device OAuth flow
kilo-models.ts        ← Kilo model fetch + mapping
zen.ts                ← OpenCode Zen provider
openrouter.ts         ← OpenRouter provider
nvidia.ts             ← NVIDIA NIM provider
cline.ts              ← Cline provider (free models, message shaping)
cline-auth.ts         ← Cline OAuth flow
cline-models.ts       ← Cline model fetch

# Shared:
provider-helper.ts    ← shared provider boilerplate (commands, events)
usage-widget.ts       ← glimpseui floating usage dashboard
usage-store.ts        ← persistent cumulative usage tracking
config.ts             ← config loading (keys, flags)
constants.ts          ← provider names, URLs, thresholds
types.ts              ← TypeScript interfaces
util.ts               ← parsePrice, fetchWithRetry, isUsableModel, etc.
cache.ts              ← file-backed model cache
metrics.ts            ← request counting, rate limit tracking
```

---

## Troubleshooting

**No models appearing for OpenRouter / NVIDIA / Cline**
→ Check that your key is set correctly in `~/.pi/free.json` or as an env var.

**Kilo models disappeared after restart**
→ Run `/login kilo` again — the session token may have expired.

**Cline login not completing**
→ The callback server scans ports 48801-48811. Make sure these aren't blocked by a firewall. If on a remote machine, paste the full callback URL from the browser when prompted.

**`zen` provider not working with a key**
→ Make sure `opencode_api_key` is in `~/.pi/free.json`, or `OPENCODE_API_KEY` is exported before starting Pi.

**Usage widget won't open**
→ The `/usage` command requires [glimpseui](https://github.com/nicehash/glimpseui). If it's not installed, Pi's built-in footer still shows token/cost info.

**Want to see what models loaded**
→ Press `Ctrl+L` in Pi to open the model selector — all active providers and their models are listed there.
