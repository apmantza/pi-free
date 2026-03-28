---
name: pi-extension-dev
description: Guide for developing Pi coding agent extensions. Use when creating, modifying, or debugging Pi extensions. Provides comprehensive structural details, event documentation, file locations, and references to Pi's official docs.
---

# Pi Extension Development

Complete guide for building Pi coding agent extensions.

## Documentation Locations (Search Here First)

### Official Pi Documentation
```
~/.pi/agent/docs/
├── extensions.md          # EXTENSION API - Complete reference
├── providers.md             # Provider setup and authentication
├── models.md                # Custom models and model.json format
├── custom-provider.md       # Building custom API providers
├── packages.md              # Pi package format (npm/git distribution)
├── skills.md                # Skill format and specification
├── prompt-templates.md      # Prompt template system
├── session.md               # Session storage internals
├── compaction.md            # Context compaction system
├── tree.md                  # Tree navigation (/tree command)
├── themes.md                # Theme customization
├── tui.md                   # TUI component API
├── keybindings.md           # Keyboard shortcuts
└── sdk.md                   # SDK integration for embedding Pi
```

### Example Extensions (Working Code)
```
~/.pi/agent/examples/extensions/
├── summarize.ts           # Conversation summarization
├── snake.ts               # Game example with custom UI
├── permission-gate.ts     # Tool call interception
├── git-checkpoint.ts      # Git integration example
└── ...
```

### Type Definitions (API Reference)
```
~/.pi/agent/node_modules/@mariozechner/pi-coding-agent/
├── dist/
│   └── core/extensions/types.d.ts    # TypeScript definitions
└── README.md                            # Main documentation
```

### Global Configuration
```
~/.pi/agent/
├── settings.json          # Pi settings (packages, extensions)
├── models.json            # Custom provider definitions
├── auth.json              # Stored credentials (OAuth, API keys)
├── sessions/              # Session storage (*.json files)
├── extensions/            # Global extensions (*.ts)
└── skills/                # Global skills (*/SKILL.md)
```

### Logs (Debug Info)
```
~/.pi/agent/logs/          # Console output from extensions
```

---

## Extension Architecture

### Extension Loading Order

1. **Discovery Phase**
   - Scan all extension locations (global, local, packages)
   - Collect `*.ts` files and `*/index.ts` entries
   - Sort by package dependency order

2. **Load Phase**
   - Load via `jiti` (TypeScript without compilation)
   - Execute default export function with `ExtensionAPI`
   - Extensions register event handlers, tools, commands

3. **Initialization Phase**
   - Fire `session_directory` (CLI only, determines session location)
   - Fire `session_start` (all extensions can react)
   - Extensions register providers, restore state

### Extension Structure Variants

#### Single File Extension
```typescript
// ~/.pi/agent/extensions/my-ext.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Event handlers, tool registration, etc.
}
```

#### Multi-File Extension
```
~/.pi/agent/extensions/my-ext/
├── index.ts              # Required: Entry point
├── config.ts             # Configuration handling
├── tools.ts              # Tool definitions
├── ui.ts                 # UI components
└── utils.ts              # Helper functions
```

#### Extension with Dependencies
```
~/.pi/agent/extensions/my-ext/
├── package.json          # npm dependencies
├── package-lock.json
├── node_modules/
└── src/
    └── index.ts
```

