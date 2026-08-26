# Free Models Catalog

> **Audit date: 2026-08-26.** Every list below was pulled live from the provider's real endpoint and classified with pi-free's own detection semantics (cost-based Route A, name-based Route B, authoritative stamps). Provider catalogs change constantly — treat this as a verified point-in-time snapshot, not a guarantee. Re-check before relying on any single model.

**Totals at audit time:** ~106 free-classified models across 16 providers. Three registered providers exposed **zero** free models (CrofAI, DeepInfra, SambaNova — see [Zero-free providers](#zero-free-providers)).

---

## Cross-cutting conditions

These apply to many entries below regardless of provider:

- **`:free` id suffix (OpenRouter convention)** — used by Infron, FastRouter, Kilo, OpenGateway and mirrored by others. Typical limits on such routes: **20 requests/minute**, **50 requests/day** (raised to **1,000/day** after a one-time $10 credit top-up on OpenRouter itself; per-gateway limits vary). Free-tier prompts/outputs are frequently **logged** by the upstream provider.
- **Balance gates** — a $0-listed model is not usable-for-free if the gateway requires a positive account balance (see Venice).
- **Promotion windows** — promotional free models expire; pi-free stamps these with revisit notes in code.

---

## Entirely-free gateways

### LLM7 (`llm7`) — 2 curated selectors

pi-free registers LLM7's curated selector list rather than its full gateway catalog.

| Model | Conditions |
| --- | --- |
| `default` | Anonymous access OK; free token from dash.llm7.io raises limits |
| `fast` | Same; turbo-class models have lower rate/token limits for anonymous users |

The paid `pro` selector ($0.30/$0.90 per M) is hidden from the free view.

### Agnes AI (`agnes`) — 2

| Model | Conditions |
| --- | --- |
| `agnes-2.0-flash` | Per Agnes pricing docs; key required |
| `agnes-2.5-flash` | Per Agnes pricing docs; key required |

## Free tiers inside mixed catalogs

### Cline (`cline`) — 22

Login required (OAuth or API key); the catalog itself is public. Free models draw from a **free quota**; once exhausted you must switch to ClinePass ($9.99/mo) or usage billing. Free models do not consume signup bonus credits.

<details><summary>Full list (22)</summary>

```text
cohere/north-mini-code:free
deepseek/deepseek-v4-flash
dots-studio/dots-3-note-preview:free
google/gemma-4-26b-a4b-it:free
google/gemma-4-31b-it:free
google/lyria-3-clip-preview
google/lyria-3-pro-preview
liquid/lfm-2.5-2.6b:free
minimax/minimax-m2.7:free
minimax/minimax-m3:free
nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
nvidia/nemotron-3-super-120b-a12b:free
nvidia/nemotron-3-ultra-550b-a55b:free
nvidia/nemotron-3.5-content-safety:free
nvidia/nemotron-3.5-lightning:free
openrouter/free
poolside/laguna-s-2.1:free
poolside/laguna-xs-2.1:free
stealth/ox-alpha
thinkingmachines/inkling-small:free
thinkingmachines/inkling:free
z-ai/glm-5.2:free
```

</details>

### Kilo Gateway (`kilo`) — 22

Key required. Gateway publishes an authoritative `isFree` flag which pi-free trusts directly.

<details><summary>Full list (22)</summary>

```text
cohere/north-mini-code:free
dots-studio/dots-3-note-preview:free
google/lyria-3-clip-preview
google/lyria-3-pro-preview
kilo-auto/free
liquid/lfm-2.5-2.6b:free
meituan/longcat-2.0-free
minimax/minimax-m2.7:free
minimax/minimax-m3:free
nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
nvidia/nemotron-3-super-120b-a12b:free
nvidia/nemotron-3-ultra-550b-a55b:free
nvidia/nemotron-3.5-content-safety:free
nvidia/nemotron-3.5-lightning:free
openrouter/free
poolside/laguna-s-2.1:free
poolside/laguna-xs-2.1:free
stealth/ox-alpha
stepfun/step-3.7-flash:free
tencent/hy3:free
thinkingmachines/inkling-small:free
thinkingmachines/inkling:free
```

</details>

### Requesty (`requesty`) — 11

Inline pricing; zero-priced chat models below.

<details><summary>Full list (11)</summary>

```text
google/gemma-4-31b-it
mistral/leanstral-1-5
novita/inclusionai/ling-3.0-tiny
nvidia/muse-glimmer-30b
nvidia/nemotron-3-nano-30b-a3b
nvidia/nemotron-3-nano-omni-30b-a3b-reasoning
nvidia/nemotron-3-super-120b-a12b
nvidia/nemotron-3-ultra-550b-a55b
nvidia/nemotron-3.5-lightning-30b-a3b
poolside/laguna-m.1
poolside/laguna-xs.2
```

</details>

### Novita (`novita`) — 7

Genuinely $0/token open-source models (plus a small one-time signup voucher ~$0.50 for everything else).

<details><summary>Full list (7)</summary>

```text
bunny
dev/glm46
gt-4p
inclusionai/ling-3.0-flash-fin
minimax/m2-her
qwen/qwen3.5-plus
qwen/qwen3.6-plus
```

</details>

### ZenMux (`zenmux`) — 8

⚠️ **Conditions:** free models are best-effort — they may be temporarily unavailable during peak usage and are subject to rate limits. Some promotional entries historically carried very low caps (e.g. "5 conversations every 5 hours"). Fine for testing; don't build production flows on them.

<details><summary>Full list (8)</summary>

```text
deepseek/deepseek-v4-flash-vision-exp-free
dots-studio/dots3-note-prev
inclusionai/ling-3.0-tiny
qwen/qwen3-asr-flash
sapiens-ai/agnes-2.0-flash
sapiens-ai/agnes-2.5-flash
z-ai/glm-4.6v-flash-free
z-ai/glm-4.7-flash-free
```

</details>

### FastRouter (`fastrouter`) — 8

`:free` suffix conditions apply (rate limits, possible logging).

<details><summary>Full list (8)</summary>

```text
fastrouter/auto
google/gemma-4-26b-a4b-it
google/gemma4-26b:free
nvidia/nemotron-3-nano-30b:free
nvidia/nemotron-3-super:free
openai/gpt-oss-120b:free
openai/gpt-oss-20b:free
sarvam/sarvam-105b:free
```

</details>

### B.AI (`bai`) — 3

⚠️ **Time-limited promotion wording** ("currently free") — documented on the [B.AI pricing page](https://docs.b.ai/llmservice/pricing-and-usage/); stamped in code with a revisit note (added 2026-08-26). Re-verify before depending on them.

| Model | Documented status |
| --- | --- |
| `deepseek-v4-flash` | Currently free on B.AI Chat **and API** |
| `deepseek-v4-flash-vision-exp` | Currently free for B.AI API use |
| `mimo-v2.5` | API usage currently free |

### Infron AI (`infron`) — 5

`:free` suffix conditions apply; free-endpoint prompts/outputs may be logged upstream.

<details><summary>Full list (5)</summary>

```text
deepseek/deepseek-v4-flash:free
moonshotai/kimi-k2.6:free
nvidia/nemotron-3-nano-omni-30b-a3b-reasoning
nvidia/nemotron-3.5-lightning-30b-a3b:free
qwen/qwen3.8-27b:free
```

</details>

### TokenRouter (`tokenrouter`) — 2

Catalog shim exposes no pricing; classification is name-based. Note `qwen/qwen3.8-max-free` returned intermittent gateway 503s ("no available servers") at audit time.

<details><summary>Full list (2)</summary>

```text
nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
qwen/qwen3.8-max-free
```

</details>

### StepFun (`stepfun`) — 2

Step Plan is a **subscription** service — both models are $0-listed in the plan catalog but require an active Step Plan subscription key.

<details><summary>Full list (2)</summary>

```text
step-3.5-flash
step-3.5-flash-2603
```

</details>

### Venice AI (`venice`) — 1

⚠️ **Balance gate:** Venice requires a positive account balance for ALL inference. `stealth-ox-alpha` is listed at $0/$0 so it classifies free, but unfunded keys receive HTTP 402.

| Model | Conditions |
| --- | --- |
| `stealth-ox-alpha` | $0-listed; requires positive account balance (402 otherwise) |

### Merge Gateway (`merge`) — 1

Catalog discovery itself is keyed — no key, no models.

| Model | Conditions |
| --- | --- |
| `nvidia/nemotron-3.5-lightning-30b-a3b` | $0/$0 per million via nvidia route; positive account balance may still be required by billing policy |

### OpenGateway (`opengateway`) — 2

Promotional entries change over time.

<details><summary>Full list (2)</summary>

```text
auto
nvidia/nemotron-3-ultra-550b-a55b:free
```

</details>

### GMI Cloud (`gmi`) — 2 ⏰ expires 2026-09-06

MiniMax Week promotion — **both entries stop being free when the window ends**.

| Model | Conditions |
| --- | --- |
| `MiniMaxAI/MiniMax-M3` | Free during MiniMax Week (2026-08-24 → 2026-09-06) |
| `MiniMaxAI/MiniMax-M2.7` | Same window |

## Zero-free providers

These registered providers exposed **no free-classified chat models** at audit time:

| Provider | Catalog | Why nothing is free |
| --- | --- | --- |
| CrofAI | 21 models | All carry non-zero pricing |
| DeepInfra | 188 models | 60 zero-priced entries exist but are all media-generation (image/video/TTS/STT) — filtered out; chat models are priced. Access is via the $5 trial credit instead |
| SambaNova | 7 models | All carry real per-token pricing; the free tier is rate-limited access *at listed prices* (billing-layer, invisible to the catalog) |

## Not covered here

- **AnyAPI** — credential expired at audit time (HTTP 401); mapper parses pricing/isFree but live state unknown. Re-auth to restore.
- **Ollama Cloud** — usage-based tier makes the whole catalog effectively free with quotas; classification is handled by its own probing path.
- **Qoder** — basic Community tier vs premium credits; static curated catalog.
- **Pi built-ins** (OpenRouter, OpenCode, OpenCode Go) — wrapped for filtering only; see Pi's own docs. OpenRouter's `:free` variants follow the cross-cutting conditions above.

---

*Maintained per [AGENTS.md convention 18](AGENTS.md): re-audit before each release and whenever a provider is added or changed.*
