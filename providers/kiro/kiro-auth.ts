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
import type { OAuthLoginCallbacks } from "@earendil-works/pi-ai/compat";
import { getKiroAuthMethod } from "../../config.ts";

export const SSO_OIDC_ENDPOINT = "https://oidc.us-east-1.amazonaws.com";
export const BUILDER_ID_START_URL = "https://view.awsapps.com/start";
export const KIRO_DESKTOP_REFRESH_URL =
  "https://prod.{region}.auth.desktop.kiro.dev/refreshToken";
export const SSO_SCOPES = [
  "codewhisperer:completions",
  "codewhisperer:analysis",
  "codewhisperer:conversations",
  "codewhisperer:transformations",
  "codewhisperer:taskassist",
];

export type KiroAuthMethod = "idc" | "desktop" | "web-portal";
export type KiroLoginMethod = "auto" | "builder-id" | "google" | "github";

export interface KiroCredentials extends OAuthCredential {
  clientId: string;
  clientSecret: string;
  region: string;
  authMethod: KiroAuthMethod;
  profileArn?: string;
  /** Set when `authMethod: "web-portal"`. The IdP the token was issued for. */
  idp?: string;
  /** Set when `authMethod: "web-portal"`. The CSRF token from the ExchangeToken response. */
  csrfToken?: string;
  /** Set when `authMethod: "web-portal"`. Stable per-host identifier for the Kiro Desktop refresh User-Agent. */
  machineId?: string;
}