```json
// package.json
{
  "name": "my-extension",
  "dependencies": {
    "lodash": "^4.17.0"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

---

## ExtensionAPI Complete Reference

### Event System

Events follow pattern: `pi.on(eventName, async (event, ctx) => { ... })`

#### Session Lifecycle Events

**session_directory**
```typescript
pi.on("session_directory", async (event) => {
  // event.cwd - Current working directory
  // No ctx provided (special case)
  return { sessionDir: "/custom/path" };
});
```
- CLI-only, startup-only
- Determines where session files are stored
- Lowest priority (after --session-dir flag and settings.json)

**session_start**
```typescript
pi.on("session_start", async (event, ctx) => {
  // ctx.sessionManager - Session management API
  // ctx.modelRegistry - Provider/model registration
  // ctx.ui - UI interaction methods
  // ctx.sessionStorage - Key-value storage for this session
});
```
- Fired once when session loads
- Primary hook for provider registration
- UI available for notifications

**session_shutdown**
```typescript
pi.on("session_shutdown", async (event, ctx) => {
  // Cleanup, save state
});
```
- Fired on Ctrl+C, Ctrl+D, SIGTERM
- Short timeout for cleanup (don't block)

#### Agent Lifecycle Events

**before_agent_start**
```typescript
pi.on("before_agent_start", async (event, ctx) => {
  // event.prompt - User's input text
  // event.images - Attached images (array)
  // event.systemPrompt - Current system prompt
  
  return {
    // Inject persistent message (shown in UI, sent to LLM)
    message: {
      customType: "my-extension",
      content: "Additional context",
      display: "inline" | "banner" | false,
    },
    // Modify system prompt for this turn
    systemPrompt: event.systemPrompt + "\n\nExtra instructions",
  };
});
```

**agent_start / agent_end**
```typescript
pi.on("agent_start", async (event, ctx) => {
  // Event fired when agent begins processing
});

pi.on("agent_end", async (event, ctx) => {
  // event.messages - All messages from this prompt
});
```

#### Turn Events (Tool Execution Loop)

**turn_start / turn_end**
```typescript
pi.on("turn_start", async (event, ctx) => {
  // New tool-calling turn begins
});

pi.on("turn_end", async (event, ctx) => {
  // Turn completed (success or error)
  // event.message - Assistant message
  // event.message.errorMessage - Error if failed
});
```

**context**
```typescript
pi.on("context", async (event, ctx) => {
  // event.messages - Messages being sent to LLM
  // Modify before provider request
  return { messages: modifiedMessages };
});
```

**before_provider_request**
```typescript
pi.on("before_provider_request", async (event, ctx) => {
  // event.payload - Provider API payload
  // Inspect or modify before sending
  // Can replace entire request
});
```

#### Tool Events

**tool_call**
```typescript
pi.on("tool_call", async (event, ctx) => {
  // event.toolName - Tool identifier
  // event.input - Tool parameters
  // event.toolCallId - Unique ID for this call
  
  // Block tool call:
  return { block: true, reason: "Not allowed" };
  
  // Modify parameters:
  return { input: modifiedInput };
  
  // Allow:
  return undefined;
});
```

**tool_execution_start / tool_execution_update / tool_execution_end**
```typescript
pi.on("tool_execution_start", async (event, ctx) => {
  // Tool begins executing
});

pi.on("tool_execution_update", async (event, ctx) => {
  // Progress update (for long-running tools)
});

pi.on("tool_execution_end", async (event, ctx) => {
  // Tool completed
});
```

**tool_result**
```typescript
pi.on("tool_result", async (event, ctx) => {
  // event.result - Tool output
  // Modify before display/LLM consumption
  return { result: modifiedResult };
});
```

#### Provider/Model Events

**model_select**
```typescript
pi.on("model_select", async (event, ctx) => {
  // event.model - Newly selected model
  // event.model.provider - Provider ID
  // event.model.id - Model ID
  
  // Clear status when switching away:
  if (event.model?.provider !== "my-provider") {
    ctx.ui.setStatus("my-provider-status", undefined);
  }
});
```

#### Input Events

**input**
```typescript
pi.on("input", async (event, ctx) => {
  // event.text - Raw user input
  // event.images - Attached images
  
  // Transform input:
  return { text: transformedText };
  
  // Or handle completely (bypass normal processing):
  ctx.ui.notify("Handled!", "info");
  return { handled: true };
});
```

---

## Context Object (ctx) Deep Dive

### UI Methods

```typescript
// Notifications
ctx.ui.notify(
  "Message text",
  "info" | "warning" | "error" | "success"
);

// Status line (footer)
ctx.ui.setStatus("extension-id", "Status text");
ctx.ui.setStatus("extension-id", undefined); // Clear

// Widget above editor
ctx.ui.setWidget("extension-id", ["Line 1", "Line 2", "Line 3"]);

// Interactive prompts
const confirmed = await ctx.ui.confirm(
  "Title",
  "Are you sure you want to do this?"
);

const input = await ctx.ui.input(
  "Enter Value",
  "placeholder text"
);

const choice = await ctx.ui.select("Choose", [
  { value: "a", label: "Option A" },
  { value: "b", label: "Option B" },
]);

