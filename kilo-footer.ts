/**
 * Kilo custom footer renderer — shows token stats, cost, context usage, and credits.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";

// =============================================================================
// Formatters
// =============================================================================

/** Format token count to human-readable string. */
function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

/** Format the pwd/branch/session line. */
function formatPwdLine(width: number, footerData: any): string {
  let pwd = process.cwd();
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home && pwd.startsWith(home)) pwd = `~${pwd.slice(home.length)}`;

  const branch = footerData.getGitBranch();
  if (branch) pwd = `${pwd} (${branch})`;

  const sessionName = footerData.getSessionName?.() || footerData.sessionManager?.getSessionName?.();
  if (sessionName) pwd = `${pwd} • ${sessionName}`;

  // Truncate if needed
  if (pwd.length > width) {
    const half = Math.floor(width / 2) - 2;
    pwd = half > 1
      ? `${pwd.slice(0, half)}...${pwd.slice(-(half - 1))}`
      : pwd.slice(0, Math.max(1, width));
  }
  return pwd;
}

/** Build stats parts array from session data. */
function buildStatsParts(ctx: any, theme: any, footerData: any): { parts: string[]; width: number } {
  const model = ctx.model;
  const parts: string[] = [];

  let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0, totalCost = 0;
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      totalInput += entry.message.usage.input;
      totalOutput += entry.message.usage.output;
      totalCacheRead += entry.message.usage.cacheRead;
      totalCacheWrite += entry.message.usage.cacheWrite;
      totalCost += entry.message.usage.cost.total;
    }
  }

  if (totalInput) parts.push(`↑${formatTokens(totalInput)}`);
  if (totalOutput) parts.push(`↓${formatTokens(totalOutput)}`);
  if (totalCacheRead) parts.push(`R${formatTokens(totalCacheRead)}`);
  if (totalCacheWrite) parts.push(`W${formatTokens(totalCacheWrite)}`);

  const usingSubscription = model ? ctx.modelRegistry.isUsingOAuth(model) : false;
  if (totalCost || usingSubscription) {
    parts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
  }

  // Context usage
  const contextUsage = ctx.getContextUsage?.();
  const contextWindow = contextUsage?.contextWindow ?? model?.contextWindow ?? 0;
  const contextPercentValue = contextUsage?.percent ?? 0;
  const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

  const autoIndicator = " (auto)";
  const contextDisplay =
    contextPercent === "?"
      ? `?/${formatTokens(contextWindow)}${autoIndicator}`
      : `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;

  const contextStr = contextPercentValue > 90
    ? theme.fg("error", contextDisplay)
    : contextPercentValue > 70
      ? theme.fg("warning", contextDisplay)
      : contextDisplay;
  parts.push(contextStr);

  // Provider-specific status
  const creditsStatus = ctx.ui.getStatus?.("kilo-credits") || ctx.ui.getStatus?.("openrouter-metrics") || footerData.getExtensionStatuses?.().get("kilo-credits");
  if (creditsStatus) parts.push(creditsStatus);

  const width = visibleWidth(parts.join(" "));
  return { parts, width };
}

/** Build the right side (model name, thinking, provider). */
function buildRightSide(ctx: any, width: number, availableWidth: number, theme: any, footerData: any): string {
  const model = ctx.model;
  if (!model) return "";

  let rightSide = model.id || "no-model";
  if (model.reasoning) {
    const level = "thinking" in model ? (model as any).thinking : "off";
    rightSide = level === "off" ? `${rightSide} • thinking off` : `${rightSide} • ${level}`;
  }

  const providerCount = footerData.getAvailableProviderCount?.() || 0;
  if (providerCount > 1) {
    const withProvider = `(${model.provider}) ${rightSide}`;
    if (availableWidth >= visibleWidth(withProvider) + 2) {
      rightSide = withProvider;
    }
  }

  return rightSide;
}

// =============================================================================
// Main renderer
// =============================================================================

export function registerKiloFooter(pi: ExtensionAPI, ctx: any) {
  let footerDispose: (() => void) | null = null;

  const setupFooter = () => {
    // Clean up any existing footer
    if (footerDispose) {
      footerDispose();
      footerDispose = null;
    }

    footerDispose = ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
      // Only render footer when Kilo is the active provider
      // Check both ctx.model and the provider status from the model registry
      const currentModel = ctx.model;
      if (!currentModel || currentModel.provider !== PROVIDER_KILO) {
        // Check if we should show generic footer for non-Kilo providers
        // Return empty to let other providers show their own footer
        return { dispose() {}, invalidate() {}, render() { return []; } };
      }

      const unsubBranch = footerData.onBranchChange?.(() => tui.requestRender());

      return {
        dispose() { unsubBranch?.(); },
        invalidate() {},
        render(width: number): string[] {
        try {
          // Line 1: pwd
          const pwdLine = theme.fg("dim", formatPwdLine(width, footerData));

          // Line 2: stats
          const { parts: statsParts, width: statsLeftWidth } = buildStatsParts(ctx, theme, footerData);
          const statsLeft = statsParts.join(" ");

          const rightSide = buildRightSide(ctx, width, width - statsLeftWidth - 2, theme, footerData);
          const rightWidth = visibleWidth(rightSide);

          let statsLine: string;
          if (statsLeftWidth + 2 + rightWidth <= width) {
            const padding = " ".repeat(width - statsLeftWidth - rightWidth);
            statsLine = statsLeft + padding + rightSide;
          } else {
            const available = width - statsLeftWidth - 2;
            if (available > 3) {
              const truncated = rightSide.replace(/\x1b\[[0-9;]*m/g, "").slice(0, available);
              statsLine = statsLeft + " ".repeat(width - statsLeftWidth - truncated.length) + truncated;
            } else {
              statsLine = statsLeft;
            }
          }

          // Strip ANSI for left part, keep for right
          const plainLeft = statsLeft.replace(/\x1b\[[0-9;]*m/g, "");
          const statsLeftColored = theme.fg("dim", plainLeft);
          const statsRightColored = theme.fg("dim", statsLine.slice(plainLeft.length));

          return [pwdLine, statsLeftColored + statsRightColored];
        } catch {
          return [];
        }
      },
    };
  });
  };

  // Initial setup
  setupFooter();
}
