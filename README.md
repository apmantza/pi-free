# pi-free

All-in-one free model providers for [Pi](https://pi.dev) — the coding agent CLI.

Add five AI providers with **60+ free models** in a single install:

| Provider | Free models | Needs key? |
|---|---|---|
| **Kilo** | 14 | Free account (OAuth) |
| **OpenCode Zen** | 11 | No signup needed |
| **OpenRouter** | 29 | Free account |
| **NVIDIA NIM** | 70B+ curated models | Free credits on signup |
| **Cline** | Free tier models | Free account |

---

## Why use this?

- **Start immediately** — Zen works with zero configuration, Kilo only needs free signup
- **One config file** — Manage all API keys in `~/.pi/free.json`
- **Smart defaults** — Only free models shown unless you opt into paid
- **Usage dashboard** — Track quotas and costs across all providers
- **No conflicts** — Works alongside your existing Pi provider setup

---

## Install

### Prerequisites

Install Pi (if you haven't already):

```bash
npm install -g @mariozechner/pi-coding-agent
```

### Add the extension

```bash
pi install git:github.com/apmantza/pi-free
```

### Start Pi

```bash
pi
```

Press `Ctrl+L` to see all available models.

---

**That's it.** Zen models work immediately. Kilo needs a free signup (`/login kilo`), and OpenRouter/NVIDIA/Cline need API keys.

---

## Quick start (no keys needed)

**OpenCode Zen works immediately** — no account, no API key required:

```bash
pi
```

Then press `Ctrl+L` to open the model selector and pick any model prefixed with `zen/`.

**Kilo** offers 14 free models after a quick one-time OAuth signup (`/login kilo`).

**Want more models?** Add API keys for OpenRouter, NVIDIA, or Cline (see [Adding API keys](#adding-api-keys)).

---

## Usage dashboard

Press `/usage` to open a floating dashboard that tracks:

- **Per-provider stats** — Request counts (session + daily)
- **Credit balances** — Kilo and OpenRouter remaining credits
- **Progress bars** — Visual indicators for daily limits
- **Cumulative metrics** — Total tokens used and cost saved across all sessions

The dashboard updates in real-time as you use models. Run `/usage` again to close it.

**Note:** Requires [glimpseui](https://github.com/nicehash/glimpseui). If not installed, Pi's built-in footer still shows per-request token/cost info.

---

## Adding API keys

API keys unlock additional providers and paid models. You can store them in a config file or use environment variables.

### Config file (recommended)

Create `~/.pi/free.json`:

```json
{
  "openrouter_api_key": "sk-or-v1-...",
  "nvidia_api_key":     "nvapi-...",
  "opencode_api_key":   "oc-...",
  "cline_api_key":      "cl-...",
  "show_paid":          false,
  "kilo_free_only":     false,
  "hidden_models":      []
}
```

| Option | Description |
|--------|-------------|
| `show_paid` | Include paid models for providers where you have a key |
| `kilo_free_only` | Restrict Kilo to free models even after OAuth login |
| `hidden_models` | Array of model IDs to hide from the selector |

### Environment variables

Set these before starting Pi (they override the config file):

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
export NVIDIA_API_KEY="nvapi-..."
export OPENCODE_API_KEY="oc-..."
export CLINE_API_KEY="cl-..."
export PI_FREE_SHOW_PAID=true
export PI_FREE_KILO_FREE_ONLY=true
```

### Get your free keys

| Provider | Where to get a key | Cost |
|---|---|---|
| **OpenRouter** | [openrouter.ai/keys](https://openrouter.ai/keys) | Free account, no credit card |
| **NVIDIA NIM** | [build.nvidia.com](https://build.nvidia.com) | Free credits on signup |
| **OpenCode Zen** | [opencode.ai/auth](https://opencode.ai/auth) | Optional — free models work without a key |
| **Cline** | [cline.bot](https://cline.bot) | Free account |

**Tip:** Start with no keys to test Kilo/Zen, then add keys one at a time to unlock more providers.

---

## Kilo authentication (free)

Kilo requires a free account to use models. Sign up once via OAuth:

Inside Pi:
```
/login kilo
```

This opens your browser to authorize the session. **No payment required** — just free account creation. Once approved:
- 14 Kilo models available for free
- Session saved locally — no re-login needed
- After login, optionally use `/kilo-all` to see 300+ paid models

To log out:
```
/logout kilo
```

**Alternative:** Set `KILO_API_KEY` environment variable if you have an API key.

---

## Cline authentication

Cline provides access to curated free-tier models. To authenticate:

Inside Pi:
```
/login cline
```

A browser window opens for sign-in. Once approved, Cline models appear in the model selector.

**Troubleshooting Cline auth:**
- **Browser doesn't open?** Paste the authorization URL manually when prompted
- **Callback fails?** Ports 48801-48811 must be accessible (check firewall)
- **Still not working?** Set `CLINE_API_KEY` directly in `~/.pi/free.json` as a workaround

The auth flow is based on [pi-cline](https://github.com/sudosubin/pi-frontier/tree/main/pi-cline)'s implementation.

---

## Showing paid models

By default, **only free models are shown** for each provider. You have two options to show paid models:

### Option 1: Config file (persistent)

Set `show_paid` in `~/.pi/free.json`:

```json
{
  "show_paid": true
}
```

Or via environment variable:

```bash
export PI_FREE_SHOW_PAID=true
```

### Option 2: Slash commands (dynamic, per-session)

Toggle between free and paid models **without restarting Pi**:

| Command | Description |
|---------|-------------|
| `/kilo-free` | Show only free Kilo models (14) |
| `/kilo-all` | Show all Kilo models (300+ after login) |
| `/openrouter-free` | Show only free OpenRouter models (29) |
| `/openrouter-all` | Show all OpenRouter models (300+) |
| `/zen-free` | Show only free Zen models (11) |
| `/zen-all` | Show all Zen models (requires key) |
| `/nvidia-free` | Show only free NVIDIA models |
| `/nvidia-all` | Show all NVIDIA models |
| `/cline-free` | Show only free Cline models |
| `/cline-all` | Show all Cline models |

**Tip:** Use `/kilo-free` after OAuth login to keep the model selector focused on free options.

---

## Existing Pi configuration

Already have OpenRouter or OpenCode configured in Pi? This extension **works alongside your setup**:

1. ✅ **Your existing key is preserved** — The extension detects and uses it
2. ✅ **Models auto-filter to free-only** — Unless you run `/openrouter-all` or `/zen-all`
3. ✅ **No conflicts** — Both your original config and this extension coexist

**Bottom line:** You can install this extension and immediately get free model filtering without any configuration changes.

---

## Hiding specific models

Hide unwanted models by adding their IDs to `~/.pi/free.json`:

```json
{
  "hidden_models": ["meta-llama/llama-3.1-8b-instruct", "some-unwanted-model"]
}
```

**Per-provider hiding** (optional):
```json
{
  "hidden_models": {
    "openrouter": ["meta-llama/llama-3.1-8b-instruct"],
    "kilo": ["some-kilo-model"],
    "zen": ["another-zen-model"]
  }
}
```

Hidden models persist across sessions and can be set globally or per-provider.

---

## Provider model availability

| Provider | Free models | With key / login | Notes |
|----------|-------------|------------------|-------|
| **Kilo** | 14 | 300+ paid models | Free signup via `/login kilo` |
| **OpenCode Zen** | 11 | All models | No signup for free, `opencode_api_key` for paid |
| **OpenRouter** | 29 | 300+ models | Free account, `openrouter_api_key` required |
| **NVIDIA NIM** | All 70B+ curated | Same | Free credits on signup |
| **Cline** | Free tier | Free tier only | Free account required |

**Total free models:** 60+ models across all providers.

---

## NVIDIA model filter

NVIDIA NIM offers hundreds of models. This extension curates them for quality:

- ✅ **70B+ parameter models** — Large, capable models only
- ✅ **MoE models included** — Where size can't be directly inferred
- ❌ **Excluded:** Embedding, speech/audio, OCR, image generation

This removes smaller models (Phi, Gemma 7B, etc.) and non-chat models. The threshold (`MIN_SIZE_B = 70`) is defined in `nvidia.ts` if you want to customize it.

---

## File layout

### Config files (in `~/.pi/`)

```
free.json       ← Your API keys and settings (create manually)
free-usage.json ← Cumulative usage stats (auto-managed)
```

### Extension files

| File | Purpose |
|------|---------|
| `kilo.ts` | Kilo provider entry point |
| `kilo-auth.ts` | Kilo device OAuth flow |
| `kilo-models.ts` | Kilo model fetch + mapping |
| `zen.ts` | OpenCode Zen provider |
| `openrouter.ts` | OpenRouter provider |
| `nvidia.ts` | NVIDIA NIM provider (70B+ filter) |
| `cline.ts` | Cline provider + message shaping |
| `cline-auth.ts` | Cline OAuth flow |
| `cline-models.ts` | Cline model fetch |

### Shared utilities

| File | Purpose |
|------|---------|
| `provider-helper.ts` | Shared boilerplate (commands, events) |
| `usage-widget.ts` | Floating usage dashboard (glimpseui) |
| `usage-store.ts` | Persistent cumulative usage tracking |
| `config.ts` | Config loading (keys, flags, hidden models) |
| `constants.ts` | Provider names, URLs, thresholds |
| `types.ts` | TypeScript interfaces |
| `util.ts` | Helpers: `parsePrice`, `fetchWithRetry`, `isUsableModel` |
| `metrics.ts` | Request counting, rate limit tracking |

---

## Troubleshooting

### Models not appearing

**OpenRouter / NVIDIA / Cline show no models**
- Verify API key is correct in `~/.pi/free.json` or environment variable
- Check key format: `sk-or-v1-...` for OpenRouter, `nvapi-...` for NVIDIA
- Press `Ctrl+L` to confirm other providers (Kilo, Zen) are working

**Kilo models disappeared after restart**
- Run `/login kilo` — session token may have expired

**Zen models not connecting**
- Free models should work without a key — try `/zen-free` command
- If using a key, verify `opencode_api_key` in config or `OPENCODE_API_KEY` env var

---

### Authentication issues

**Cline login not completing**
- Callback uses ports 48801-48811 — ensure firewall allows these
- On remote machines, paste the full callback URL when prompted in browser
- Workaround: set `CLINE_API_KEY` directly in `~/.pi/free.json`

**Kilo OAuth fails**
- Ensure browser can reach `kilotext.com`
- Try `/logout kilo` then `/login kilo` again

---

### Usage dashboard

**`/usage` won't open**
- Requires [glimpseui](https://github.com/nicehash/glimpseui)
- Pi's built-in footer still shows per-request token/cost info

**Dashboard shows wrong totals**
- Reset usage data: delete `~/.pi/free-usage.json`
- Data repopulates on next request

---

### General

**Want to see what models are loaded?**
- Press `Ctrl+L` in Pi — all active providers and models appear there

**Extension not loading at all**
- Check install path: `~/.pi/agent/git/github.com/apmantza/pi-free`
- Verify `package.json` has `"pi"` field with extensions array
- Restart Pi after installation

**Need help?**
- Open an issue: [github.com/apmantza/pi-free/issues](https://github.com/apmantza/pi-free/issues)
- Check Pi's logs: `~/.pi/logs/`
