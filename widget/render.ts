/**
 * Widget HTML rendering
 */

import type { ProviderRow } from "./data.ts";
import { formatCost, formatTokens, relativeTime } from "./format.ts";

export function renderWidgetHTML(rows: ProviderRow[]): string {
	let totalTokens = 0,
		totalReqs = 0,
		totalCost = 0;
	for (const r of rows) {
		totalTokens += r.totalTokensIn + r.totalTokensOut;
		totalReqs += r.totalRequests;
		totalCost += r.costEquivalent;
	}

	const summaryHTML =
		totalReqs > 0
			? `
  <div style="background: rgba(255,255,255,0.04); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px;">
    <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 500;">
      <span>Total free value</span>
      <span style="color: #48bb78;">${formatCost(totalCost)} saved</span>
    </div>
    <div style="font-size: 11px; color: #888; margin-top: 3px;">
      ${formatTokens(totalTokens)} tokens · ${totalReqs} requests
    </div>
  </div>`
			: "";

	const providerRows = rows.map((r) => renderProviderRow(r)).join("\n");

	return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, sans-serif;
    background: rgba(24, 24, 30, 0.95);
    color: #e0e0e0; padding: 14px 16px;
    min-height: 100vh; backdrop-filter: blur(20px);
  }
  .header { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; }
</style></head>
<body>
  <div class="header">Free Usage</div>
  ${summaryHTML}
  ${providerRows}
  <div style="font-size: 10px; color: #555; margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.05);">
    Each gateway has independent quotas — using multiple providers multiplies capacity.
  </div>
</body></html>`;
}

function renderProviderRow(r: ProviderRow): string {
	const hasActivity = r.sessionReqs > 0 || r.totalRequests > 0;
	const quotaBar = renderQuotaBar(r);
	const infoHTML = renderInfoLine(r);

	return `
      <div style="padding: 7px 0; ${hasActivity ? "" : "opacity: 0.3;"}">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 500; font-size: 13px;">${r.icon} ${r.provider}</span>
          <span style="font-size: 10px; color: #888;">${r.sessionReqs} this session</span>
        </div>
        ${infoHTML}
        ${quotaBar}
      </div>`;
}

function renderQuotaBar(r: ProviderRow): string {
	if (!r.dailyLimit || r.dailyLimit <= 0) return "";

	const pct = Math.min(100, Math.round((r.dailyReqs / r.dailyLimit) * 100));
	const color = pct > 80 ? "#e53e3e" : pct > 50 ? "#ecc94b" : "#48bb78";

	return `
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 3px;">
          <div style="flex: 1; height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden;">
            <div style="width: ${pct}%; height: 100%; background: ${color}; border-radius: 2px;"></div>
          </div>
          <span style="font-size: 10px; color: #666;">${r.dailyReqs}/${r.dailyLimit}</span>
        </div>`;
}

function renderInfoLine(r: ProviderRow): string {
	const infoParts: string[] = [];

	if (r.totalRequests > 0) {
		infoParts.push(
			`${formatTokens(r.totalTokensIn + r.totalTokensOut)} tok · ${r.totalRequests} reqs`,
		);
		if (r.costEquivalent > 0) {
			infoParts.push(`≈${formatCost(r.costEquivalent)}`);
		}
		if (r.firstUsed) {
			infoParts.push(`since ${relativeTime(r.firstUsed)}`);
		}
	}
	if (r.remainingToday !== undefined) {
		infoParts.push(`${r.remainingToday} left today`);
	}
	if (r.hourlyLimit) {
		infoParts.push(`${r.hourlyLimit}/hr limit`);
	}
	if (r.credits !== undefined) {
		infoParts.push(`💰 ${formatCost(r.credits)}`);
	}
	if (r.key === "local" && r.totalRequests > 0) {
		infoParts.push("always free");
	}

	if (infoParts.length === 0) return "";

	return `<div style="font-size: 10px; color: #777; margin-top: 2px;">${infoParts.join(" · ")}</div>`;
}
