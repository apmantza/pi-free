/**
 * Kiro Provider Extension
 *
 * Provides access to free Claude Opus/Sonnet models via AWS's Kiro service.
 * Registered as a native pi-ai `Provider` (custom wire protocol, not OpenAI-compatible).
 *
 * Kiro uses SSO OIDC device code flow for authentication. No API key is needed.
 * All models are free/zero-cost.
 *
 * Run /login kiro to authenticate via AWS Builder ID.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getKiroShowPaid, PROVIDER_KIRO } from "../../config.ts";
import { registerWithGlobalToggle } from "../../lib/registry.ts";
import {
  registerNativeProvider,
  registerNativeProviderRefresh,
  registerNativeProviderToggle,
} from "../../lib/native-provider.ts";
import { createKiroProvider } from "./kiro-provider.js";

export default async function kiroProvider(pi: ExtensionAPI) {
  const { provider, stored } = createKiroProvider();

  registerNativeProvider(pi, provider);

  const reRegister = () => {
    registerNativeProvider(pi, provider);
  };

  registerWithGlobalToggle(PROVIDER_KIRO, stored, reRegister, false, {
    native: true,
    invalidate: reRegister,
  });

  registerNativeProviderToggle(pi, {
    providerId: PROVIDER_KIRO,
    stored,
    getShowPaid: getKiroShowPaid,
    reRegister,
  });

  registerNativeProviderRefresh(pi, PROVIDER_KIRO);
}