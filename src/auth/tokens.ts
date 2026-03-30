import * as fs from "fs";
import * as path from "path";

const AUTH_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME || ".",
  ".beacon-mcp"
);

const TOKENS_FILE = path.join(AUTH_DIR, "tokens.json");
const PENDING_FILE = path.join(AUTH_DIR, "pending_flow.json");

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiry: number;
  refreshTokenExpiry: number;
}

export interface PendingFlow {
  deviceCode: string;
  codeVerifier: string;
  expiresAt: number;
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function deleteFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export function loadTokens(): StoredTokens | null {
  return readJson<StoredTokens>(TOKENS_FILE);
}

export function saveTokens(tokens: StoredTokens): void {
  writeJson(TOKENS_FILE, tokens);
}

export function clearTokens(): void {
  deleteFile(TOKENS_FILE);
}

export function isAccessTokenValid(tokens: StoredTokens): boolean {
  return tokens.accessTokenExpiry > nowUnix() + 60;
}

export function isRefreshTokenValid(tokens: StoredTokens): boolean {
  return tokens.refreshTokenExpiry > nowUnix();
}

export function savePendingFlow(flow: PendingFlow): void {
  writeJson(PENDING_FILE, flow);
}

export function loadPendingFlow(): PendingFlow | null {
  const flow = readJson<PendingFlow>(PENDING_FILE);
  if (!flow) return null;
  if (flow.expiresAt < nowUnix()) {
    clearPendingFlow();
    return null;
  }
  return flow;
}

export function clearPendingFlow(): void {
  deleteFile(PENDING_FILE);
}
