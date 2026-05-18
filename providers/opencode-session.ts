import { randomUUID } from "node:crypto";
import type { Api, Model } from "@earendil-works/pi-ai";
import { streamSimpleAnthropic } from "@earendil-works/pi-ai/anthropic";
import { streamSimpleOpenAICompletions } from "@earendil-works/pi-ai/openai-completions";
import type { ProviderConfig } from "@earendil-works/pi-coding-agent";

export const OPENCODE_DYNAMIC_API = "opencode-dynamic" as const;

export const OPENCODE_STATIC_HEADERS = {
	"User-Agent": "opencode/1.15.5",
	"x-opencode-client": "cli",
} as const;

/**
 * Shared OpenCode session/request tracking.
 *
 * OpenCode endpoints appear to behave more reliably when a stable session id
 * is included across requests in the same Pi session.
 */
export function createOpenCodeSessionTracker() {
	let sessionId = "";
	let requestCount = 0;

	function generateId(): string {
		return randomUUID().replaceAll("-", "");
	}

	function getSessionId(): string {
		if (!sessionId) {
			sessionId = generateId();
		}
		return sessionId;
	}

	function nextRequestId(): string {
		requestCount++;
		return `${getSessionId()}-${requestCount}`;
	}

	return {
		getSessionId,
		nextRequestId,
	};
}

export type OpenCodeSessionTracker = ReturnType<
	typeof createOpenCodeSessionTracker
>;

export function createOpenCodeHeaders(
	tracker: OpenCodeSessionTracker,
	existingHeaders?: Record<string, string>,
): Record<string, string> {
	return {
		...existingHeaders,
		...OPENCODE_STATIC_HEADERS,
		"x-opencode-session": tracker.getSessionId(),
		"x-opencode-request": tracker.nextRequestId(),
	};
}

export function isOpenCodeProvider(providerId: string): boolean {
	return providerId === "opencode" || providerId === "opencode-go";
}

function isAnthropicOpenCodeEndpoint(model: Model<Api>): boolean {
	return !model.baseUrl.replace(/\/+$/, "").endsWith("/v1");
}

/**
 * Pi's static model headers are evaluated at registration time. OpenCode treats
 * x-opencode-request like a per-request id, so reusing one value across turns can
 * leave later requests attached to an old/in-flight generation. Registering a
 * provider-specific stream keeps the normal Pi parsers but refreshes headers for
 * every LLM call.
 */
export function createOpenCodeStreamSimple(
	tracker: OpenCodeSessionTracker,
): NonNullable<ProviderConfig["streamSimple"]> {
	return (model, context, options) => {
		const headers = createOpenCodeHeaders(tracker, options?.headers);

		if (isAnthropicOpenCodeEndpoint(model)) {
			return streamSimpleAnthropic(
				{ ...model, api: "anthropic-messages" } as Model<"anthropic-messages">,
				context,
				{ ...options, headers },
			);
		}

		return streamSimpleOpenAICompletions(
			{ ...model, api: "openai-completions" } as Model<"openai-completions">,
			context,
			{ ...options, headers },
		);
	};
}
