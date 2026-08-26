/**
 * Kiro account usage fetching.
 *
 * Simplified port of the reference implementation's usage.ts.
 * Fetches usage limits from the Kiro management API.
 */
import type { OAuthCredentials } from "@earendil-works/pi-ai";
import { getKiroEndpoints, resolveApiRegion } from "./kiro-endpoints.js";
import { type KiroManagementAuth, resolveKiroProfileArn } from "./kiro-management.js";
import type { KiroCredentials } from "./kiro-auth.js";

const MANAGE_USAGE_URL = "https://app.kiro.dev/account/usage";

interface KiroUsageBreakdown {
  resourceType?: string;
  displayName?: string;
  displayNamePlural?: string;
  currentUsage: number;
  currentUsageWithPrecision?: number;
  currentOverages: number;
  currentOveragesWithPrecision?: number;
  usageLimit: number;
  usageLimitWithPrecision?: number;
  unit?: string;
  overageCharges: number;
  currency?: string;
  overageRate?: number;
  nextDateReset?: number | string;
  overageCap?: number;
  overageCapWithPrecision?: number;
  freeTrialInfo?: {
    freeTrialStatus?: string;
    freeTrialExpiry?: number | string;
    currentUsage?: number;
    currentUsageWithPrecision?: number;
    usageLimit?: number;
    usageLimitWithPrecision?: number;
  };
}

interface KiroUsageLimitList {
  type?: string;
  currentUsage?: number;
  totalUsageLimit?: number;
  percentUsed?: number;
}

export interface KiroGetUsageLimitsResponse {
  limits?: KiroUsageLimitList[];
  nextDateReset?: number | string;
  daysUntilReset?: number;
  usageBreakdown?: KiroUsageBreakdown;
  usageBreakdownList?: KiroUsageBreakdown[];
  subscriptionInfo?: { subscriptionTitle?: string };
  overageConfiguration?: { overageStatus?: string };
  userInfo?: { userId?: string; email?: string };
}

export interface KiroProviderUsage {
  summary?: string;
  subscriptionTitle?: string;
  resetAt?: string;
  daysUntilReset?: number;
  overageStatus?: string;
  manageUrl?: string;
  usageBuckets?: Array<{
    id: string;
    label: string;
    resourceType?: string;
    usedDisplay: string;
    limitDisplay?: string;
    unit?: string;
    overagesDisplay?: string;
    overageChargesDisplay?: string;
    resetAt?: string;
    bonus?: { label: string; usedDisplay?: string; limitDisplay?: string; expiresAt?: string };
  }>;
  raw?: Record<string, unknown>;
}

function toIsoDate(value: number | string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function formatCount(value: number | undefined): string | undefined {
  if (value === undefined || Number.isNaN(value)) return undefined;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatMoney(amount: number | undefined, currency: string | undefined): string | undefined {
  if (amount === undefined || Number.isNaN(amount) || amount <= 0) return undefined;
  const code = currency || "USD";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

async function getKiroUsageLimits<TResponse>(
  auth: KiroManagementAuth,
  request: { profileArn?: string; origin: string; resourceType: string; isEmailRequired: boolean },
): Promise<TResponse> {
  const url = new URL("Get-Usage-Limits", getKiroEndpoints(auth.region).management);
  for (const [name, value] of Object.entries(request)) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
        "User-Agent": "pi-provider-kiro",
      },
    });
  } catch (error) {
    throw new Error(`Kiro management GetUsageLimits request failed in ${auth.region}`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`Kiro management GetUsageLimits failed in ${auth.region}: ${response.status}`);
  }
  return (await response.json()) as TResponse;
}

async function fetchRawUsage(auth: KiroManagementAuth, profileArn?: string): Promise<KiroGetUsageLimitsResponse> {
  const resolvedProfileArn = await resolveKiroProfileArn(auth, profileArn);
  return getKiroUsageLimits<KiroGetUsageLimitsResponse>(auth, {
    profileArn: resolvedProfileArn,
    origin: "KIRO_CLI",
    resourceType: "CREDIT",
    isEmailRequired: false,
  });
}

export async function fetchKiroUsage(credentials: OAuthCredentials): Promise<KiroProviderUsage> {
  const auth = {
    accessToken: credentials.access,
    region: resolveApiRegion((credentials as KiroCredentials).region),
  };
  const raw = await fetchRawUsage(auth, (credentials as KiroCredentials).profileArn);
  const usageBuckets = raw.usageBreakdownList?.length
    ? raw.usageBreakdownList.map((bucket, index) => {
        const used = bucket.currentUsageWithPrecision ?? bucket.currentUsage;
        const limit = bucket.usageLimitWithPrecision ?? bucket.usageLimit;
        const overages = bucket.currentOveragesWithPrecision ?? bucket.currentOverages;
        const freeTrialUsed = bucket.freeTrialInfo?.currentUsageWithPrecision ?? bucket.freeTrialInfo?.currentUsage;
        const freeTrialLimit = bucket.freeTrialInfo?.usageLimitWithPrecision ?? bucket.freeTrialInfo?.usageLimit;
        return {
          id: bucket.resourceType || bucket.displayName || `usage-${index}`,
          label: bucket.displayName || bucket.displayNamePlural || bucket.resourceType || "Usage",
          resourceType: bucket.resourceType,
          usedDisplay: formatCount(used) || "0",
          limitDisplay: formatCount(limit),
          unit: bucket.unit,
          overagesDisplay: overages && overages > 0 ? formatCount(overages) : undefined,
          overageChargesDisplay: formatMoney(bucket.overageCharges, bucket.currency),
          resetAt: toIsoDate(bucket.nextDateReset),
          bonus: freeTrialUsed !== undefined || freeTrialLimit !== undefined || bucket.freeTrialInfo?.freeTrialExpiry !== undefined
            ? { label: "Bonus credits", usedDisplay: formatCount(freeTrialUsed), limitDisplay: formatCount(freeTrialLimit), expiresAt: toIsoDate(bucket.freeTrialInfo?.freeTrialExpiry) }
            : undefined,
        };
      })
    : raw.usageBreakdown
      ? [{
          id: "usage-0",
          label: "Usage",
          usedDisplay: "0",
          limitDisplay: undefined,
        }]
      : [];

  return {
    summary: raw.subscriptionInfo?.subscriptionTitle,
    subscriptionTitle: raw.subscriptionInfo?.subscriptionTitle,
    resetAt: toIsoDate(raw.nextDateReset),
    daysUntilReset: raw.daysUntilReset,
    overageStatus: raw.overageConfiguration?.overageStatus,
    manageUrl: MANAGE_USAGE_URL,
    usageBuckets,
    raw: raw as Record<string, unknown>,
  };
}