// Full custom TUI
const result = await ctx.ui.custom<MyResultType>(
  (tui, theme, keyboard, done) => ({
    render: (width: number) => string[],
    handleInput: (data: Buffer) => void,
    invalidate: () => void,
  })
);
```

### Session Manager

```typescript
// Session file path
const sessionFile = ctx.sessionManager.getSessionFile();

// Current conversation branch
const branch = ctx.sessionManager.getBranch();

// Fork session at entry
const forked = await ctx.sessionManager.fork(entryId);
```

### Model Registry

```typescript
// Get all registered models
const allModels = ctx.modelRegistry.getAll();

// Get available models (with auth)
const available = ctx.modelRegistry.getAvailable();

// Find specific model
const model = ctx.modelRegistry.find("provider", "model-id");

// Register provider
ctx.modelRegistry.registerProvider("id", providerConfig);

// Auth storage
const auth = ctx.modelRegistry.authStorage.get("provider-id");
```

### Session Storage

```typescript
// Persistent key-value storage for extension
ctx.sessionStorage.setItem("my-key", "value");
const value = ctx.sessionStorage.getItem("my-key");
ctx.sessionStorage.removeItem("my-key");
```

---

## Registration Methods

### Register Provider

```typescript
import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";

const models: ProviderModelConfig[] = [{
  id: "model-id",
  name: "Display Name",
  reasoning: false,
  input: ["text"], // or ["text", "image"]
  cost: {
    input: 0.27,      // Per million tokens
    output: 1.10,
    cacheRead: 0.05,  // Optional
    cacheWrite: 0.10, // Optional
  },
  contextWindow: 128000,
  maxTokens: 4096,
}];

pi.registerProvider("my-provider", {
  baseUrl: "https://api.example.com/v1",
  apiKey: "ENV_VAR_NAME", // Read from process.env.ENV_VAR_NAME
  api: "openai-completions", // or "anthropic-messages", "google-generative-ai"
  headers: {
    "X-Custom-Header": "value",
  },
  models,
});
```

### Register Tool

```typescript
import { Type } from "@sinclair/typebox";

pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "What this tool does and when to use it",
  parameters: Type.Object({
    param1: Type.String({
      description: "What this parameter does",
    }),
    param2: Type.Number({
      description: "Numeric parameter",
    }),
  }),
  
  async execute(
    toolCallId: string,
    params: { param1: string; param2: number },
    signal: AbortSignal,
    onUpdate: (update: { type: string; data: unknown }) => void,
    ctx: ToolContext
  ) {
    // Execute tool logic
    const result = await doSomething(params);
    
    // Return result
    return {
      content: [{ type: "text", text: String(result) }],
      details: {
        // Additional structured data for LLM
        extra: "information",
      },
    };
  },
});
```

### Register Command

```typescript
pi.registerCommand("my-command", {
  description: "What this command does",
  handler: async (args: string, ctx) => {
    // args - Text after command name
    ctx.ui.notify(`Executed with args: ${args}`, "info");
  },
});
```

### Register Shortcut

```typescript
pi.registerShortcut("ctrl+shift+x", {
  description: "Custom keyboard shortcut",
  handler: async (ctx) => {
    ctx.ui.notify("Shortcut pressed!", "info");
  },
});
```

### Register Flag

```typescript
pi.registerFlag("my-flag", {
  description: "CLI flag description",
  type: "string", // or "boolean", "number"
});

// Access flag value
const flagValue = pi.getFlag("my-flag");
```

---

## Error Handling in Extensions

### Detecting Errors

Pi extensions detect errors from the `turn_end` event, NOT from a separate error event:

```typescript
pi.on("turn_end", async (event, ctx) => {
  // Cast to access errorMessage
  const msg = event.message as {
    role?: string;
    errorMessage?: string;
  };
  
  if (msg?.role === "assistant" && msg.errorMessage) {
    const error = msg.errorMessage;
    console.log(`Error detected: ${error}`);
    
    // Classify error
    if (error.includes("429") || error.match(/rate.?limit/i)) {
      ctx.ui.notify("Rate limited! Try another provider.", "warning");
    }
  }
});
```

### Error Classification Patterns

```typescript
const ERROR_PATTERNS = {
  rateLimit: [
    /429/,
    /rate.?limit/i,
    /too.?many.?requests/i,
    /quota.*exceeded/i,
    /throttled/i,
  ],
  capacity: [
    /no.*capacity/i,
    /overloaded/i,
    /503/,
    /529/,
    /temporarily.*unavailable/i,
  ],
  auth: [
    /401/,
    /403/,
    /unauthorized/i,
    /invalid.*key/i,
    /invalid.*token/i,
  ],
  network: [
    /timeout/i,
    /etimedout/i,
    /econnreset/i,
    /fetch.*failed/i,
    /network.*error/i,
  ],
};

