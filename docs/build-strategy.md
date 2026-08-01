# Compiled packaging

Compiled packaging is implemented and is the published form of pi-free. The
working tree remains TypeScript-first for development and tests, while npm and
Pi load the plain Node ESM output in `dist/`.

## Build

`tsconfig.build.json` uses the pinned TypeScript compiler with `module` and
`moduleResolution` set to `NodeNext`. It emits the runtime graph rooted at
`index.ts` as ES2022 JavaScript, keeps peer imports external, and uses
`rewriteRelativeImportExtensions` so source `.ts` imports become `.js` imports.
The build also copies `provider-failover/benchmarks.json` to the matching
`dist/provider-failover/` path; the benchmark loader resolves it relative to
`import.meta.url`.

```sh
npm run build       # clean and emit dist/
npm run clean       # remove dist/
npm run lint        # type-check source
npm run test:run    # source-mode tests
npm run smoke:compiled
```

`prepare` runs the build for git/file installs and before npm packaging. The
published `pi.extensions` entry and `main` are both `./dist/index.js`. The
package `files` list publishes `dist/` plus user-facing documentation and the
relative-import checker; source TypeScript, tests, and development scripts are
not published. `dist/` is ignored and is intentionally not committed.

## Validation

Build and package checks are available with:

```sh
npm run build
npm run check
npm pack
node scripts/check-tarball.mjs ./pi-free-*.tgz
node scripts/smoke-compiled.mjs ./dist/index.js
```

The tarball checker verifies the compiled entry, benchmark JSON, package
metadata, safe contents, relative imports, and (when run after `npm ci`) loads
the extracted compiled entry with the local peer dependencies. CI also packs,
installs, checks, and loads the entry from the installed package on Linux,
macOS, and Windows. `npm publish --dry-run` runs the same build lifecycle.

Dynamic imports remain unbundled. In particular, the OpenCode and
`opencode-session` paths continue to use runtime specifier resolution, so the
compiled output must be tested with the host Pi peer packages available. The
build targets Node `>=20.0.0`; it does not bundle or install Pi peer packages.

## Startup comparison

The import-inclusive benchmark supports both modes:

```sh
npx tsx scripts/bench-startup.ts warm source
npm run build
npx tsx scripts/bench-startup.ts warm compiled
```

The `RESULT` line includes `entryKind`, `importMs`, `factoryMs`, and the
import-inclusive `totalMs`. `importMs` includes the `tsx` loader and module
graph in source mode, while compiled mode measures Node's native ESM loader;
provider initialization and the existing warm/cold network scenarios are kept
the same. The benchmark requires `dist/` for compiled mode and does not
exercise provider API calls beyond its existing mocked scenarios.
