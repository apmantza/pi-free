# pi-free — Agents.md

> This file helps AI agents understand the codebase quickly. Read it before making changes.

## What is pi-free?

A **Pi extension** (`@earendil-works/pi-coding-agent`) that registers free and paid AI model providers with Pi's model picker. It shows free models by default and lets users toggle per-provider between free-only and all-models view via `/toggle-{provider}` commands.

**Package:** `pi-free` v2.0.9  
**Author:** Apostolos Mantzaris  
**License:** MIT  
**Repo:** `github.com/apmantza/pi-free`  
**Peer deps:** `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`

---

## Architecture at a Glance

```
index.ts                          ← Extension entry point (piFreeEntry)
  ├─ lib/registry.ts              ← Global provider registry + isFreeModel detection
  ├─ lib/toggle-state.ts          ← Generic toggle state machine (free ↔ all)
  ├─ lib/built-in-toggle.ts       ← Toggles for Pi's built-in providers (opencode, openrouter)
  ├─ lib/quota-monitor.ts         ← Rate-limit header extraction → status bar
  ├─ lib/logger.ts                ← Structured logging (console + ~/.pi/free.log)
  ├─ lib/json-persistence.ts      ← Generic JSON/JSONL file stores
  ├─ lib/model-detection.ts       ← Model family grouping, name normalization
  ├─ lib/model-enhancer.ts        ← CI score name decoration (thin wrapper)
  ├─ lib/provider-cache.ts        ← Disk cache for fetched model lists
  ├─ lib/provider-compat.ts       ← DeepSeek proxy compat flag detection
  ├─ lib/util.ts                  ← fetchWithRetry, model size parsing, OpenRouter mapping
  │
  ├─ config.ts                    ← ~/.pi/free.json + env var resolution (ALL config lives here)
  ├─ constants.ts                 ← Provider IDs, base URLs, timeouts, thresholds
  ├─ provider-helper.ts           ← registerOpenAICompatible, createReRegister, enhanceWithCI, setupProvider
  │
  ├─ provider-failover/           ← Benchmark lookup (Coding Index scores)
  │   ├─ benchmark-lookup.ts      ← Multi-strategy benchmark matching + debug logging
  │   ├─ hardcoded-benchmarks.ts  ← Benchmark data
  │   └─ benchmarks-chunk-*.ts    ← Split benchmark data files
  │
  └─ providers/                   ← Per-provider extensions (each exports default async fn)
      ├─ kilo/kilo.ts             ← Kilo Gateway (OAuth, free + paid)
      ├─ cline/cline.ts           ← Cline bot (OAuth, message reshaping for Cline API)
      ├─ novita/novita.ts         ← Novita AI (paid credits)
      ├─ ollama/ollama.ts         ← Ollama Cloud (usage-based free tier, 403 probing)
      ├─ routeway/routeway.ts     ← RouteWay AI (paid)
      ├─ sambanova/sambanova.ts   ← SambaNova (free tier)
      ├─ zenmux/zenmux.ts         ← ZenMux AI gateway (paid)
      ├─ crofai/crofai.ts         ← CrofAI (paid)
      ├─ codestral/codestral.ts   ← Codestral (free tier)
      ├─ llm7/llm7.ts             ← LLM7 (free default/fast selectors)
      ├─ deepinfra/deepinfra.ts   ← DeepInfra ($5 trial credit)
      ├─ together/together.ts     ← Together AI (paid credits)
      ├─ tokenrouter/tokenrouter.ts ← TokenRouter API gateway (paid + free models)
      ├─ qwen/qwen.ts             ← Qwen (deprecated, free tier removed)
      ├─ model-fetcher.ts         ← Shared OpenRouter-compatible model fetching
      ├─ opencode-session.ts      ← OpenCode session handling
      └─ dynamic-built-in/        ← Dynamic fetchers for Mistral, Groq, Cerebras, xAI, HF
          └─ index.ts

tests/                            ← Vitest test suite
```

---

## Key Concepts

### Extension Entry Point

`index.ts` exports `piFreeEntry(pi: ExtensionAPI)` — the single entry point Pi calls. It:

