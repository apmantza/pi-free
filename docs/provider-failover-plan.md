# Provider Failover & 429 Handling - Assessment & Plan

## Analysis of Reference Implementations

### 1. pi-high-availability (burggraf) ⭐ Most Relevant
**Key Features:**
- **Error Classification**: Network, Quota (429), Capacity errors
- **Multi-Tier Failover**: 
  - Account-level: Switch API keys for same provider
  - Provider-level: Jump to next provider in group
- **Exhaustion Tracking**: Marks accounts/providers as exhausted with cooldown
- **Group-Based Chains**: Configurable failover chains (e.g., "Fast Tier" → "Backup Tier")
- **Error Actions**: `stop`, `retry`, `next_provider`, `next_key_then_provider`
- **Auto-Retry**: Configurable timeouts, intelligent retry delays

**Architecture:**
- Intercepts errors via `onBeforeSendRequest` hook
- Maintains exhaustion state in memory
- Uses Pi's credential system for account fallback
- Interactive TUI for group/credential management

**Integration Points for pi-free:**
- ✅ Error detection patterns for 429/capacity
- ✅ Exhaustion/cooldown concept
- ✅ Provider failover logic
- ⚠️ Account-level failover (we mostly have single-key providers)
- ⚠️ Groups concept needs simplification for pi-free

### 2. pi-budget-model ⭐ Relevant for Autocompact
**Key Features:**
- **Cost-Aware Selection**: Find cheapest model meeting criteria
- **Strategies**: `same-provider`, `any-provider`
- **Cost Ratio**: Filter by max cost (e.g., ≤ 50% of current model)
- **Major Versions**: Include previous versions for more options
- **Free-Only Mode**: `costRatio: 0` for free models only

**Integration Points for pi-free:**
- ✅ Perfect for autocompact trigger on 429
- ✅ Cross-provider budget model search
- ✅ Can find free alternatives when paid hits 429
- ⚠️ Need to add provider exhaustion awareness

### 3. pi-interactive-shell (nicobailon) ❌ Not Relevant
**Features:**
- Interactive CLI overlay for Pi
- Subagent dispatch/background modes
- Notification system

**Verdict**: Not relevant for provider failover. Different problem domain.

---

## Proposed Architecture for pi-free

### Core Design Principles
1. **Minimal Complexity**: Don't replicate full HA manager, focus on 429 handling
2. **Automatic Recovery**: Failover should be transparent to user
3. **Free-Mode Priority**: In free mode, aggressively find free alternatives
4. **Paid-Mode Graceful**: In paid mode, try cheaper alternatives first

### Components

#### 1. Error Detector (`provider-failover/errors.ts`)
```typescript
export type ErrorType = 'rate_limit' | 'capacity' | 'network' | 'auth' | 'unknown';

export function classifyError(error: unknown): {
  type: ErrorType;
  provider?: string;
  model?: string;
  message: string;
  retryable: boolean;
};

// Pattern matching for various provider 429 messages
const RATE_LIMIT_PATTERNS = [
  /429/i,
  /rate.?limit/i,
  /too.?many.?requests/i,
  /quota.*exceeded/i,
  /insufficient.*quota/i,
];
```

#### 2. Exhaustion Tracker (`provider-failover/exhaustion.ts`)
```typescript
export interface ExhaustionState {
  provider: string;
  model?: string;
  exhaustedAt: number;
  cooldownMs: number;
  reason: 'rate_limit' | 'capacity' | 'manual';
}

export class ExhaustionTracker {
  // Mark provider/model as exhausted
  markExhausted(state: ExhaustionState): void;
  
  // Check if provider/model is currently exhausted
  isExhausted(provider: string, model?: string): boolean;
  
  // Get next available provider from preference list
  findAlternative(preferred: string[], excludeExhausted?: boolean): string | null;
  
  // Clear exhaustion (e.g., after cooldown)
  clearExhausted(provider: string, model?: string): void;
}
```

#### 3. Failover Handler (`provider-failover/index.ts`)
```typescript
export interface FailoverConfig {
  // Ordered list of providers to try
  providerChain: string[];
  
  // What to do on 429 in free mode
  freeModeAction: 'autocompact' | 'next_provider' | 'budget_model';
  
  // What to do on 429 in paid mode  
  paidModeAction: 'next_provider' | 'budget_model' | 'retry';
  
  // Cooldown before retrying exhausted provider (ms)
  defaultCooldownMs: number;
  
  // Max failover attempts per turn
  maxFailoverAttempts: number;
}

export async function handleFailover(
  error: unknown,
  currentProvider: string,
  config: FailoverConfig,
  ctx: AgentContext
): Promise<{ 
  action: 'retry' | 'failover' | 'autocompact' | 'fail';
  newProvider?: string;
  newModel?: string;
}>;
```

