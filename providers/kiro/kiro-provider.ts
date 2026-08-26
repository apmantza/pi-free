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
import { refreshNativeProviderModels, filterNativeModels } from "../../lib/native-provider.ts";
import type { StoredModels } from "../../provider-helper.ts";
import { getKiroShowPaid } from "../../config.ts";
import { getKiroEndpoints } from "./kiro-endpoints.js";
import { kiroAuth } from "./kiro-auth.js";
import { kiroModels, type KiroModel } from "./kiro-models.js";
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
    let fetchedFree: KiroModelType[] = [];
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
            const { resolveKiroProfileArn } = await import("./kiro-management.js");
            const region = resolveApiRegion((context.credential as { region?: string })?.region);
            await updateKiroModelsCache(token, region);
            const cached = getCachedModels(region);
            if (cached.length > 0) {
              fetchedFree = cached;
              return cached as KiroModelType[];
            }
          } catch {
            // Fall through to bootstrap models
          }
        }
        // Return bootstrap models as the baseline
        fetchedFree = kiroModels as unknown as KiroModelType[];
        const all = kiroModels as unknown as KiroModelType[];
        // Also stamp the free list
        const free = all.filter((model) =>
          isFreeModel({ ...model, provider: PROVIDER_KIRO }, all),
        );
        fetchedFree = free;
        return all;
      },
      (next) => {
        stored.all = next;
        stored.free = fetchedFree;
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