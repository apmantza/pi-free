/**
 * Host-agnostic transcript helpers.
 *
 * Mirrors `@earendil-works/pi-ai/dist/utils/transcript.js` +
 * `text.js` (`getCurrentSystemPrompt` / `getCurrentTools`) without a
 * runtime import of `@earendil-works/pi-ai/compat`.
 *
 * Why: Oh My Pi remaps pi-ai to its legacy bundle
 * (`omp-legacy-pi-bundled:@oh-my-pi/pi-ai`) which predates these exports.
 * A static named import (`import { getCurrentSystemPrompt } from ...`) fails
 * at extension load with "Export named 'getCurrentSystemPrompt' not found",
 * taking the whole extension down (refs #543, PR #557 follow-up). These
 * locals read only the stable transcript message shape
 * (`role === "system"`, string/array content, sections, toolsAdded/Removed),
 * so Qoder loads on both stock Pi and legacy hosts.
 */

// biome-ignore lint/suspicious/noExplicitAny: transcript shapes vary by host version; helpers read only shared fields.
type AnyMsg = {
	role: string;
	content?: any;
	sections?: any;
	toolsAdded?: any;
	toolsRemoved?: any;
};

/** Extract and join text from message content (upstream `contentText`). */
// biome-ignore lint/suspicious/noExplicitAny: mirrors upstream untyped JS.
function contentText(content: any, separator = "\n"): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((block) => block?.type === "text")
			.map((block) => block?.text ?? "")
			.join(separator);
	}
	return "";
}

function isSystemMessage(message: AnyMsg): boolean {
	return message.role === "system";
}

/**
 * Resolve the tools available after replaying every transcript delta in
 * order (upstream `getCurrentTools`).
 */
// biome-ignore lint/suspicious/noExplicitAny: tool schemas are host-defined; identity is by name.
export function getCurrentTools(messages: readonly AnyMsg[]): any[] {
	const tools = new Map<string, any>();
	for (const message of messages) {
		if (!isSystemMessage(message)) continue;
		for (const tool of (message.toolsRemoved ?? []) as Array<{ name: string }>)
			tools.delete(tool.name);
		for (const tool of (message.toolsAdded ?? []) as any[])
			tools.set(tool.name, tool);
	}
	return [...tools.values()];
}

/**
 * Render the current system prompt text after replaying every system message
 * (upstream `getCurrentSystemPrompt`).
 */
export function getCurrentSystemPrompt(messages: readonly AnyMsg[]): string {
	const content: string[] = [];
	const sections = new Map<string, string>();
	for (const message of messages) {
		if (!isSystemMessage(message)) continue;
		const text = contentText(message.content);
		if (text.length > 0) content.push(text);
		for (const [name, value] of Object.entries(
			(message.sections ?? {}) as Record<string, string | null>,
		)) {
			if (value === null) sections.delete(name);
			else if (value !== undefined) sections.set(name, value);
		}
	}
	return [...content, ...sections.values()]
		.filter((part) => part.length > 0)
		.join("\n\n");
}