1. Sets up global commands (`/toggle-free`, `/free-providers`)
2. Sets up quota monitoring (passive, listens to `after_provider_response`)
3. Loads all unique providers via `Promise.allSettled`
4. Sets up dynamic built-in providers (only if API keys configured)
5. Sets up built-in provider toggles (OpenCode, OpenRouter)
6. Applies initial global filter if `free_only` is enabled

### Provider Registration Pattern

Every provider follows this pattern:

```typescript
export default async function providerName(pi: ExtensionAPI) {
    // 1. Fetch models (from API, hardcoded list, or models.dev)
    const allModels = await fetchModels(...);
    const freeModels = allModels.filter(m => isFreeModel(m, allModels));
    const stored = { free: freeModels, all: allModels };

    // 2. Create re-register function (used by toggles)
    const reRegister = createReRegister(pi, { providerId, baseUrl, apiKey });

    // 3. Register with global toggle system
    registerWithGlobalToggle(providerId, stored, reRegister, hasKey);

    // 4. Register initial models with Pi
    pi.registerProvider(providerId, { models: enhanceWithCI(initialModels), ... });

    // 5. Register toggle command
    pi.registerCommand(`toggle-${providerId}`, { ... });

    // 6. Status bar + session refresh
    pi.on("model_select", ...);
    pi.on("session_start", ...);
}
```

### Free Model Detection (isFreeModel)

Located in `lib/registry.ts`. Uses **adaptive Route A/B detection**:

- **Route A** (pricing-exposed): If ANY model in the set has cost > 0, use cost-based detection. Free = both input AND output cost are 0 (OR name contains "free").
- **Route B** (non-pricing-exposed): If ALL models have cost === 0, use name-based detection only. Free = name contains "free" (case-insensitive).

This avoids false positives where providers default all costs to 0 without exposing real pricing.

### Coding Index (CI) Scores

`provider-failover/benchmark-lookup.ts` implements a multi-strategy benchmark matching system that appends `[CI: X.X]` to model names. Strategies (in order):

1. Direct substring match against hardcoded benchmarks
2. Variant alias matching (e.g., `gpt-4o` → `gpt-4-o`)
3. Provider-specific normalization (strip NVIDIA prefixes, Groq suffixes, etc.)
4. Prefix fallback with base model extraction + size token reordering

Debug logging writes to `~/.pi/modelmatch.log`.

### Config Resolution

`config.ts` handles ALL configuration. Resolution order: **env var > `~/.pi/free.json`**.

- API keys: `resolve(envKey, fileVal)` — env wins, then config file
- Boolean flags: `resolveBool(envKey, fileVal)` — env `"true"`/`"false"` wins, then config file
- Config file is auto-created on first run with `CONFIG_TEMPLATE`
- `applyHidden(models, providerId)` filters models by `hidden_models` in config (supports provider-scoped format `provider/model-id`)

### Toggle State

`lib/toggle-state.ts` provides a generic `createToggleState<T>()` factory that manages:

- Mode: `"free"` | `"all"`
- Model storage: `{ free: T[], all: T[] }`
- Persistence: auto-saves to `~/.pi/free.json` on toggle
- Resolution: handles edge cases (empty `all` → fall back to `free`, etc.)

### Quota Monitoring

`lib/quota-monitor.ts` passively extracts rate-limit headers from provider responses. Tries 5 header pair formats in priority order. Shows quota in status bar with warning icons when < 25%.

---

## Provider Categories

| Category    | Providers                                          | Auth              | Notes                            |
| ----------- | -------------------------------------------------- | ----------------- | -------------------------------- |
| ✅ Free     | kilo, cline, openrouter, opencode, llm7            | OAuth or none     | Toggle between free/paid         |
| 🔄 Freemium | ollama-cloud, sambanova, codestral, tokenrouter    | API key           | Free tier with limits            |
| 💳 Paid     | zenmux, crofai, deepinfra, together, novita, routeway | API key + credits | Trial credits or pay-per-token   |
| 🔧 Dynamic  | mistral, groq, cerebras, xai, huggingface, fastrouter | API key        | Fetched when key configured      |

