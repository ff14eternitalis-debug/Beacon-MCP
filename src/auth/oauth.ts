import axios from "axios";
import { generateCodeVerifier, generateCodeChallenge } from "./pkce.js";
import {
  StoredTokens,
  PendingFlow,
  saveTokens,
  savePendingFlow,
  clearPendingFlow,
} from "./tokens.js";

export const BEACON_API_BASE =
  process.env.BEACON_API_URL ?? "https://api.usebeacon.app/v4";

// App web officielle Beacon — publique, pas de client_secret requis
export const BEACON_CLIENT_ID =
  process.env.BEACON_CLIENT_ID ?? "12877547-7ad0-466f-a001-77815043c96b";

export const BEACON_SCOPES = "common users:read sentinel:read sentinel:write";

const authClient = axios.create({
  baseURL: BEACON_API_BASE,
  headers: { "Content-Type": "application/json" },
});

interface OAuthResponse {
  access_token: string;
  refresh_token: string;
  access_token_expiration: number;
  refresh_token_expiration: number;
}

function oauthToStored(r: OAuthResponse): StoredTokens {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    accessTokenExpiry: r.access_token_expiration,
    refreshTokenExpiry: r.refresh_token_expiration,
  };
}

export interface DeviceFlowStart {
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  interval: number;
  expiresIn: number;
}

export async function startDeviceFlow(): Promise<DeviceFlowStart> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const { data } = await authClient.post("/device", {
    client_id: BEACON_CLIENT_ID,
    scope: BEACON_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  savePendingFlow({
    deviceCode: data.device_code,
    codeVerifier,
    expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
  });

  return {
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    verificationUriComplete: data.verification_uri_complete,
    interval: data.interval,
    expiresIn: data.expires_in,
  };
}

export type PollResult =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "success"; tokens: StoredTokens };

export async function pollDeviceFlow(
  pending: PendingFlow
): Promise<PollResult> {
  if (pending.expiresAt < Math.floor(Date.now() / 1000)) {
    clearPendingFlow();
    return { status: "expired" };
  }

  try {
    const { data } = await authClient.post("/login", {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: BEACON_CLIENT_ID,
      device_code: pending.deviceCode,
      code_verifier: pending.codeVerifier,
    });

    const tokens = oauthToStored(data as OAuthResponse);
    saveTokens(tokens);
    clearPendingFlow();
    return { status: "success", tokens };
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.data?.error === "authorization_pending") {
      return { status: "pending" };
    }
    throw err;
  }
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<StoredTokens> {
  const { data } = await authClient.post("/login", {
    grant_type: "refresh_token",
    client_id: BEACON_CLIENT_ID,
    refresh_token: refreshToken,
  });

  const tokens = oauthToStored(data as OAuthResponse);
  saveTokens(tokens);
  return tokens;
}
