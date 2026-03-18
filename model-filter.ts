/**
 * Shared model quality filter for OpenRouter-format model IDs.
 *
 * Used by Kilo, OpenRouter, and NVIDIA providers.
 * Removes small models and non-chat types (embed, speech, OCR, image-gen).
 *
 * Models where a parameter count can be determined must exceed minSizeB.
 * Unknown-size models (no B count in ID) pass through — they tend to be large.
 */

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
 * Returns true if the model is worth showing.
 * @param id      Model ID string (OpenRouter format)
 * @param minSizeB Minimum parameter count in billions (default 30)
 */
export function isUsableModel(id: string, minSizeB = 30): boolean {
  if (SKIP_PATTERNS.some((p) => p.test(id))) return false;
  const m = id.match(/[_-](?:e)?(\d+(?:\.\d+)?)b[_:-]/i);
  if (m && parseFloat(m[1]) <= minSizeB) return false;
  return true;
}
