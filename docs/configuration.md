# Configuration & Logging

---

## Config File

pi-free reads settings from `~/.pi/free.json` (auto-created on first run).

**Resolution order** (first wins):

1. Environment variable
2. `~/.pi/free.json`

### API Keys

```json
{
  "ollama_api_key": "YOUR_KEY",
  "mistral_api_key": "YOUR_KEY",
  "codestral_api_key": "YOUR_KEY",
  "deepinfra_api_key": "YOUR_KEY",
  "sambanova_api_key": "YOUR_KEY",
  "llm7_api_key": "YOUR_KEY",
  "zenmux_api_key": "YOUR_KEY",
  "crofai_api_key": "YOUR_KEY",
  "routeway_api_key": "sk-...",
  "tokenrouter_api_key": "YOUR_KEY",
  "bai_api_key": "YOUR_KEY",
  "openmodel_api_key": "YOUR_KEY",
  "novita_api_key": "YOUR_KEY",
  "together_api_key": "YOUR_KEY"
}
```

Or use environment variables (same names, uppercase):

```bash
export MISTRAL_API_KEY="..."
export OLLAMA_API_KEY="..."
```

### Boolean Flags

```json
{
  "free_only": true,
  "ollama_show_paid": true,
  "kilo_show_paid": true
}
```

### Hidden Models

Hide specific models per-provider:

```json
{
  "hidden_models": [
    "ollama/kimi-k2.6",
    "deepinfra/meta-llama/Llama-3.3-70B-Instruct"
  ]
}
```

Use `"provider/model-id"` format for provider-scoped hiding. A bare `"model-id"` hides across all providers.

---

## Logging

### Extension Log

- **Windows:** `%USERPROFILE%\.pi\free.log`
- **Linux/macOS:** `~/.pi/free.log`

Config parse errors and provider startup messages are written here.

### Model Match Log

Diagnostic log for Coding Index score matching:

- **Windows:** `%USERPROFILE%\.pi\modelmatch.log`
- **Linux/macOS:** `~/.pi/modelmatch.log`

**Log format:**

```
timestamp|provider|modelId|modelName|action|strategy|normalizedId|matchKey|codingIndex|details
```

**View the log:**

```bash
# Pretty-print with column alignment
cat ~/.pi/modelmatch.log | column -t -s '|'

# See only misses (models without CI scores)
grep '|miss|' ~/.pi/modelmatch.log
```

### Provider Cache

Fetched model lists are cached on disk to avoid re-fetching on every session:

- **Path:** `~/.pi/provider-cache.json`

### Log Verbosity

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

## File Locations

| File | Purpose |
|---|---|
| `~/.pi/free.json` | Config (API keys, flags, hidden models) |
| `~/.pi/free.log` | Extension log |
| `~/.pi/modelmatch.log` | Model match diagnostics |
| `~/.pi/provider-cache.json` | Cached model lists |
