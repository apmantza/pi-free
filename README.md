# pi-free

All-in-one free model providers for [Pi](https://pi.dev) — the coding agent CLI.

Adds four providers in a single install:

| Provider | Free models | Needs key? |
|---|---|---|
| **Kilo** | 14 (no signup) | No — optional OAuth for paid |
| **OpenCode Zen** | 11 (no signup) | No — optional key for paid |
| **OpenRouter** | 29 | Yes (free account) |
| **NVIDIA NIM** | 70B+ models | Yes (free credits) |

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

## Adding API keys

For OpenRouter and NVIDIA, create `~/.pi/free.json`:

```json
{
  "openrouter_api_key": "sk-or-v1-...",
  "nvidia_api_key":     "nvapi-...",
  "opencode_api_key":   "oc-...",
  "show_paid":          false
}
```

Or use environment variables (take priority over the config file):

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
export NVIDIA_API_KEY="nvapi-..."
export OPENCODE_API_KEY="oc-..."
```

### Get your free keys

| Provider | Where to get a key |
|---|---|
| OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) — free account, no credit card |
| NVIDIA NIM | [build.nvidia.com](https://build.nvidia.com) — free credits on signup |
| OpenCode Zen | [opencode.ai/auth](https://opencode.ai/auth) — optional, free models work without one |

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

Effect per provider:

| Provider | `show_paid: false` | `show_paid: true` |
|---|---|---|
| Kilo | Free models only | All models (after `/login kilo`) |
| OpenCode Zen | Free models only | All models (requires `opencode_api_key`) |
| OpenRouter | 29 free models | 300+ models (requires `openrouter_api_key`) |
| NVIDIA NIM | All 70B+ free-credit models | Same (no paid distinction) |

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

# Extension files (managed by Pi):
kilo.ts               ← Kilo provider entry point
kilo-auth.ts          ← Kilo device OAuth flow
kilo-models.ts        ← Kilo model fetch + mapping
kilo-footer.ts        ← Kilo status footer
zen.ts                ← OpenCode Zen provider
openrouter.ts         ← OpenRouter provider
nvidia.ts             ← NVIDIA NIM provider
config.ts             ← shared key resolution + SHOW_PAID flag
package.json          ← Pi extension manifest
```

---

## Troubleshooting

**No models appearing for OpenRouter / NVIDIA**
→ Check that your key is set correctly in `~/.pi/free.json` or as an env var.

**Kilo models disappeared after restart**
→ Run `/login kilo` again — the session token may have expired.

**`zen` provider not working with a key**
→ Make sure `opencode_api_key` is in `~/.pi/free.json`, or `OPENCODE_API_KEY` is exported before starting Pi.

**Want to see what models loaded**
→ Press `Ctrl+L` in Pi to open the model selector — all active providers and their models are listed there.
