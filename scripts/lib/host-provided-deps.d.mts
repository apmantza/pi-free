// Type declarations for host-provided-deps.mjs (untyped .mjs imported from a
// .ts test file). #447.

export const OPTIONAL_HOST_PROVIDED_PACKAGES: readonly string[];

export const REQUIRED_HOST_PROVIDED_PACKAGES: readonly string[];

// Vendored-but-tolerated subset of the optional peers (documented reason in
// the .mjs). The install-shape check warns instead of failing on these.
export const TOLERATED_VENDORED_PACKAGES: readonly string[];
