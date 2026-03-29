# pi-free-providers

All-in-one free model providers for [Pi](https://pi.dev) — with **intelligent failover, automatic rate limit recovery, and capability-based ranking**.

Add five AI providers with **60+ free models** in a single install:

| Provider | Free models | Auth needed | Smart failover |
|---|---|---|---|
| **Kilo** | 14 | Free OAuth | ✅ Auto-hop on 429 |
| **OpenCode Zen** | 11 | None | ✅ Auto-compact + retry |
| **OpenRouter** | 29 | Free account | ✅ Capability-ranked |
| **NVIDIA NIM** | 70B+ curated | Free credits | ✅ 1000 req/month limit |
| **Cline** | Free tier | Free account | ✅ Auto-retry |

---

## ✨ What's New

### 🤖 Intelligent Failover
When you hit a 429 (rate limit):
1. **Auto-compacts** conversation to reduce tokens
2. **Retries same provider** with smaller payload
3. **Auto-hops to backup** provider if still failing
4. **Re-sends your message** automatically — no manual retry needed!

### 📊 Capability-Based Ranking
Models ranked by real benchmark data (Artificial Analysis API):
- **445 models** with Intelligence Index scores
- **"MiMo V2 Pro Free (CI 70)"** format shows Coding Index
- Prevents major capability downgrades (Claude Opus → tiny Llama)
- Same-tier hops allowed (GPT-4 ↔ Claude-3)

### 📈 Usage Tracking Commands
```
/free-sessionusage  - Current session stats with rate limit warnings
/free-totalusage    - All-time cumulative usage
```

Shows:
- Request counts per model
- Token usage (in/out)
- Rate limit status: 🟢 healthy / 🟡 warning / 🔴 critical

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

## Quick Start (No Keys Needed)

**OpenCode Zen works immediately** — no account, no API key:

```bash
pi
```

Press `Ctrl+L` and pick any model prefixed with `zen/`.

**Kilo** offers 14 free models after quick OAuth (`/login kilo`).

---

## 🚀 Auto-Failover in Action

When a provider hits a rate limit, here's what happens automatically:

```
You: Write a function to parse JSON...
Zen (Mimo): 429 Too Many Requests
     ↓
🗜️  Auto-compacting conversation...
     ↓ (2 seconds)
🔄  Retrying on Zen...
Still 429? → Hop to OpenRouter (same Mimo model)
     ↓ (3 seconds)
🔄  Auto-retrying on backup provider...
     ↓
OpenRouter (Mimo): "Here's the JSON parser function..."
```

**You don't lift a finger.** The conversation just continues.

---

## 📊 Usage Commands

Track your free tier usage:

### `/free-sessionusage` — Current Session
```
📊 Session Usage Report
━━━━━━━━━━━━━━━━━━━━━━━━
Total: 47 requests | 12,450 tokens in | 34,280 tokens out

🔥 Top Models:
  1. zen/mimo-v2-omni-free (12 req, 3,240 tokens)
  2. kilo/gpt-4o-mini (8 req, 2,100 tokens)

⚠️  Rate Limit Status:
  🟡 kilo: 170/200 req/hr (85%)
  🟢 openrouter: 45/1000 req/day (4%)
  🟢 nvidia: 12/1000 req/mo (1%)
```

### `/free-totalusage` — All-Time Stats
```
📈 Cumulative Usage (All Sessions)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total: 1,247 requests | 384K tokens

💰 Estimated cost saved: $142.80

Top providers:
  1. zen: 523 requests
  2. kilo: 412 requests
  3. openrouter: 312 requests
```

---

## Configuration

### Config file: `~/.pi/free.json`

```json
{
  "openrouter_api_key": "YOUR_OPENROUTER_KEY",
  "nvidia_api_key":     "YOUR_NVIDIA_KEY",
  "opencode_api_key":   "YOUR_ZEN_KEY",
  "cline_api_key":      "YOUR_CLINE_KEY",
  
  "show_paid":          false,
  "kilo_free_only":     false,
  "hidden_models":      [],
  
  "preferred_models":   ["mimo-v2-omni-free", "gpt-4o-mini"],
  "allow_downgrades":   "minor",
  "max_model_hops":     3
}
```

| Option | Description | Default |
|--------|-------------|---------|
| `show_paid` | Include paid models where you have a key | `false` |
| `kilo_free_only` | Restrict Kilo to free models even after login | `false` |
| `preferred_models` | Priority order for model failover | `[]` |
| `allow_downgrades` | `"never"`, `"minor"`, or `"always"` | `"minor"` |
| `max_model_hops` | Max providers to try before giving up | `3` |

### Environment variables

```bash
export OPENROUTER_API_KEY="YOUR_OPENROUTER_KEY"
export NVIDIA_API_KEY="YOUR_NVIDIA_KEY"
export PI_FREE_SHOW_PAID=true
export PI_FREE_ALLOW_DOWNGRADES=minor
```

---

## Slash Commands

| Command | Description |
|---------|-------------|
| `/kilo-free` | Show only free Kilo models (14) |
| `/kilo-all` | Show all Kilo models (300+ after login) |
| `/openrouter-free` | Show only free OpenRouter models (29) |
| `/openrouter-all` | Show all OpenRouter models (300+) |
| `/zen-free` | Show only free Zen models (11) |
| `/zen-all` | Show all Zen models |
| `/nvidia-free` | Show only free NVIDIA models |
| `/nvidia-all` | Show all NVIDIA models |
| `/cline-free` | Show only free Cline models |
| `/cline-all` | Show all Cline models |
| `/free-sessionusage` | Show current session usage |
| `/free-totalusage` | Show all-time cumulative usage |

---

## Get Free API Keys

| Provider | Where to get | Cost |
|---|---|---|
| **OpenRouter** | [openrouter.ai/keys](https://openrouter.ai/keys) | Free account |
| **NVIDIA NIM** | [build.nvidia.com](https://build.nvidia.com) | Free credits on signup |
| **OpenCode Zen** | [opencode.ai/auth](https://opencode.ai/auth) | Optional — free models work without |
| **Cline** | [cline.bot](https://cline.bot) | Free account |

---

## Authentication

### Kilo OAuth (Free)

```
/login kilo
```

- Opens browser for one-time signup
- 14 free models unlocked
- Session saved locally

### Cline OAuth

```
/login cline
```

- Browser sign-in (uses ports 48801-48811)
- Free tier models unlocked

---

## Provider Details

### Kilo
- **Free models:** 14 (after OAuth)
- **Rate limit:** 200 requests/hour
- **With login:** 300+ models

### OpenCode Zen
- **Free models:** 11 (no auth needed!)
- **Rate limit:** 1000 requests/day
- **Models:** Big Pickle, MiMo V2, Trinity, MiniMax

### OpenRouter
- **Free models:** 29
- **Rate limit:** 1000 requests/day
- **With key:** 300+ models

### NVIDIA NIM
- **Free models:** 70B+ parameter curated list
- **Rate limit:** 1000 requests/month
- **Filter:** Excludes small models (<70B), embeddings, audio

### Cline
- **Free models:** Curated free tier
- **Requires:** Free account

---

## Architecture

### Provider Failover System

```
provider-failover/
├── autocompact.ts      # Auto-compact on 429
├── capability-ranking.ts # Benchmark-based scoring
├── errors.ts            # Error classification
├── hardcoded-benchmarks.ts # 445 models with AA scores
├── model-hop.ts         # Intelligent provider hopping
└── index.ts             # Main failover coordinator
```

### Usage Tracking

```
free-tier-limits.ts    # Per-model rate limits & tracking
usage-commands.ts        # /free-sessionusage, /free-totalusage
usage-store.ts           # Persistent cumulative data (~/.pi/free-cumulative-usage.json)
```

### Key Features

| Feature | Implementation |
|---------|----------------|
| Auto-compact | `triggerAutocompact()` → `sendUserMessage()` retry |
| Model hopping | `rankByCapability()` → `findBestAlternative()` |
| Benchmark data | Hardcoded 445 models, refreshed monthly via GitHub Actions |
| Token tracking | Extracted from `turn_end` events in `provider-helper.ts` |
| Rate limit warnings | 🟢🟡🔴 based on percent used |

---

## Testing

Run the test suite:

```bash
npm test              # Run all tests
npm test -- --run     # CI mode (once through)
npm run test:ui       # Interactive UI
```

**80 tests** covering:
- ✅ Error classification (429, 503, 401 patterns)
- ✅ Autocompact cooldown logic
- ✅ Failover handler actions
- ✅ Usage tracking & rate limits
- ✅ Capability ranking & scoring
- ✅ Fetch retry logic with timeout

---

## Troubleshooting

### Models not appearing
- Check API keys in `~/.pi/free.json`
- Verify key formats: `sk-or-v1-...` (OpenRouter), `nvapi-...` (NVIDIA)
- Press `Ctrl+L` to refresh model list

### 429 errors not auto-recovering
- Check `/free-sessionusage` for rate limit status
- Verify `allow_downgrades` isn't set to `"never"`
- Ensure extension is up to date: `pi update git:github.com/apmantza/pi-free`

### Authentication issues
- Cline: Check firewall for ports 48801-48811
- Kilo: Try `/logout kilo` then `/login kilo`

### Dashboard not opening
- Usage commands work without dashboard: `/free-sessionusage`
- Dashboard requires [glimpseui](https://github.com/nicehash/glimpseui)

---

## Data Sources

**Benchmark Data:** [Artificial Analysis API](https://artificialanalysis.ai)
- 445 models with Intelligence Index scores
- Normalized to 0-100 scale
- Monthly updates via GitHub Actions

**Rate Limits:** Hardcoded from provider docs
- Kilo: 200/hr
- OpenRouter: 1000/day
- NVIDIA/Fireworks: 1000/month

---

## Development

```bash
git clone https://github.com/apmantza/pi-free
cd pi-free
npm install
npm test
```

### File Layout

```
providers/
  kilo.ts, kilo-auth.ts, kilo-models.ts
  zen.ts
  openrouter.ts
  nvidia.ts
  cline.ts, cline-auth.ts, cline-models.ts

provider-failover/
  autocompact.ts, capability-ranking.ts, errors.ts
  hardcoded-benchmarks.ts, model-hop.ts, index.ts

tests/
  *.test.ts (80 tests)
```

---

## License

MIT — See [LICENSE](LICENSE)

---

**Questions?** [Open an issue](https://github.com/apmantza/pi-free/issues)
