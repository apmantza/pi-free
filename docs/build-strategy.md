# Proposed compiled packaging strategy

This document records a **proposed separate packaging effort** for pi-free. It is not an implementation plan for the current release: the current package still loads `index.ts`, and no `dist` build is shipped.

## Recommended output

Ship plain, pinned TypeScript compiler output as JavaScript in `dist/`. An initial esbuild bundler is unnecessary: the runtime imports currently consist of Node built-ins and Pi peer packages. Keep `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, and `@earendil-works/pi-tui` external rather than bundling them. This keeps the extension aligned with the host Pi installation and avoids duplicating peer runtime code.

The compiler configuration should emit the source module graph without bundling it. Emitted relative imports must be rewritten from `.ts` to `.js` so Node can resolve the compiled graph. The build must also copy `provider-failover/benchmarks.json` beside its emitted code: benchmark loading uses `import.meta.url`, so the data file must preserve the expected relative layout in `dist/`.

Dynamic imports require explicit compatibility testing, especially the OpenCode paths and `opencode-session`. The compiled entry must retain their dynamic resolution behavior rather than assuming a bundler-specific module format. Target Node `>=20.0.0`, matching the package runtime requirement.

## Packaging and validation

- Add a `prepare` script so git installs compile the package before use.
- Add tarball and CI checks that verify the compiled entry exists, the expected JSON asset is present, and the published package can load the compiled entry.
- Validate from a clean clone, including installation through the supported package-install paths; do not rely only on a working tree with generated files.
- Preserve the existing source tests. Run them against source as they do today, and add focused compiled-entry/tarball checks rather than replacing the source suite.
- Measure startup with import-inclusive timing before adopting the build. The comparison must include loading the entry and its dependency graph, not only provider initialization; use the result to decide whether compilation improves the real startup path.

This strategy should be introduced as a deliberate packaging change in a later effort, with its generated output and release checks reviewed independently from provider behavior changes.
