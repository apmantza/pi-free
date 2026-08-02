# Opportunities

> Findings from reviewing the latest Pi releases against the pi-free architecture.
> Tracks upstream APIs that originally overlapped with code pi-free shipped by hand.
> This is historical context: most recommendations below were completed in PRs
> #354–#362. For current architecture, see [`agents.md`](../agents.md) and
> [`docs/roadmap.md`](roadmap.md).

---

## Pi 0.81.0 Highlights

Pi 0.81.0 (released 2026-07-21) introduces two first-class APIs that map almost
1:1 onto problems pi-free solves with its own machinery:

1. **Full provider registration via `createProvider`** — `pi.registerProvider()`
   now accepts a complete `pi-ai` `Provider` object built with
   `createProvider({...})`. Provides native `auth` (apiKey + oauth), per-credential
   `filterModels`, sync `getModels`, and custom `stream` / `streamSimple`.
   The legacy `registerProvider("id", { baseUrl, apiKey, api, models, oauth })`
   form remains supported and is documented as "legacy config options".
2. **`refreshModels(context)` callback** — replaces hand-rolled disk caching. Pi
   calls it during model refresh, passes a `RefreshModelsContext`
   (`credential`, `store`, `allowNetwork`, `force`, `signal`), and persists
   catalogs through `context.store` into `~/.pi/agent/models-store.json`.

Pi 0.80.x laid the groundwork (`ModelRuntime` unified facade, 4-hour refresh
throttle, `pi update --models`, `getProviderAuth()`, `provider-scoped env`
resolution). 0.81.0 is the release that exposes the public extension surface.

---

## What's Worth Adopting

### A. `refreshModels` for native providers — completed for the migrated catalog

Kilo, Cline, Qoder, and the API-key providers that formerly hit a `models`
endpoint on startup now use Pi's native `refreshModels` lifecycle. Qoder's
compatibility cache is limited to optional stream metadata; Ollama retains the
provider cache only for `/api/show` capability reuse and its compatibility
refresh command. Pi 0.81 supplies the primitives
that enabled the migration:

| | pi-free today | Pi 0.81 `refreshModels` |
| --- | --- | --- |
| Disk cache | `~/.pi/provider-cache.json` (hand-rolled JSON store) | `~/.pi/agent/models-store.json` (built-in, per-provider) |
| Network gating | Legacy providers may fetch during startup if cache is stale | Pi refreshes native providers only when configured — gated, throttled, abortable |
| Throttling | None — every cold cache = a network call | Built-in 4-hour throttle (added in 0.80.8), plus `force` flag for `pi update --models` |
| OAuth refresh | Manual in `kilo-auth.ts` / `cline-auth.ts` | Handled inside `Models.refresh()` — credential is refreshed before `refreshModels` is called |
| Background refresh | None — startup is sequential | `/model` refreshes in the background with partial results streaming into the open selector |
| `pi --list-models` | Works only because the async factory awaits the fetch | Native — `createProvider`'s factory is awaited, so cached/fresh models are available immediately |

`RefreshModelsContext` shape (from `@earendil-works/pi-ai`):

```typescript
interface RefreshModelsContext {
    credential?: Credential;          // resolved + refreshed OAuth
    store: ProviderModelsStore;       // { read, write, delete } — auto-persisted
    allowNetwork: boolean;            // false during offline init
    force?: boolean;                  // bypass freshness check (pi update --models)
    signal?: AbortSignal;
}
```

### B. `filterModels` for the global free filter — completed for native providers

Native providers now keep the complete catalog as the source of truth and use
`filterModels` plus same-object re-registration for invalidation. Pi-built-in
integrations retain their specialized catalog/filter paths.
`Models.getAvailable()` runs native `filterModels` after confirming auth, so the
free/all policy composes with credential-aware visibility.

### C. Migrate Kilo/Cline OAuth to the new `createProvider` `auth` shape — completed

Kilo, Cline, and Qoder now use native `ProviderAuth` implementations. Pi
persists their credentials in `~/.pi/agent/auth.json` and owns refresh
coordination. Cline's legacy callback-server flow and Qoder's OAuth/PAT flow
are adapted to native `AuthInteraction`.

### D. `refreshModels` for Ollama Cloud — completed with a compatibility exception

Ollama Cloud now uses native `refreshModels` and Pi's models store for its
catalog. It intentionally keeps `~/.pi/provider-cache.json` for `/api/show`
capability reuse and `/ollama-cloud-refresh`; this is not a second catalog
freshness policy.

### E. Cache-friendly tool loading for Kilo's XML-leak problem

The `before_agent_start` / `before_provider_headers` hooks (added in 0.80.5)
plus cache-friendly dynamic tool loading (0.80.7) let extensions strip or
replace tools per request. `detectXmlToolLeak` in `providers/kilo/kilo.ts`
currently runs *after* the leak. Detecting the model at `before_provider_headers`
and dropping native tools for known-leaky models would prevent the leak
instead of detecting and re-prompting. Quality-of-life improvement, not a
refactor.

---

## Things That DON'T Need Changes (verified)

- `ProviderModelConfig` shape is unchanged — the `enhanceWithCI` decorator
  still works as-is.
- All existing `pi.registerProvider("name", { ...models })` calls keep working
  through the legacy config form.
- `ctx.modelRegistry` / `ctx.model` events (`model_select`, `session_start`,
  `turn_end`) are unchanged.
- Qoder's OAuth/PAT and custom stream now run behind the native provider surface;
  their protocol-specific adapters remain Qoder-owned.

---

## Watch Items

- **`OAuthCredential` discriminator** — `auth.json` switched from
  `type: "api-key"` to `type: "api_key"` in 0.80.2. The existing
  `isOAuthCredential()` check distinguishes OAuth (`refresh`/`access`/`expires`)
  from api-key (`key`/`env`) and should be unaffected, but anywhere pi-free
  reads `auth.json` directly should handle both shapes.
- **Throttling collision** — 0.80.8 introduced a once-per-4-hour throttle on
  configured-provider refresh. Combining it with the existing 1-hour TTL in
  `lib/provider-cache.ts` would double-throttle. Pick one. Pi's is the right
  choice.
- **`/login` discoverability** — built-in providers appear in `/login`
  autocomplete. Extensions still appear but only if their `oauth` config is
  registered through the new path. Legacy `oauth:` config still works for
  `/login <provider-id>` but is less discoverable.

---

## Remaining opportunities

- Qoder native migration remains a separate protocol/auth project.
- Provider-specific free-filter toggles for Pi-built-in catalogs can be added
  only when their pricing metadata supports safe Route A/B classification.
- The proposed compiled packaging work is documented in
  [`build-strategy.md`](build-strategy.md); it should follow an
  import-inclusive startup benchmark rather than being assumed to help.
