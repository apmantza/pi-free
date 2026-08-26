/**
 * Kiro API region resolution and endpoint construction.
 *
 * Maps SSO regions to Kiro API regions and builds management/runtime endpoints.
 */
export const API_REGION_MAP: Record<string, string> = {
  "us-west-1": "us-east-1",
  "us-west-2": "us-east-1",
  "us-east-2": "us-east-1",
  "ap-southeast-1": "us-east-1",
  "ap-southeast-2": "us-east-1",
  "ap-northeast-1": "us-east-1",
  "ap-south-1": "us-east-1",
  "eu-west-1": "eu-central-1",
  "eu-west-2": "eu-central-1",
  "eu-west-3": "eu-central-1",
  "eu-north-1": "eu-central-1",
  "eu-south-1": "eu-central-1",
  "eu-south-2": "eu-central-1",
  "eu-central-2": "eu-central-1",
};

export interface KiroEndpoints {
  region: string;
  management: string;
  runtime: string;
}

export function resolveApiRegion(ssoRegion: string | undefined): string {
  if (!ssoRegion) return "us-east-1";
  return API_REGION_MAP[ssoRegion] ?? ssoRegion;
}

export function getKiroEndpoints(region: string): KiroEndpoints {
  return {
    region,
    management: `https://management.${region}.kiro.dev/`,
    runtime: `https://runtime.${region}.kiro.dev/`,
  };
}

export function getKiroRegionFromEndpoint(endpoint: string): string | undefined {
  try {
    const [service, region, ...suffix] = new URL(endpoint).hostname.split(".");
    const domain = suffix.join(".");
    if ((service === "management" || service === "runtime") && domain === "kiro.dev") return region;
    return undefined;
  } catch {
    return undefined;
  }
}