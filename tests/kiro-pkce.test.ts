/**
 * Unit tests for `providers/kiro/kiro-pkce.ts`.
 *
 * Per design doc Phase C test plan: PKCE `code_verifier` is 43-128 chars
 * base64url, `code_challenge` is SHA256(verifier) base64url, `state` is
 * uuid v4. The `code_challenge` MUST be deterministic for a given
 * `code_verifier` (RFC 7636 §4.2) — verified here.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  computeCodeChallenge,
  generateCodeVerifier,
  generatePkce,
} from "../providers/kiro/kiro-pkce.ts";

describe("kiro-pkce — code_verifier", () => {
  it("is 43-128 chars of base64url (RFC 7636 §4.1)", () => {
    for (let i = 0; i < 50; i++) {
      const verifier = generateCodeVerifier();
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
      // base64url alphabet: A-Z, a-z, 0-9, '-', '_'. No padding.
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("is unique across calls (512 bits of entropy)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const verifier = generateCodeVerifier();
      expect(seen.has(verifier)).toBe(false);
      seen.add(verifier);
    }
    expect(seen.size).toBe(1000);
  });
});

describe("kiro-pkce — code_challenge (RFC 7636 §4.2 S256)", () => {
  it("is base64url(SHA256(code_verifier))", () => {
    // Known-answer test: a fixed verifier must produce a fixed challenge.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expected = createHash("sha256")
      .update(verifier, "utf8")
      .digest("base64url");
    expect(computeCodeChallenge(verifier)).toBe(expected);
  });

  it("is 43 chars of base64url (SHA-256 → 32 bytes → 43 chars)", () => {
    const verifier = generateCodeVerifier();
    const challenge = computeCodeChallenge(verifier);
    expect(challenge.length).toBe(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is deterministic for a given verifier", () => {
    const verifier = "abcdef1234567890abcdef1234567890abcdef12345678";
    expect(computeCodeChallenge(verifier)).toBe(computeCodeChallenge(verifier));
  });

  it("differs for different verifiers (collision resistance)", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(computeCodeChallenge(a)).not.toBe(computeCodeChallenge(b));
  });
});

describe("kiro-pkce — state", () => {
  it("generatePkce returns a UUID v4-shaped state", () => {
    const { state } = generatePkce();
    // UUID v4: 8-4-4-4-12 hex with version nibble 4 and variant nibble 8/9/a/b
    expect(state).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("generatePkce returns unique state across calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const { state } = generatePkce();
      expect(seen.has(state)).toBe(false);
      seen.add(state);
    }
    expect(seen.size).toBe(1000);
  });
});

describe("kiro-pkce — generatePkce integration", () => {
  it("returns a consistent (codeVerifier, codeChallenge, state) triple", () => {
    const pair = generatePkce();
    expect(pair.codeChallenge).toBe(computeCodeChallenge(pair.codeVerifier));
    expect(pair.state).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("two calls produce independent triples (no shared state)", () => {
    const a = generatePkce();
    const b = generatePkce();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.codeChallenge).not.toBe(b.codeChallenge);
    expect(a.state).not.toBe(b.state);
  });
});
