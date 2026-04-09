import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createBackup } from "./backup.js";
import { getRuntimeLayout } from "../payload/install-path.js";
import { PatchResult } from "../types/index.js";

type ClaudeConfig = {
  mcpServers?: Record<string, { command: string; args: string[] }>;
  [key: string]: unknown;
};

function buildBeaconEntry() {
  return getRuntimeLayout().commandConfig;
}

export async function patchClaudeConfig(configPath: string): Promise<PatchResult> {
  await mkdir(path.dirname(configPath), { recursive: true });

  let config: ClaudeConfig = {};
  let created = false;
  let backupPath: string | undefined;

  try {
    const raw = await readFile(configPath, "utf8");
    config = JSON.parse(raw) as ClaudeConfig;
    const backup = await createBackup(configPath);
    backupPath = backup.backupPath;
  } catch {
    created = true;
  }

  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    config.mcpServers = {};
  }

  const beaconEntry = buildBeaconEntry();
  const current = config.mcpServers.beacon;
  const alreadyConfigured =
    current?.command === beaconEntry.command &&
    JSON.stringify(current.args ?? []) === JSON.stringify(beaconEntry.args);

  config.mcpServers.beacon = beaconEntry;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  return {
    client: "claude",
    configPath,
    backupPath,
    created,
    updated: true,
    alreadyConfigured,
  };
}
