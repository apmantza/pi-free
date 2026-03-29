# Free Tier Rate Limits

This document tracks the free tier usage limits for each provider in pi-free-providers.

## Provider Limits

| Provider | Free Tier Limit | Notes |
|----------|-----------------|-------|
| **Kilo** | 200 requests/hour | Per IP (anonymous) or per account (authenticated) |
| **OpenRouter** | 1000 requests/day | For free tier (no API key) |
| **Zen (OpenCode)** | Fair use | No hard limits, but abuse may be throttled |
| **NVIDIA** | 1000 requests/month | NIM free tier |
| **Fireworks** | 1000 requests/month | Free tier |
| **Cline** | Undisclosed | Rate limited but limits not documented |

## Usage Tracking

The extension automatically tracks your usage against these limits:

```typescript
// Check current usage
const usage = getFreeTierUsage("kilo");
console.log(`Used ${usage.requestsThisHour}/${usage.limit.requestsPerHour} this hour`);

// Get warning if approaching limit
const warning = getLimitWarning("openrouter");
if (warning) {
  console.warn(warning); // "⚠️ openrouter: 85% of free tier used. ~150 requests remaining."
}
```

## Status Indicators

| Status | Meaning | Action |
|--------|---------|--------|
| 🟢 **OK** | < 70% used | No action needed |
| 🟡 **Warning** | 70-90% used | Consider using other providers |
| 🔴 **Critical** | > 90% used | Switch provider soon to avoid 429s |
| ⚪ **Unknown** | Limits not documented | Monitor for errors |

## What Happens When You Hit Limits

When you approach or hit a rate limit:

1. **Warning**: The system warns you before hitting the limit
2. **429 Error**: Provider returns rate limit error
3. **Auto-failover**: If `auto_model_hop` is enabled, automatically switches to another provider
4. **Autocompact**: Suggests compacting conversation to reduce tokens

## Understanding Exact Limits

Per-model tracking helps discover exact limits empirically:

### Example: Discovering Kilo's Per-Model Limits

```typescript
// After heavy usage, check the report
logModelUsageReport("kilo");
// [usage-report] kilo: 267 total requests
//   - xiaomi/mimo-v2-pro:free: 201 requests  ← Hmm, stopped at ~200?
//   - minimax/minimax-m2.5:free: 66 requests
```

This pattern suggests Kilo may have **per-model** limits (around 200/hour per model) in addition to IP-level limits.

### Example: OpenRouter Daily Pattern

```typescript
logModelUsageReport("openrouter");
// [usage-report] openrouter: 847 total requests
//   - anthropic/claude-sonnet-4.6: 423 requests
//   - google/gemini-3.1-pro-preview: 424 requests
```

Even distribution suggests OpenRouter's 1000/day limit is **provider-wide**, not per-model.

### Example: Model-Specific Throttling

```typescript
// Compare two models at same provider
const claudeUsage = getModelUsage("zen", "claude-opus-4-6");
const geminiUsage = getModelUsage("zen", "gemini-3.1-pro");

// If Claude hits 429s at 50 requests but Gemini works at 200,
// Claude may have stricter rate limiting
```

## Avoiding Rate Limits

### Strategy 1: Provider Rotation
Use multiple providers to distribute load:

```bash
# Start with Kilo
/model kilo/mimo-v2-pro:free

# If rate limited, hop to OpenRouter
/model openrouter/mimo-v2-pro:free
```

### Strategy 2: Session Management
Start fresh sessions periodically to reset counters:

```
/session  # New session = fresh rate limit counters
```

### Strategy 3: Upgrade to Paid
When free tier isn't enough:

- **Kilo**: `/login kilo` for higher limits
- **OpenRouter**: Set `OPENROUTER_API_KEY` for paid access
- **NVIDIA**: Sign up for paid NIM access

## Configuration

Add to `~/.pi/free.json`:

```json
{
  "auto_model_hop": true,
  "max_model_hops": 3,
  "allow_downgrades": "minor"
}
```

This enables automatic failover when rate limits are hit.

## Implementation Details

Usage tracking is done via:
- **In-memory counters**: Per session (resets when Pi restarts)
- **Daily tracking**: Tracks requests per provider per day
- **Hourly estimates**: Based on session activity
- **Per-model tracking**: Granular tracking of which models you use most

### Per-Model Tracking (NEW)

We now track usage per model per provider:

```typescript
// Track a request for specific model
incrementModelRequestCount("kilo", "xiaomi/mimo-v2-pro:free");

// Get usage for specific model
const usage = getModelUsage("kilo", "xiaomi/mimo-v2-pro:free");
// { count: 45, lastUsed: 1711731234567 }

// See which models you use most with a provider
const kiloModels = getProviderModelUsage("kilo");
// [
//   { modelId: "xiaomi/mimo-v2-pro:free", count: 45, lastUsed: ... },
//   { modelId: "minimax/minimax-m2.5:free", count: 32, lastUsed: ... }
// ]

// Get top models across all providers
const top = getTopModels(5);
// [
//   { provider: "kilo", modelId: "xiaomi/mimo-v2-pro:free", count: 45 },
//   { provider: "zen", modelId: "mimo-v2-pro-free", count: 38 },
//   ...
// ]
```

This helps identify:
- Which models consume your quota fastest
- If certain models have stricter limits
- Optimal model rotation strategies

Note: These are estimates. Provider-side counters are authoritative.

## Known Limitations

1. **No server-side sync**: We can't know the provider's exact count
2. **Hourly estimates**: Hourly usage is estimated from daily total
3. **IP-based limits**: Kilo's IP-based limits affect all users on same network
4. **Undocumented limits**: Cline and Zen limits are not publicly documented

## API Reference

### Provider-Level Functions

#### `getFreeTierUsage(provider: string)`
Returns current usage against free tier limits.

#### `isApproachingLimit(provider: string)`
Returns `true` if usage is > 70% of limit.

#### `getLimitWarning(provider: string)`
Returns warning message if approaching limit, `null` otherwise.

#### `formatFreeTierStatus(provider: string)`
Returns formatted status string for display.

### Per-Model Functions

#### `incrementModelRequestCount(provider, modelId)`
Track a request for a specific model. Call this on every request.

#### `getModelUsage(provider, modelId)`
Get usage stats for a specific model:
```typescript
{ count: 45, lastUsed: 1711731234567 }
```

#### `getProviderModelUsage(provider)`
Get all model usage sorted by count (highest first) for a provider.

#### `getTopModels(n)`
Get top N most used models across all providers.

#### `logModelUsageReport(provider?)`
Print usage report to console. If provider omitted, shows top 10 across all providers.
