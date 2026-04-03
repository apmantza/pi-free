# Package.json & Metadata Fix Plan

> **For Pi:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Fix package.json metadata to match the actual extension purpose and follow Pi SDK best practices

**Scope:** Only package.json changes - no code refactoring

**Tech Stack:** JSON editing, npm package metadata

---

## Current Issues

| Field | Current | Problem |
|-------|---------|---------|
| `name` | `pi-free-providers` | Long, unofficial naming |
| `description` | Mentions specific model counts, includes Fireworks details | Outdated, too specific |
| `keywords` | `["pi-package"]` | Insufficient for discovery |
| `repository.url` | `your-username/pi-free-providers` | Wrong URL |
| `author` | missing | Required for npm |
| `homepage` | missing | Needed for package gallery |
| `bugs` | missing | Needed for issue tracking |

---

## Task 1: Update package.json

**Files:**
- Modify: `package.json`

**Step 1: Update name and description**

```json
{
  "name": "pi-free",
  "description": "AIO Free AI models for Pi",
  "version": "1.0.0",
```

**Step 2: Add keywords for discoverability**

```json
  "keywords": [
    "pi-package",
    "pi-extension",
    "free-models",
    "ai-providers",
    "openrouter",
    "nvidia-nim",
    "opencode",
    "kilo",
    "cline",
    "ollama",
    "mistral",
    "fireworks"
  ],
```

**Step 3: Fix repository URL**

```json
  "repository": {
    "type": "git",
    "url": "git+https://github.com/apmantza/pi-free.git"
  },
```

**Step 4: Add missing metadata fields**

```json
  "author": "",
  "license": "MIT",
  "homepage": "https://github.com/apmantza/pi-free#readme",
  "bugs": {
    "url": "https://github.com/apmantza/pi-free/issues"
  },
```

**Step 5: Keep existing pi.extensions (Fireworks stays)**

```json
  "pi": {
    "extensions": [
      "./providers/kilo.ts",
      "./providers/zen.ts",
      "./providers/openrouter.ts",
      "./providers/nvidia.ts",
      "./providers/cline.ts",
      "./providers/fireworks.ts",
      "./providers/mistral.ts",
      "./providers/ollama.ts"
    ]
  }
```

**Step 6: Validate JSON**

Run: `cat package.json | npx jsonlint` or just `npm test` to ensure it parses

Expected: No JSON parse errors

**Step 7: Commit**

```bash
git add package.json
git commit -m "chore: update package.json metadata

- Change name to 'pi-free'
- Update description to 'AIO Free AI models for Pi'
- Add 11 keywords for discoverability
- Fix repository URL to apmantza/pi-free
- Add author, homepage, bugs fields
- Keep all 8 providers including Fireworks"
```

**Verification:**
- [ ] Name is `pi-free`
- [ ] Description is `AIO Free AI models for Pi`
- [ ] Keywords include all provider names
- [ ] Repository URL is correct
- [ ] All 8 providers still in pi.extensions
- [ ] JSON is valid
- [ ] Commit made

---

## Post-Implementation Notes

**Not in scope (per user request):**
- Code refactoring
- Removing Fireworks
- Adding error boundaries
- Version checks

**Future considerations (not part of this plan):**
- Add gallery metadata (video/image) when ready
- Consider adding `engines` field for Node version requirements
- Consider adding `peerDependencies` if Pi SDK version matters

---

**Plan complete. Ready for execution.**
