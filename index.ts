/**
 * Pi-Free Providers Index
 *
 * Loads all free model providers into a single extension entry point.
 * This keeps the extension list clean in pi (one entry instead of many).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
// Import all provider extensions (from providers/ directory)
import cline from "./providers/cline/cline.ts";
import fireworks from "./providers/fireworks/fireworks.ts";
import go from "./providers/go/go.ts";
import kilo from "./providers/kilo/kilo.ts";
import mistral from "./providers/mistral/mistral.ts";
import modal from "./providers/modal/modal.ts";
import nvidia from "./providers/nvidia/nvidia.ts";
import ollama from "./providers/ollama/ollama.ts";
import openrouter from "./providers/openrouter/openrouter.ts";
import qwen from "./providers/qwen/qwen.ts";
import zen from "./providers/zen/zen.ts";

/**
 * Main extension entry point that loads all providers.
 * Called once by pi - each provider initializes independently.
 */
export default async function (pi: ExtensionAPI) {
	// Load all providers concurrently
	await Promise.allSettled([
		fireworks(pi),
		mistral(pi),
		ollama(pi),
		modal(pi),
		zen(pi),
		openrouter(pi),
		nvidia(pi),
		go(pi),
		kilo(pi),
		qwen(pi),
		cline(pi),
	]);
}
