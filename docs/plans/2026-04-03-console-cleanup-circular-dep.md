# Console Cleanup & Circular Dependency Fix Plan

> **For Pi:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Fix circular dependency between `usage/limits.ts` and `usage/formatters.ts` (and verify console statements are appropriately placed)

**Architecture:** Extract shared types to a new `usage/types.ts` file, removing the bidirectional import cycle

**Tech Stack:** TypeScript, Vitest

---

## Analysis

### Console Statements Review
After investigation, the console statements are appropriately placed:
- **11 in `scripts/update-benchmarks.ts`**: CLI development script - console.log is acceptable for user feedback
- **3 in `lib/logger.ts`**: These are the actual logger implementation (debug/warn/error) - necessary
- **0 in production code**: All provider/usage/lib code uses the proper logger, no stray console calls

**Conclusion:** No console cleanup needed - already clean!

### Circular Dependency (Madge Report)
```
usage/limits.ts → usage/formatters.ts → usage/limits.ts
```

**Root Cause:**
- `limits.ts` re-exports functions from `formatters.ts` (line 20)
- `formatters.ts` imports types and functions from `limits.ts` (lines 5-9)

**Files to Modify:**
- `usage/limits.ts`
- `usage/formatters.ts`
- Create: `usage/types.ts` (extract shared interfaces)

---

## Task 1: Extract Shared Types

**Files:**
- Create: `usage/types.ts`
- Modify: `usage/limits.ts:9-29` (remove duplicate interface)
- Modify: `usage/formatters.ts:7-16` (remove duplicate interface)

**Step 1: Create shared types file**

```typescript
// usage/types.ts
/**
 * Shared types for usage tracking modules
 * Extracted to break circular dependency between limits.ts and formatters.ts
 */

export interface FreeTierLimit {
  provider: string;
  requestsPerDay?: number;
  requestsPerHour?: number;
  requestsPerMonth?: number;
  description: string;
}

export interface FreeTierUsage {
  provider: string;
  requestsToday: number;
  requestsThisHour: number;
  requestsThisMonth?: number;
  limit: FreeTierLimit;
  remainingToday?: number;
  remainingThisHour?: number;
  remainingThisMonth?: number;
  percentUsed: number;
  status: "ok" | "warning" | "critical" | "unknown";
}
```

**Step 2: Update limits.ts to import from types.ts**

Remove the duplicate `FreeTierLimit` interface (lines 9-16) and import from types:

```typescript
// usage/limits.ts
import {
  type FreeTierLimit,
  type FreeTierUsage,
} from "./types.ts";

// ... rest of file, but remove:
// - export interface FreeTierLimit (lines 9-16)
// - keep FREE_TIER_LIMITS, getFreeTierUsage, etc.
```

**Step 3: Update formatters.ts to import from types.ts**

Remove the duplicate `FreeTierUsage` interface (lines 7-16) and change imports:

```typescript
// usage/formatters.ts
import {
  type FreeTierLimit,
  type FreeTierUsage,
  getFreeTierUsage,
  getLimitWarning,
} from "./limits.ts";
// Remove the local FreeTierUsage interface definition (lines 7-16)
```

**Step 4: Verify no circular dependency**

Run: `npx madge --circular usage/`

Expected: No circular dependencies found

**Step 5: Run tests**

Run: `npx vitest run`

Expected: All 127 tests pass

**Step 6: Commit**

```bash
git add usage/types.ts usage/limits.ts usage/formatters.ts
git commit -m "refactor: break circular dependency in usage modules

- Extract shared types to usage/types.ts
- Remove duplicate interface definitions
- limits.ts and formatters.ts now import from shared types
- Resolves Madge circular dependency report"
```

**Verification:**
- [ ] `usage/types.ts` created with `FreeTierLimit` and `FreeTierUsage`
- [ ] `limits.ts` imports types from `./types.ts`
- [ ] `formatters.ts` imports types from `./types.ts` via limits
- [ ] Madge reports no circular dependencies
- [ ] All 127 tests pass
- [ ] Commit made

---

## Task 2: Verify Exports Still Work

**Files:**
- Test: Verify `usage/index.ts` exports still function

**Step 1: Check index.ts exports**

Read: `usage/index.ts`

Verify it still correctly exports from limits and formatters:
```typescript
export { ... } from "./limits.ts";
export { ... } from "./formatters.ts";
```

**Step 2: Verify no breaking changes**

Run: `npx tsc --noEmit`

Expected: No type errors

**Step 3: Run tests again**

Run: `npx vitest run tests/usage-tracking.test.ts`

Expected: All usage tests pass

**Step 4: Commit**

```bash
git commit -m "verify: no breaking changes to usage module exports"
```

**Verification:**
- [ ] TypeScript compilation succeeds
- [ ] Usage tests pass
- [ ] No breaking changes to public API
- [ ] Commit made

---

## Post-Implementation Summary

**Changes Made:**
- Created `usage/types.ts` with shared interfaces
- Removed duplicate `FreeTierLimit` from `limits.ts`
- Removed duplicate `FreeTierUsage` from `formatters.ts`
- Both files now import from shared types

**Circular Dependency:** ✅ Resolved

**Tests:** ✅ All 127 passing

**Console Statements:** ✅ Already clean (no action needed)

---

## Execution Options

**Recommended:** Use superpowers:subagent-driven-development

**Process:**
1. /tree → Branch 1: Extract types (Task 1)
2. /tree → Branch 2: Verify exports (Task 2)
3. Return to mainline when complete

---

**Plan complete. Ready for execution.**
