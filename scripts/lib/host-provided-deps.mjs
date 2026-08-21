/**
 * Single source of truth for the peers a production (`--omit=dev`) install
 * must NOT vendor. #447.
 *
 * pi-free declares three peerDependencies: `@earendil-works/pi-ai`,
 * `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`. They are not
 * interchangeable:
 *
 * - `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` are used
 *   ONLY as `import type` (pi-coding-agent) or not at all (pi-tui) — grep the
 *   whole tree, neither appears in a single value import. `tsc` erases
 *   `import type` regardless of whether the module resolves
 *   (`tsconfig.build.json` also sets `noCheck`, so even module-resolution
 *   errors don't block the build), and the compiled `dist/*.js` never
 *   references either name. Both are safe to mark
 *   `peerDependenciesMeta.optional`, verified by building and running the
 *   full test suite (668/668) with both physically absent from
 *   node_modules — only pi-coding-agent needs a pinned devDependency, to keep
 *   `tsc --noEmit` (the separate, non-noCheck "Lint & type-check" job) fully
 *   type-checked against its real types; pi-tui needs neither.
 *
 * - `@earendil-works/pi-ai` is a real, static VALUE import in ~30 provider
 *   files (`import { createModels } from "@earendil-works/pi-ai"`, etc.), so
 *   it MUST stay a required (non-optional) peer: marking it optional was
 *   tried as part of this same investigation and immediately broke the full
 *   `vitest run` suite (4 test files failed with "Cannot find package
 *   '@earendil-works/pi-ai'"). `typebox` is pi-ai's own regular dependency
 *   (not pi-free's), so it is vendored as a side effect of keeping pi-ai
 *   required — pi-free's package.json has no lever to stop that without
 *   first migrating every plain top-level pi-ai import through
 *   `lib/pi-ai-loader.ts`'s disk-fallback resolver, the way `lib/lazy-compat.ts`
 *   already does. That migration is tracked separately; see the #447 PR body.
 *
 * A prior attempt (328c0cd1) moved all three peers to devDependencies
 * together and broke the "Production source install" CI job. That
 * regression came from pi-ai's absence (a real load-bearing dependency), not
 * from pi-coding-agent or pi-tui — this file documents the narrower, verified
 * split so the two are not conflated again.
 */

/** Optional peers: never vendored by `npm install --omit=dev`. */
export const OPTIONAL_HOST_PROVIDED_PACKAGES = Object.freeze([
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
]);

/**
 * Required peers: intentionally still vendored by `npm install --omit=dev`,
 * because pi-free's own runtime code value-imports them directly and cannot
 * yet tolerate their absence. A production install check that finds these
 * MISSING should fail just as loudly as one that finds the optional peers
 * present — that shape means the peer contract broke, not that #447 improved.
 */
export const REQUIRED_HOST_PROVIDED_PACKAGES = Object.freeze([
	"@earendil-works/pi-ai",
]);
