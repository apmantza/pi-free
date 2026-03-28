# Model Hopping Configuration

## Overview

When a model hits a 429 rate limit, pi-free-providers automatically hops to alternatives using **dynamic hierarchical matching**.

## How It Works (Priority Order)

```
1. User: "Hello" → MiMo V2 Pro Free @ Kilo
2. Kilo: 429 Rate limit

Hopping logic:
  1st: Same model ID on other provider? → MiMo V2 Pro Free @ OpenRouter
  2nd: Same provider, similar model? → MiMo V2 Flash Free @ Kilo
  3rd: User's preferred_models? → (from config)
  4th: Same model family? → MiMo V2 Omni Free @ Zen
  5th: Similar by name? → Other MiMo variants
  
Auto-retry until success or max hops reached
```

## Configuration

Add to `~/.pi/free.json`:

```json
{
  "preferred_models": [
    "llama-3.3-70b",
    "qwen-2.5-72b",
    "deepseek-v3",
    "minimax-m2.5",
    "mimo-v2",
    "trinity-large"
  ],
  "auto_model_hop": true,
  "max_model_hops": 3,
  "allow_downgrades": "minor"
}
```

### preferred_models (Optional)

Your preferred model families. The system **automatically extracts family names** from model IDs, so you can use:
- Full names: `"llama-3.3-70b"`, `"qwen-2.5-72b"`
- Partial names: `"llama"`, `"qwen"`, `"deepseek"`
- Any substring that appears in model IDs

If configured, these are tried after exact matches but before fuzzy matching.

### auto_model_hop

Enable/disable automatic hopping on 429 (default: `true`)

### max_model_hops

Maximum provider switches before giving up (default: `3`)

### allow_downgrades

Control capability preservation when hopping (default: `"minor"`):
- `"never"` - Only hop to equal or better models
- `"minor"` - Allow minor downgrades (one tier) with warning
- `"always"` - Allow any downgrade with warning

## Dynamic Family Extraction

The system automatically extracts model families without hardcoded patterns:

| Model ID | Extracted Family |
|----------|-----------------|
| `accounts/fireworks/models/mimo-v2-pro-free` | `mimo-v2` |
| `kilo/mimo-v2-flash-free` | `mimo-v2` |
| `meta-llama/llama-3.3-70b-instruct` | `llama-3.3-70b` |
| `qwen2.5-72b-instruct` | `qwen2.5-72b` |
| `deepseek-v3-r1` | `deepseek-v3` |

This works for **any model** without requiring code changes.

## Example Flows

**Scenario 1: Same model on different provider**
```
User → MiMo V2 Pro @ Kilo → 429
Hop 1: MiMo V2 Pro @ OpenRouter → Success!
```

**Scenario 2: Same provider, different variant**
```
User → MiMo V2 Pro @ Kilo → 429
Hop 1: MiMo V2 Flash @ Kilo → 429
Hop 2: MiMo V2 @ OpenRouter → Success!
```

**Scenario 3: User preferences guide hopping**
```
Config: "preferred_models": ["llama-3.3-70b", "deepseek-v3"]

User → Qwen @ Kilo → 429
Hop 1: (no exact Qwen match on other provider)
Hop 2: Llama 3.3 70B @ OpenRouter (from preferences) → Success!
```

**Scenario 4: Fallback to similar models**
```
User → Big Pickle @ Kilo → 429
Hop 1: (no other Big Pickle found)
Hop 2: Trinity Large @ Zen (similar free model) → Success!
```

## Capability Ranking

Models are ranked using **hardcoded benchmark data** from Artificial Analysis, updated monthly.

### Data Source

**Artificial Analysis** (https://artificialanalysis.ai)
- Real benchmark scores for 50+ popular models
- Intelligence Index (overall capability)
- Coding, reasoning, agentic benchmarks
- Updated monthly via GitHub Actions

### How It Works

```
User asks Claude-3.5-Sonnet @ Kilo → 429

1. Check hardcoded benchmark database
   Found! Intelligence Index: 62.9 → Score: 90 (high tier)

2. Find alternatives:
   - GPT-4 @ OpenRouter: Index 58.0 → Score: 83 ✅ Equal
   - MiMo-V2-Pro @ Zen: Index 49.2 → Score: 70 ⬇️ Major down
   - Llama-3.1-70B @ Fireworks: Not in DB → Heuristic: 69 ⚠️ Minor down

3. Hop to best equal-or-better option
```

### Hardcoded Models

The extension includes benchmark data for:
- **OpenAI**: GPT-4o, GPT-4, GPT-4o-mini, GPT-3.5
- **Anthropic**: Claude-3.5-Sonnet, Claude-3-Opus, Claude-3.5/3-Haiku
- **Meta**: Llama-3.1-405B, Llama-3.1-70B, Llama-3-70B
- **Google**: Gemini-1.5-Pro, Gemini-1.5-Flash
- **Alibaba**: Qwen-2.5-72B, Qwen-2.5-32B
- **DeepSeek**: DeepSeek-V3, DeepSeek-R1
- **Xiaomi**: MiMo-V2-Pro, MiMo-V2-Flash, MiMo-V2-Omni
- **ZAI/OpenCode**: Big Pickle, Trinity, MiniMax
- **And more...**

### Capability Tiers

| Tier | Score | Typical Models |
|------|-------|----------------|
| **ultra** | 80+ | GPT-4o (92), Claude-3.5-Opus |
| **high** | 70-84 | GPT-4 (83), Llama-3.1-405B (75) |
| **medium** | 45-69 | Claude-3-Haiku (69), Qwen-72B (70) |
| **low** | 25-44 | 7B-13B models |
| **minimal** | <25 | Small models (fallback heuristics) |

### Fallback Heuristics

For models not in the hardcoded database:
- Context window × 0.03 points
- Reasoning flag +20 points
- Vision +5 points
- Parameters × 0.4 points

Still prevents major downgrades (e.g., 70B → 7B).

### Updating Data

Benchmarks are updated **monthly** via GitHub Actions:
1. Fetches fresh data using maintainer's API key
2. Updates `provider-failover/hardcoded-benchmarks.ts`
3. Creates PR with new scores
4. Merged → new release

Users always have current data **without needing API keys**.

## Exhaustion Tracking

Each (provider, model) pair that returns a 429 is marked "exhausted" for 5 minutes. This prevents infinite loops and repeated failures.

## Free vs Paid Mode

**Free mode** (default, no `*_SHOW_PAID`):
- Only free models considered (`cost.input === 0`)
- Paid alternatives excluded from hopping

**Paid mode** (`*_SHOW_PAID=true`):
- All models considered (free + paid)
- Sorted by cost (cheapest first)
- Seamless failover to paid if needed

## Disable Hopping

```json
{
  "auto_model_hop": false
}
```

When disabled, 429 errors show notification to run `/autocompact` or use `/model` to switch manually.

## Debugging

Check hop status in extension logs:
```
[hop] Session: abc123, Hops: 2, Tried: 3 models
[hop] Current: openrouter/mimo-v2, Original: kilo/mimo-v2-pro
```
