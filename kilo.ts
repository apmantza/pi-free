/**
 * Kilo Provider Extension
 *
 * Provides access to 300+ AI models via the Kilo Gateway (OpenRouter-compatible).
 * Free models available immediately; /login kilo for full access.
 *
 * Usage:
 *   pi install git:github.com/your-username/pi-free-providers
 *   # Then /login kilo, or set KILO_API_KEY=...
 *
 * Based on https://github.com/mrexodia/kilo-pi-provider (BSL-1.0)
 */

import type { Api, Model, OAuthCredentials } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import { loginKilo, refreshKiloToken, fetchKiloBalance, formatCredits } from "./kilo-auth.ts";
import { fetchKiloModels, KILO_GATEWAY_BASE } from "./kilo-models.ts";
import { registerKiloFooter } from "./kilo-footer.ts";
import { KILO_FREE_ONLY } from "./config.ts";

const KILO_TOS_URL = "https://kilo.ai/terms";

const KILO_PROVIDER_CONFIG = {
  baseUrl: KILO_GATEWAY_BASE,
  apiKey: "KILO_API_KEY",
  api: "openai-completions" as const,
  headers: {
    "X-KILOCODE-EDITORNAME": "Pi",
    "User-Agent": "pi-free-providers",
  },
};

export default async function (pi: ExtensionAPI) {
  let freeModels: ProviderModelConfig[] = [];
  try {
    freeModels = await fetchKiloModels({ freeOnly: true });
  } catch (error) {
    console.warn("[kilo] Failed to fetch free models at startup:", error instanceof Error ? error.message : error);
  }

  let cachedAllModels: ProviderModelConfig[] = [];

  // Created once — the closure captures cachedAllModels by reference so
  // updates to it are visible without recreating the config object.
  const oauthConfig = (function makeOAuthConfig() {
    return {
      name: "Kilo",
      login: async (callbacks: any) => {
        const cred = await loginKilo(callbacks);
        try {
          cachedAllModels = await fetchKiloModels({ token: cred.access });
        } catch (error) {
          console.warn("[kilo] Failed to fetch models after login:", error instanceof Error ? error.message : error);
        }
        return cred;
      },
      refreshToken: refreshKiloToken,
      getApiKey: (cred: OAuthCredentials) => cred.access,
      modifyModels: (models: Model<Api>[], _cred: OAuthCredentials) => {
        if (KILO_FREE_ONLY || cachedAllModels.length === 0) return models;
        const template = models.find((m) => m.provider === "kilo");
        if (!template) return models;
        const nonKilo = models.filter((m) => m.provider !== "kilo");
        const fullModels = cachedAllModels.map((m) => ({
          ...template, id: m.id, name: m.name, reasoning: m.reasoning,
          input: m.input, cost: m.cost, contextWindow: m.contextWindow, maxTokens: m.maxTokens,
        }));
        return [...nonKilo, ...fullModels];
      },
    };
  })();

  pi.registerProvider("kilo", { ...KILO_PROVIDER_CONFIG, models: freeModels, oauth: oauthConfig });

  // ── Credits helpers ──────────────────────────────────────────────────────

  async function updateCredits(ctx: any) {
    const cred = ctx.modelRegistry.authStorage.get("kilo");
    if (cred?.type !== "oauth") return;
    try {
      const balance = await fetchKiloBalance(cred.access);
      if (balance !== null) {
        ctx.ui.setStatus("kilo-credits", ctx.ui.theme.fg("accent", `💰 ${formatCredits(balance)}`));
      }
    } catch { /* silent */ }
  }

  // ── Events ───────────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    const cred = ctx.modelRegistry.authStorage.get("kilo");

    if (cred?.type !== "oauth") {
      ctx.ui.setStatus("kilo-credits", undefined);
    } else {
      try {
        cachedAllModels = await fetchKiloModels({ token: cred.access });
        if (cachedAllModels.length > 0) {
          ctx.modelRegistry.registerProvider("kilo", { ...KILO_PROVIDER_CONFIG, models: freeModels, oauth: oauthConfig });
        }
      } catch (error) {
        console.warn("[kilo] Failed to fetch models at session start:", error instanceof Error ? error.message : error);
      }
      await updateCredits(ctx);
    }

    registerKiloFooter(pi, ctx);
  });

  pi.on("model_select", async (event, ctx) => {
    if (event.model?.provider === "kilo") await updateCredits(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    await updateCredits(ctx);
  });

  // ── ToS notice on first free use ─────────────────────────────────────────

  let tosShown = false;
  pi.on("before_agent_start", async (_event, ctx) => {
    if (tosShown || ctx.model?.provider !== "kilo") return;
    tosShown = true;
    const cred = ctx.modelRegistry.authStorage.get("kilo");
    if (cred?.type === "oauth") return;
    return {
      message: { customType: "kilo", content: `By using Kilo, you agree to the Terms of Service: ${KILO_TOS_URL}`, display: "inline" },
    };
  });
}
