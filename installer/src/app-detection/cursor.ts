import { access } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ClientDetectionResult } from "../types/index.js";

function getCursorConfigCandidates(): string[] {
  const home = os.homedir();
  const roaming = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");

  return [
    path.join(home, ".cursor", "mcp.json"),
    path.join(roaming, "Cursor", "mcp.json"),
    path.join(roaming, "Cursor", "User", "mcp.json"),
    path.join(roaming, "Cursor", "User", "settings.json"),
  ];
}

function isProcessRunning(processNames: string[]): boolean {
  try {
    const output = execFileSync("tasklist", ["/FO", "CSV"], { encoding: "utf8", windowsHide: true });
    return processNames.some((name) => output.toLowerCase().includes(name.toLowerCase()));
  } catch {
    return false;
  }
}

async function isWritable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function detectCursor(): Promise<ClientDetectionResult> {
  const candidates = getCursorConfigCandidates();
  const running = isProcessRunning(["cursor.exe"]);

  for (const configPath of candidates) {
    try {
      await access(configPath, constants.F_OK);
      const writable = await isWritable(configPath);
      return {
        client: "cursor",
        detected: true,
        configPath,
        configExists: true,
        isWritable: writable,
        isRunning: running,
        recommendedAction: writable ? (running ? "restart_recommended" : "configure") : "read_only",
        details: writable ? "Cursor config detected." : "Cursor config detected but is not writable.",
      };
    } catch {
      continue;
    }
  }

  return {
    client: "cursor",
    detected: false,
    configPath: candidates[0],
    configExists: false,
    isWritable: false,
    isRunning: running,
    recommendedAction: "not_found",
    details: "Cursor config file not found in known locations.",
  };
}
