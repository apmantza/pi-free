/**
 * Kiro OAuth authentication — native ProviderAuth for the Kiro provider.
 *
 * Ported from the reference implementation's oauth.ts and login.ts.
 * Supports AWS Builder ID (SSO OIDC device code flow), IAM Identity Center,
 * and social login (Google/GitHub) via kiro-cli.
 */
import type {
  AuthInteraction,
  OAuthAuth,
  OAuthCredential,
  ProviderAuth,
  ModelAuth,
} from "@earendil-works/pi-ai";

export const SSO_OIDC_ENDPOINT = "https://oidc.us-east-1.amazonaws.com";
export const BUILDER_ID_START_URL = "https://view.awsapps.com/start";
export const KIRO_DESKTOP_REFRESH_URL = "https://prod.{region}.auth.desktop.kiro.dev/refreshToken";
export const SSO_SCOPES = [
  "codewhisperer:completions",
  "codewhisperer:analysis",
  "codewhisperer:conversations",
  "codewhisperer:transformations",
  "codewhisperer:taskassist",
];

export type KiroAuthMethod = "idc" | "desktop";
export type KiroLoginMethod = "auto" | "builder-id" | "google" | "github";

export interface KiroCredentials extends OAuthCredential {
  clientId: string;
  clientSecret: string;
  region: string;
  authMethod: KiroAuthMethod;
  profileArn?: string;
}

const IDC_PROBE_REGIONS = [
  "us-east-1", "eu-west-1", "eu-central-1", "us-east-2",
  "eu-west-2", "eu-west-3", "eu-north-1", "ap-southeast-1",
  "ap-northeast-1", "us-west-2",
];

const PROBE_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 5_000;
const EXPIRES_BUFFER_MS = 5 * 60 * 1000;

type DeviceAuth = {
  verificationUri: string;
  verificationUriComplete: string;
  userCode: string;
  deviceCode: string;
  interval: number;
  expiresIn: number;
};

async function tryRegisterAndAuthorize(
  startUrl: string,
  region: string,
): Promise<{ clientId: string; clientSecret: string; oidcEndpoint: string; devAuth: DeviceAuth } | null> {
  const oidcEndpoint = `https://oidc.${region}.amazonaws.com`;
  const regResp = await fetch(`${oidcEndpoint}/client/register`, {
    method: "POST",
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    headers: { "Content-Type": "application/json", "User-Agent": "pi-cli" },
    body: JSON.stringify({
      clientName: "pi-cli",
      clientType: "public",
      scopes: SSO_SCOPES,
      grantTypes: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
    }),
  });
  if (!regResp.ok) return null;
  const { clientId, clientSecret } = (await regResp.json()) as { clientId: string; clientSecret: string };
  const devResp = await fetch(`${oidcEndpoint}/device_authorization`, {
    method: "POST",
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    headers: { "Content-Type": "application/json", "User-Agent": "pi-cli" },
    body: JSON.stringify({ clientId, clientSecret, startUrl }),
  });
  if (!devResp.ok) return null;
  return { clientId, clientSecret, oidcEndpoint, devAuth: (await devResp.json()) as DeviceAuth };
}

