# Configuration & Logging

## Config file

pi-free reads `~/.pi/free.json` and creates it on first run. For values supported by both mechanisms, environment variables take precedence over the file.

### API keys

These are the pi-free config keys and their environment variables:

| Config key | Environment variable |
| --- | --- |
| `kilo_api_key` | `KILO_API_KEY` |
| `cline_api_key` | `CLINE_API_KEY` |
| `ollama_api_key` | `OLLAMA_API_KEY` |
| `zenmux_api_key` | `ZENMUX_API_KEY` |
| `crofai_api_key` | `CROFAI_API_KEY` |
| `llm7_api_key` | `LLM7_API_KEY` |
| `deepinfra_api_key` | `DEEPINFRA_TOKEN` |
| `sambanova_api_key` | `SAMBANOVA_API_KEY` |
| `novita_api_key` | `NOVITA_API_KEY` |
| `routeway_api_key` | `ROUTEWAY_API_KEY` |
| `opengateway_api_key` | `OPENGATEWAY_API_KEY` |
| `fastrouter_api_key` | `FASTROUTER_API_KEY` |
| `tokenrouter_api_key` | `TOKENROUTER_API_KEY` |
| `anyapi_api_key` | `ANYAPI_API_KEY` |
| `bai_api_key` | `BAI_API_KEY` |
| `openmodel_api_key` | `OPENMODEL_API_KEY` |

```bash
export FASTROUTER_API_KEY="..."
export DEEPINFRA_TOKEN="..."
```

Example file:

```json
{
  "kilo_api_key": "...",
  "cline_api_key": "...",
  "ollama_api_key": "...",
  "anyapi_api_key": "...",
  "openmodel_api_key": "..."
}
```

Qoder does not use a pi-free config API-key field. Authenticate with `/login qoder`, or set `QODER_PERSONAL_ACCESS_TOKEN` (with `QODER_PAT` as an alias) before login. Pi's built-in OpenRouter and OpenCode providers use Pi's auth handling; their environment variables are `OPENROUTER_API_KEY` and `OPENCODE_API_KEY`.

NVIDIA, Together, Mistral, Groq, Cerebras, xAI, and Hugging Face are Pi-built-in providers rather than pi-free registrations. Use Pi's documented environment variables for them; pi-free does not maintain their catalogs or config keys.

### Boolean flags

```json
{
  "free_only": true,
  "kilo_show_paid": true,
  "qoder_show_paid": false
}
```

`free_only` controls the global filter. Each provider's `<provider>_show_paid` value controls its provider toggle. Environment flags use the uppercase form, for example `PI_FREE_ONLY`, `KILO_SHOW_PAID`, and `QODER_SHOW_PAID`. The legacy `kilo_free_only` setting is also supported as `PI_FREE_KILO_FREE_ONLY`.

### Hidden models

Hide specific models per provider:

```json
{
  "hidden_models": [
    "ollama-cloud/kimi-k2.6",
    "deepinfra/meta-llama/Llama-3.3-70B-Instruct"
  ]
}
```

Use `provider/model-id` for provider-scoped hiding. A bare `model-id` is retained as a legacy global form.

## Model stores and caches

Migrated native providers restore and persist catalogs through Pi's model lifecycle:

- `~/.pi/agent/models-store.json` — Pi-owned native provider catalogs.
- `~/.pi/agent/auth.json` — Pi-owned native credentials, including Kilo and Cline OAuth/API-key credentials.

Remaining legacy network catalogs use the pi-free cache:

- `~/.pi/provider-cache.json` — one-hour cache used by legacy catalog fetches.
- `~/.pi/agent/qoder-models-cache.json` — Qoder's separate legacy model/config cache; Qoder intentionally remains unmigrated.

Ollama Cloud is native but intentionally retains `~/.pi/provider-cache.json` for `/api/show` capability reuse and `/ollama-cloud-refresh`. This does not replace its Pi native model store.

Native providers restore the store first and Pi controls online refresh throttling. A native provider's refresh retains the previous catalog when a fetch is empty or fails. Legacy startup fetches are bounded by the 8-second default `PI_FREE_STARTUP_FETCH_TIMEOUT_MS` deadline and fall back to stale cache where available.

## Logging

### Extension log

- **Windows:** `%USERPROFILE%\.pi\free.log`
- **Linux/macOS:** `~/.pi/free.log`

Provider startup messages and configuration errors are written here.

### Coding Index debug diagnostics

Coding Index match diagnostics (attempt/match/miss per model) are written to the shared extension log under the `benchmark-lookup` namespace:

- **Windows:** `%USERPROFILE%\.pi\free.log`
- **Linux/macOS:** `~/.pi/free.log`

Diagnostics are opt-in (one line per model per match attempt, so off by default for startup speed):

```bash
export PI_FREE_BENCHMARK_DEBUG=1
```

### Log verbosity and paths

```bash
LOG_LEVEL=debug
PI_FREE_LOG_LEVEL=debug
PI_FREE_LOG_PATH=/tmp/pi-free.log
PI_FREE_FILE_LOG=false
PI_FREE_PROVIDER_CACHE=/tmp/provider-cache.json
PI_FREE_TELEMETRY_FILE=/tmp/free-telemetry.json
```

The telemetry file defaults to `~/.pi/free-telemetry.json`.

## File locations

| File | Purpose |
| --- | --- |
| `~/.pi/free.json` | pi-free config, flags, and extension-provider keys |
| `~/.pi/free.log` | Extension log (includes opt-in `benchmark-lookup` diagnostics) |
| `~/.pi/free-telemetry.json` | Local model performance telemetry |
| `~/.pi/provider-cache.json` | Legacy cache and Ollama compatibility data |
| `~/.pi/agent/models-store.json` | Pi native provider catalogs |
| `~/.pi/agent/auth.json` | Pi native credentials and Qoder credentials |
| `~/.pi/agent/qoder-models-cache.json` | Qoder legacy model/config cache |
