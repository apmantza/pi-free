/**
 * Kilo custom footer renderer — shows token stats, cost, context usage, and credits.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";

export function registerKiloFooter(pi: ExtensionAPI, ctx: any) {
  ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
    const unsubBranch = footerData.onBranchChange(() => tui.requestRender());

    function formatTokens(count: number): string {
      if (count < 1000) return count.toString();
      if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
      if (count < 1000000) return `${Math.round(count / 1000)}k`;
      if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
      return `${Math.round(count / 1000000)}M`;
    }

    return {
      dispose() { unsubBranch(); },
      invalidate() {},
      render(width: number): string[] {
        const model = ctx.model;

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

        const contextUsage = ctx.getContextUsage();
        const contextWindow = contextUsage?.contextWindow ?? model?.contextWindow ?? 0;
        const contextPercentValue = contextUsage?.percent ?? 0;
        const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

        // Build pwd + branch + session line
        let pwd = process.cwd();
        const home = process.env.HOME || process.env.USERPROFILE;
        if (home && pwd.startsWith(home)) pwd = `~${pwd.slice(home.length)}`;
        const branch = footerData.getGitBranch();
        if (branch) pwd = `${pwd} (${branch})`;
        const sessionName = ctx.sessionManager.getSessionName();
        if (sessionName) pwd = `${pwd} • ${sessionName}`;
        if (pwd.length > width) {
          const half = Math.floor(width / 2) - 2;
          pwd = half > 1
            ? `${pwd.slice(0, half)}...${pwd.slice(-(half - 1))}`
            : pwd.slice(0, Math.max(1, width));
        }

        // Stats (left side)
        const statsParts: string[] = [];
        if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
        if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
        if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
        if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);

        const usingSubscription = model ? ctx.modelRegistry.isUsingOAuth(model) : false;
        if (totalCost || usingSubscription) {
          statsParts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
        }

        const autoIndicator = " (auto)";
        const contextDisplay =
          contextPercent === "?"
            ? `?/${formatTokens(contextWindow)}${autoIndicator}`
            : `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
        const contextStr =
          contextPercentValue > 90 ? theme.fg("error", contextDisplay) :
          contextPercentValue > 70 ? theme.fg("warning", contextDisplay) :
          contextDisplay;
        statsParts.push(contextStr);

        const creditsStatus = footerData.getExtensionStatuses().get("kilo-credits");
        if (creditsStatus) statsParts.push(creditsStatus);

        let statsLeft = statsParts.join(" ");
        let statsLeftWidth = visibleWidth(statsLeft);

        // Model + thinking + provider (right side)
        const modelName = model?.id || "no-model";
        let rightSide = modelName;
        if (model?.reasoning) {
          const level = pi.getThinkingLevel() || "off";
          rightSide = level === "off" ? `${modelName} • thinking off` : `${modelName} • ${level}`;
        }
        if (footerData.getAvailableProviderCount() > 1 && model) {
          const withProvider = `(${model.provider}) ${rightSide}`;
          if (statsLeftWidth + 2 + visibleWidth(withProvider) <= width) rightSide = withProvider;
        }

        if (statsLeftWidth > width) {
          statsLeft = `${statsLeft.replace(/\x1b\[[0-9;]*m/g, "").substring(0, width - 3)}...`;
          statsLeftWidth = visibleWidth(statsLeft);
        }

        const rightSideWidth = visibleWidth(rightSide);
        let statsLine: string;
        if (statsLeftWidth + 2 + rightSideWidth <= width) {
          const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
          statsLine = statsLeft + padding + rightSide;
        } else {
          const available = width - statsLeftWidth - 2;
          if (available > 3) {
            const truncated = rightSide.replace(/\x1b\[[0-9;]*m/g, "").substring(0, available);
            statsLine = statsLeft + " ".repeat(width - statsLeftWidth - truncated.length) + truncated;
          } else {
            statsLine = statsLeft;
          }
        }

        return [
          theme.fg("dim", pwd),
          theme.fg("dim", statsLeft) + theme.fg("dim", statsLine.slice(statsLeft.length)),
        ];
      },
    };
  });
}
