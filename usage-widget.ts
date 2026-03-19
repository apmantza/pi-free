/**
 * Usage monitoring widget — floating glimpseui window showing per-provider
 * free quota status, daily request counts, credit balances, and cumulative
 * token usage across all sessions.
 *
 * Launch with /usage command. Toggles on repeated invocation.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getRequestCount, getDailyRequestCount, getCachedMetrics } from "./metrics.ts";
import { getAllCumulativeUsage } from "./usage-store.ts";
import { PROVIDER_KILO, PROVIDER_OPENROUTER, PROVIDER_ZEN, PROVIDER_NVIDIA, PROVIDER_CLINE } from "./constants.ts";

const GLIMPSE_PATH = "file:///C:/Users/R3LiC/AppData/Roaming/npm/node_modules/glimpseui/src/glimpse.mjs";

// =============================================================================
// Types
// =============================================================================

interface ProviderRow {
  provider: string;
  key: string;
  icon: string;
  // This session
  sessionReqs: number;
  dailyReqs: number;
  // Known limits (static or from API)
  dailyLimit?: number;
  hourlyLimit?: number;
  remainingToday?: number;
  // Cumulative (all time)
  totalTokensIn: number;
  totalTokensOut: number;
  totalRequests: number;
  costEquivalent: number;
  firstUsed?: string;
  // Credits
  credits?: number;
  creditsLabel?: string;
}

// =============================================================================
// Formatting
// =============================================================================

function formatTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

function formatCost(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

// =============================================================================
// Data collection
// =============================================================================

function collectRows(): ProviderRow[] {
  const cumulative = getAllCumulativeUsage();
  const orMetrics = getCachedMetrics(PROVIDER_OPENROUTER);
  const kiloMetrics = getCachedMetrics(PROVIDER_KILO);

  function makeRow(provider: string, key: string, icon: string, opts?: {
    dailyLimit?: number;
    hourlyLimit?: number;
    remainingToday?: number;
    credits?: number;
    creditsLabel?: string;
  }): ProviderRow {
    const c = cumulative[key];
    return {
      provider, key, icon,
      sessionReqs: getRequestCount(key),
      dailyReqs: getDailyRequestCount(key),
      dailyLimit: opts?.dailyLimit,
      hourlyLimit: opts?.hourlyLimit,
      remainingToday: opts?.remainingToday,
      totalTokensIn: c?.tokensIn ?? 0,
      totalTokensOut: c?.tokensOut ?? 0,
      totalRequests: c?.requests ?? 0,
      costEquivalent: c?.costEquivalent ?? 0,
      firstUsed: c?.firstUsed,
      credits: opts?.credits,
      creditsLabel: opts?.creditsLabel,
    };
  }

  return [
    makeRow("Kilo", PROVIDER_KILO, "🔥", {
      hourlyLimit: 200, // 200 req/hr per IP (anonymous)
      credits: kiloMetrics?.balance,
      creditsLabel: "balance",
    }),
    makeRow("OpenRouter", PROVIDER_OPENROUTER, "🔀", {
      dailyLimit: orMetrics?.rateLimit?.requestsPerDay,
      remainingToday: orMetrics?.rateLimit?.remainingToday,
      credits: orMetrics?.credits,
      creditsLabel: "credits",
    }),
    makeRow("Zen", PROVIDER_ZEN, "✦"),
    makeRow("NVIDIA", PROVIDER_NVIDIA, "⚡"),
    makeRow("Cline", PROVIDER_CLINE, "🤖"),
  ];
}

// =============================================================================
// HTML rendering
// =============================================================================

function renderHTML(rows: ProviderRow[]): string {
  // Summary totals across all providers
  let totalTokens = 0, totalReqs = 0, totalCost = 0;
  for (const r of rows) {
    totalTokens += r.totalTokensIn + r.totalTokensOut;
    totalReqs += r.totalRequests;
    totalCost += r.costEquivalent;
  }

  const summaryHTML = totalReqs > 0 ? `
  <div style="background: rgba(255,255,255,0.04); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px;">
    <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 500;">
      <span>Total free value</span>
      <span style="color: #48bb78;">${formatCost(totalCost)} saved</span>
    </div>
    <div style="font-size: 11px; color: #888; margin-top: 3px;">
      ${formatTokens(totalTokens)} tokens · ${totalReqs} requests
    </div>
  </div>` : "";

  const providerRows = rows.map((r) => {
    const hasActivity = r.sessionReqs > 0 || r.totalRequests > 0;

    // Progress bar for known daily limits
    let quotaBar = "";
    if (r.dailyLimit && r.dailyLimit > 0) {
      const pct = Math.min(100, Math.round((r.dailyReqs / r.dailyLimit) * 100));
      const color = pct > 80 ? "#e53e3e" : pct > 50 ? "#ecc94b" : "#48bb78";
      quotaBar = `
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 3px;">
          <div style="flex: 1; height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden;">
            <div style="width: ${pct}%; height: 100%; background: ${color}; border-radius: 2px;"></div>
          </div>
          <span style="font-size: 10px; color: #666;">${r.dailyReqs}/${r.dailyLimit}</span>
        </div>`;
    }

    // Info line: cumulative + credits + limits
    const infoParts: string[] = [];
    if (r.totalRequests > 0) {
      infoParts.push(`${formatTokens(r.totalTokensIn + r.totalTokensOut)} tok · ${r.totalRequests} reqs`);
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

    const infoHTML = infoParts.length > 0
      ? `<div style="font-size: 10px; color: #777; margin-top: 2px;">${infoParts.join(" · ")}</div>`
      : "";

    return `
      <div style="padding: 7px 0; ${hasActivity ? '' : 'opacity: 0.3;'}">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 500; font-size: 13px;">${r.icon} ${r.provider}</span>
          <span style="font-size: 10px; color: #888;">${r.sessionReqs} this session</span>
        </div>
        ${infoHTML}
        ${quotaBar}
      </div>`;
  }).join("\n");

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

// =============================================================================
// Widget lifecycle
// =============================================================================

let glimpseWin: any = null;

export async function openUsageWidget(): Promise<void> {
  const { open } = await import(GLIMPSE_PATH);
  glimpseWin = open(renderHTML(collectRows()), {
    width: 340, height: 380,
    title: "Pi Free Usage",
    frameless: true, transparent: true, floating: true,
    x: 20, y: 20,
  });
  glimpseWin.on("closed", () => { glimpseWin = null; });
}

function updateWidget(): void {
  if (!glimpseWin) return;
  try { glimpseWin.setHTML(renderHTML(collectRows())); } catch { glimpseWin = null; }
}

function closeWidget(): void {
  if (glimpseWin) { glimpseWin.close(); glimpseWin = null; }
}

// =============================================================================
// Extension registration
// =============================================================================

export function registerUsageWidget(pi: ExtensionAPI): void {
  pi.registerCommand("usage", {
    description: "Toggle free model usage dashboard",
    handler: async (_args, ctx) => {
      if (glimpseWin) { closeWidget(); return; }
      try { await openUsageWidget(); }
      catch { ctx.ui.notify("Failed to open usage widget (glimpseui required)", "warning"); }
    },
  });

  // Refresh widget after each turn
  pi.on("turn_end", async () => { updateWidget(); });
}
