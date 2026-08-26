/**
 * Kiro management control plane API.
 *
 * Simplified port of the reference implementation's management.ts.
 * Handles profile resolution and model catalog discovery.
 */
import { getKiroEndpoints } from "./kiro-endpoints.js";

const LIST_PROFILES_PATH = "List-Available-Profiles";
const LIST_MODELS_PATH = "List-Available-Models";

export interface KiroManagementAuth {
  accessToken: string;
  region: string;
}

export interface KiroCatalogModel {
  modelId: string;
  tokenLimits?: {
    maxInputTokens?: number;
    maxOutputTokens?: number;
    [key: string]: unknown;
  };
  additionalModelRequestFieldsSchema?: Record<string, unknown> | null;
  displayName?: string;
  [key: string]: unknown;
}

export interface KiroListAvailableModelsResponse {
  models: KiroCatalogModel[];
  [key: string]: unknown;
}

export class KiroManagementHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "KiroManagementHttpError";
  }
}

async function requestManagement<TResponse>(
  auth: KiroManagementAuth,
  operation: string,
  path: string,
  method: "GET" | "POST",
  body: Record<string, unknown>,
): Promise<TResponse> {
  const url = new URL(path, getKiroEndpoints(auth.region).management);
  const request: RequestInit = {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${auth.accessToken}`,
    },
  };
  if (method === "GET") {
    for (const [name, value] of Object.entries(body)) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
  } else {
    request.headers = { ...request.headers, "Content-Type": "application/json" };
    request.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), request);
  } catch (error) {
    throw new Error(`Kiro management ${operation} request failed in ${auth.region}`, { cause: error });
  }

  return parseManagementResponse<TResponse>(response, operation, auth.region);
}

async function parseManagementResponse<TResponse>(
  response: Response,
  operation: string,
  region: string,
): Promise<TResponse> {
  if (!response.ok) {
    const statusText = response.statusText ? ` ${response.statusText}` : "";
    throw new KiroManagementHttpError(
      `Kiro management ${operation} failed in ${region}: ${response.status}${statusText}`,
      response.status,
    );
  }
  try {
    return (await response.json()) as TResponse;
  } catch (error) {
    throw new Error(`Kiro management ${operation} returned invalid JSON in ${region}`, { cause: error });
  }
}

export async function resolveKiroProfileArn(auth: KiroManagementAuth, providedArn?: string): Promise<string> {
  if (providedArn) return providedArn;
  // Simple single-region probe for the profile ARN
  const response = await requestManagement<{ profiles?: Array<{ arn?: string; [key: string]: unknown }> }>(
    auth,
    "ListAvailableProfiles",
    LIST_PROFILES_PATH,
    "POST",
    {},
  );
  const arn = response.profiles?.find((profile) => profile.arn)?.arn;
  if (!arn) throw new Error("Kiro management ListAvailableProfiles returned no profile in " + auth.region);
  return arn;
}

export async function listAvailableModels(
  auth: KiroManagementAuth,
  profileArn: string,
): Promise<KiroListAvailableModelsResponse> {
  const response = await requestManagement<KiroListAvailableModelsResponse>(
    auth,
    "ListAvailableModels",
    LIST_MODELS_PATH,
    "GET",
    { origin: "KIRO_CLI", profileArn },
  );
  if (!Array.isArray(response.models) || response.models.length === 0) {
    throw new Error(`Kiro management ListAvailableModels returned no models in ${auth.region}`);
  }
  return response;
}

export async function fetchKiroModelCatalog(
  auth: KiroManagementAuth,
  providedProfileArn?: string,
): Promise<KiroListAvailableModelsResponse> {
  const profileArn = await resolveKiroProfileArn(auth, providedProfileArn);
  return listAvailableModels(auth, profileArn);
}