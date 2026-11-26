# Free Models Catalog

> **Audit date: 2026-11-15 (2.9.0).** Regenerated from the [2.9.0 live audit](catalog-audit.md#2026-11-15--290-live-audit), run against master `43100f3` through real Pi. Counts are chat models after pi-free's own filters ("free / published"). Each section says how it was verified: **live turn OK** (a tool-calling turn succeeded on 2026-11-15), **not verified** (the catalog was read but no turn could complete, with the reason), or **catalog only** (no key was available; the count comes from the public catalog through pi-free's real fetchers). Provider catalogs change constantly: treat this as a dated snapshot, not a guarantee. Earlier dated audits are kept in [catalog-audit.md](catalog-audit.md).

> **Visibility:** these lists describe what each provider *offers*, not what `/model` shows. A provider stays hidden until you add its key or log in; only LLM7, whose anonymous tier answers chat, appears with no credentials. See [Model visibility](providers.md#model-visibility).

**Totals:** 116 free-classified models across 17 pi-free providers: 6 with a live tool turn on 2026-11-15 (AMD Token Lab, Xkiro, Cline, Kilo, Requesty, Infron), OpenCode Free confirmed by the maintainer, LLM7 verified on 2026-11-14, 4 not verified and 5 catalog only. Pi's own OpenRouter (14) and OpenCode Go (3) are listed separately. Nine registered providers expose no usable free model ([Zero-free providers](#zero-free-providers)) and AnyAPI was not covered.

---

## Cross-cutting conditions

These apply to many entries below regardless of provider:

- **`:free` id suffix (OpenRouter convention)** — used by Infron, FastRouter, Kilo, Cline, Routeway, OpenGateway and Command Code. Typical limits on such routes: **20 requests/minute**, **50 requests/day** (raised to **1,000/day** after a one-time $10 credit top-up on OpenRouter itself; per-gateway limits vary). Free-tier prompts and outputs are frequently **logged** by the upstream provider.
- **Balance gates** — a $0-listed model is not usable for free if the gateway requires a positive account balance (see GMI and Venice).
- **Promotion windows** — promotional free models expire; GMI's promotional rows disappear from its catalog when a promotion ends.
- **Tool calling** — pi-free lists only chat models, and drops models the catalog marks as unable to call tools, because an agent turn needs them.

---

## Pi's own providers

pi-free does not wrap these; they are listed so the free picture is complete.

### OpenRouter (`openrouter`, Pi built-in) — 14 free · live turn OK

pi-free's `/toggle-openrouter` free view hides OpenRouter's paid chat models. Free = zero prompt and completion price **and** a `:free` id or "free" in the name; the `$0` routers (`openrouter/auto`, `openrouter/fusion`, …) bill the routed model and stay hidden. Live turn OK on `cohere/north-mini-code:free`. The ids below are the free view of the catalog shipped with Pi 1.5.0; Pi's own refresh can change them.

<details><summary>Full list (14)</summary>

```text
cohere/north-mini-code:free
dots-studio/dots-3-note-preview:free
google/gemma-4-26b-a4b-it:free
google/gemma-4-31b-it:free
liquid/lfm-2.5-2.6b:free
nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
nvidia/nemotron-3-ultra-550b-a55b:free
nvidia/nemotron-3.5-lightning:free
nvidia/nemotron-3.5-super-vl:free
openrouter/free
recursive/flint-v1.0:free
thinkingmachines/inkling-small:free
thinkingmachines/inkling:free
xingchen-agi/xing4.0-29b-a4b:free
```

</details>

### OpenCode Go (`opencode-go`, Pi built-in) — 3 free of 32 shown · live turn OK

Served entirely by Pi with its own catalog and credentials; pi-free does not filter it. Live turn OK on `beam-free`.

---

## OpenCode Free (`opencode-free`) — 12 · maintainer-confirmed

pi-free's own provider for OpenCode's anonymous free tier (Bun relay, minimal environment frame). The maintainer confirmed it working on 2026-11-15; the audit's own turns then hit `429 FreeUsageLimit` on that IP after heavy probing, so the per-model list is not individually verified. The public feed (`https://opencode.ai/inference/v1/models`, 2026-11-15) lists these free candidates; it publishes no prices, so candidacy comes from Pi's metadata and the free names.

```text
beam-free
big-pickle
deepseek-v4.1-flash-free
flint-40b-free
glm-5.3-flash-free
iceman-free
inkling-2-small-free
longcat-2.5-free
mimo-v2.6-flash-free
minimax-m3.1-flash-free
nemotron-3.5-lightning-free
nemotron-3.5-super-vl-free
```

Upstream quotas and availability limits apply.

---

## Entirely-free providers

### LLM7 (`llm7`) — 2 / 3 · no key needed

pi-free registers LLM7's curated selectors rather than its full gateway catalog. The only provider visible without a key. Its anonymous daily quota was exhausted by audit probing on 2026-11-15; an anonymous tool turn succeeded on 2026-11-14.

| Model | Conditions |
| --- | --- |
| `default` | Anonymous access OK; a free token from dash.llm7.io raises limits |
| `fast` | Same; turbo-class models have lower rate and token limits for anonymous users |

The paid `pro` selector is hidden from the free view.

### AMD Token Lab (`amd-tokenlab`) — 7 / 7 · live turn OK

Key from the AMD AI Developer Program (https://notebooks.amd.com/tokenlab). All models share one per-user budget (observed 2026-11-14: $10, resetting monthly) and 20 requests per minute; the status bar shows the remaining budget. Live turn OK on `DeepSeek-V4-Flash`; `DeepSeek-V4.1-Flash` was at capacity on 2026-11-15.

| Model | Context | Conditions |
| --- | --- | --- |
| `DeepSeek-V4.1-Flash` | 1M | Text + image; reasoning via `reasoning_effort` |
| `DeepSeek-V4-Flash` | 1M | Text; reasoning via `reasoning_effort` |
| `Qwen3.8-27B` | 262K | Text + image |
| `Gemma-4-31B-IT` | 262K | Text + image |
| `MiniCPM-V-4.7-35B-A3B` | 262K | Text + image |
| `MiniCPM-V-4.7-1B` | 262K | Text + image |
| `MiniCPM5-2B` | 131K | Text |

## Free tiers inside mixed catalogs

### Xkiro (`xkiro`) — 22 / 64 · live turn OK

Key required. Free = zero published price; only models whose catalog declares tool calling are listed, and each model sends only the reasoning efforts it declares. Live turn OK on `mistralai/ministral-14b`.

<details><summary>Full list (22)</summary>

```text
cohere/command-a
cohere/command-a-plus
cohere/command-a-reasoning
cohere/command-a-translate
cohere/command-r-08-2024
cohere/command-r-plus-08-2024
cohere/command-r7b-12-2024
cohere/north-mini-code
cohere/tiny-aya-earth
cohere/tiny-aya-fire
cohere/tiny-aya-global
cohere/tiny-aya-water
mistralai/codestral-2508
mistralai/devstral-medium
mistralai/ministral-14b
mistralai/ministral-3b
mistralai/ministral-8b
mistralai/mistral-large-2512
mistralai/mistral-medium-3.5
mistralai/mistral-small-2603
sensenova/sensenova-6.8-flash-lite
stealth/big-pickle
```

</details>

### Cline (`cline`) — 18 / 440 · live turn OK

Login or key required (`/login cline` or `CLINE_API_KEY`); the catalog itself is public. Free models draw from a **free quota**; once it is exhausted you must switch to a paid plan or usage billing. Live turn OK on `baidu/ernie-5.5-flash-preview:free`; `inclusionai/ling-3.2-flash:free` failed upstream on 2026-11-15.

<details><summary>Full list (18)</summary>

```text
baidu/ernie-5.5-flash-preview:free
cline-free/nemotron-3.5-super-vl
cline-free/solar-mini4
cohere/north-mini-code:free
dots-studio/dots-3-note-preview:free
google/gemma-4-26b-a4b-it:free
google/gemma-4-31b-it:free
inclusionai/ling-3.2-flash:free
liquid/lfm-3-1.7b:free
nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
nvidia/nemotron-3-ultra-550b-a55b:free
nvidia/nemotron-3.5-lightning-free
nvidia/nemotron-3.5-lightning:free
nvidia/nemotron-3.5-super-vl:free
openrouter/free
particle-ai/particle-1:free
recursive/flint-v1.0:free
thinkingmachines/inkling-2-small:free
```

</details>

### Kilo Gateway (`kilo`) — 14 / 451 · live turn OK

Login or key required. The gateway publishes an authoritative `isFree` flag, which pi-free trusts directly. Live turn OK on `kilo-auto/free`.

<details><summary>Full list (14)</summary>

```text
baidu/ernie-5.5-flash-preview:free
cohere/north-mini-code:free
dots-studio/dots-3-note-preview:free
inclusionai/ling-3.2-flash:free
kilo-auto/free
liquid/lfm-3-1.7b:free
nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
nvidia/nemotron-3-ultra-550b-a55b:free
nvidia/nemotron-3.5-lightning:free
nvidia/nemotron-3.5-super-vl:free
openrouter/free
particle-ai/particle-1:free
reflection/beam-free
stealth/glyph-cluster
```

</details>

### Requesty (`requesty`) — 8 / 658 · live turn OK

Inline pricing; zero-priced chat models below. Retired and tool-less models are not listed. Live turn OK on `novita/ling-3.1-flash`.

<details><summary>Full list (8)</summary>

```text
google/gemma-4-31b-it
mistral/leanstral-1-5
novita/ling-3.1-flash
nvidia/muse-glimmer-30b
nvidia/nemotron-3-nano-30b-a3b
nvidia/nemotron-3-nano-omni-30b-a3b-reasoning
nvidia/nemotron-3-ultra-550b-a55b
nvidia/nemotron-3.5-lightning-30b-a3b
```

</details>

### Infron AI (`infron`) — 1 / 299 · live turn OK

`:free` suffix conditions apply; free-endpoint prompts and outputs may be logged upstream. Live turn OK on `qwen/qwen3.8-27b:free`. Models Infron serves only over the Responses API are not listed.

```text
qwen/qwen3.8-27b:free
```

### Routeway (`routeway`) — 9 / 195 · catalog only

No key was available for the audit; ids are from the public catalog through pi-free's fetcher (2026-11-15). Tool-less models are not listed.

<details><summary>Full list (9)</summary>

```text
deepseek-v4.1-flash:free
gemma-4-26b-a4b-it-chimerax:free
gemma-4-26b-a4b-it-darksoul:free
gemma-4-26b-a4b-it-luminous:free
gemma-4-26b-a4b-it-meromero:free
gemma-4-26b-a4b-it-moonlight:free
gemma-4-26b-a4b-it-musica:free
minimax-m3.1-flash:free
muse-glimmer-30b:free
```

</details>

### FastRouter (`fastrouter`) — 6 / 192 · catalog only

Key required (`FASTROUTER_API_KEY`); no key was available for the audit. Free follows FastRouter's own `free_slug_enabled` flag; the billed `fastrouter/auto` router is not free. `:free` suffix conditions apply.

<details><summary>Full list (6)</summary>

```text
google/gemma4-26b:free
nvidia/nemotron-3-nano-30b:free
nvidia/nemotron-3-super:free
openai/gpt-oss-120b:free
openai/gpt-oss-20b:free
sarvam/sarvam-105b:free
```

</details>

### OrcaRouter (`orcarouter`) — 6 / 176 · not verified

Key required. Only chat-completion models are listed (image generators priced per request are excluded). **Not verified:** the audit account's key had been reset (401), so no turn ran and the free ids were not recorded.

### ZenMux (`zenmux`) — 4 / 170 · not verified

⚠️ Free models are best-effort: they may be unavailable during peak usage and are rate-limited. **Not verified:** the audit account holds a legacy key (429).

```text
dots-studio/dots3-note-prev
sapiens-ai/agnes-2.5-flash
z-ai/glm-4.6v-flash-free
z-ai/glm-4.7-flash-free
```

### Agnes AI (`agnes`) — 2 / 4 · catalog only

Key required; no key was available for the audit. Admission and free status come from Agnes's documented text-model list (llms.txt and the pricing page, 2026-11-15); the flash models are free on promotional terms with no published end date, the pro models are paid.

| Model | Conditions |
| --- | --- |
| `agnes-2.5-flash` | Free per Agnes pricing docs |
| `agnes-3.0-flash` | Free per Agnes pricing docs |

### Command Code (`commandcode`) — 2 / 98 · catalog only

Key required; no key was available for the audit, so whether `:free` turns are unbilled is unverified. The catalog lists no prices; free is exactly the ids ending in `:free`.

```text
stealth/glyph-cluster:free
thinkingmachines/inkling-2-small:free
```

### OpenGateway (`opengateway`) — 1 / 23 · catalog only

Key required; no key was available for the audit. OpenGateway now operates as Twigpine: `api.twigpine.com/v1` serves the same catalog as the host pi-free uses, so the endpoint is unchanged. Promotional entries change over time.

```text
nvidia/nemotron-3.5-super-vl:free
```

### TrustedRouter (`trustedrouter`) — 1 / 497 · catalog only (2026-11-26)

Key required (`TRUSTEDROUTER_API_KEY`); no key was available for the 2026-11-26 audit, so counts come from the public `GET /v1/models` catalog through pi-free's real fetcher. Inline per-token pricing classifies `trustedrouter/free` as free while `/toggle-trustedrouter` reveals the full paid catalog (including `trustedrouter/auto`, `trustedrouter/zdr`, `trustedrouter/e2e`, and direct upstream models).

```text
trustedrouter/free
```

### TokenRouter (`tokenrouter`) — 1 / 121 · not verified

The catalog exposes no pricing; classification is name-based. **Not verified:** the audit account had reached its daily free limit (429), and the free id was not recorded.

### Merge Gateway (`merge`) — 1 / 280 · not verified

Catalog discovery is keyed. Each model is priced from a single route, and only text/tool-use models are listed. **Not verified:** the audit account was out of credits (402); a positive balance may be required even for a $0 route, and the free id was not recorded.

## Zero-free providers

These registered providers exposed **no usable free chat model** on 2026-11-15:

| Provider | Free / published | Why nothing is free |
| --- | --- | --- |
| GMI Cloud | 0 / 75 | Its one $0 catalog row, `gmicloud/Ripple-65B-Preview`, answered `402 no_entitlement` ("Insufficient balance"); GMI prices it at $0.20/$0.60 per million. Promotional rows (`is_free`) appear only while a promotion runs; the MiniMax Week promotion listed in earlier audits ended 2026-09-06. Whether pi-free's free view lists Ripple depends on the row's price fields; tracked as a follow-up |
| Venice AI | 0 / 137 | All models priced; inference requires a positive account balance |
| B.AI | 0 / 68 | The former "currently free" trio is now priced on docs.b.ai ($0.14–0.60 per million); only a `:free` id would count |
| InferX | 0 / 13 | No free tier; the catalog publishes no prices |
| Ollama Cloud | 0 / 23 | No free tier (pay-as-you-go) |
| DeepInfra | 0 / 92 (catalog only) | Chat models are priced; access is via trial credit |
| Novita | 0 / 82 (catalog only) | Chat models are priced; rows without a published price (including the `nvrouter/*` routers) are not free |
| SambaNova | 0 / 5 (catalog only) | All models carry per-token prices; no free tier |
| StepFun | not counted (keyed) | Step Plan is a paid subscription |

## Not covered here

- **AnyAPI** — keyed catalog, no key available for the audit; live state unknown.

---

*Maintained per [AGENTS.md convention 18](../agents.md): re-audit before each release and whenever a provider is added or changed.*
