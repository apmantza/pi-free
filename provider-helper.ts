/**
 * Shared provider setup helpers for pi-free-providers.
 * Extracts the common boilerplate pattern repeated across providers:
 *   - /{provider}-free and /{provider}-all toggle commands
 *   - model_select handler (clear status for other providers)
 *   - turn_end handler (increment request count)
 *   - before_agent_start handler (one-time ToS notice)
 */

import type { ExtensionAPI, ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import { incrementRequestCount } from "./metrics.ts";
import { recordTurn } from "./usage-store.ts";

// =============================================================================
// Types
// =============================================================================

export interface ProviderSetupConfig {
  /** Provider identifier (e.g., "kilo", "openrouter"). */
  providerId: string;
  /** Terms of service URL. If set, shows a one-time notice on first free use. */
  tosUrl?: string;
  /**
   * Called by /{provider}-free and /{provider}-all commands to re-register
   * the provider with the given model set. Receives the model array and a
   * reference to the stored models object so it can update the pointers.
   */
  reRegister: (models: ProviderModelConfig[], stored: StoredModels) => void;
}

export interface StoredModels {
  free: ProviderModelConfig[];
  all: ProviderModelConfig[];
}

// =============================================================================
// Setup
// =============================================================================

/**
 * Wire up common provider event handlers and toggle commands.
 *
 * Call this after your provider's initial `pi.registerProvider()` call.
 * Each provider still owns its own registration timing and custom handlers
 * (OAuth, message reshaping, footer, etc.) — this only handles the shared
 * parts.
 *
 * @param pi        Extension API
 * @param config    Provider setup config
 * @param stored    Mutable reference to stored free/all model arrays
 */
export function setupProvider(
  pi: ExtensionAPI,
  config: ProviderSetupConfig,
  stored: StoredModels,
): void {
  const { providerId, tosUrl, reRegister } = config;

  // ── Toggle commands ──────────────────────────────────────────────────

  pi.registerCommand(`${providerId}-free`, {
    description: `Show only free ${providerId} models`,
    handler: async (_args, ctx) => {
      if (stored.free.length === 0) {
        ctx.ui.notify("No free models loaded", "warning");
        return;
      }
      reRegister(stored.free, stored);
      ctx.ui.notify(`${providerId}: showing ${stored.free.length} free models`, "info");
    },
  });

  pi.registerCommand(`${providerId}-all`, {
    description: `Show all ${providerId} models (free + paid)`,
    handler: async (_args, ctx) => {
      if (stored.all.length === 0) {
        ctx.ui.notify("No models loaded", "warning");
        return;
      }
      reRegister(stored.all, stored);
      ctx.ui.notify(`${providerId}: showing all ${stored.all.length} models`, "info");
    },
  });

  // ── Clear status when another provider is selected ───────────────────

  pi.on("model_select", (_event, ctx) => {
    if (_event.model?.provider !== providerId) {
      ctx.ui.setStatus(`${providerId}-status`, undefined);
    }
  });

  // ── Track request count + cumulative tokens ─────────────────────────

  pi.on("turn_end", async (_event, ctx) => {
    if (ctx.model?.provider !== providerId) return;
    incrementRequestCount(providerId);
    const msg = _event.message;
    if (msg.role === "assistant") {
      recordTurn(providerId, msg.usage.input, msg.usage.output, msg.usage.cost.total);
    }
  });

  // ── One-time ToS notice on first free use ────────────────────────────

  if (tosUrl) {
    let tosShown = false;
    pi.on("before_agent_start", async (_event, ctx) => {
      if (tosShown || ctx.model?.provider !== providerId) return;
      tosShown = true;
      const cred = ctx.modelRegistry.authStorage.get(providerId);
      if (cred?.type === "oauth") return;
      return {
        message: {
          customType: providerId,
          content: `Using ${providerId} free models. Set API key for paid access.\nTerms: ${tosUrl}`,
          display: "inline" as const,
        },
      };
    });
  }
}
