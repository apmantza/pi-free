/**
 * Cline Provider Extension
 *
 * Provides access to Cline's free models (via their OpenRouter gateway).
 * Free model list is fetched from Cline's GitHub source — no account needed to browse.
 * Run /login cline to authenticate and make API calls.
 *
 * Usage:
 *   pi install git:github.com/apmantza/pi-free
 *   # Models appear immediately; run /login cline to start chatting
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { fetchClineModels } from "./cline-models.ts";
import { PROVIDER_CLINE, BASE_URL_CLINE } from "./constants.ts";
import { logWarning } from "./util.ts";

// =============================================================================
// Cline request headers (mimic VS Code extension identity)
// =============================================================================

const CLINE_VERSION = "3.63.0";
let _currentTaskId = generateUlid();

function generateUlid(): string {
  const CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const now = Date.now();
  let ts = "";
  let t = now;
  for (let i = 0; i < 10; i++) { ts = CHARS[t % 32] + ts; t = Math.floor(t / 32); }
  const rand = new Uint8Array(16);
  crypto.getRandomValues(rand);
  let r = "";
  for (let i = 0; i < 16; i++) r += CHARS[rand[i] % 32];
  return ts + r;
}

function buildClineHeaders(): Record<string, string> {
  return {
    "HTTP-Referer": "https://cline.bot",
    "X-Title": "Cline",
    "X-Task-ID": _currentTaskId,
    "X-Platform": "Visual Studio Code",
    "X-Platform-Version": "1.109.3",
    "X-Client-Type": "VSCode Extension",
    "X-Client-Version": CLINE_VERSION,
    "X-Core-Version": CLINE_VERSION,
    "X-Is-Multiroot": "false",
  };
}

// =============================================================================
// Context shaping — Cline's API requires a specific message envelope
// =============================================================================

const TASK_PROGRESS_BLOCK = `
# task_progress List (Optional - Plan Mode)

While in PLAN MODE, if you've outlined concrete steps or requirements for the user, you may include a preliminary todo list using the task_progress parameter.

1. To create or update a todo list, include the task_progress parameter in the next tool call
2. Review each item and update its status:
   - Mark completed items with: - [x]
   - Keep incomplete items as: - [ ]
3. Modify the list as needed
4. Ensure the list accurately reflects the current state`;

function buildEnvironmentDetails(): string {
  const cwd = process.cwd();
  return `<environment_details>
# Visual Studio Code Visible Files
(No visible files)

# Visual Studio Code Open Tabs
(No open tabs)

# Current Working Directory (${cwd}) Files
(No files)

# Context Window Usage
0 / 204.8K tokens used (0%)

# Current Mode
PLAN MODE
</environment_details>`;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return (content as any[])
      .filter((p: any) => p?.type === "text" && typeof p?.text === "string")
      .map((p: any) => p.text)
      .join("\n\n")
      .trim();
  }
  return "";
}

function isClineWrapped(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  const texts = (content as any[])
    .filter((p: any) => p?.type === "text" && typeof p?.text === "string")
    .map((p: any) => p.text as string);
  return (
    texts.some((t) => /<task>[\s\S]*<\/task>/.test(t)) &&
    texts.some((t) => t.includes("task_progress List")) &&
    texts.some((t) => t.includes("<environment_details>"))
  );
}

function extractTaskBody(content: unknown): string {
  if (!Array.isArray(content)) return "";
  for (const p of content as any[]) {
    if (p?.type !== "text" || typeof p?.text !== "string") continue;
    const m = p.text.match(/<task>\s*([\s\S]*?)\s*<\/task>/);
    if (m?.[1]) return m[1].trim();
  }
  return "";
}

function shapeMessagesForCline(messages: any[]): any[] {
  // Find the last already-wrapped user message to avoid re-wrapping
  let lastWrappedIdx = -1;
  let baseTranscript = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== "user") continue;
    if (!isClineWrapped(messages[i]?.content)) continue;
    lastWrappedIdx = i;
    baseTranscript = extractTaskBody(messages[i].content);
    break;
  }

  const parts: string[] = baseTranscript ? [baseTranscript] : [];
  const startIdx = lastWrappedIdx >= 0 ? lastWrappedIdx + 1 : 0;

  for (let i = startIdx; i < messages.length; i++) {
    const msg = messages[i];
    const role = msg?.role ?? "user";
    if (role === "system") continue;
    if (role === "user" && isClineWrapped(msg?.content)) continue;
    const text = extractText(msg?.content).trim();
    if (!text) continue;

    if (role === "tool") {
      parts.push(`<tool_result>\n${text}\n</tool_result>`);
    } else if (role !== "assistant") {
      parts.push(`[${role}]\n${text}`);
    }
  }

  const transcript = parts.join("\n\n").trim() || "(no conversation yet)";
  const envDetails = buildEnvironmentDetails();

  const collapsed: any[] = [];
  const systemMsg = messages.find((m: any) => m?.role === "system");
  if (systemMsg) {
    const systemText = extractText(systemMsg.content);
    if (systemText) collapsed.push({ role: "system", content: systemText });
  }

  collapsed.push({
    role: "user",
    content: [
      { type: "text", text: `<task>\n${transcript}\n</task>` },
      { type: "text", text: TASK_PROGRESS_BLOCK },
      { type: "text", text: envDetails },
    ],
  });

  return collapsed;
}

// =============================================================================
// Extension entry point
// =============================================================================

export default async function (pi: ExtensionAPI) {
  let models = await fetchClineModels().catch((err) => {
    logWarning("cline", "Failed to fetch free models at startup", err);
    return [];
  });

  function registerProvider(m = models) {
    pi.registerProvider(PROVIDER_CLINE, {
      baseUrl: BASE_URL_CLINE,
      api: "openai-completions" as const,
      headers: buildClineHeaders(),
      models: m,
    });
  }

  registerProvider();

  // Refresh task ID and re-register headers before each agent run
  pi.on("before_agent_start", async (_event, ctx) => {
    if (ctx.model?.provider !== PROVIDER_CLINE) return;
    _currentTaskId = generateUlid();
    registerProvider();
  });

  // Shape messages to Cline's expected envelope format
  pi.on("context", async (event, ctx) => {
    if (ctx.model?.provider !== PROVIDER_CLINE) return;
    const sourceMessages = Array.isArray(event.messages) ? event.messages : [];
    return { messages: shapeMessagesForCline(sourceMessages) };
  });

  // Refresh model list at session start
  pi.on("session_start", async (_event, ctx) => {
    try {
      const fresh = await fetchClineModels();
      if (fresh.length > 0) {
        models = fresh;
        registerProvider(models);
        if (ctx.model?.provider === PROVIDER_CLINE) {
          ctx.ui.notify(`Cline: ${models.length} free models available`, "info");
        }
      }
    } catch (err) {
      logWarning("cline", "Failed to refresh models at session start", err);
    }
  });
}
