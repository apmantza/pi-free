# Commands

All slash commands provided by pi-free.

---

## Global Commands

| Command | Description |
|---|---|
| `/toggle-free` | Toggle global free-only mode for ALL providers |
| `/free-providers` | Show free/paid model counts for all providers |
| `/free-telemetry` | Show real-world performance data (tokens/s, latency, success rate) for free models |
| `/clear-free-telemetry` | Clear all stored telemetry data |

---

## Per-Provider Toggles

Run `/toggle-{provider}` to switch between free-only and all models. Your preference is saved to `~/.pi/free.json` and remembered across Pi restarts.

| Command | Provider | Type |
|---|---|---|
| `/toggle-kilo` | Kilo | ✅ free |
| `/toggle-openrouter` | OpenRouter | ✅ free |
| `/toggle-opencode` | OpenCode | ✅ free |
| `/toggle-cline` | Cline | ✅ free |
| `/toggle-ollama` | Ollama Cloud | 🔄 freemium |
| `/toggle-sambanova` | SambaNova | 🔄 freemium |
| `/toggle-codestral` | Codestral | 🔄 freemium |
| `/toggle-llm7` | LLM7 | ✅ free |
| `/toggle-novita` | Novita AI | 💳 paid |
| `/toggle-routeway` | Routeway AI | 💳 paid |
| `/toggle-tokenrouter` | TokenRouter | 💳 paid |
| `/toggle-openmodel` | OpenModel | ✅ free |
| `/toggle-agentrouter` | AgentRouter | 🔄 freemium |
| `/toggle-zenmux` | ZenMux | 💳 paid |
| `/toggle-crofai` | CrofAI | 💳 paid |
| `/toggle-deepinfra` | DeepInfra | 💳 trial |
| `/toggle-together` | Together AI | 💳 trial |
| `/toggle-fastrouter` | FastRouter | 🔧 dynamic |
| `/toggle-mistral` | Mistral | 🔧 dynamic |
| `/toggle-groq` | Groq | 🔧 dynamic |
| `/toggle-cerebras` | Cerebras | 🔧 dynamic |
| `/toggle-xai` | xAI | 🔧 dynamic |
| `/toggle-huggingface` | Hugging Face | 🔧 dynamic |

**Notes:**

- **✅ Free providers** — toggle switches between free-only vs all models (including paid)
- **🔄 Freemium** — shows all models by default; toggle switches between filtered and full list
- **🔧 Dynamic** — filters the model list when you have an API key configured
- **💳 Paid** — shows all models by default

---

## OAuth Commands

| Command | Description |
|---|---|
| `/login kilo` | Start OAuth flow for Kilo |
| `/logout kilo` | Clear Kilo OAuth credentials |
| `/login cline` | Start OAuth flow for Cline |
| `/logout cline` | Clear Cline OAuth credentials |

---

## Probe Commands

Test models for errors and auto-hide broken ones. All probes use a **24-hour cache** to avoid re-checking recently-verified models. Run any probe manually to force a full re-check.

| Command | Provider | What it does |
|---|---|---|
| `/probe-ollama` | Ollama Cloud | Test for 403 errors, auto-hide |
| `/probe-routeway` | Routeway | Test for 5xx/404 errors, auto-hide |
| `/probe-opencode` | OpenCode | Test for expired free promotions (report only) |
| `/probe-opencode-go` | OpenCode Go | Test for expired free promotions (report only) |
| `/probe-deepinfra` | DeepInfra | Test for 404/5xx errors, auto-hide |
| `/probe-sambanova` | SambaNova | Test for 404/5xx errors, auto-hide |
| `/probe-together` | Together AI | Test for 404/5xx errors, auto-hide |
| `/probe-novita` | Novita AI | Test for 404/5xx errors, auto-hide |

**How probes work:**

1. Sends a minimal test request to every model
2. Identifies broken models (404/403/5xx responses)
3. **Auto-hides** broken models in your config (provider-scoped: `"ollama/kimi-k2.6"`)
4. Re-registers the provider so broken models disappear immediately
5. Hidden models persist across Pi restarts