function classifyError(error: string): {
  type: "rate_limit" | "capacity" | "auth" | "network" | "unknown";
  retryable: boolean;
} {
  for (const [type, patterns] of Object.entries(ERROR_PATTERNS)) {
    if (patterns.some(p => p.test(error))) {
      return {
        type: type as any,
        retryable: type !== "auth",
      };
    }
  }
  return { type: "unknown", retryable: true };
}
```

---

## Common Extension Patterns

### Provider Extension Pattern

```typescript
import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Configuration
  const PROVIDER_ID = "my-provider";
  const BASE_URL = "https://api.example.com/v1";
  const API_KEY_VAR = "MY_PROVIDER_API_KEY";
  
  // Model definitions
  const models: ProviderModelConfig[] = [
    {
      id: "model-v1",
      name: "My Model v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0.5, output: 1.5 },
      contextWindow: 128000,
      maxTokens: 4096,
    },
  ];
  
  // Track state
  let isRegistered = false;
  
  pi.on("session_start", async (_event, ctx) => {
    // Check if already registered via auth
    const hasAuth = ctx.modelRegistry
      .getAvailable()
      .some(m => m.provider === PROVIDER_ID);
    
    if (hasAuth) {
      isRegistered = true;
      return;
    }
    
    // Check for API key
    const apiKey = process.env[API_KEY_VAR];
    if (!apiKey) {
      console.log(`[${PROVIDER_ID}] No API key found`);
      return;
    }
    
    // Register provider
    pi.registerProvider(PROVIDER_ID, {
      baseUrl: BASE_URL,
      apiKey: API_KEY_VAR,
      api: "openai-completions",
      models,
    });
    
    isRegistered = true;
    ctx.ui.setStatus(
      `${PROVIDER_ID}-status`,
      ctx.ui.theme.fg("accent", `⚡ ${PROVIDER_ID} ready`)
    );
  });
  
  // Clear status when switching away
  pi.on("model_select", (event, ctx) => {
    if (event.model?.provider !== PROVIDER_ID) {
      ctx.ui.setStatus(`${PROVIDER_ID}-status`, undefined);
    }
  });
  
  // Handle errors
  pi.on("turn_end", async (event, ctx) => {
    if (!isRegistered) return;
    
    const msg = event.message as {
      role?: string;
      errorMessage?: string;
    };
    
    if (msg?.role === "assistant" && msg.errorMessage) {
      const error = msg.errorMessage;
      
      if (error.includes("429") || error.match(/rate.?limit/i)) {
        ctx.ui.notify(
          `${PROVIDER_ID} rate limited. Try /model to switch.`,
          "warning"
        );
      }
    }
  });
}
```

### Tool Interception Pattern

```typescript
pi.on("tool_call", async (event, ctx) => {
  // Block dangerous bash commands
  if (event.toolName === "bash") {
    const cmd = event.input.command as string;
    
    // Check for dangerous patterns
    const dangerous = [
      /rm\s+-rf\s+\//,
      />\s*\/etc\/passwd/,
      /mkfs\./,
      /dd\s+if=.*of=\/dev\/sda/,
    ];
    
    if (dangerous.some(p => p.test(cmd))) {
      const ok = await ctx.ui.confirm(
        "⚠️ Dangerous Command",
        `Allow: ${cmd}?`
      );
      
      if (!ok) {
        return {
          block: true,
          reason: "Blocked by safety extension",
        };
      }
    }
  }
  
  // Allow tool call
  return undefined;
});
```

### State Persistence Pattern

```typescript
// Load state on session start
pi.on("session_start", async (_event, ctx) => {
  const stored = ctx.sessionStorage.getItem("my-extension-data");
  if (stored) {
    const data = JSON.parse(stored);
    // Restore state...
  }
});

