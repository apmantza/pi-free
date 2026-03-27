/**
 * Free model load balancer with hot-swap.
 * 
 * When rate limited, automatically:
 * 1. Finds next available free model
 * 2. Hot-swaps to it (same terminal, same context)
 * 3. Compacts conversation if needed
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  PROVIDER_CLINE,
  PROVIDER_KILO,
  PROVIDER_NVIDIA,
  PROVIDER_OPENROUTER,
  PROVIDER_ZEN,
} from "./constants.ts";

// =============================================================================
// Types
// =============================================================================

interface ModelEntry {
  provider: string;
  modelId: string;
  requestCount: number;
  lastUsed: number;
  rateLimitedUntil: number;
}

// =============================================================================
// Free model queue - order matters (most reliable first)
// =============================================================================

const freeModels: ModelEntry[] = [
  // Zen free models (most reliable, no auth needed)
  { provider: PROVIDER_ZEN, modelId: "big-pickle", requestCount: 0, lastUsed: 0, rateLimitedUntil: 0 },
  { provider: PROVIDER_ZEN, modelId: "glm-5-free", requestCount: 0, lastUsed: 0, rateLimitedUntil: 0 },
  { provider: PROVIDER_ZEN, modelId: "minimax-m2.5-free", requestCount: 0, lastUsed: 0, rateLimitedUntil: 0 },
  { provider: PROVIDER_ZEN, modelId: "mimo-v2-pro-free", requestCount: 0, lastUsed: 0, rateLimitedUntil: 0 },
  { provider: PROVIDER_ZEN, modelId: "nemotron-3-super-free", requestCount: 0, lastUsed: 0, rateLimitedUntil: 0 },
  { provider: PROVIDER_ZEN, modelId: "mimo-v2-omni-free", requestCount: 0, lastUsed: 0, rateLimitedUntil: 0 },
  { provider: PROVIDER_ZEN, modelId: "mimo-v2-flash-free", requestCount: 0, lastUsed: 0, rateLimitedUntil: 0 },

  // Kilo free models (requires free auth via /login kilo)
  { provider: PROVIDER_KILO, modelId: "deepseek-r1", requestCount: 0, lastUsed: 0, rateLimitedUntil: 0 },
  { provider: PROVIDER_KILO, modelId: "llama-3.1-70b-instruct", requestCount: 0, lastUsed: 0, rateLimitedUntil: 0 },

  // OpenRouter free models
  { provider: PROVIDER_OPENROUTER, modelId: "meta-llama/llama-3.1-8b-instruct:free", requestCount: 0, lastUsed: 0, rateLimitedUntil: 0 },
  { provider: PROVIDER_OPENROUTER, modelId: "google/gemma-2-9b-it:free", requestCount: 0, lastUsed: 0, rateLimitedUntil: 0 },

  // Cline models
  { provider: PROVIDER_CLINE, modelId: "anthropic/claude-3.5-sonnet", requestCount: 0, lastUsed: 0, rateLimitedUntil: 0 },
];

const RATE_LIMIT_COOLDOWN_MS = 90_000; // 90 seconds cooldown after suspected 429

let turnStartTime = 0;
let turnProvider = "";
let turnModelId = "";

// =============================================================================
// Core functions
// =============================================================================

function getAvailableModels(): ModelEntry[] {
  const now = Date.now();
  return freeModels.filter((m) => m.rateLimitedUntil < now);
}

function selectNextModel(currentProvider: string, currentModelId: string): ModelEntry | null {
  const available = getAvailableModels();

  if (available.length === 0) return null;

  // Filter out current model
  const others = available.filter(
    (m) => !(m.provider === currentProvider && m.modelId === currentModelId)
  );

  const candidates = others.length > 0 ? others : available;

  // Sort by: least used, then oldest
  candidates.sort((a, b) => {
    if (a.requestCount !== b.requestCount) return a.requestCount - b.requestCount;
    return a.lastUsed - b.lastUsed;
  });

  return candidates[0];
}

function markRateLimited(provider: string, modelId: string): void {
  const entry = freeModels.find((m) => m.provider === provider && m.modelId === modelId);
  if (entry) {
    entry.rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
  }
}

function recordRequest(provider: string, modelId: string): void {
  const entry = freeModels.find((m) => m.provider === provider && m.modelId === modelId);
  if (entry) {
    entry.requestCount++;
    entry.lastUsed = Date.now();
  }
}

// =============================================================================
// Hot-swap logic
// =============================================================================

async function hotSwapModel(
  ctx: any,
  currentProvider: string,
  currentModelId: string,
  reason: string
): Promise<boolean> {
  const next = selectNextModel(currentProvider, currentModelId);

  if (!next) {
    ctx.ui.notify("🔴 All free models rate-limited. Wait ~90s.", "error");
    return false;
  }

  // Find the model in Pi's registry
  const nextModel = ctx.modelRegistry.find(next.provider, next.modelId);
  if (!nextModel) {
    ctx.ui.notify(`Model not available: ${next.provider}/${next.modelId}`, "warning");
    // Mark as unavailable and try next
    markRateLimited(next.provider, next.modelId);
    return hotSwapModel(ctx, currentProvider, currentModelId, reason);
  }

  // Check if model has auth configured (for providers that need it)
  if (!ctx.modelRegistry.hasConfiguredAuth(nextModel)) {
    // Skip models that need auth but don't have it
    markRateLimited(next.provider, next.modelId);
    return hotSwapModel(ctx, currentProvider, currentModelId, reason);
  }

  // Compact context first (optional, reduces token count for new model)
  ctx.compact({
    onComplete: async () => {
      // Hot-swap the model
      const success = await ctx.modelRegistry.setModel(nextModel);
      if (success) {
        recordRequest(next.provider, next.modelId);
        ctx.ui.notify(
          `🔄 ${reason} → Switched to ${next.modelId} (${next.provider})`,
          "info"
        );
      } else {
        ctx.ui.notify(`Failed to switch to ${next.modelId}`, "warning");
      }
    },
    onError: async () => {
      // Try switching even if compact fails
      const success = await ctx.modelRegistry.setModel(nextModel);
      if (success) {
        recordRequest(next.provider, next.modelId);
        ctx.ui.notify(
          `🔄 ${reason} → Switched to ${next.modelId} (${next.provider}) [no compact]`,
          "info"
        );
      }
    },
  });

  return true;
}

// =============================================================================
// Extension registration
// =============================================================================

export function registerLoadBalancer(pi: ExtensionAPI): void {
  // Track turn start
  pi.on("turn_start", async (_event, ctx) => {
    if (!ctx.model) return;
    turnStartTime = Date.now();
    turnProvider = ctx.model.provider;
    turnModelId = ctx.model.id;
  });

  // Detect potential rate limiting on turn end
  pi.on("turn_end", async (event, ctx) => {
    if (!turnStartTime || !turnProvider || !turnModelId) return;

    const turnDuration = Date.now() - turnStartTime;

    // Heuristic: Long turn with minimal output = likely rate limited
    const isSuspected429 = turnDuration > 45_000;

    if (isSuspected429) {
      markRateLimited(turnProvider, turnModelId);
      ctx.ui.notify("⏳ Slow response detected — preparing to rotate models...", "warning");
    } else {
      recordRequest(turnProvider, turnModelId);
    }

    turnStartTime = 0;
    turnProvider = "";
    turnModelId = "";
  });

  // /hop command - manual model rotation
  pi.registerCommand("hop", {
    description: "Hot-swap to next free model (rate limit workaround)",
    handler: async (_args, ctx) => {
      if (!ctx.model) {
        ctx.ui.notify("No active model", "warning");
        return;
      }

      await hotSwapModel(ctx, ctx.model.provider, ctx.model.id, "Manual hop");
    },
  });

  // /free-status - show model queue status
  pi.registerCommand("free-status", {
    description: "Show free model availability status",
    handler: async (_args, ctx) => {
      const now = Date.now();
      const lines = freeModels.map((m) => {
        const limited = m.rateLimitedUntil > now;
        const remaining = limited ? Math.ceil((m.rateLimitedUntil - now) / 1000) : 0;
        const icon = limited ? "🔴" : m.requestCount > 0 ? "🟡" : "🟢";
        const stats = `${m.requestCount} reqs${limited ? ` (limited ${remaining}s)` : ""}`;
        return `${icon} ${m.modelId} — ${stats}`;
      });

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // /free-reset - reset rate limits (for testing)
  pi.registerCommand("free-reset", {
    description: "Reset all rate limits",
    handler: async (_args, ctx) => {
      freeModels.forEach((m) => {
        m.rateLimitedUntil = 0;
        m.requestCount = 0;
      });
      ctx.ui.notify("✓ All rate limits reset", "info");
    },
  });
}