async function pollDeviceCode(
  interaction: AuthInteraction,
  clientId: string,
  clientSecret: string,
  region: string,
  oidcEndpoint: string,
  devAuth: DeviceAuth,
): Promise<OAuthCredential> {
  interaction.notify({
    type: "auth_url",
    url: devAuth.verificationUriComplete,
    instructions: `Your code: ${devAuth.userCode}`,
  });

  const deadline = Date.now() + (devAuth.expiresIn || 600) * 1000;
  const baseInterval = (devAuth.interval || 5) * 1000;
  let interval = baseInterval;

  while (Date.now() < deadline) {
    if (interaction.signal?.aborted) throw new Error("Login cancelled");
    await new Promise((r) => setTimeout(r, interval));

    const tokResp = await fetch(`${oidcEndpoint}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "pi-cli" },
      body: JSON.stringify({
        clientId,
        clientSecret,
        deviceCode: devAuth.deviceCode,
        grantType: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const tokData = (await tokResp.json()) as {
      error?: string; accessToken?: string; refreshToken?: string; expiresIn?: number;
    };

    switch (tokData.error) {
      case undefined:
        if (tokData.accessToken && tokData.refreshToken) {
          return {
            type: "oauth",
            refresh: `${tokData.refreshToken}|${clientId}|${clientSecret}|idc`,
            access: tokData.accessToken,
            expires: Date.now() + (tokData.expiresIn || 3600) * 1000 - EXPIRES_BUFFER_MS,
            clientId,
            clientSecret,
            region,
            authMethod: "idc" as KiroAuthMethod,
          } as KiroCredentials;
        }
        break;
      case "authorization_pending": break;
      case "slow_down": interval += baseInterval; break;
      default: throw new Error(`Authorization failed: ${tokData.error}`);
    }
  }
  throw new Error("Authorization timed out");
}

async function runDeviceCodeFlow(interaction: AuthInteraction, startUrl: string, region: string): Promise<OAuthCredential> {
  const result = await tryRegisterAndAuthorize(startUrl, region);
  if (!result) throw new Error(`Device authorization failed in ${region}`);
  return pollDeviceCode(interaction, result.clientId, result.clientSecret, region, result.oidcEndpoint, result.devAuth);
}

async function runDeviceCodeFlowWithRegionDetection(interaction: AuthInteraction, startUrl: string): Promise<OAuthCredential> {
  interaction.notify({ type: "progress", message: "Detecting your Identity Center region..." });
  for (const region of IDC_PROBE_REGIONS) {
    const result = await tryRegisterAndAuthorize(startUrl, region).catch(() => null);
    if (result) {
      interaction.notify({ type: "progress", message: `Region detected: ${region}` });
      return pollDeviceCode(interaction, result.clientId, result.clientSecret, region, result.oidcEndpoint, result.devAuth);
    }
  }
  throw new Error(
    `Could not find an AWS region that accepts ${startUrl}. Tried: ${IDC_PROBE_REGIONS.join(", ")}.`
  );
}

async function loginKiro(interaction: AuthInteraction): Promise<OAuthCredential> {
  interaction.notify({ type: "progress", message: "Getting AWS Builder ID login..." });
  interaction.notify({
    type: "auth_url",
    url: BUILDER_ID_START_URL,
    instructions: "Initiating AWS Builder ID device authorization",
  });
  // Default to Builder ID device code flow
  return runDeviceCodeFlow(interaction, BUILDER_ID_START_URL, "us-east-1");
}

async function refreshKiroCredential(credential: OAuthCredential, _signal?: AbortSignal): Promise<OAuthCredential> {
  const parts = credential.refresh.split("|");
  const refreshToken = parts[0] ?? "";
  const authMethod = (parts[parts.length - 1] ?? "idc") as KiroAuthMethod;
  const region = (credential as KiroCredentials).region || "us-east-1";

  if (authMethod === "desktop") {
    const url = KIRO_DESKTOP_REFRESH_URL.replace("{region}", region);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "pi-cli" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) throw new Error(`Desktop token refresh failed: ${response.status}`);
    const data = (await response.json()) as { accessToken: string; refreshToken?: string; expiresIn: number; profileArn?: string };
    if (!data.accessToken) throw new Error("Desktop token refresh: missing accessToken");
    return {
      ...credential,
      refresh: `${data.refreshToken || refreshToken}|desktop`,
      access: data.accessToken,
      expires: Date.now() + data.expiresIn * 1000 - EXPIRES_BUFFER_MS,
      profileArn: data.profileArn || (credential as KiroCredentials).profileArn,
      clientId: (credential as KiroCredentials).clientId,
      clientSecret: (credential as KiroCredentials).clientSecret,
      region: (credential as KiroCredentials).region,
      authMethod: (credential as KiroCredentials).authMethod,
    } as KiroCredentials;
  }

  const clientId = parts[1] ?? "";
  const clientSecret = parts[2] ?? "";
  const ssoEndpoint = `https://oidc.${region}.amazonaws.com`;
  const response = await fetch(`${ssoEndpoint}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "pi-cli" },
    body: JSON.stringify({ clientId, clientSecret, refreshToken, grantType: "refresh_token" }),
  });
  if (!response.ok) throw new Error(`Token refresh failed: ${response.status}`);
  const data = (await response.json()) as { accessToken: string; refreshToken: string; expiresIn: number };
  return {
    ...credential,
    refresh: `${data.refreshToken}|${clientId}|${clientSecret}|idc`,
    access: data.accessToken,
    expires: Date.now() + data.expiresIn * 1000 - EXPIRES_BUFFER_MS,
  } as KiroCredentials;
}

export const kiroOAuthAuth: OAuthAuth = {
  name: "Kiro (AWS Builder ID)",
  loginLabel: "Sign in with AWS Builder ID",
  login: loginKiro,
  refresh: refreshKiroCredential,
  async toAuth(credential: OAuthCredential): Promise<ModelAuth> {
    return { apiKey: credential.access };
  },
};

/** Native auth for the Kiro provider: OAuth-only (SSO OIDC device code flow). */
export const kiroAuth: ProviderAuth = {
  oauth: kiroOAuthAuth,
};