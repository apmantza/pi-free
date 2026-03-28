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

### allow_downgrades

Control capability preservation when hopping (default: `"minor"`):
- `"never"` - Only hop to equal or better models. If none available, ask user.
- `"minor"` - Allow minor downgrades (one tier). Warn on major downgrades.
- `"always"` - Allow any downgrade with notification.

## Capability Ranking

Models are ranked using **real benchmark data** when available, falling back to smart heuristics.

### Data Sources

**Primary: Artificial Analysis API**
- Real benchmark scores for 300+ models
- Intelligence Index (overall capability)
- Coding, reasoning, agentic benchmarks
- Updated regularly
- Free API key at artificialanalysis.ai

**Fallback: Smart Heuristics**
- For models not in AA database
- Context window, reasoning flag, vision
- Parameter extraction from name

### Setup

Get free API key:
```bash
# 1. Sign up at https://artificialanalysis.ai
# 2. Generate API key in account settings
# 3. Add to ~/.pi/free.json or env:

export ARTIFICIAL_ANALYSIS_API_KEY="your_key_here"
```

Or in config:
```json
{
  "artificial_analysis_api_key": "your_key_here"
}
```

### How It Works

```
User asks Claude-3.5-Sonnet @ Kilo → 429

1. Check Artificial Analysis database
   Found! Intelligence Index: 62.9 → Score: 90 (high tier)

2. Find alternatives:
   - GPT-4 @ OpenRouter: Index 64.2 → Score: 92 ✅ Equal
   - Llama-3.1-70B @ Fireworks: Not in AA → Heuristic: 68 ⚠️ Minor down
   - MiMo-V2-Pro @ Zen: Index 49.2 → Score: 70 ⬇️ Major down

3. Hop to best equal-or-better option
```

### Capability Tiers

| Tier | Score | AA Intelligence Index | Typical Models |
|------|-------|---------------------|----------------|
| **ultra** | 80+ | 56+ | GPT-4o (64), Claude-3.5-Opus |
| **high** | 65-79 | 45-55 | GPT-4 (58), Llama-3.1-405B (52) |
| **medium** | 45-64 | 32-44 | Claude-3-Haiku (45), Qwen-72B |
| **low** | 25-44 | 18-31 | 7B-13B models |
| **minimal** | <25 | <18 | Small/free models |

### Without API Key

If no API key, system uses **heuristics only**:
- Context window size × 0.03 points
- Reasoning flag +20 points
- Vision support +5 points
- Parameter count × 0.4 points

Less accurate but still prevents major downgrades (e.g., 70B → 7B).

### Cache

Data cached at `~/.pi/cache/artificial-analysis.json` for 24 hours.
Cache auto-refreshes on session start if stale.

## Smart Hopping with Capability Preservation

**Example 1: Capability preserved**
```
User: Complex reasoning task → Claude-3.5-Sonnet @ OpenRouter → 429
Auto-hop: Claude-3.5-Sonnet @ Kilo (same capability) → Success ✓
```

**Example 2: Minor downgrade allowed**
```
User: Complex task → GPT-4 @ OpenRouter → 429
No GPT-4 on other providers available...
Hop: GPT-4o @ Fireworks (high tier, minor downgrade) → Success ⚠️
Notification: "Slight downgrade: GPT-4o (high) vs GPT-4 (ultra)"
```

**Example 3: Major downgrade prevented**
```
User: Code analysis → Claude-3.5-Sonnet @ Kilo → 429
Config: allow_downgrades: "minor"
No equal-or-better alternatives found
Result: ⚠️ "Cannot find equivalent model. Llama-3-8B is significantly less capable 
than Claude-3.5-Sonnet. Use /model to switch manually or allow downgrades."
```

**Example 4: User overrides**
```
Config: allow_downgrades: "always"
User: Task → GPT-4 @ Kilo → 429
Hop: Qwen-7B @ OpenRouter (major downgrade) → Success ⬇️
Notification: "Major downgrade: Qwen-7B (low, score: 35) vs GPT-4 (ultra, score: 92)"
```

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
