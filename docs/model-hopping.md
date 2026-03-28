# Model Hopping Configuration

## Overview

When a free model hits a 429 rate limit, pi-free-providers can automatically hop to the **same model family** on a different provider.

## How It Works

```
User asks Llama 3.3 70B @ OpenRouter → 429
Auto-hop: Try Llama 3.3 70B @ Kilo → Try Llama 3.3 70B @ Fireworks
Same model, different provider
```

## Configuration

Add to `~/.pi/free.json`:

```json
{
  "preferred_models": [
    "llama-3.3-70b",
    "qwen-2.5-72b",
    "deepseek-v3",
    "mixtral-8x22b"
  ],
  "auto_model_hop": true,
  "max_model_hops": 3
}
```

### preferred_models

Ordered list of model families to prioritize when hopping. If the current model matches one of these, alternatives from the same family are tried first.

**Supported model families:**
- `deepseek-v3`, `deepseek-r1`
- `llama-3.3-70b`, `llama-3.1-405b`, `llama-3-8b`
- `qwen-2.5-72b`, `qwen-2.5-32b`
- `mixtral-8x22b`, `mixtral-8x7b`
- `kimi-k2`, `kimi-k2.5`
- `gemini-1.5-pro`, `gemini-2-flash`

### auto_model_hop

Enable/disable automatic model hopping on 429 (default: `true`)

### max_model_hops

Maximum number of provider switches before giving up (default: `3`)

## Example Flow

**With preferred_models configured:**
```
1. User: "Hello" → Llama 3.3 70B @ OpenRouter
2. OpenRouter: 429 Rate limit
3. Auto-hop: Llama 3.3 70B @ Kilo (same family, user's #1 preference)
4. Kilo: 429 Rate limit
5. Auto-hop: Llama 3.3 70B @ Fireworks (paid but available)
6. Fireworks: Success!
```

**Without preferred_models (automatic fuzzy matching):**
```
1. User: "Hello" → Qwen 2.5 72B @ Kilo
2. Kilo: 429 Rate limit
3. Auto-hop: Qwen 2.5 72B @ OpenRouter (detected same family)
4. OpenRouter: Success!
```

## Exhaustion Tracking

Each (provider, model) pair that returns a 429 is marked as "exhausted" for 5 minutes. This prevents repeatedly trying the same failing combination.

## Free Mode Behavior

In free mode (no `*_SHOW_PAID` flags):
- Only free alternatives are considered
- If no free alternatives exist, shows notification to run `/autocompact`
- Paid models are excluded from automatic hopping

## Paid Mode Behavior

When `*_SHOW_PAID=true` for the current provider:
- All alternatives (free and paid) are considered
- Sorted by cost (cheapest first)
- Seamless automatic failover

## Manual Override

Use `/model` (Ctrl+L) to manually switch models at any time. The hopping system respects manual choices and won't override them.

## Disable Hopping

Set `auto_model_hop: false` in config to disable automatic failover:

```json
{
  "auto_model_hop": false
}
```

With hopping disabled, 429 errors will show a notification suggesting `/autocompact` or manual model switch.
