/**
 * Qoder WAF bypass body encoding.
 *
 * Qoder's API uses a custom base64 variant with a scrambled alphabet and
 * rearranged segments to evade WAF detection. This is the same encoding
 * used by the official qodercli binary.
 *
 * The algorithm:
 *   1. Take the standard base64 of the input
 *   2. Rearrange segments: last N/3 chars + middle N-2N/3 chars + first N/3 chars
 *   3. Substitute each character through a custom alphabet
 *   4. Replace '=' padding with '$'
 */

const QODER_CUSTOM_ALPHABET =
	"_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!";
const QODER_STD_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Encode a body string or buffer using Qoder's custom WAF-bypass encoding.
 *
 * @param plaintext - String or Buffer to encode
 * @returns Encoded string ready for transmission
 */
export function qoderEncodeBody(plaintext: string | Buffer): string {
	const std = Buffer.isBuffer(plaintext)
		? plaintext.toString("base64")
		: Buffer.from(plaintext).toString("base64");
	const n = std.length;
	const a = Math.floor(n / 3);
	const rearranged = std.slice(n - a) + std.slice(a, n - a) + std.slice(0, a);
	let out = "";
	for (let i = 0; i < n; i++) {
		const c = rearranged[i];
		if (c === "=") {
			out += "$";
		} else {
			const idx = QODER_STD_ALPHABET.indexOf(c);
			if (idx >= 0) {
				out += QODER_CUSTOM_ALPHABET[idx];
			} else {
				out += c;
			}
		}
	}
	return out;
}
