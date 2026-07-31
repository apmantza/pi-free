# Features

---

## Free-model filtering

pi-free uses adaptive Route A/B detection:

- **Route A (pricing exposed):** when the catalog contains a priced model, a model is free when both input and output costs are zero, or its name explicitly contains `free`.
- **Route B (pricing not exposed):** when the catalog has no positive pricing, only an explicit `free` name signal marks a model free.

Providers can also supply authoritative free/basic metadata. This avoids treating missing pricing as proof that every model is free.

The global `free_only` setting is enabled by default. Provider-level settings and the global toggle determine whether a provider's paid or trial catalog is visible.

## Native provider lifecycle

Most pi-free providers now use Pi's native `registerProvider(provider)` surface. Native providers:

- restore catalogs from Pi's `~/.pi/agent/models-store.json` during offline initialization;
- let Pi control online refresh timing and cancellation;
- retain the previous catalog after an empty or failed refresh; and
- keep their complete catalog in memory while Pi applies the current free/all filter.

Qoder intentionally remains on the legacy registration surface. Dynamic built-in catalogs and Qoder do not use the native provider lifecycle. See [configuration](configuration.md#model-stores-and-caches) for cache locations, including Ollama Cloud's intentional compatibility-cache exception.

## Coding Index (CI) scores

Where a model matches the benchmark catalog, pi-free appends a Coding Index score such as `CI: 52.3` to its display name. Matching uses direct, alias, provider-normalization, and prefix-fallback strategies. Missing scores are not fabricated.

Set `PI_FREE_BENCHMARK_DEBUG=1` to record match diagnostics in `~/.pi/modelmatch.log`.

## Model availability probing

Some providers list models that are unavailable at request time. pi-free provides automatic and manual probes for selected providers:

- native availability probes cover Ollama Cloud, Routeway, DeepInfra, SambaNova, and Novita;
- dynamic probes cover OpenCode and OpenCode Go; and
- probes use a 24-hour result cache for automatic checks, while explicit commands force a fresh check.

Deterministically broken models are hidden in `~/.pi/free.json` using provider-scoped IDs. Transient network failures are not treated as proof that a model is broken.

See [Commands](commands.md#probe-commands) for the command list.

## Free/all model toggling

- `/toggle-{provider}` switches an individual provider between its free/basic view and full catalog.
- `/toggle-free` changes the global free-only mode.
- Preferences persist in `~/.pi/free.json`.
- Native providers re-register the same provider object to invalidate Pi's model snapshot; legacy and dynamic providers re-register the selected model array.

## Optional telemetry

Telemetry is local and opt-in through actual use of free models. It records aggregate calls, latency, token throughput, success, and cost data. Use:

| Command | Description |
| --- | --- |
| `/free-telemetry` | Show collected telemetry. |
| `/clear-free-telemetry` | Delete collected telemetry. |

## Startup observability

`/free-startup` reports the latest extension startup timing, including provider setup durations, per-provider cache/network activity, failed network attempts, session-start handler durations, detached post-handler work, and failures. `/pi-free-health` adds a credential-free status summary, registered-provider count, problem list, and the path to `~/.pi/free.log` (or the configured log path). Legacy/dynamic startup model fetches have an 8-second default deadline, configurable with `PI_FREE_STARTUP_FETCH_TIMEOUT_MS`; native provider refresh is handled by Pi after registration and its session-start nudge is measured without blocking the event.

## Provider protocols

Most providers use OpenAI-compatible APIs. Notable custom integrations are:

- **Cline** — native provider with the custom `cline-xml-tools` wire API and XML message/tool reshaping.
- **OpenModel** — native Anthropic Messages API provider.
- **Qoder** — intentionally legacy provider with Qoder authentication, request signing, and custom streaming compatibility.

See [Provider catalog & auth](providers.md) for setup details.
