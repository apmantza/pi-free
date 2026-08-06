import type { ModelsStoreEntry } from "@earendil-works/pi-ai/compat";

declare module "@earendil-works/pi-ai/compat" {
	/** Legacy test-store shape retained for Pi <=0.83 compatibility fixtures. */
	export interface ProviderModelsStore {
		read(): Promise<ModelsStoreEntry | undefined>;
		write(entry: ModelsStoreEntry): Promise<void>;
		delete(): Promise<void>;
	}

	/** Allows legacy refresh fixtures to exercise the runtime compatibility path. */
	interface RefreshModelsContext {
		store?: ProviderModelsStore;
	}
}
