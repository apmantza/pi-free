# pi-free Refactoring Plan

Enhancements to improve maintainability, reduce duplication, and harden reliability — without removing any functionality.

---

## 1. Extract shared provider boilerplate

**Problem:** Every provider (`kilo.ts`, `zen.ts`, `openrouter.ts`, `nvidia.ts`) repeats the same scaffolding:
- Module-level `storedFreeModels` / `storedAllModels`
- `pi.registerCommand("{provider}-free", ...)` and `{provider}-all` with near-identical logic
- `pi.on("model_select", ...)` to clear status for other providers
- `pi.on("turn_end", ...)` to `incrementRequestCount`
- `pi.on("before_agent_start", ...)` for ToS notices

**Fix:** Create `provider-helper.ts` that generates this boilerplate:

```ts
export function setupProvider(pi: ExtensionAPI, opts: {
  name: string;           // "openrouter"
  providerId: string;     // PROVIDER_OPENROUTER
  baseUrl: string;
  apiKeyEnv?: string;
  headers: Record<string, string>;
  freeModels: ProviderModelConfig[];
  allModels: ProviderModelConfig[];
  showPaid: boolean;
  statusIcon: string;
  tosUrl?: string;
}): void
```

**Impact:** Cuts ~60 lines per provider file. Adding a new provider becomes ~20 lines of config instead of ~150 lines of boilerplate.

**Files:** New `provider-helper.ts`, simplify `kilo.ts`, `zen.ts`, `openrouter.ts`, `nvidia.ts`

---

## 2. Tighten types — eliminate `any`

**Problem:** `cline.ts` uses `any` for message content, callbacks, and context. `kilo-footer.ts` uses `any` for `footerData` and `ctx`. These are all typed in Pi's SDK.

**Fix:**
- `shapeMessagesForCline(messages: any[])` → use Pi's `Message` type from `@mariozechner/pi-ai`
- `extractText(content: unknown)` → narrow to `string | ContentPart[]`
- `buildStatsParts(ctx: any, ...)` → type `ctx` via Pi's extension context
- `kilo-footer.ts` `footerData: any` → use Pi's footer data types

**Impact:** No runtime change. Catches type errors at compile time.

**Files:** `cline.ts`, `kilo-footer.ts`

---

## 3. Unify model fetch pipeline

**Problem:** Each provider has its own fetch→filter→map→cache pipeline with similar but slightly different logic.

**Fix:** Shared utility in `fetch-models.ts`:

```ts
export async function fetchAndCacheModels<T>(opts: {
  cacheKey: string;
  fetch: () => Promise<T[]>;
  filter?: (m: T) => boolean;
  map?: (m: T) => ProviderModelConfig;
}): Promise<ProviderModelConfig[]>
```

`Kilo`, `OpenRouter`, and `Cline` already share `mapOpenRouterModel` and `isFreeModel` — this extends that to the whole pipeline.

**Impact:** Reduces per-provider fetch code to a declarative config.

**Files:** New `fetch-models.ts`, simplify `kilo-models.ts`, `cline-models.ts`, `openrouter.ts`

---

## 4. DRY the `openBrowser` function

**Problem:** `kilo-auth.ts` and `cline-auth.ts` both have identical `openBrowser(url)` functions (platform dispatch to `cmd /c start`, `open`, `xdg-open`).

**Fix:** Extract to `util.ts` as a single export:

```ts
export function openBrowser(url: string): void { ... }
```

**Impact:** Removes ~30 lines of duplicated code. Single place to fix browser-open bugs.

**Files:** `util.ts`, `kilo-auth.ts`, `cline-auth.ts`

---

## 5. Make `fetchWithRetry` the only fetch path

**Problem:** `kilo-models.ts` calls raw `fetch()` instead of `fetchWithRetry` (no retry, no timeout). Some `metrics.ts` calls also bypass it.

**Fix:** Route all network calls through `fetchWithRetry` for consistent retry behavior and timeout handling.

**Impact:** Better reliability on flaky networks. Consistent error handling.

**Files:** `kilo-models.ts`, `metrics.ts`

---

## 6. Initialize provider status at registration time

**Problem:** OpenRouter and NVIDIA only set their status in `session_start`. If the user picks a model from `Ctrl+L` before `session_start` fires, there's no status label. Kilo partially does this right.

**Fix:** Set `ctx.ui.setStatus(...)` immediately after `registerProvider()` at the top-level, not lazily in the event handler.

**Impact:** Status always visible in model selector, even before first session start.

**Files:** `openrouter.ts`, `nvidia.ts`

---

## 7. Surface errors to users, not just logs

**Problem:** When a provider fails to load models, `logWarning` writes to `console.warn` but the user sees nothing in Pi's UI.

**Fix:** Add visible notification on failure:

```ts
ctx.ui.notify(`Kilo: failed to load models (using cached)`, "warning");
```

`cline.ts` already does this in some paths — standardize across all providers.

**Impact:** Users know when something is wrong instead of silently getting fewer models.

**Files:** `kilo.ts`, `zen.ts`, `openrouter.ts`, `nvidia.ts`

---

## 8. Cache invalidation on login

**Problem:** When the user runs `/login kilo`, `kilo.ts` fetches new models but doesn't invalidate the cache. The old cache could serve stale data on the next `session_start`.

**Fix:** Call `invalidate()` after successful login:

```ts
import { invalidate } from "./cache.ts";
invalidate("kilo-all");
invalidate("kilo-free");
```

**Impact:** Model list is always fresh after login. One-line fix.

**Files:** `kilo.ts`

---

## 9. Per-provider hidden models

**Problem:** `hidden_models` in `~/.pi/free.json` is global — can't hide a model from OpenRouter but keep it in Kilo.

**Fix:** Accept both formats for backward compatibility:

```json
{
  "hidden_models": ["global-model-id"],
  "hidden_models": {
    "openrouter": ["meta-llama/llama-3.1-8b-instruct"],
    "kilo": ["some-kilo-model"]
  }
}
```

Update `applyHidden()` to take an optional provider name:

```ts
export function applyHidden<T extends { id: string }>(models: T[], provider?: string): T[]
```

**Impact:** Fine-grained control over which models appear per provider.

**Files:** `config.ts`, all provider files (pass provider name to `applyHidden`)

---

## 10. Minor cleanups

| Item | File | Fix |
|------|------|-----|
| Dead `STATIC_ZEN_MODELS` array | `zen.ts` | Use it in the `useStaticFallback` path or remove it |
| `CACHE_KEY_*` constants unused | `kilo-models.ts` | Use constants instead of string literals `"kilo-free"` / `"kilo-all"` |
| Double-dispose in footer | `kilo-footer.ts` | Guard against calling `dispose()` twice |

**Impact:** Removes confusion from dead code and inconsistency.

**Files:** `zen.ts`, `kilo-models.ts`, `kilo-footer.ts`

---

## Suggested implementation order

| Phase | Items | Rationale |
|-------|-------|-----------|
| **Quick wins** | #4, #8, #10 | Low risk, immediately useful, can be done independently |
| **Core refactor** | #1, #3, #5 | Biggest code reduction, sets up clean architecture |
| **Type safety** | #2 | No behavior change, pure compile-time improvement |
| **UX improvements** | #6, #7 | Better user experience, small changes |
| **Feature** | #9 | New capability, slightly more config surface |

---

## Non-goals (explicitly out of scope)

- Removing any provider or model
- Changing API behavior or request formats
- Modifying the config file structure beyond `hidden_models`
- Adding new providers (that's a follow-up, enabled by #1)
