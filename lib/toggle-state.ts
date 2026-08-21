import { saveConfig } from "../config.ts";

export type ToggleMode = "free" | "all";

export interface ToggleModelStore<T> {
	free: T[];
	all: T[];
}

interface CreateToggleStateOptions<T> {
	providerId: string;
	initialShowPaid: boolean;
	/**
	 * Config key to persist under; defaults to `{providerId}_show_paid`.
	 * Providers whose config key diverges from their registration id (e.g.
	 * `opencode-free` → `opencode_free_show_paid`) must pass it so the
	 * toggle survives a restart.
	 */
	configKey?: string;
	save?: typeof saveConfig;
	initialModels?: ToggleModelStore<T>;
}

interface ToggleResult<T> {
	mode: ToggleMode;
	models: T[];
}

export function createToggleState<T>({
	providerId,
	initialShowPaid,
	configKey = `${providerId}_show_paid`,
	save = saveConfig,
	initialModels,
}: CreateToggleStateOptions<T>) {
	let stored: ToggleModelStore<T> = initialModels ?? { free: [], all: [] };
	let currentMode: ToggleMode = initialShowPaid ? "all" : "free";

	function resolveMode(mode: ToggleMode): ToggleResult<T> {
		if (mode === "all") {
			if (stored.all.length > 0) {
				return { mode: "all", models: stored.all };
			}
			return { mode: "free", models: stored.free };
		}

		if (stored.free.length > 0) {
			return { mode: "free", models: stored.free };
		}
		return { mode: "all", models: stored.all };
	}

	function persist(mode: ToggleMode): void {
		save({ [configKey]: mode === "all" });
	}

	function applyMode(
		mode: ToggleMode,
		apply?: (models: T[]) => void,
	): ToggleResult<T> {
		const resolved = resolveMode(mode);
		currentMode = resolved.mode;
		if (apply) apply(resolved.models);
		return resolved;
	}

	return {
		setModels(next: ToggleModelStore<T>): ToggleModelStore<T> {
			stored = next;
			const resolved = resolveMode(currentMode);
			currentMode = resolved.mode;
			return stored;
		},
		getStored(): ToggleModelStore<T> {
			return stored;
		},
		getCurrentMode(): ToggleMode {
			return currentMode;
		},
		getCurrentModels(): T[] {
			return resolveMode(currentMode).models;
		},
		applyCurrent(apply?: (models: T[]) => void): ToggleResult<T> {
			return applyMode(currentMode, apply);
		},
		applyMode,
		toggle(apply?: (models: T[]) => void): ToggleResult<T> {
			const nextMode = currentMode === "all" ? "free" : "all";
			const resolved = applyMode(nextMode, apply);
			persist(resolved.mode);
			return resolved;
		},
	};
}
