import { access } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ClientDetectionResult } from "../types/index.js";

function getClaudeConfigPath(): string {
  const roaming = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  return path.join(roaming, "Claude", "claude_desktop_config.json");
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

export async function detectClaudeDesktop(): Promise<ClientDetectionResult> {
  const configPath = getClaudeConfigPath();
  const running = isProcessRunning(["claude.exe"]);

  try {
    await access(configPath, constants.F_OK);
    const writable = await isWritable(configPath);
    return {
      client: "claude",
      detected: true,
      configPath,
      configExists: true,
      isWritable: writable,
      isRunning: running,
      recommendedAction: writable ? (running ? "restart_recommended" : "configure") : "read_only",
      details: writable
        ? "Claude Desktop config detected."
        : "Claude Desktop config detected but is not writable.",
    };
  } catch {
    return {
      client: "claude",
      detected: false,
      configPath,
      configExists: false,
      isWritable: false,
      isRunning: running,
      recommendedAction: "not_found",
      details: "Claude Desktop config file not found.",
    };
  }
}
