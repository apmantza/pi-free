---
name: pi-extension-dev
description: Guide for developing Pi coding agent extensions. Use when creating, modifying, or debugging Pi extensions that register providers, tools, commands, or handle events.
---

# Pi Extension Development

Comprehensive guide for building extensions for the Pi coding agent.

## Quick Reference

### Extension Structure
```
extension.ts              # Single file extension
extension/
├── index.ts              # Entry point (exports default function)
├── package.json          # Optional: npm dependencies
└── src/
    └── ...               # Additional modules
```

### Minimal Extension Template
```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Extension loaded!", "info");
  });
}
```

## Extension Locations

Extensions are auto-discovered from:
- `~/.pi/agent/extensions/*.ts` - Global
- `.pi/extensions/*.ts` - Project-local
- `pi.extensions` in package.json - From npm/git packages

## ExtensionAPI Reference

### Events

#### Session Lifecycle
- `session_start` - Initial session load
- `session_shutdown` - On exit (Ctrl+C, SIGTERM)
- `session_before_switch / session_switch` - New/resume session
- `session_before_fork / session_fork` - Forking sessions
- `session_before_compact / session_compact` - Compaction

#### Agent Lifecycle
- `before_agent_start` - Before agent loop, can inject messages
- `agent_start / agent_end` - Once per user prompt
- `turn_start / turn_end` - Each tool-calling turn
- `message_start / message_update / message_end` - Message rendering

#### Provider/Model
- `model_select` - When switching models (Ctrl+L)
- `before_provider_request` - Inspect/modify API payload

#### Tools
- `tool_call` - Block, modify, or allow tool calls
- `tool_execution_start / tool_execution_update / tool_execution_end`
- `tool_result` - Modify tool results before display

#### Input/Context
- `input` - Intercept or transform user input
- `context` - Modify messages sent to LLM

### UI Methods (ctx.ui)

```typescript
// Notifications
ctx.ui.notify(message: string, type: "info" | "warning" | "error" | "success")

// Status line (footer)
ctx.ui.setStatus(id: string, text: string | undefined)

// Widget above editor
ctx.ui.setWidget(id: string, lines: string[])

// Interactive prompts
const ok = await ctx.ui.confirm(title: string, message: string)
const input = await ctx.ui.input(title: string, placeholder?: string)
const choice = await ctx.ui.select(title: string, options: Array<{value: string, label: string}>)

// Full custom TUI
const result = await ctx.ui.custom<T>((tui, theme, kb, done) => ({
  render: (width: number) => string[],
  handleInput: (data: Buffer) => void,
  invalidate: () => void,
}))
```

### Registration Methods

```typescript
// Custom commands
pi.registerCommand("name", {
  description: string,
  handler: async (args: string, ctx) => void
})

// Custom tools (LLM-callable)
import { Type } from "@sinclair/typebox";

pi.registerTool({
  name: "tool_name",
  label: "Display Name",
  description: "What this tool does",
  parameters: Type.Object({
    param: Type.String({ description: "Parameter description" })
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // Return tool result
    return {
      content: [{ type: "text", text: "Result" }],
      details: {},  // Additional data for LLM
    };
  }
})

// Register provider
pi.registerProvider("provider-id", {
  baseUrl: "https://api.example.com/v1",
  apiKey: "ENV_VAR_NAME",  // or actual key
  api: "openai-completions" | "anthropic-messages" | "google-generative-ai",
  headers: { "Custom-Header": "value" },
  models: [{
    id: "model-id",
    name: "Display Name",
    reasoning: boolean,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead?: number, cacheWrite?: number },
    contextWindow: number,
    maxTokens: number,
  }]
})

// Keyboard shortcuts
pi.registerShortcut("ctrl+x", {
  description: "What it does",
  handler: async (ctx) => void,
})

// CLI flags
pi.registerFlag("flag-name", {
  description: "What it does",
  type: "string" | "boolean" | "number",
})
```

## Common Patterns

### Provider Extension Pattern
```typescript
import type { ExtensionAPI, ProviderModelConfig } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const models: ProviderModelConfig[] = [...];
  
  pi.on("session_start", async (_event, ctx) => {
    // Check for existing auth
    const hasAuth = ctx.modelRegistry.getAvailable()
      .some(m => m.provider === "my-provider");
    
    if (!hasAuth) {
      // Register with default models
      pi.registerProvider("my-provider", {
        baseUrl: "https://api.example.com/v1",
        apiKey: "MY_API_KEY",
        api: "openai-completions",
        models,
      });
    }
    
    ctx.ui.setStatus("my-provider-status", "⚡ Provider active");
  });
  
  pi.on("model_select", (_event, ctx) => {
    if (_event.model?.provider !== "my-provider") {
      ctx.ui.setStatus("my-provider-status", undefined);
    }
  });
}
```

### Error Handling in Extensions
```typescript
// Detect errors from assistant messages in turn_end
pi.on("turn_end", async (event, ctx) => {
  const msg = (event as { message?: { role?: string; errorMessage?: string } }).message;
  
  if (msg?.role === "assistant" && msg.errorMessage) {
    const error = msg.errorMessage;
    
    // Classify error
    if (error.includes("429") || error.includes("rate limit")) {
      ctx.ui.notify("Rate limited! Consider switching providers.", "warning");
    }
  }
});
```

