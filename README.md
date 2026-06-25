# pi-free-providers

<p align="center">
  <img src="banner.png" alt="pi-free" width="100%" max-width="900">
</p>

Free and paid AI model providers for [Pi](https://pi.dev). Access **free and paid models** from multiple providers in one install.

---

## What does pi-free do

**pi-free is a Pi extension that unlocks free and paid AI models from multiple providers.**

When you install pi-free, it:

1. **Registers free-tier providers** — Kilo, Cline, LLM7, OpenModel, TokenRouter, and more
2. **Captures Pi's built-in providers** with free/paid toggles — OpenCode, OpenRouter
3. **Fetches models dynamically** — ZenMux, CrofAI, Mistral, Groq, Cerebras, xAI, Hugging Face when API keys are configured
4. **Filters to show only free models by default** — paid models hidden until explicitly toggled on
5. **Provides per-provider toggle commands** — `/toggle-{provider}` switches free ↔ all immediately
6. **Handles authentication** — OAuth flows open your browser; API keys from `~/.pi/free.json` or env vars
7. **Adds Coding Index scores** — model names include benchmark scores (`CI: 45.2`) for quick comparison
8. **Auto-probes and hides broken models** — expired free tiers and decommissioned models detected automatically

---

## Install

```bash
pi install git:github.com/apmantza/pi-free
```

Press `Ctrl+L` to open the model picker. Free models are shown by default.

---

## Quick Start

### 1. Use free models (no setup)

Kilo and Cline models appear immediately. To unlock all models:

```
/login kilo      # Kilo free OAuth
/login cline     # Cline free OAuth
```

### 2. Toggle between free and paid

```
/toggle-kilo       # Kilo free ↔ all
/toggle-openrouter # OpenRouter free ↔ all
/toggle-free       # global free-only mode
/free-providers    # show model counts
```

### 3. Add API keys (optional)

First run creates `~/.pi/free.json` automatically. Add keys there or use environment variables:

```json
{
  "ollama_api_key": "...",
  "sambanova_api_key": "...",
  "deepinfra_api_key": "..."
}
```

---

## Provider Catalog

| Category | Providers |
|---|---|
| ✅ **Free** | Kilo, Cline, OpenRouter, OpenCode, LLM7, OpenModel, TokenRouter (1 free) |
| 🔄 **Freemium** | Ollama Cloud, SambaNova, Codestral, AgentRouter |
| 💳 **Paid** | ZenMux, CrofAI, DeepInfra, Together, Novita, Routeway, b.ai |
| 🔧 **Dynamic** | Mistral, Groq, Cerebras, xAI, Hugging Face, FastRouter |

**Full catalog and setup instructions:** [docs/providers.md](docs/providers.md)

---

## Docs

| Topic | Link |
|---|---|
| Provider catalog & auth | [docs/providers.md](docs/providers.md) |
| Slash commands | [docs/commands.md](docs/commands.md) |
| Configuration & logging | [docs/configuration.md](docs/configuration.md) |
| Features deep dive | [docs/features.md](docs/features.md) |
| Adding new providers | [CONTRIBUTING.md](CONTRIBUTING.md) |

---

## License

MIT — See [LICENSE](LICENSE)

**Questions?** [Open an issue](https://github.com/apmantza/pi-free/issues)
