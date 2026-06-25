# Features

---

## Free Model Detection

pi-free uses **adaptive Route A/B detection** to identify free models:

- **Route A** (pricing-exposed): If ANY model has cost > 0, use cost-based detection. Free = both input AND output cost are 0 (OR name contains "free").
- **Route B** (non-pricing-exposed): If ALL models have cost === 0, use name-based detection only. Free = name contains "free" (case-insensitive).

This avoids false positives where providers default all costs to 0 without exposing real pricing.

---

## Coding Index (CI) Scores

Every model shows a **Coding Index score** (e.g., `CI: 52.3`) in the model picker:

- **Benchmark-based** — scores from Artificial Analysis coding benchmarks (HumanEval, MBPP, etc.)
- **Applied to all providers** — every model from every provider gets a CI score
- **Multi-strategy matching** — direct match, variant alias, provider normalization, prefix fallback

**Debug missing scores:** Check `~/.pi/modelmatch.log` to see which models matched or didn't match.

---

## Model Availability Probing

Provider APIs often list models that return errors when actually used (expired free promotions, decommissioned models, server spin-down). pi-free automatically detects and hides broken models:

- **Lazy auto-probe** — runs on first `session_start`, no manual command needed
- **24-hour probe cache** — avoids re-checking recently-verified models
- **Provider-scoped hiding** — broken models hidden in `~/.pi/free.json` as `"provider/model-id"`

See [Commands](commands.md#probe-commands) for the full list of probe commands.

---

## Free/Paid Model Toggling

- **Free-only by default** — shows only zero-cost models initially
- **Per-provider toggles** — `/toggle-{provider}` switches between free-only and all models
- **Global toggle** — `/toggle-free` applies to all providers at once
- **Persists across sessions** — preference saved to `~/.pi/free.json`
- **Instant updates** — changes apply immediately, no Pi restart needed

---

## Telemetry

pi-free collects optional real-world performance data for free models:

| Command | Description |
|---|---|
| `/free-telemetry` | Show tokens/s, latency, success rate |
| `/clear-free-telemetry` | Clear all stored telemetry data |

---

## Non-OpenAI-Compatible Providers

Most providers use OpenAI-compatible APIs. Some use custom protocols:

- **Qoder** — proprietary COSY auth headers, WAF-encoded bodies, custom SSE streaming, PKCE OAuth device flow
- **Cline** — OpenAI-compatible API with message reshaping for Cline's bot protocol

These providers implement the full `streamSimple` interface that Pi expects, bridging their proprietary streaming to Pi's `AssistantMessageEventStream`.
