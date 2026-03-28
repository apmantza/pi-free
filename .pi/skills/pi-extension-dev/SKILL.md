---
name: pi-extension-dev
description: Guide for developing Pi coding agent extensions. Use when creating or debugging extensions.
---

# Pi Extension Development

## Documentation Locations

| Resource | Path |
|----------|------|
| Extension API | `~/.pi/agent/docs/extensions.md` |
| Examples | `~/.pi/agent/examples/extensions/*.ts` |
| Type Definitions | `~/.pi/agent/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts` |
| Logs | `~/.pi/agent/logs/` |
| Global Extensions | `~/.pi/agent/extensions/*.ts` |
| Project Extensions | `.pi/extensions/*.ts` |

## Extension Structure

```typescript
// Single file: ~/.pi/agent/extensions/my-ext.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Loaded!", "info");
  });
}
```

## Key Events

| Event | When | Use For |
|-------|------|---------|
| `session_start` | Session loads | Register providers, init state |
| `turn_end` | Turn completes | **Error detection** (check `event.message.errorMessage`) |
| `model_select` | Model changes | Clear provider status |
| `before_agent_start` | Before LLM call | Inject messages |
| `tool_call` | Tool invoked | Block/modify tools |

## Context (ctx) Methods

```typescript
// UI
ctx.ui.notify("msg", "info"|"warning"|"error"|"success")
ctx.ui.setStatus("id", "text" | undefined)
ctx.ui.confirm(title, message) → Promise<boolean>
ctx.ui.input(title, placeholder?) → Promise<string>

// Registry
ctx.modelRegistry.registerProvider(id, config)
ctx.modelRegistry.getAvailable()

// Storage
ctx.sessionStorage.setItem(key, value)
ctx.sessionStorage.getItem(key)
```

## Register Provider

```typescript
pi.registerProvider("id", {
  baseUrl: "https://api.example.com/v1",
  apiKey: "ENV_VAR_NAME",
  api: "openai-completions", // or "anthropic-messages"
  headers: {},
  models: [{
    id: "model-id",
    name: "Display Name",
    reasoning: false,
    input: ["text"], // or ["text", "image"]
    cost: { input: 0.5, output: 1.5 },
    contextWindow: 128000,
    maxTokens: 4096,
  }]
});
```

## Error Detection (Important!)

Pi has **no error event**. Detect errors in `turn_end`:

```typescript
pi.on("turn_end", async (event, ctx) => {
  const msg = event.message as { role?: string; errorMessage?: string };
  
  if (msg?.role === "assistant" && msg.errorMessage) {
    const error = msg.errorMessage;
    
    // Classify
    if (error.includes("429") || /rate.?limit/i.test(error)) {
      ctx.ui.notify("Rate limited! Try /model to switch.", "warning");
    }
  }
});
```

## Error Patterns

| Type | Patterns |
|------|----------|
| Rate Limit | `429`, `rate limit`, `quota exceeded`, `throttled` |
| Capacity | `no capacity`, `overloaded`, `503`, `temporarily unavailable` |
| Auth | `401`, `403`, `unauthorized`, `invalid key` |

## Register Commands

```typescript
pi.registerCommand("my-cmd", {
  description: "What it does",
  handler: async (args, ctx) => {
    ctx.ui.notify(`Args: ${args}`, "info");
  }
});
```

## Register Tools

```typescript
import { Type } from "@sinclair/typebox";

pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "What it does",
  parameters: Type.Object({
    param: Type.String({ description: "Param desc" })
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    return {
      content: [{ type: "text", text: "Result" }],
      details: {}
    };
  }
});
```

## Best Practices

- Import as type: `import type { ExtensionAPI }`
- Export default function
- Use `.ts` extensions for imports
- Errors in `turn_end` (no error event exists)
- Clear status in `model_select` when switching away
- API keys in env vars, never hardcoded
- Test with `pi -e ./ext.ts`, install to `~/.pi/agent/extensions/`
- Hot reload with `/reload` after changes

## Debugging

```typescript
console.log("[ext] Debug:", data); // Check ~/.pi/agent/logs/
ctx.ui.notify("Extension loaded!", "info");
```
