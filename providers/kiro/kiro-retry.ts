/**
 * Kiro-specific error classification and retry helpers.
 *
 * Ported from the reference implementation's retry.ts.
 * Keeps provider-local retry logic limited to auth refresh and stream quirks.
 */

export const FIRST_TOKEN_TIMEOUT = 90_000;

export const KIRO_REASON_CODES = Object.freeze({
  CONTENT_LENGTH_EXCEEDS_THRESHOLD: "CONTENT_LENGTH_EXCEEDS_THRESHOLD",
  INPUT_TOO_LONG: "Input is too long",
  MONTHLY_REQUEST_COUNT: "MONTHLY_REQUEST_COUNT",
  INSUFFICIENT_MODEL_CAPACITY: "INSUFFICIENT_MODEL_CAPACITY",
  REQUEST_BODY_INVALID: "REQUEST_BODY_INVALID",
} as const);

export type KiroReasonCode = (typeof KIRO_REASON_CODES)[keyof typeof KIRO_REASON_CODES];

export const TOO_BIG_PATTERNS: readonly string[] = Object.freeze([
  KIRO_REASON_CODES.CONTENT_LENGTH_EXCEEDS_THRESHOLD,
  KIRO_REASON_CODES.INPUT_TOO_LONG,
]);
export const NON_RETRYABLE_BODY_PATTERNS: readonly string[] = Object.freeze([
  KIRO_REASON_CODES.MONTHLY_REQUEST_COUNT,
]);
export const CAPACITY_PATTERN = KIRO_REASON_CODES.INSUFFICIENT_MODEL_CAPACITY;
export const CAPACITY_MAX_RETRIES = 3;
export const CAPACITY_BASE_DELAY_MS = 5_000;

export const capacityRetryConfig = {
  maxRetries: CAPACITY_MAX_RETRIES,
  baseDelayMs: CAPACITY_BASE_DELAY_MS,
};

export function exponentialBackoff(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(baseMs * 2 ** attempt, maxMs);
}

export const MAX_RETRY_DELAY = 10_000;

export function isTooBigError(status: number, errorText: string): boolean {
  return status === 413 || (status === 400 && TOO_BIG_PATTERNS.some((p) => errorText.includes(p)));
}

export function isNonRetryableBodyError(errorText: string): boolean {
  return NON_RETRYABLE_BODY_PATTERNS.some((p) => errorText.includes(p));
}

export function isCapacityError(errorText: string): boolean {
  return errorText.includes(CAPACITY_PATTERN);
}