#### 4. Autocompact Integration (`provider-failover/autocompact.ts`)
```typescript
export async function triggerAutocompact(
  ctx: AgentContext,
  reason: string
): Promise<boolean>;

// Check if autocompact is available/enabled
export function isAutocompactAvailable(): boolean;
```

#### 5. Budget Model Fallback (`provider-failover/budget.ts`)
```typescript
export async function findBudgetAlternative(
  currentModel: Model,
  strategy: 'free_only' | 'cheaper' | 'same_provider_cheaper',
  ctx: AgentContext
): Promise<{ provider: string; model: string } | null>;
```

---

## Integration with Existing pi-free

### 1. Hook into provider setup
Modify `provider-helper.ts` to add error handling:

```typescript
export interface ProviderSetupConfig {
  // ... existing fields
  
  /** Error handler for provider-specific errors */
  onError?: (error: unknown, ctx: AgentContext) => Promise<boolean>; // return true if handled
}
```

### 2. Global error interceptor
Add to each provider in `session_start`:

```typescript
pi.on("error", async (event, ctx) => {
  if (!isProviderError(event.error)) return;
  
  const classification = classifyError(event.error);
  if (classification.type === 'rate_limit') {
    return handleRateLimit(event.error, ctx);
  }
});
```

### 3. Provider priority chain
Define default failover order:

```typescript
// In constants.ts
export const DEFAULT_PROVIDER_CHAIN = [
  PROVIDER_KILO,      // Try free Kilo first
  PROVIDER_OPENROUTER, // Then OpenRouter free
  PROVIDER_ZEN,       // Then Zen
  // Paid providers last (if in paid mode)
  PROVIDER_FIREWORKS,
  PROVIDER_NVIDIA,
  PROVIDER_CLINE,
];
```

---

## Implementation Phases

### Phase 1: Error Detection & Basic Failover
1. Create `provider-failover/errors.ts` - Classify errors by provider
2. Create `provider-failover/exhaustion.ts` - Track exhausted providers
3. Add error handling hook to `provider-helper.ts`
4. Implement basic provider-to-provider failover

### Phase 2: Autocompact Integration
1. Create `provider-failover/autocompact.ts`
2. Add `/autocompact` command trigger on 429 in free mode
3. Test with Kilo → autocompact → retry flow

### Phase 3: Budget Model Selection
1. Create `provider-failover/budget.ts`
2. Implement free-model finder across providers
3. Integrate with pi-budget-model patterns

### Phase 4: Smart Failover
1. Add provider chain configuration
2. Implement cooldown management
3. Add UI notifications for failover events
4. Metrics tracking for failover success rates

---

## Configuration Example

```json
// ~/.pi/free.json
{
  "fireworks_api_key": "fw_xxx",
  "openrouter_api_key": "or_xxx",
  
  // Failover configuration
  "failover": {
    "enabled": true,
    "provider_chain": ["kilo", "openrouter", "zen", "fireworks", "nvidia"],
    "free_mode_action": "autocompact_then_next",
    "paid_mode_action": "budget_then_next",
    "default_cooldown_ms": 300000,
    "max_failover_attempts": 3
  },
  
  // Per-provider cooldown overrides
  "cooldowns": {
    "kilo": 60000,      // 1 min (fast recovery)
    "openrouter": 300000, // 5 min
    "fireworks": 60000   // 1 min
  }
}
```

---

## Key Design Decisions

1. **No Full HA Manager**: Keep it simple - just 429 handling, not full HA
2. **Exhaustion in Memory Only**: Don't persist, reset on Pi restart
3. **Explicit Chain**: User defines priority, we respect it
4. **Autocompact as First Resort**: In free mode, compact before switching
5. **Budget Models as Fallback**: Use cost-aware selection when switching
6. **Transparent to User**: Failover happens automatically, notify but don't block

## Open Questions

1. Should we persist exhaustion state across Pi sessions?
2. How to handle cascading 429s (all providers exhausted)?
3. Should we implement account-level failover (multiple API keys per provider)?
4. Should failover trigger model re-selection UI or be fully automatic?
5. How to integrate with Pi's existing retry logic vs our failover?
