# Contributing to pi-free

Thanks for wanting to contribute! This guide covers how to add a new provider — the most common and valuable contribution.

---

## What makes a good provider?

pi-free is about **unlocking free and low-cost models** for Pi users. Prioritize:

1. **Free-tier providers** — models that cost $0 to use (even with limits)
2. **Trial-credit providers** — one-time free credits on signup (no credit card)
3. **Freemium providers** — free tier with rate limits, paid after
4. **Paid providers** — only if they offer something unique not available elsewhere

**Avoid:** Providers that duplicate models already available through existing providers (e.g., another OpenAI-compatible gateway that only offers GPT-4o).

---

## Quick Start: Adding a New Provider

### 1. Add provider constants

In [`constants.ts`](constants.ts), add a provider ID and base URL:

```typescript
// Provider names (near top)
export const PROVIDER_MYPROVIDER = "myprovider";

// Add to ALL_UNIQUE_PROVIDERS array
export const ALL_UNIQUE_PROVIDERS = [
    // ... existing providers
    PROVIDER_MYPROVIDER,
];

// Base URLs
export const BASE_URL_MYPROVIDER = "https://api.myprovider.com/v1";
```

### 2. Add config support

In [`config.ts`](config.ts):

- Add the API key field to `PiFreeConfig` interface
- Add the getter function (env var + file resolution)
- Add to `CONFIG_TEMPLATE` so first-run users see it

```typescript
interface PiFreeConfig {
    // ... existing fields
    myprovider_api_key?: string;
}

// Add getter (uses resolve() helper)
export function getMyproviderApiKey(): string | undefined {
    return resolve("MYPROVIDER_API_KEY", config.myprovider_api_key);
}

// Add to CONFIG_TEMPLATE
const CONFIG_TEMPLATE = {
    // ... existing keys
    myprovider_api_key: undefined,
};
```

### 3. Create the provider file

Create `providers/myprovider/myprovider.ts` following this pattern:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createLogger } from "../../lib/logger.ts";
import {
    isFreeModel,
    registerWithGlobalToggle,
} from "../../lib/registry.ts";
import { createReRegister, setupProvider, enhanceWithCI } from "../../provider-helper.ts";
import { PROVIDER_MYPROVIDER, BASE_URL_MYPROVIDER } from "../../constants.ts";
import { getMyproviderApiKey } from "../../config.ts";

const _logger = createLogger("myprovider");

// --- Model fetching ---

interface MyProviderModel {
    id: string;
    name: string;
    // ... provider-specific fields
}

async function fetchMyProviderModels(
    apiKey: string,
): Promise<Array<{ id: string; name: string; cost: Record<string, number> }>> {
    const response = await fetch(`${BASE_URL_MYPROVIDER}/models`, {
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
    });

    if (!response.ok) return [];

    const data = (await response.json()) as { data: MyProviderModel[] };
    return data.data.map((m) => ({
        id: m.id,
        name: m.name,
        cost: { input: 0, output: 0 }, // adjust if pricing is available
    }));
}

// --- Provider registration ---

export default async function myproviderProvider(pi: ExtensionAPI) {
    const apiKey = getMyproviderApiKey();

    if (!apiKey) {
        _logger.info(
            "[myprovider] Skipping — MYPROVIDER_API_KEY not set.",
        );
        return;
    }

    // Fetch models
    const allModels = await fetchMyProviderModels(apiKey);

    if (allModels.length === 0) {
        _logger.warn("[myprovider] No models available");
        return;
    }

    // Detect free models
    const freeModels = allModels.filter((m) =>
        isFreeModel({ ...m, provider: PROVIDER_MYPROVIDER }, allModels),
    );
    const stored = { free: freeModels, all: allModels };

    _logger.info(
        `[myprovider] Registered ${allModels.length} models (${freeModels.length} free)`,
    );

    // Create re-register function (used by toggles)
    const reRegister = createReRegister(pi, {
        providerId: PROVIDER_MYPROVIDER,
        baseUrl: BASE_URL_MYPROVIDER,
        apiKey,
    });

    // Register with global toggle system
    registerWithGlobalToggle(PROVIDER_MYPROVIDER, stored, reRegister, true);

    // Setup provider with toggle command
    setupProvider(
        pi,
        {
            providerId: PROVIDER_MYPROVIDER,
            initialShowPaid: false, // true if provider is trial-credit or paid
            reRegister: (models, newStored) => {
                if (newStored) {
                    stored.free = newStored.free;
                    stored.all = newStored.all;
                }
                reRegister(enhanceWithCI(models));
            },
        },
        stored,
    );

    // Initial registration
    reRegister(enhanceWithCI(freeModels));

    // Refresh models on session start
    pi.on("session_start", async () => {
        const refreshed = await fetchMyProviderModels(apiKey);
        if (refreshed.length > 0) {
            const refreshedFree = refreshed.filter((m) =>
                isFreeModel({ ...m, provider: PROVIDER_MYPROVIDER }, refreshed),
            );
            stored.free = refreshedFree;
            stored.all = refreshed;
            reRegister(enhanceWithCI(refreshedFree));
        }
    });
}
```

### 4. Register in index.ts

In [`index.ts`](index.ts):

```typescript
// Add import
import myprovider from "./providers/myprovider/myprovider.ts";