### Tool Interception
```typescript
pi.on("tool_call", async (event, ctx) => {
  // Block dangerous commands
  if (event.toolName === "bash") {
    const cmd = event.input.command;
    if (cmd?.includes("rm -rf") || cmd?.includes("sudo")) {
      const ok = await ctx.ui.confirm(
        "Dangerous Command",
        `Allow: ${cmd}?`
      );
      if (!ok) return { block: true, reason: "Blocked by extension" };
    }
  }
});
```

### State Management
```typescript
// Persistent state (survives restarts)
pi.on("session_start", async (_event, ctx) => {
  // Load state
  const data = ctx.sessionStorage.getItem("my-extension-data");
  
  // Save state later
  ctx.sessionStorage.setItem("my-extension-data", JSON.stringify({ ... }));
});

// Or use pi.appendEntry() for session history
pi.appendEntry({
  type: "custom",
  customType: "my-extension",
  content: "Event happened",
});
```

## Provider Model Configuration

```typescript
interface ProviderModelConfig {
  id: string;                    // Unique model ID
  name: string;                  // Display name
  reasoning: boolean;            // Supports reasoning/thinking
  input: ("text" | "image")[];   // Supported input types
  cost: {
    input: number;               // Cost per million input tokens
    output: number;              // Cost per million output tokens
    cacheRead?: number;          // Cost per million cached tokens
    cacheWrite?: number;         // Cost per million cache writes
  };
  contextWindow: number;         // Max context in tokens
  maxTokens: number;             // Max output tokens
}
```

## Error Detection Patterns

### Common Provider Errors
```typescript
const RATE_LIMIT_PATTERNS = [
  /429/,
  /rate.?limit/i,
  /too.?many.?requests/i,
  /quota.*exceeded/i,
  /insufficient.*quota/i,
];

const CAPACITY_PATTERNS = [
  /no.*capacity/i,
  /overloaded/i,
  /engine.*overloaded/i,
  /temporarily.*unavailable/i,
  /503/,
  /529/,
];

const AUTH_PATTERNS = [
  /401/,
  /403/,
  /unauthorized/i,
  /invalid.*key/i,
];

function classifyError(error: unknown): {
  type: "rate_limit" | "capacity" | "auth" | "network" | "unknown";
  retryable: boolean;
} {
  const message = String(error);
  if (RATE_LIMIT_PATTERNS.some(p => p.test(message))) {
    return { type: "rate_limit", retryable: true };
  }
  if (CAPACITY_PATTERNS.some(p => p.test(message))) {
    return { type: "capacity", retryable: true };
  }
  if (AUTH_PATTERNS.some(p => p.test(message))) {
    return { type: "auth", retryable: false };
  }
  return { type: "unknown", retryable: true };
}
```

## Best Practices

### 1. Extension Structure
- Single file for simple extensions
- Directory with `index.ts` for complex extensions
- Always export default function receiving `ExtensionAPI`

### 2. Error Handling
- Use `turn_end` event to detect errors (not a separate error event)
- Check `event.message.errorMessage` for assistant errors
- Provide helpful user notifications via `ctx.ui.notify()`

### 3. Provider Extensions
- Register in `session_start` after checking for existing auth
- Clear status in `model_select` when switching away
- Support both free and paid modes via config

### 4. User Experience
- Use `ctx.ui.notify()` sparingly (can be noisy)
- Set status via `ctx.ui.setStatus()` for persistent state
- Provide commands for manual control (`/mycommand`)

### 5. Security
- Never hardcode API keys (use env vars or config files)
- Validate all inputs in tool execute functions
- Be careful with tool_call interception (don't block legit operations)

## Testing Extensions

```bash
# Quick test
pi -e ./my-extension.ts

# With hot reload (place in auto-discovered location)
cp my-extension.ts ~/.pi/agent/extensions/
pi
# Then /reload in Pi after changes

# Debug with notifications
pi.on("session_start", async (_event, ctx) => {
  ctx.ui.notify("Extension loaded!", "info");
  console.log("Extension debug info");  // Check ~/.pi/agent/logs/
});
```

## Debugging

- Logs: `~/.pi/agent/logs/`
- Session data: `~/.pi/agent/sessions/`
- Extension errors show in TUI as notifications
- Use `console.log()` for debugging (appears in logs)

## Common Mistakes

1. **Import paths** - Use `.ts` extensions for ESM imports in NodeNext mode
2. **Event order** - `session_start` fires before `agent_start`, not before each turn
3. **Tool blocking** - Return `{ block: true, reason: "..." }` to block, not `undefined`
4. **Async handlers** - Always `await` async operations in event handlers
5. **Type imports** - Use `import type { ... }` for type-only imports

## Resources

- Full docs: `~/.pi/agent/docs/extensions.md`
- Examples: `~/.pi/agent/examples/extensions/`
- Type definitions: `@mariozechner/pi-coding-agent` package
- Skill spec: https://agentskills.io/specification
