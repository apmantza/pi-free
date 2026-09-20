/**
 * `glob` tool — Pi's built-in file finder exposed under the name OpenCode Zen's
 * free tier requires.
 *
 * Zen's free-tier gate needs the request's `tools[]` to carry the lowercase
 * names `bash`, `edit`, `glob`, `grep`, `read` (issue #544). Pi's file finder
 * is named `find`, and its default roster is `read, write, edit, bash`, so a
 * request presents at most three of the five. Registering `glob` as a rename of
 * the built-in `find` definition satisfies the gate without a second search
 * implementation.
 *
 * Delegating to Pi's own `find` keeps this OS-agnostic: Pi owns the search
 * backend (its `fd` resolution and per-platform fallbacks). This module adds no
 * dependency and spawns nothing itself; the only value it needs is a `cwd`,
 * supplied by the caller. `find`'s execute resolves the search directory from
 * the live `ctx.cwd` at call time, so the creation-time `cwd` is a fallback
 * only.
 *
 * The host package is imported lazily: `@earendil-works/pi-coding-agent` is an
 * optional host-provided peer (#447), so pi-free must not require it at module
 * load. A production-shaped tree without it still loads; the tool simply is not
 * registered there. In a real Pi host the package is always present.
 */
import type {
	ExtensionAPI,
	FindToolOptions,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { PROVIDER_OPENCODE_FREE } from "../constants.ts";

export const GLOB_TOOL_NAME = "glob";

/**
 * Gate names not present in Pi's default active roster (`read`, `bash`, `edit`
 * are; `glob` and `grep` are not). Added per-turn to opencode-free requests
 * only — never activated globally.
 */
export const OPENCODE_FREE_GATE_TOOLS = ["glob", "grep"] as const;

/** Minimal surface of the host package this module needs. */
interface HostFindModule {
	createFindToolDefinition?: (
		cwd: string,
		options?: FindToolOptions,
	) => ToolDefinition;
}

/** Lazily load the host package; `undefined` when the host does not provide it. */
async function loadHostFindModule(): Promise<HostFindModule | undefined> {
	try {
		return (await import("@earendil-works/pi-coding-agent")) as HostFindModule;
	} catch {
		return undefined;
	}
}

/**
 * Register `glob` as the built-in `find` tool under a different name.
 *
 * `options` is forwarded to `createFindToolDefinition` and exists for tests,
 * which inject stub `FindOperations` so the suite never depends on a search
 * binary being installed on the host.
 *
 * @returns `true` when the tool was registered.
 */
export async function registerGlobTool(
	pi: ExtensionAPI,
	cwd: string,
	options?: FindToolOptions,
): Promise<boolean> {
	const host = await loadHostFindModule();
	const createFindToolDefinition = host?.createFindToolDefinition;
	if (!createFindToolDefinition) return false;
	// Stripped test doubles may not implement tool registration.
	if (!pi.registerTool) return false;
	const find = createFindToolDefinition(cwd, options);
	pi.registerTool({ ...find, name: GLOB_TOOL_NAME, label: GLOB_TOOL_NAME });
	return true;
}

/**
 * On opencode-free turns, add the missing gate tool names to this run's
 * selected tools. This mutates `systemPromptOptions.selectedTools` for the run
 * only (Pi rebuilds it each turn), so no other provider's request changes.
 */
export function addOpenCodeFreeGateTools(
	event: { systemPromptOptions: { selectedTools: string[] } },
	providerId: string | undefined,
): void {
	if (providerId !== PROVIDER_OPENCODE_FREE) return;
	const selected = event.systemPromptOptions.selectedTools;
	for (const name of OPENCODE_FREE_GATE_TOOLS) {
		if (!selected.includes(name)) selected.push(name);
	}
}
