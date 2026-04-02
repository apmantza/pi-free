# File Reorganization Assessment Plan

> **For Pi:** Move root-level TS files to `lib/` directory without refactoring code.

**Goal:** Reduce root folder clutter by moving shared utilities into `lib/`

**Impact Assessment:**
- 14 files need import path updates
- 3 files to move
- 1 file to delete (unused)
- 1 file kept in root (has dependents)

---

## Summary of Changes

### Files to Move (3)
| File | Dest | Files With Broken Imports |
|------|------|---------------------------|
| `util.ts` | `lib/util.ts` | 12 files |
| `types.ts` | `lib/types.ts` | 5 files |
| `model-enhancer.ts` | `lib/model-enhancer.ts` | 0 files (unused) |

### Files to Delete (1)
| File | Reason |
|------|--------|
| `providers/fireworks.ts` | Provider removed from README, no longer supported |

### Files to Keep in Root (1)
| File | Reason |
|------|--------|
| `providers/factory.ts` | **Still used by mistral.ts, nvidia.ts, ollama.ts** - CANNOT DELETE |

---

## Task 1: Move util.ts → lib/util.ts

**Files needing import updates (12 total):**

### Root files (1):
- `provider-factory.ts:43` - `import { logWarning } from "./util.ts";`
  - Change to: `import { logWarning } from "./lib/util.ts";`

### Provider files (8):
- `providers/ollama.ts:15` - `import { fetchWithRetry } from "../util.ts";`
- `providers/model-fetcher.ts:8` - `import { fetchWithRetry, isUsableModel, mapOpenRouterModel } from "../util.ts";`
- `providers/kilo.ts:27` - `import { cleanModelName, logWarning } from "../util.ts";`
- `providers/cline-models.ts:14` - `import { cleanModelName, fetchWithRetry, isUsableModel } from "../util.ts";`
- `providers/nvidia.ts:24` - `import { fetchWithRetry, isUsableModel } from "../util.ts";`
- `providers/cline.ts:19` - `import { logWarning } from "../util.ts";`
- `providers/openrouter.ts:33` - `import { cleanModelName, isUsableModel, logWarning } from "../util.ts";`
- `providers/zen.ts:34` - `import { fetchWithRetry, logWarning } from "../util.ts";`
  - All change from `../util.ts` to `../lib/util.ts`

### Usage files (1):
- `usage/metrics.ts` - `import { fetchWithTimeout, logWarning } from "../util.ts";`
  - Change to: `import { fetchWithTimeout, logWarning } from "../lib/util.ts";`

### Test files (3):
- `tests/ollama.test.ts` - `import { fetchWithRetry } from "../util.ts";`
- `tests/util.test.ts` - `import { ... } from "../util.ts";`
- `tests/zen.test.ts` - `import { fetchWithRetry } from "../util.ts";`
  - All change from `../util.ts` to `../lib/util.ts`

**Steps:**
1. Move file: `mv util.ts lib/util.ts`
2. Update 12 import statements
3. Run tests to verify: `npm test`
4. Commit

---

## Task 2: Move types.ts → lib/types.ts

**Files needing import updates (5 total):**

### Root files (1):
- `util.ts:2` - `import type { ProviderModelConfig } from "./types.ts";`
  - Note: This is AFTER util.ts is moved to lib/, so path becomes: `import type { ProviderModelConfig } from "./types.ts";` (same dir)

### Provider files (4):
- `providers/model-fetcher.ts:7` - `import type { ProviderModelConfig } from "../types.ts";`
- `providers/nvidia.ts:23` - `import type { ModelsDevProvider } from "../types.ts";`
- `providers/zen.ts:33` - `import type { ModelsDevModel, ZenGatewayModel } from "../types.ts";`
- `providers/cline-models.ts:13` - `import type { ProviderModelConfig } from "../types.ts";`
  - All change from `../types.ts` to `../lib/types.ts`

**Steps:**
1. Move file: `mv types.ts lib/types.ts`
2. Update 5 import statements
3. Run tests to verify
4. Commit

---

## Task 3: Move model-enhancer.ts → lib/model-enhancer.ts

**Files needing import updates: 0**

This file re-exports from hardcoded-benchmarks but isn't directly imported by anyone.

**Steps:**
1. Move file: `mv model-enhancer.ts lib/model-enhancer.ts`
2. No imports to update
3. Commit

---

## Task 4: Delete providers/fireworks.ts

**Files importing fireworks.ts: 0**

This provider was removed from README and is no longer supported.

**Steps:**
1. Delete file: `rm providers/fireworks.ts`
2. Delete test file: `rm tests/fireworks.test.ts` (if it exists)
3. Commit

---

## Critical Finding: CANNOT DELETE providers/factory.ts

**Reason:** Still actively used by 4 files:
- `providers/fireworks.ts` (being deleted anyway)
- `providers/mistral.ts`
- `providers/nvidia.ts`
- `providers/ollama.ts`

**Action:** Keep `providers/factory.ts` in place

---

## Execution Order

**Phase 1:** Move model-enhancer.ts (safest, no dependents)
**Phase 2:** Move types.ts (5 dependents)
**Phase 3:** Move util.ts (12 dependents - most complex)
**Phase 4:** Delete fireworks.ts

---

## Verification Checklist

After each move:
- [ ] File exists in new location
- [ ] File removed from old location
- [ ] All imports updated
- [ ] Tests pass: `npm test`
- [ ] Type check passes: `npx tsc --noEmit` (if available)

---

## Rollback Strategy

If anything breaks:
```bash
git checkout HEAD -- <moved-file>
git checkout HEAD -- <files-with-updated-imports>
```

---

## Files That Will Remain in Root (6)

1. `config.ts` - Core config, heavily used
2. `constants.ts` - Core constants, heavily used
3. `provider-factory.ts` - Used by mistral/nvidia/ollama
4. `provider-helper.ts` - Core provider logic
5. `vitest.config.ts` - Test config (standard location)

**Result:** Root goes from 9 files → 6 files (33% reduction)
