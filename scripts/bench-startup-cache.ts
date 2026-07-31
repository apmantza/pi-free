import { readFileSync, writeFileSync } from "node:fs";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Copy a provider cache while refreshing timestamps for a warm-start benchmark.
 *
 * The benchmark intentionally fails with a path-specific error when the source
 * cache is malformed instead of hiding the parse or shape error behind a raw
 * JSON exception or a later provider failure.
 */
export function freshenProviderCache(src: string, dest: string): number {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(src, "utf-8")) as unknown;
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to parse provider cache ${src}: ${detail}`, {
			cause: error,
		});
	}

	if (!isRecord(raw) || !isRecord(raw.providers)) {
		throw new Error(
			`Invalid provider cache ${src}: expected an object with a providers object`,
		);
	}

	const now = new Date().toISOString();
	let count = 0;
	for (const [providerId, value] of Object.entries(raw.providers)) {
		if (!isRecord(value)) {
			throw new Error(
				`Invalid provider cache ${src}: entry ${JSON.stringify(providerId)} must be an object`,
			);
		}
		value.fetchedAt = now;
		count++;
	}

	writeFileSync(dest, JSON.stringify(raw));
	return count;
}