---

## File Locations (User-Facing)

- **Config:** `~/.pi/free.json` (auto-created)
- **Extension log:** `~/.pi/free.log`
- **Model match log:** `~/.pi/modelmatch.log`
- **Provider cache:** `~/.pi/provider-cache.json`

---

## Important Conventions

1. **TypeScript only** — no transpilation needed (Pi runs `.ts` directly with Node)
2. **ES modules** (`"type": "module"` in package.json)
3. **No build step** — `tsconfig.json` has `"noEmit": true`
4. **Node >= 20.0.0** required
5. **Provider IDs are constants** in `constants.ts` — always import from there
6. **API keys are getters** in `config.ts` — re-read on every call for runtime changes
7. **Logging uses `createLogger(namespace)`** — never `console.log` directly
8. **Error handling is graceful** — providers that fail at startup are silently skipped
9. **Model filtering happens at fetch time** — small models (< 30B, < 70B for NVIDIA) are filtered
10. **All providers use `enhanceWithCI()`** before registration to add CI scores

---

## Commands Reference

| Command              | Scope        | Description                               |
| -------------------- | ------------ | ----------------------------------------- |
| `/toggle-free`       | Global       | Toggle free-only mode for ALL providers   |
| `/free-providers`    | Global       | Show free/paid counts for all providers   |
| `/toggle-{provider}` | Per-provider | Toggle between free and all models        |
| `/probe-deepinfra`   | DeepInfra    | Test all models, auto-hide broken       |
| `/probe-novita`      | Novita       | Test all models, auto-hide broken        |
| `/probe-ollama`      | Ollama       | Test all models for 403 errors, auto-hide |
| `/probe-opencode`    | OpenCode     | Test all models, report expired free     |
| `/probe-opencode-go` | OpenCode (Go)| Test all models, report expired free    |
| `/probe-routeway`    | RouteWay     | Test all models, auto-hide broken        |
| `/probe-sambanova`   | SambaNova    | Test all models, auto-hide broken        |
| `/probe-together`    | Together     | Test all models, auto-hide broken        |
| `/login kilo`        | Kilo         | Start OAuth flow                          |
| `/login cline`       | Cline        | Start OAuth flow                          |
| `/logout kilo`       | Kilo         | Clear OAuth credentials                   |
| `/logout cline`      | Cline        | Clear OAuth credentials                   |

---

## Testing

- **Framework:** Vitest (`vitest` v4.1.5)
- **Run:** `npm test` (watch), `npm run test:run` (once)
- **Tests:** `tests/*.test.ts` — covers registry, toggle state, config, model detection, provider compat
- Tests use `vi.fn()` mocks for ExtensionAPI

---

## Adding a New Provider

1. Add provider constant to `constants.ts` (ID + base URL)
2. Add API key getter to `config.ts` + config file template
3. Create `providers/{name}/{name}.ts` following the registration pattern
4. Import and call from `index.ts` `Promise.allSettled([...])`
5. If it needs toggle support, it's automatic via `registerWithGlobalToggle`
6. Add tests to `tests/` if there's provider-specific logic worth testing

---

## Pi Extension API (Key Methods)

```typescript
pi.registerProvider(id, config); // Register a provider with models
pi.registerCommand(name, { handler }); // Register a slash command
pi.on(event, handler); // Subscribe to events
```

**Events:**

- `session_start` — New session begins (refresh models here)
- `model_select` — User picked a model (update status bar)
- `turn_end` — Conversation turn completed (error handling)
- `before_agent_start` — Before agent starts (re-register models)
- `context` — Intercept/transform messages (Cline uses this)
- `after_provider_response` — After API response (quota monitoring)

**Context (`ctx`):**

- `ctx.ui.notify(message, type)` — Show notification (`"info" | "warning" | "error"`)
- `ctx.ui.setStatus(key, value)` — Set status bar text
- `ctx.model?.provider` — Currently selected model's provider
- `ctx.modelRegistry.authStorage.get(providerId)` — Get OAuth credentials
