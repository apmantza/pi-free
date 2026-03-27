# pi-free-providers Refactor Ideas

Keep track of improvements to tackle later.

---

## Type Safety

- **Cline message shaping** — The `cline.ts` message reshaping code uses many `any` casts (lines 58-87). Define local interfaces for the Cline message envelope shapes to get proper type checking.

- **Kilo OAuth callbacks** — `kilo.ts` line 26: `login: async (callbacks: any)` should be typed to the actual callback shape.

- **Kilo updateCredits** — `kilo.ts` line 61: `ctx: any` should use the proper context type from `ExtensionContext`.

---

## Code Duplication

- **ReRegister closure pattern** — `openrouter.ts` and `zen.ts` both define `let reRegisterFn` with nearly identical patterns. Could extract into `provider-helper.ts`.

- **Status label pattern** — Each provider does `ctx.ui.setStatus(...)` with a provider-specific label in `session_start`. Could add a `statusLabel` option to `ProviderSetupConfig`.

---

## Dead Code / Unused

- **CACHE_KEY constants** — `constants.ts` defines `CACHE_KEY_KILO_FREE`, `CACHE_KEY_OPENROUTER_ALL`, etc., but providers use string literals directly (e.g., `getCached<ProviderModelConfig>("openrouter-free")` in `openrouter.ts` line 23). Either use the constants or remove them.

---

## Logging

- **Add --verbose flag** — Some `console.log` statements in zen.ts/openrouter.ts were removed. If verbose logging is needed for debugging, add a `PI_FREE_VERBOSE` env var or flag to control them.

---

## Type Incompatibility

- **ProviderModelConfig cache mismatch** — `openrouter.ts` line 79 has a type error: the local `ProviderModelConfig` type has `cacheRead`/`cacheWrite` as `number | undefined`, but Pi's type expects `number`. Either update the local type or map undefined to 0.
