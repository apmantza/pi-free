# Contributing to pi-free

Thanks for contributing. This guide covers the provider patterns used by the current codebase.

## What makes a good provider?

Prioritize free tiers, trial credits, or a useful freemium offering. Avoid gateways that duplicate an existing Pi provider without adding a distinct capability.

## Provider architecture

New catalog-backed providers should use the native provider helpers in [`lib/native-provider.ts`](lib/native-provider.ts):

- assemble a Pi `Provider` object and register it with `pi.registerProvider(provider)`;
- restore models from Pi's `RefreshModelsContext.store` before attempting network access;
- honor `allowNetwork` and `signal`;
- retain the previous catalog when a fetch is empty or fails;
- persist successful catalogs through the supplied store; and
- use `filterModels` plus `registerWithGlobalToggle` for free/all filtering.

Pi owns native refresh throttling and credentials. Do not add a second freshness gate or a startup catalog fetch in the extension factory. If a `session_start` task is intentionally detached, use `trackDetachedSessionStart()` so `/free-startup` still reports its completion and failure without making the event wait.

Qoder is intentionally still legacy and is not a migration template. Its static catalog, dedicated cache, authentication, and custom stream integration live under [`providers/qoder/`](providers/qoder/).

## Adding a provider

### 1. Add constants

In [`constants.ts`](constants.ts), add the provider ID and base URL when appropriate. Use the existing provider constants rather than repeating string literals.

### 2. Add configuration

In [`config.ts`](config.ts), add the config field, template entry, API-key getter, and provider `show_paid` metadata. Keep environment variables ahead of `~/.pi/free.json`, and document unusual names such as `DEEPINFRA_TOKEN`.

Do not add keys for Pi-built-in providers. Pi owns those credentials.

### 3. Implement the provider

For an OpenAI-compatible native provider, use `registerNativeOpenAIProvider` with:

- a `ProviderAuth` implementation;
- `fetchModels(apiKey, signal)`;
- `getShowPaid()`;
- an appropriate initial paid/trial policy; and
- any provider-specific terms or probe support.

For a custom wire protocol, implement both native stream entry points when the public `Provider` contract requires them. Cline is the native custom-API example. OpenModel is the native Anthropic Messages example.

### 4. Register it

Import the provider in [`index.ts`](index.ts) and add it to `UNIQUE_PROVIDERS`. Providers that are built into Pi should instead be wrapped only through the built-in toggle or dynamic-built-in mechanisms when there is a documented reason.

### 5. Update documentation

Update [`README.md`](README.md), [`docs/providers.md`](docs/providers.md), and [`docs/commands.md`](docs/commands.md). Document the exact environment variable, config key, authentication flow, toggle, probe, and storage behavior. Do not publish volatile model counts.

## Provider categories

| Category | Meaning |
| --- | --- |
| **Free/free-tier** | Free models or a free/basic plan. |
| **Freemium** | Free quota alongside paid usage. |
| **Paid/trial** | Credits, payment, or a trial balance is required. |
| **Dynamic/built-in** | Catalog discovered from a Pi provider or endpoint at runtime. |

## Non-standard protocols

Most providers use OpenAI-compatible APIs. For custom protocols:

- **Cline** uses the native `cline-xml-tools` API and XML tool bridge.
- **OpenModel** uses the native Anthropic Messages API.
- **Qoder** is the intentionally legacy reference for proprietary authentication and custom streaming; do not migrate it as part of an unrelated provider change.

## Shared helpers

| Helper | Location | Purpose |
| --- | --- | --- |
| `isFreeModel()` | `lib/registry.ts` | Adaptive free-model detection. |
| `registerWithGlobalToggle()` | `lib/registry.ts` | Global free/all coordination. |
| `registerNativeOpenAIProvider()` | `lib/native-provider.ts` | Native OpenAI-compatible provider lifecycle. |
| `registerNativeProviderToggle()` | `lib/native-provider.ts` | Standard native toggle command. |
| `enhanceWithCI()` | `provider-helper.ts` | Add available Coding Index scores. |
| `createLogger()` | `lib/logger.ts` | Structured console/file logging. |
| `createProviderProbe()` | `lib/provider-probe.ts` | Availability probing and auto-hide. |
| `wrapSessionStartHandler()` | `lib/session-start-metrics.ts` | Monotonic session-start handler timing. |
| `trackDetachedSessionStart()` | `lib/session-start-metrics.ts` | Measure intentionally non-blocking work after a handler returns. |

## Code quality and tests

Run the same checks as CI:

```bash
npm run lint
npm run test:run
```

Add tests for provider-specific auth, catalog conversion, filtering, refresh, and custom streaming behavior. Keep functions small enough for the repository's complexity checks and document protocol-mandatory cryptography where applicable.

## Development workflow

```bash
git clone https://github.com/apmantza/pi-free.git
cd pi-free
npm install
git checkout -b feat/my-provider
npm run lint
npm run test:run
git add -A
git commit -m "feat: add myprovider"
git push origin feat/my-provider
```

Open a pull request against `master`.

## Release documentation

Keep the `[Unreleased]` section in [`CHANGELOG.md`](CHANGELOG.md) organized under `Added`, `Changed`, `Fixed`, and `Removed`. Use concise bullets beginning with a bold area/title and include PR or issue links where useful. At release time, move those bullets into a dated semver heading; do not create or push a tag manually because CI does that.

## Questions?

- Inspect existing providers under [`providers/`](providers/).
- Read [`agents.md`](agents.md) for repository architecture and conventions.
- [Open an issue](https://github.com/apmantza/pi-free/issues) for questions or provider problems.
