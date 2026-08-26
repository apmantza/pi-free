# Commands

All slash commands provided by pi-free.

---

## Global Commands

| Command | Description |
| --- | --- |
| `/toggle-free` | Toggle global free-only mode for all providers. |
| `/free-providers` | Show the current free/paid model view for registered providers. |
| `/pi-free-health` | Show a credential-free health report, startup/session issues, registered-provider count, and the diagnostic log path. |
| `/free-startup` | Show the latest startup timing summary, including provider timings, cache/network activity, session-start handlers, and detached work. |
| `/free-telemetry` | Show optional real-world performance data for free models. |
| `/clear-free-telemetry` | Clear stored telemetry data. |

## Per-Provider Toggles

Run `/toggle-{provider}` to switch between a provider's free/basic view and its full catalog. The preference is saved in `~/.pi/free.json`.

| Command | Provider | Surface |
| --- | --- | --- |
| `/toggle-kilo` | Kilo | Native |
| `/toggle-cline` | Cline | Native |
| `/toggle-ollama-cloud` | Ollama Cloud | Native |
| `/toggle-llm7` | LLM7 | Native |
| `/toggle-zenmux` | ZenMux | Native |
| `/toggle-crofai` | CrofAI | Native |
| `/toggle-deepinfra` | DeepInfra | Native |
| `/toggle-sambanova` | SambaNova | Native |
| `/toggle-novita` | Novita AI | Native |
| `/toggle-routeway` | Routeway AI | Native |
| `/toggle-opengateway` | OpenGateway | Native |
| `/toggle-tokenrouter` | TokenRouter | Native |
| `/toggle-anyapi` | AnyAPI | Native |
| `/toggle-bai` | B.AI | Native |
| `/toggle-stepfun` | StepFun | Native |
| `/toggle-qoder` | Qoder | Legacy |
| `/toggle-openrouter` | OpenRouter | Pi built-in |
| `/toggle-opencode-free` | OpenCode Zen free wrapper | Pi built-in catalog + detached Zen refresh |
| `/toggle-opencode-go` | OpenCode Go | Pi built-in |
| `/toggle-fastrouter` | FastRouter | Native |
| `/toggle-gmi` | GMI Cloud | Native |
| `/toggle-agnes` | Agnes AI | Native |
| `/toggle-requesty` | Requesty | Native |
| `/toggle-venice` | Venice AI | Native |
| `/toggle-infron` | Infron AI | Native |
| `/toggle-merge` | Merge Gateway | Native |
| `/toggle-commandcode` | CommandCode | Native |

Native providers retain their complete catalog and let Pi apply the current filter. All pi-free providers now use the native provider lifecycle; Pi built-in providers retain Pi-owned catalogs.

## Authentication Commands

| Command | Description |
| --- | --- |
| `/login kilo` | Start Kilo OAuth. Kilo also accepts `KILO_API_KEY`. |
| `/login cline` | Start Cline OAuth. Cline's public catalog does not require login; chat does. |
| `/login qoder` | Authenticate Qoder with a PAT or browser OAuth. |
| `/logout kilo` | Clear Kilo credentials managed by Pi. |
| `/logout cline` | Clear Cline credentials managed by Pi. |

Qoder PAT authentication can also use `QODER_PERSONAL_ACCESS_TOKEN` or its `QODER_PAT` alias. See [providers.md](providers.md) for all API-key names.

## Ollama Cloud Refresh

| Command | Description |
| --- | --- |
| `/ollama-cloud-refresh` | Re-fetch Ollama Cloud's catalog and update the provider live. Requires `OLLAMA_API_KEY`. |

Ollama Cloud is a native provider, but this compatibility command and `/api/show` capability reuse continue to use `~/.pi/provider-cache.json`.

## Probe Commands

Probes test model availability. Automatic checks use a 24-hour probe cache; running a probe command explicitly forces a fresh check. Broken models are hidden in `~/.pi/free.json` with provider-scoped IDs.

| Command | Provider | What it does |
| --- | --- | --- |
| `/probe-ollama` | Ollama Cloud | Test for 403 access-denied models and auto-hide them. |
| `/probe-routeway` | Routeway | Test for 5xx/404 errors and auto-hide broken models. |
| `/probe-deepinfra` | DeepInfra | Test for 404/5xx errors and auto-hide broken models. |
| `/probe-sambanova` | SambaNova | Test for 404/5xx errors and auto-hide broken models. |
| `/probe-novita` | Novita AI | Test for 404/5xx errors and auto-hide broken models. |

Probes never treat a transient network failure as proof that a model is broken.