// Add to UNIQUE_PROVIDERS array
const UNIQUE_PROVIDERS = [
    // ... existing providers
    myprovider,
];
```

### 5. Update README.md

Add your provider to the appropriate section in [`README.md`](README.md):

- List it under the correct category (✅ Free, 🔄 Freemium, 💳 Paid, 🔧 Dynamic)
- Add setup instructions if it needs an API key
- Add the `/toggle-{provider}` command to the commands table

---

## Provider Categories

| Category | Description | `initialShowPaid` |
|---|---|---|
| ✅ **Free** | Models cost $0, no payment required | `false` |
| 🔄 **Freemium** | Free tier with limits, paid after | `false` |
| 💳 **Paid / Trial** | Requires credits or payment | `true` |
| 🔧 **Dynamic** | Fetched only when API key configured | `true` |

---

## Non-OpenAI-Compatible Providers

Most providers use OpenAI-compatible APIs. If your provider uses a different protocol (custom headers, non-standard streaming, etc.), you'll need a custom `streamSimple` handler.

**Reference:** The [qoder provider](providers/qoder/) is the most complete example of a non-OpenAI-compatible provider. It implements:

- Custom cryptographic auth headers ([`cosy.ts`](providers/qoder/cosy.ts))
- Custom streaming handler ([`stream.ts`](providers/qoder/stream.ts))
- OAuth device flow authentication ([`auth.ts`](providers/qoder/auth.ts))
- Message format transformation ([`transform.ts`](providers/qoder/transform.ts))
- Model fetching from proprietary API ([`models.ts`](providers/qoder/models.ts))

For simpler custom protocols, look at the [cline provider](providers/cline/) which adds message reshaping without full custom streaming.

---

## Helper Functions

The following utilities are available and should be used instead of reimplementing:

| Helper | Location | Purpose |
|---|---|---|
| `isFreeModel()` | `lib/registry.ts` | Detect free models (adaptive pricing/name detection) |
| `registerWithGlobalToggle()` | `lib/registry.ts` | Register provider with free/all toggle system |
| `createReRegister()` | `provider-helper.ts` | Create re-register function for toggles |
| `setupProvider()` | `provider-helper.ts` | Register provider + toggle command in one call |
| `enhanceWithCI()` | `provider-helper.ts` | Append Coding Index benchmark scores to model names |
| `createLogger()` | `lib/logger.ts` | Structured logging (console + file) |
| `fetchWithTimeout()` | `lib/util.ts` | Fetch with configurable timeout |
| `createProviderProbe()` | `lib/provider-probe.ts` | Model availability probing + auto-hide |
| `wrapSessionStartHandler()` | `lib/session-start-metrics.ts` | Wrap handlers with session start metrics |

---

## Code Quality Requirements

All new providers must pass the CI checks:

1. **TypeScript** — no type errors (`npm run lint`)
2. **Tests** — existing tests still pass (`npm run test:run`)
3. **SonarCloud** — Cognitive Complexity ≤ 15 per function, no security violations
4. **CodeQL** — no security alerts (protocol-mandatory crypto must be documented with comments)

### Cognitive Complexity

SonarCloud requires cognitive complexity ≤ 15 per function. Keep functions small:

- Extract SSE/delta processing into separate functions
- Extract request building into helpers
- Extract setup/initialization into separate functions
- Use early returns instead of deep nesting

### Security

If your provider requires non-standard cryptographic primitives (MD5, AES-CBC with unusual IV, etc.):

1. Document **why** with inline comments referencing the protocol source
2. Example: `// sonar-security: MD5 is protocol-mandatory for COSY signature`

---

## Testing

Add tests for any provider-specific logic:

```typescript
// tests/myprovider.test.ts
import { describe, it, expect, vi } from "vitest";

describe("myprovider", () => {
    it("detects free models correctly", () => {
        // ...
    });
});
```

Run tests locally:

```bash
npm test          # watch mode
npm run test:run  # single run
```

---

## Development Workflow

```bash
# Clone and setup
git clone https://github.com/apmantza/pi-free.git
cd pi-free
npm install

# Develop on a feature branch
git checkout -b feat/my-provider

# Test locally
npm run lint
npm run test:run

# Commit and push
git add -A
git commit -m "feat: add myprovider with free models"
git push origin feat/my-provider

# Open PR against master
```

---

## Questions?

- Check existing providers in [`providers/`](providers/) for reference
- Read the [AGENTS.md](AGENTS.md) for architecture details
- [Open an issue](https://github.com/apmantza/pi-free/issues) if you need help
