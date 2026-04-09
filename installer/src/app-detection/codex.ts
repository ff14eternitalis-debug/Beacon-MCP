import { access } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ClientDetectionResult } from "../types/index.js";

function getCodexConfigPath(): string {
  return path.join(os.homedir(), ".codex", "config.toml");
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

export async function detectCodex(): Promise<ClientDetectionResult> {
  const configPath = getCodexConfigPath();
  const running = isProcessRunning(["codex.exe"]);

  try {
    await access(configPath, constants.F_OK);
    const writable = await isWritable(configPath);
    return {
      client: "codex",
      detected: true,
      configPath,
      configExists: true,
      isWritable: writable,
      isRunning: running,
      recommendedAction: writable ? (running ? "restart_recommended" : "configure") : "read_only",
      details: writable
        ? "Codex config detected."
        : "Codex config detected but is not writable.",
    };
  } catch {
    return {
      client: "codex",
      detected: false,
      configPath,
      configExists: false,
      isWritable: false,
      isRunning: running,
      recommendedAction: "not_found",
      details: "Codex config.toml not found.",
    };
  }
}
