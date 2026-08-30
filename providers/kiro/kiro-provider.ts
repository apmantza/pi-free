/**
 * Kiro native provider — the native Provider object form.
 *
 * Assembles a pi-ai `Provider` object with a custom wire protocol (`kiro-api`).
 * Kiro is NOT OpenAI-compatible — it uses a Smithy event stream wire protocol.
 * The provider is assembled manually against the public `Provider` interface.
 *
 * Pi owns credential refresh, background model refresh (4h throttle, abortable),
 * and offline initialization.
 */
import type {
  Credential,
  Model,
  Provider,
  RefreshModelsContext,
  ProviderStreams,
} from "@earendil-works/pi-ai";
import { PROVIDER_KIRO } from "../../config.ts";
import { isFreeModel } from "../../lib/registry.ts";
import { enhanceWithCI, type StoredModels } from "../../provider-helper.ts";
import { refreshNativeProviderModels, filterNativeModels } from "../../lib/native-provider.ts";
import { getKiroShowPaid } from "../../config.ts";
import { getKiroEndpoints } from "./kiro-endpoints.js";
import { kiroAuth } from "./kiro-auth.js";
import { kiroModels } from "./kiro-models.js";
import { streamKiro } from "./kiro-stream.js";

type KiroModelType = Model<"kiro-api">;

interface KiroNativeProvider {
  provider: Provider<"kiro-api">;
  stored: StoredModels;
  ingest: (all: KiroModelType[], free: KiroModelType[]) => void;
}

function credentialToken(credential?: Credential): string | undefined {
  if (!credential) return undefined;
  if (credential.type === "oauth") return credential.access;
  if (credential.type === "api_key") return credential.key ?? undefined;
  return undefined;
}

export function createKiroProvider(): KiroNativeProvider {
  const stored: StoredModels = { free: [], all: [] };

  function prepare(all: KiroModelType[], free: KiroModelType[]): { all: KiroModelType[]; free: KiroModelType[] } {
    return { all, free };
  }

  function ingest(all: KiroModelType[], free: KiroModelType[]): void {
    const next = prepare(all, free);
    stored.all = next.all;
    stored.free = next.free;
  }

  async function refreshModels(context: RefreshModelsContext): Promise<void> {
    await refreshNativeProviderModels(
      PROVIDER_KIRO,
      context,
      (storedModels: KiroModelType[]) => {
        stored.all = storedModels;
        stored.free = storedModels.filter((model) =>
          isFreeModel({ ...model, provider: PROVIDER_KIRO }, storedModels),
        );
      },
      async () => {
        // Kiro's bootstrap catalog is always available; the refresh fetches
        // from the management API when a credential is available.
        const token = credentialToken(context.credential);
        if (token && context.allowNetwork) {
          try {
            const { updateKiroModelsCache, getCachedModels } = await import("./kiro-models.js");
            const { resolveApiRegion } = await import("./kiro-endpoints.js");
            const region = resolveApiRegion((context.credential as { region?: string })?.region);
            await updateKiroModelsCache(token, region);
            const cached = getCachedModels(region);
            if (cached.length > 0) {
              return cached as KiroModelType[];
            }
          } catch {
            // Fall through to bootstrap models
          }
        }
        // Return bootstrap models as the baseline with CI scores.
        // SAFETY: `kiroModels` is our own bootstrap catalog typed as
        // `KiroModel[]` (the legacy shape), but `enhanceWithCI` expects
        // the new pi-ai `Model<Api>[]` shape. The two shapes are
        // structurally compatible for the fields enhanceWithCI reads
        // (id, name, cost, contextWindow, maxTokens, etc.) — the cast
        // is safe at runtime but TypeScript can't prove it.
        const all = enhanceWithCI(
          kiroModels as unknown as Parameters<typeof enhanceWithCI>[0],
          PROVIDER_KIRO,
        ) as KiroModelType[];
        return all;
      },
      (next) => {
        stored.all = next;
        stored.free = next.filter((model) =>
          isFreeModel({ ...model, provider: PROVIDER_KIRO }, next),
        );
      },
    );
  }

  const streams: ProviderStreams = {
    stream: streamKiro,
    streamSimple: streamKiro,
  };

  const provider: Provider<"kiro-api"> = {
    id: PROVIDER_KIRO,
    name: "Kiro",
    baseUrl: getKiroEndpoints("us-east-1").runtime,
    auth: kiroAuth,
    getModels: () =>
      (stored.all.length > 0 ? stored.all : stored.free) as KiroModelType[],
    filterModels: (models) =>
      filterNativeModels(PROVIDER_KIRO, models, {
        showPaid: getKiroShowPaid(),
        freeModels: stored.free,
      }),
    refreshModels,
    stream: (model, context, options) => streams.stream(model, context, options),
    streamSimple: (model, context, options) =>
      streams.streamSimple(model, context, options),
  };

  return { provider, stored, ingest };
}