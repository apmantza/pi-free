# Toggle Persistence Implementation Plan

> **For Pi:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Make provider toggles persist correctly and toggle from the actual current display state for built-in providers and Cline.

**Architecture:** Introduce a narrow shared toggle-state helper that owns persisted `*_show_paid` state, current visible mode, model selection, and re-application after refresh. Keep provider-specific fetching, auth, and registration behavior in each provider.

**Tech Stack:** TypeScript, Vitest, Pi extension APIs

---

### Task 1: Add toggle-state regression tests

**Files:**
- Create: `tests/toggle-state.test.ts`
- Modify: `tests/cline.test.ts`
- Modify: `tests/built-in-toggle.test.ts` (new if missing)

**Step 1: Write failing tests**
- Verify saved `show_paid` state is restored for built-in providers after capture.
- Verify Cline persists `cline_show_paid` and re-applies the chosen model set after `session_start` and `before_agent_start`.
- Verify toggling flips from actual current mode, not from an assumed boolean.

**Step 2: Run tests to verify they fail**
Run: `npm test -- tests/toggle-state.test.ts tests/cline.test.ts tests/built-in-toggle.test.ts`

Expected: failures showing persistence/re-application is not implemented.

**Step 3: Commit**
```bash
git add tests/toggle-state.test.ts tests/cline.test.ts tests/built-in-toggle.test.ts
git commit -m "test: cover toggle persistence regressions"
```

**Verification:**
- [ ] Tests capture built-in restore behavior
- [ ] Tests capture Cline persistence
- [ ] At least one test fails before implementation

---

### Task 2: Add shared toggle-state helper

**Files:**
- Create: `lib/toggle-state.ts`
- Modify: `config.ts`

**Step 1: Write minimal helper**
- Add helper to initialize persisted mode from config.
- Add helper methods to set stored models, apply current mode, and toggle from actual current state.
- Add generic config getter/setter support if needed for provider `*_show_paid` flags.

**Step 2: Run focused tests**
Run: `npm test -- tests/toggle-state.test.ts`

Expected: PASS.

**Step 3: Commit**
```bash
git add lib/toggle-state.ts config.ts tests/toggle-state.test.ts
git commit -m "refactor: add shared toggle state helper"
```

**Verification:**
- [ ] Helper persists state updates
- [ ] Helper tracks actual current mode
- [ ] Helper chooses correct model list

---

### Task 3: Integrate built-in providers with shared helper

**Files:**
- Modify: `lib/built-in-toggle.ts`
- Test: `tests/built-in-toggle.test.ts`

**Step 1: Replace ad-hoc built-in state logic**
- Use the shared helper per built-in provider.
- On `session_start`, capture models and immediately apply persisted mode.
- Make `/toggle-{provider}` flip from the helper’s current mode.

**Step 2: Run tests**
Run: `npm test -- tests/built-in-toggle.test.ts`

Expected: PASS.

**Step 3: Commit**
```bash
git add lib/built-in-toggle.ts tests/built-in-toggle.test.ts
git commit -m "fix: persist built-in provider toggles"
```

**Verification:**
- [ ] Saved state restored on startup
- [ ] Toggle reflects actual current mode
- [ ] No hardcoded dependency on `globalFreeOnly` for per-provider state

---

### Task 4: Integrate Cline with shared helper

**Files:**
- Modify: `providers/cline/cline.ts`
- Modify: `tests/cline.test.ts`

**Step 1: Replace local `showPaidModels` flag**
- Initialize from persisted `cline_show_paid`.
- Re-apply selected mode after model refresh and before-agent re-registration.
- Persist changes through shared helper.

**Step 2: Run tests**
Run: `npm test -- tests/cline.test.ts`

Expected: PASS.

**Step 3: Commit**
```bash
git add providers/cline/cline.ts tests/cline.test.ts
git commit -m "fix: persist cline toggle state"
```

**Verification:**
- [ ] Cline toggle persists
- [ ] Lifecycle hooks preserve selected mode
- [ ] Notifications match actual state

---

### Task 5: Full verification

**Files:**
- Modify: any touched files as needed

**Step 1: Run targeted regression suite**
Run: `npm test -- tests/toggle-state.test.ts tests/built-in-toggle.test.ts tests/cline.test.ts tests/kilo-toggle.test.ts`

**Step 2: Run full test suite**
Run: `npm test -- --run`

Expected: all tests passing.

**Step 3: Commit**
```bash
git add lib/toggle-state.ts lib/built-in-toggle.ts providers/cline/cline.ts config.ts tests/
git commit -m "fix: make provider toggles persist correctly"
```

**Verification:**
- [ ] Targeted tests pass
- [ ] Full test suite passes
- [ ] No regressions in existing toggle behavior

---

## Execution

Implement with TDD:
1. Write the failing regression tests first
2. Run them and confirm failure
3. Implement minimal helper and integrations
4. Re-run targeted tests
5. Re-run full suite