const PROBE_TIMEOUT_MS = 15_000;
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
  externalSignal?: AbortSignal,
): Promise<{
  clientId: string;
  clientSecret: string;
  oidcEndpoint: string;
  devAuth: DeviceAuth;
} | null> {
  const oidcEndpoint = `https://oidc.${region}.amazonaws.com`;
  const mergedSignal = externalSignal
    ? AbortSignal.any([externalSignal, AbortSignal.timeout(PROBE_TIMEOUT_MS)])
    : AbortSignal.timeout(PROBE_TIMEOUT_MS);
  const regResp = await fetch(`${oidcEndpoint}/client/register`, {
    method: "POST",
    signal: mergedSignal,
    headers: { "Content-Type": "application/json", "User-Agent": "pi-cli" },
    body: JSON.stringify({
      clientName: "pi-cli",
      clientType: "public",
      scopes: SSO_SCOPES,
      grantTypes: [
        "urn:ietf:params:oauth:grant-type:device_code",
        "refresh_token",
      ],
    }),
  });
  if (!regResp.ok) return null;
  const { clientId, clientSecret } = (await regResp.json()) as {
    clientId: string;
    clientSecret: string;
  };
  const devResp = await fetch(`${oidcEndpoint}/device_authorization`, {
    method: "POST",
    signal: mergedSignal,
    headers: { "Content-Type": "application/json", "User-Agent": "pi-cli" },
    body: JSON.stringify({ clientId, clientSecret, startUrl }),
  });
  if (!devResp.ok) return null;
  return {
    clientId,
    clientSecret,
    oidcEndpoint,
    devAuth: (await devResp.json()) as DeviceAuth,
  };
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
      signal: interaction.signal
        ? AbortSignal.any([
            interaction.signal,
            AbortSignal.timeout(PROBE_TIMEOUT_MS),
          ])
        : AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { "Content-Type": "application/json", "User-Agent": "pi-cli" },
      body: JSON.stringify({
        clientId,
        clientSecret,
        deviceCode: devAuth.deviceCode,
        grantType: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const tokData = (await tokResp.json()) as {
      error?: string;
      accessToken?: string;
      refreshToken?: string;
      expiresIn?: number;
    };

    switch (tokData.error) {
      case undefined:
        if (tokData.accessToken && tokData.refreshToken) {
          return {
            type: "oauth",
            refresh: tokData.refreshToken,
            access: tokData.accessToken,
            expires:
              Date.now() +
              (tokData.expiresIn || 3600) * 1000 -
              EXPIRES_BUFFER_MS,
            clientId,
            clientSecret,
            region,
            authMethod: "idc" as KiroAuthMethod,
          } as KiroCredentials;
        }
        break;
      case "authorization_pending":
        break;
      case "slow_down":
        interval += baseInterval;
        break;
      default:
        throw new Error(`Authorization failed: ${tokData.error}`);
    }
  }
  throw new Error("Authorization timed out");
}

async function runDeviceCodeFlow(
  interaction: AuthInteraction,
  startUrl: string,
  region: string,
): Promise<OAuthCredential> {
  const result = await tryRegisterAndAuthorize(startUrl, region);
  if (!result) throw new Error(`Device authorization failed in ${region}`);
  return pollDeviceCode(
    interaction,
    result.clientId,
    result.clientSecret,
    region,
    result.oidcEndpoint,
    result.devAuth,
  );
}

async function loginKiro(
  callbacks: OAuthLoginCallbacks,
): Promise<OAuthCredential> {
  // Translate the legacy OAuthLoginCallbacks surface (what Pi's
  // adaptOAuth actually passes) into the new AuthInteraction shape.
  // This mirrors the Cline provider's pattern in cline-auth.ts: the
  // legacy callbacks map 1:1 to interaction.notify / interaction.prompt
  // calls, and the translation is local to this function so the
  // downstream helpers (loginKiroDesktop, pollDeviceCode) keep
  // working with the new shape unchanged.
  const interaction: AuthInteraction = {
    signal: callbacks.signal,
    notify: (event) => {
      switch (event.type) {
        case "info":
          callbacks.onProgress?.(event.message);
          return;
        case "auth_url":
          callbacks.onAuth({
            url: event.url,
            instructions: event.instructions,
          });
          return;
        case "device_code":
          callbacks.onDeviceCode({
            userCode: event.userCode,
            verificationUri: event.verificationUri,
            intervalSeconds: event.intervalSeconds,
            expiresInSeconds: event.expiresInSeconds,
          });
          return;
        case "progress":
          callbacks.onProgress?.(event.message);
          return;
      }
    },
    prompt: async (prompt): Promise<string> => {
      // The legacy OAuthLoginCallbacks splits text/secret/select into
      // onPrompt vs the manual-code path lives in onManualCodeInput.
      // The new AuthInteraction.prompt covers all of these via a
      // discriminated union. Translate each variant to its legacy
      // equivalent.
      switch (prompt.type) {
        case "text":
        case "secret":
          return callbacks.onPrompt({
            message: prompt.message,
            placeholder: prompt.placeholder,
          });
        case "manual_code":
          if (!callbacks.onManualCodeInput) {
            throw new Error(
              "Manual code input is not supported by this provider's auth flow.",
            );
          }
          return callbacks.onManualCodeInput();
        case "select":
          if (!callbacks.onSelect) {
            throw new Error(
              "Select prompt is not supported by this provider's auth flow.",
            );
          }
          // onSelect returns Promise<string | undefined> per the
          // legacy contract; coerce undefined to "" to satisfy
          // AuthInteraction.prompt's strict string return.
          return (
            (await callbacks.onSelect({
              message: prompt.message,
              options: [...prompt.options],
            })) ?? ""
          );
      }
    },
  };

  // Dispatch to the configured auth method (per docs/kiro-web-portal-auth.md):
  //   - "web-portal" (default for fresh installs): PKCE + Kiro Web Portal
  //     flow that persists profileArn automatically. The user signs in
  //     via browser and pastes the redirect URL back.
  //   - "idc": the existing AWS SSO OIDC device-code flow. Requires
  //     the user to set kiro_profile_arn in ~/.pi/free.json for chat
  //     to work.
  //   - "kiro-cli": Phase G fallback, not yet implemented — falls
  //     through to the idc flow for now.
  const method = getKiroAuthMethod();
  if (method === "web-portal") {
    const { loginKiroDesktop } = await import("./kiro-desktop-auth.js");
    interaction.notify({
      type: "progress",
      message: "Starting Kiro Web Portal login (PKCE + browser redirect)...",
    });
    return loginKiroDesktop(interaction);
  }

  // Legacy SSO OIDC device-code flow.
  interaction.notify({
    type: "progress",
    message: "Getting AWS Builder ID login...",
  });
  interaction.notify({
    type: "auth_url",
    url: BUILDER_ID_START_URL,
    instructions: "Initiating AWS Builder ID device authorization",
  });
  return runDeviceCodeFlow(interaction, BUILDER_ID_START_URL, "us-east-1");
}

async function refreshKiroCredential(
  credential: OAuthCredential,
  _signal?: AbortSignal,
): Promise<OAuthCredential> {
  const kiroCred = credential as KiroCredentials;
  // Prefer the typed `authMethod` field (used by `web-portal` and
  // modern `desktop` credentials). Fall back to the legacy
  // pipe-encoded suffix for older `desktop` credentials where the
  // refresh string ends with "|desktop".
  let authMethod: KiroAuthMethod = kiroCred.authMethod ?? "idc";
  const parts = credential.refresh.split("|");
  const rawRefresh = parts[0] ?? "";
  const refreshToken = rawRefresh;
  if (authMethod === "idc" && parts.length > 1) {
    const legacy = parts[parts.length - 1] ?? "idc";
    if (legacy === "desktop" || legacy === "web-portal") {
      authMethod = legacy;
    }
  }
  const region = kiroCred.region || "us-east-1";

  if (authMethod === "web-portal") {
    // Phase D: route to the new Web Portal refresh path which
    // also extracts profileArn from the response.
    const { refreshKiroDesktopCredential } = await import(
      "./kiro-desktop-auth.js"
    );
    return refreshKiroDesktopCredential(kiroCred, _signal);
  }

  if (authMethod === "desktop") {
    const url = KIRO_DESKTOP_REFRESH_URL.replace("{region}", region);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "pi-cli" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok)
      throw new Error(`Desktop token refresh failed: ${response.status}`);
    const data = (await response.json()) as {
      accessToken: string;
      refreshToken?: string;
      expiresIn: number;
      profileArn?: string;
    };
    if (!data.accessToken)
      throw new Error("Desktop token refresh: missing accessToken");
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

  const clientId = (credential as KiroCredentials).clientId ?? parts[1] ?? "";
  const clientSecret =
    (credential as KiroCredentials).clientSecret ?? parts[2] ?? "";
  const ssoEndpoint = `https://oidc.${region}.amazonaws.com`;
  const response = await fetch(`${ssoEndpoint}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "pi-cli" },
    body: JSON.stringify({
      clientId,
      clientSecret,
      refreshToken,
      grantType: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error(`Token refresh failed: ${response.status}`);
  const data = (await response.json()) as {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
  return {
    ...credential,
    refresh: `${data.refreshToken}${clientId ? `|${clientId}` : ""}|${clientSecret}|idc`,
    access: data.accessToken,
    expires: Date.now() + data.expiresIn * 1000 - EXPIRES_BUFFER_MS,
    clientId,
    clientSecret,
    region: (credential as KiroCredentials).region,
    authMethod: (credential as KiroCredentials).authMethod,
  } as KiroCredentials;
}

export const kiroOAuthAuth: OAuthAuth = {
  name: "Kiro",
  loginLabel: "Sign in with Kiro",
  // SAFETY: pi-ai's `OAuthAuth.login` is typed as taking the new
  // `ProviderAuthInteraction` shape, but Pi's `adaptOAuth` (in
  // provider-composer.js) actually passes the legacy
  // `OAuthLoginCallbacks` shape. Our `loginKiro` matches the
  // legacy shape (and translates to the new shape internally) so
  // it's correct at runtime; the cast here just bridges the type
  // mismatch so the assignment type-checks. This is the same
  // adapter pattern Cline uses in `clineOAuthAuth.login`.
  login: loginKiro as unknown as OAuthAuth["login"],
  refresh: refreshKiroCredential,
  async toAuth(credential: OAuthCredential): Promise<ModelAuth> {
    return { apiKey: credential.access };
  },
};

/** Native auth for the Kiro provider: OAuth-only (SSO OIDC device code flow). */
export const kiroAuth: ProviderAuth = {
  oauth: kiroOAuthAuth,
};