// Save state periodically or on shutdown
pi.on("session_shutdown", async (_event, ctx) => {
  ctx.sessionStorage.setItem(
    "my-extension-data",
    JSON.stringify({ /* state */ })
  );
});

// Or use pi.appendEntry() for session history
pi.appendEntry({
  type: "custom",
  customType: "my-extension",
  content: "Event occurred",
  display: false, // Don't display in UI
});
```

---

## Configuration Files

### Settings Format (~/.pi/agent/settings.json)

```json
{
  "packages": [
    "npm:pi-high-availability",
    "git:github.com/user/repo"
  ],
  "extensions": [
    "/path/to/extension.ts"
  ],
  "skills": [
    "/path/to/skills"
  ],
  "theme": "custom-theme",
  "sessionDir": "/custom/sessions/path",
  "enableSkillCommands": true,
  "model": "anthropic/claude-3-5-sonnet"
}
```

### Custom Models (~/.pi/agent/models.json)

```json
{
  "custom-provider": {
    "id": "custom-provider",
    "api": "openai-completions",
    "baseUrl": "https://api.example.com/v1",
    "models": {
      "model-id": {
        "id": "model-id",
        "name": "Display Name",
        "context": 128000,
        "maxOutput": 4096,
        "cost": {
          "input": 0.5,
          "output": 1.5
        }
      }
    }
  }
}
```

---

## Debugging Extensions

### Console Logging
```typescript
console.log("[my-ext] Debug info:", data);
// Check output in ~/.pi/agent/logs/
```

### Notification Debugging
```typescript
pi.on("session_start", async (_event, ctx) => {
  ctx.ui.notify("Extension loaded!", "info");
  console.log("Extension debug: session started");
});
```

### Hot Reload
1. Place extension in `~/.pi/agent/extensions/` or `.pi/extensions/`
2. Run `pi` with extension auto-discovered
3. After code changes, run `/reload` in Pi
4. Extension reloads without restarting Pi

---

## Best Practices Checklist

- [ ] Import `ExtensionAPI` as type: `import type { ExtensionAPI }`
- [ ] Export default function as entry point
- [ ] Use `console.log()` for debugging (check logs)
- [ ] Handle errors via `turn_end` event
- [ ] Clean up status/widgets in `model_select`
- [ ] Use `ctx.ui.notify()` sparingly (can be noisy)
- [ ] Store sensitive data (API keys) in env vars, not code
- [ ] Test with `pi -e ./extension.ts` before installing
- [ ] Add `pi.extensions` to package.json for distribution
- [ ] Document commands with clear descriptions
- [ ] Validate all tool inputs before execution
- [ ] Use TypeBox for tool parameter schemas
- [ ] Handle AbortSignal in long-running tools
- [ ] Don't block event handlers (use async/await)

---

## Troubleshooting

### Extension not loading
- Check file is in correct location (global or project-local)
- Verify TypeScript syntax (run `tsc --noEmit` if possible)
- Check logs: `~/.pi/agent/logs/`
- Try `pi -e ./extension.ts` for direct loading

### Type errors
- Ensure `@mariozechner/pi-coding-agent` is installed
- Check TypeScript version compatibility
- Use `.ts` extensions for ESM imports

### Events not firing
- Verify event name spelling (case-sensitive)
- Check that extension registered before events fired
- Some events are CLI-only (session_directory)

### UI not showing
- Use `/reload` after code changes
- Check that extension loaded (notification or status)
- Verify UI methods called with correct context

---

## Resources Summary

| Resource | Location |
|----------|----------|
| Extension API Docs | `~/.pi/agent/docs/extensions.md` |
| Example Extensions | `~/.pi/agent/examples/extensions/` |
| Type Definitions | `~/.pi/agent/node_modules/@mariozechner/pi-coding-agent/dist/` |
| Global Extensions | `~/.pi/agent/extensions/` |
| Project Extensions | `.pi/extensions/` |
| Logs | `~/.pi/agent/logs/` |
| Settings | `~/.pi/agent/settings.json` |
| Skills Spec | https://agentskills.io/specification |
