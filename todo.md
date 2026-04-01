# TODO: Fix Usage Tracking & Rate Limit Attribution

## Current State

The usage tracking infrastructure exists but is **not fully functional**:

1. **Usage commands are disabled** (`usage/commands.ts`)
   - `/free-sessionusage` and `/free-totalusage` commands exist but are commented out
   - Reason: "duplicate registration issues" across providers

2. **Usage tracking works at runtime** (`usage/tracking.ts`)
   - Per-model request counts tracked in `modelUsageCounts` Map
   - Session stats tracked in `sessionStats` Map
   - Called from `provider-helper.ts` on each `turn_end` event

3. **Cumulative usage persists** (`usage/cumulative.ts`, `usage/store.ts`)
   - Stored at `~/.pi/free-usage.json`
   - Tracks all-time usage per provider/model

4. **Free tier limits defined** (`free-tier-limits.ts`)
   - Hardcoded limits per provider
   - NOT correctly integrated with usage tracking

## Problems to Fix

### 1. Usage Commands Disabled
**File:** `usage/commands.ts`

The `registerUsageCommands()` function is empty. The slash commands need to:
- Register once globally (not per-provider)
- Show current session usage with rate limit status
- Show cumulative all-time usage

**Current:**
```typescript
export function registerUsageCommands(_pi: ExtensionAPI): void {
    // Commands disabled - Pi shows duplicate registrations across providers
    // TODO: Find reliable way to register global commands once
}
```

**Needed:**
- Register `/free-sessionusage` - shows current session breakdown
- Register `/free-totalusage` - shows cumulative usage from disk
- Include rate limit warnings (🟢🟡🔴) based on current usage vs limits

### 2. Rate Limit Attribution Wrong
**Files:** `usage/tracking.ts`, `free-tier-limits.ts`, `usage/formatters.ts`

The `FREE_TIER_LIMITS` in `free-tier-limits.ts` defines limits, but:
- Zen has no entry (has free tier but not in the list)
- Ollama has no entry (has free tier but not in the list)
- Fireworks has no entry (has free tier but not in the list)
- Mistral has no entry (has free tier but not in the list)
- Cline has no entry (has free tier but not in the list)

**Current `FREE_TIER_LIMITS`:**
```typescript
export const FREE_TIER_LIMITS: Record<string, FreeTierLimit> = {
    kilo: { provider: "kilo", requestsPerHour: 200, ... },
    openrouter: { provider: "openrouter", requestsPerDay: 1000, ... },
    nvidia: { provider: "nvidia", requestsPerMonth: 1000, ... },
    // Missing: zen, ollama, fireworks, mistral, cline
};
```

**Needed:**
- Add all providers with free tiers
- Research actual limits from provider docs
- Track per-provider usage counts separately (currently aggregated in `metrics.ts`)

### 3. Usage Formatters Not Integrated
**File:** `usage/formatters.ts`

The formatters exist but are not called anywhere:
- `formatSessionUsage()` - formats session stats
- `formatCumulativeUsage()` - formats cumulative stats  
- `formatFreeTierStatus()` - formats rate limit status with 🟢🟡🔴

**Needed:**
- Call formatters from usage commands
- Show rate limit warnings based on `FREE_TIER_LIMITS`
- Calculate percentage used: `(currentUsage / limit) * 100`

### 4. Provider-Level Usage Tracking Missing
**File:** `usage/tracking.ts`

Current tracking aggregates by model, but doesn't track per-provider totals correctly for rate limits.

The `sessionStats.providers` Map exists but:
- Doesn't reset per time window (hour/day/month)
- Doesn't check against `FREE_TIER_LIMITS`

**Needed:**
- Track usage per time window (hourly for Kilo, daily for OpenRouter, monthly for NVIDIA)
- Check limits before incrementing (warn at 80%, critical at 95%)
- Show warning in UI when approaching limits

## Implementation Plan

### Phase 1: Fix Free Tier Limits
- [ ] Add missing providers to `FREE_TIER_LIMITS`
  - [ ] Zen: 1000/day (verify with opencode.ai docs)
  - [ ] Ollama: 5 hours + 7 days reset (explain credit system)
  - [ ] Fireworks: research free tier limits
  - [ ] Mistral: research free tier limits  
  - [ ] Cline: research free tier limits

### Phase 2: Wire Up Usage Commands
- [ ] Create single registration point for global commands
- [ ] Register `/free-sessionusage` command
- [ ] Register `/free-totalusage` command
- [ ] Test commands don't duplicate across providers

### Phase 3: Integrate Formatters
- [ ] Call `formatSessionUsage()` in `/free-sessionusage`
- [ ] Call `formatCumulativeUsage()` in `/free-totalusage`
- [ ] Add rate limit status to both commands using `formatFreeTierStatus()`

### Phase 4: Per-Provider Rate Limit Warnings
- [ ] Track usage per time window (hour/day/month)
- [ ] Add limit checking in `incrementRequestCount()`
- [ ] Show UI notification when approaching limit (80% = 🟡, 95% = 🔴)
- [ ] Reset counters when time window expires

## Provider Free Tier Research

| Provider | Free Tier | Rate Limit | Documentation |
|----------|-----------|------------|---------------|
| Kilo | 14 models | 200 req/hour | kilo.ai/terms |
| Zen | 11 models | 1000 req/day | opencode.ai |
| OpenRouter | 29 models | 1000 req/day | openrouter.ai/docs |
| NVIDIA | Curated 70B+ | 1000 credits/mo | build.nvidia.com |
| Ollama | Cloud models | 5hrs + 7 days reset | ollama.com |
| Fireworks | ? | ? | app.fireworks.ai |
| Mistral | ? | ? | mistral.ai |
| Cline | ? | ? | cline.bot |

## Files to Modify

1. `free-tier-limits.ts` - Add missing providers, verify limits
2. `usage/commands.ts` - Implement command registration
3. `usage/formatters.ts` - Ensure formatters use correct limits
4. `usage/tracking.ts` - Add per-time-window tracking
5. `provider-helper.ts` - Call limit check on turn_end
6. `README.md` - Document usage commands once working

## Notes

- The `metrics.ts` file has `getDailyRequestCount()` but it tracks ALL providers together
- Need separate counters per provider per time window
- Consider using `usage/sessions.ts` for session-level tracking
- The cumulative storage in `usage/store.ts` works - don't break it
