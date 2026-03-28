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
  "max_model_hops": 3
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
