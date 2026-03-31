/**
 * Widget formatting utilities
 */

export function formatTokens(n: number): string {
	if (n < 1000) return n.toString();
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	return `${(n / 1_000_000_000).toFixed(1)}B`;
}

export function formatCost(n: number): string {
	if (n < 0.01) return `$${n.toFixed(4)}`;
	if (n < 1) return `$${n.toFixed(3)}`;
	return `$${n.toFixed(2)}`;
}

export function relativeTime(isoDate: string): string {
	const diff = Date.now() - new Date(isoDate).getTime();
	const days = Math.floor(diff / 86_400_000);
	if (days === 0) return "today";
	if (days === 1) return "yesterday";
	if (days < 30) return `${days}d ago`;
	const months = Math.floor(days / 30);
	return `${months}mo ago`;
}
