/**
 * ZenMux Provider Extension
 *
 * ZenMux is an OpenAI-compatible gateway for models from multiple providers.
 * It is registered as a native Pi Provider so Pi owns credential resolution,
 * models-store persistence, refresh throttling, and offline initialization.
 *
 * Setup:
 *   1. Get an API key from https://zenmux.ai
 *   2. Set ZENMUX_API_KEY or add zenmux_api_key to ~/.pi/free.json
 */

import type { Provider } from "@earendil-works/pi-ai/compat";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { getZenmuxApiKey, getZenmuxShowPaid } from "../../config.ts";
import { PROVIDER_ZENMUX } from "../../constants.ts";
import {
	registerNativeProvider,
	registerNativeProviderRefresh,
	registerNativeProviderToggle,
} from "../../lib/native-provider.ts";
import { registerWithGlobalToggle } from "../../lib/registry.ts";
import { createZenmuxProvider } from "./zenmux-provider.ts";

export default async function zenmuxProvider(pi: ExtensionAPI) {
	const { provider, stored, setView } = createZenmuxProvider();
	registerNativeProvider(pi, provider as Provider);

	const reRegister = (models: ProviderModelConfig[]) => {
		setView(models);
		registerNativeProvider(pi, provider as Provider);
	};

	registerWithGlobalToggle(
		PROVIDER_ZENMUX,
		stored,
		reRegister,
		Boolean(getZenmuxApiKey()),
		{ native: true },
	);
	registerNativeProviderToggle(pi, {
		providerId: PROVIDER_ZENMUX,
		stored,
		getShowPaid: getZenmuxShowPaid,
		reRegister,
	});
	registerNativeProviderRefresh(pi, PROVIDER_ZENMUX);
}
