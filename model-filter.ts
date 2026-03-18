/**
 * Shared model quality filter for OpenRouter-format model IDs.
 *
 * Used by both Kilo and OpenRouter providers (same ID naming convention).
 * Removes small models and non-chat types (embed, speech, OCR, image-gen).
 *
 * Threshold: models where a parameter count can be determined must be > MIN_SIZE_B.
 * Unknown-size models (no B count in ID) pass through — they tend to be large.
 */

const MIN_SIZE_B = 30;

const SKIP_PATTERNS = [
  /gemma-3n/i,    // e2b / e4b efficient tiny variants
  /-mini:/i,      // explicitly mini (e.g. trinity-mini:free)
  /-a\db$/i,      // MoE with tiny active params (e.g. nemotron-30b-a3b)
  /embed/i,
  /whisper/i,
  /\bocr\b/i,
  /flux/i,
  /parakeet/i,
  /retriev/i,
  /cosmos/i,
  /\/phi-/i,      // phi family (all small in practice)
];

/**
 * Returns true if the model is worth showing — large enough and a chat model.
 */
export function isUsableModel(id: string): boolean {
  if (SKIP_PATTERNS.some((p) => p.test(id))) return false;
  const m = id.match(/[_-](?:e)?(\d+(?:\.\d+)?)b[_:-]/i);
  if (m && parseFloat(m[1]) <= MIN_SIZE_B) return false;
  return true;
}
