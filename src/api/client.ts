import axios, { AxiosInstance } from "axios";
import { BEACON_API_BASE, refreshAccessToken } from "../auth/oauth.js";
import {
  loadTokens,
  isAccessTokenValid,
  isRefreshTokenValid,
  StoredTokens,
} from "../auth/tokens.js";

export async function getValidAccessToken(): Promise<string | null> {
  const tokens = loadTokens();
  if (!tokens) return null;

  if (isAccessTokenValid(tokens)) return tokens.accessToken;

  if (isRefreshTokenValid(tokens)) {
    try {
      const refreshed = await refreshAccessToken(tokens.refreshToken);
      return refreshed.accessToken;
    } catch {
      return null;
    }
  }

  return null;
}

export function createBeaconClient(): AxiosInstance {
  const client = axios.create({
    baseURL: BEACON_API_BASE,
    headers: { "Content-Type": "application/json" },
    timeout: 30_000,
  });

  client.interceptors.request.use(async (config) => {
    const token = await getValidAccessToken();
    if (token) config.headers.set("Authorization", `Bearer ${token}`);
    return config;
  });

  return client;
}

export const beaconClient = createBeaconClient();

export async function checkAuthStatus(): Promise<{
  connected: boolean;
  userId?: string;
  email?: string;
  tokens?: StoredTokens;
  error?: string;
}> {
  const token = await getValidAccessToken();

  if (!token) {
    const hasTokens = loadTokens() !== null;
    return {
      connected: false,
      error: hasTokens
        ? "Token expiré — relancez beacon_login"
        : "Aucun token stocké",
    };
  }

  try {
    const response = await beaconClient.get("/user");
    return {
      connected: true,
      userId: response.data?.userId,
      email: response.data?.email,
      tokens: loadTokens()!,
    };
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        return {
          connected: false,
          error: "Token invalide ou révoqué — relancez beacon_login",
        };
      }
      return { connected: false, error: `Erreur API (${status}): ${err.message}` };
    }
    return { connected: false, error: String(err) };
  }
}
