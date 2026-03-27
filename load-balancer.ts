/**
 * Free model load balancer with 429 handling.
 * 
 * Tracks request counts per provider, detects potential rate limiting,
 * and auto-compacts + hops to next model when needed.
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
  model: string;
  requestCount: number;
  lastUsed: number;
  rateLimitedUntil: number; // timestamp when rate limit expires
}

// =============================================================================
// Model queue (round-robin across free models)
// =============================================================================

const modelQueue: ModelEntry[] = [
  // Zen free models (no auth needed)
  { provider: PROVIDER_ZEN, model: "big-pickle", requestCount: 0, lastUsed: 0, rateLimitedUntil: 0 },
  { provider: PROVIDER_ZEN, model: "glm-5-free", requestCount: 0, lastUsed: 0, rateLimitedUntil: 0 },
  { provider: PROVIDER_ZEN, model: "minimax-m2.5-free", requestCount: 0, lastUsed: 0, rateLimitedUntil: 0 },
  { provider: PROVIDER_ZEN, model: "mimo-v2-pro-free", requestCount: 0, lastUsed: 0, rateLimitedUntil: 0 },
  { provider: PROVIDER_ZEN, model: "nemotron-3-super-free", requestCount: 0, lastUsed: 0, rateLimitedUntil: 0 },

  // Kilo free models (requires free auth)
  { provider: PROVIDER_KILO, model: "deepseek-r1", requestCount: 0, lastUsed: 0, rateLimitedUntil: 0 },
  { provider: PROVIDER_KILO, model: "llama-3.1-70b-instruct", requestCount: 0, lastUsed: 0, rateLimitedUntil: 0 },

  // OpenRouter free models
  { provider: PROVIDER_OPENROUTER, model: "meta-llama/llama-3.1-8b-instruct:free", requestCount: 0, lastUsed: 0, rateLimitedUntil: 0 },
  { provider: PROVIDER_OPENROUTER, model: "google/gemma-2-9b-it:free", requestCount: 0, lastUsed: 0, rateLimitedUntil: 0 },
];

// =============================================================================
// Detection heuristics
// =============================================================================

const RATE_LIMIT_COOLDOWN_MS = 60_000; // Assume 1 min cooldown after suspected 429

let turnStartTime: number = 0;
let turnModel: string = "";
let turnProvider: string = "";

// =============================================================================
// Core functions
// =============================================================================

/** Get next available model, skipping rate-limited ones */
export function getNextModel(): { provider: string; model: string } | null {
  const now = Date.now();
  const available = modelQueue.filter((m) => m.rateLimitedUntil < now);

  if (available.length === 0) {
    return null; // All models rate-limited
  }

  // Sort by: least requests, then oldest usage
  available.sort((a, b) => {
    if (a.requestCount !== b.requestCount) return a.requestCount - b.requestCount;
    return a.lastUsed - b.lastUsed;
  });

  return available[0];
}

/** Mark a model as rate-limited */
export function markRateLimited(provider: string, model: string): void {
  const entry = modelQueue.find((m) => m.provider === provider && m.model === model);
  if (entry) {
    entry.rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
  }
}

/** Record a successful request */
export function recordRequest(provider: string, model: string): void {
  const entry = modelQueue.find((m) => m.provider === provider && m.model === model);
  if (entry) {
    entry.requestCount++;
    entry.lastUsed = Date.now();
  }
}

// =============================================================================
// Extension integration
// =============================================================================

export function registerLoadBalancer(pi: ExtensionAPI): void {
  // Track turn start
  pi.on("turn_start", async (_event, ctx) => {
    const model = ctx.model;
    if (!model) return;

    turnStartTime = Date.now();
    turnModel = model.id;
    turnProvider = model.provider;
  });

  // Track turn end and detect issues
  pi.on("turn_end", async (event, ctx) => {
    if (!turnStartTime) return;

    const turnDuration = Date.now() - turnStartTime;
    const message = event.message;

    // Check for potential rate limiting based on heuristics
    // Short response after long wait = likely rate limited
    const isShortResponse = turnDuration > 30_000;
    const hasNoTools = !event.toolResults || event.toolResults.length === 0;

    if (isShortResponse && hasNoTools) {
      markRateLimited(turnProvider, turnModel);

      const next = getNextModel();
      if (next) {
        ctx.ui.notify(
          `⚠️ Possible rate limit → will use ${next.provider}/${next.model} next`,
          "warning"
        );

        // Trigger compaction to reduce context
        ctx.compact({
          onComplete: () => {
            ctx.ui.notify("✓ Context compacted", "info");
          },
          onError: () => {
            // Silent - compaction is best-effort
          },
        });
      }
    } else {
      // Successful turn - record it
      recordRequest(turnProvider, turnModel);
    }

    turnStartTime = 0;
  });

  // Manual hop command
  pi.registerCommand("hop", {
    description: "Compact context and switch to next free model",
    handler: async (_args, ctx) => {
      const next = getNextModel();

      if (!next) {
        ctx.ui.notify("All free models rate-limited. Wait a minute.", "warning");
        return;
      }

      // Compact context before switching
      ctx.compact({
        onComplete: () => {
          ctx.ui.notify(
            `✓ Compacted → Next: ${next.provider}/${next.model} (Ctrl+L to select)`,
            "info"
          );
        },
        onError: () => {
          ctx.ui.notify(`→ Next: ${next.provider}/${next.model} (Ctrl+L to select)`, "info");
        },
      });

      // Mark current as used to rotate
      if (ctx.model) {
        markRateLimited(ctx.model.provider, ctx.model.id);
      }
    },
  });

  // Status command
  pi.registerCommand("free-status", {
    description: "Show free model rate limit status",
    handler: async (_args, ctx) => {
      const now = Date.now();
      const lines = modelQueue.map((m) => {
        const limited = m.rateLimitedUntil > now;
        const remaining = limited ? Math.ceil((m.rateLimitedUntil - now) / 1000) : 0;
        const icon = limited ? "🔴" : "🟢";
        return `${icon} ${m.model} — ${m.requestCount} reqs${limited ? ` (${remaining}s)` : ""}`;
      });

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
