import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createBackup } from "./backup.js";
import { getRuntimeLayout } from "../payload/install-path.js";
import { PatchResult } from "../types/index.js";

type CursorConfig = {
  mcpServers?: Record<string, { command: string; args: string[] }>;
  [key: string]: unknown;
};

function buildBeaconEntry() {
  return getRuntimeLayout().commandConfig;
}

function normalizeCursorConfig(config: CursorConfig): CursorConfig {
  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    config.mcpServers = {};
  }
  return config;
}

export async function patchCursorConfig(configPath: string): Promise<PatchResult> {
  await mkdir(path.dirname(configPath), { recursive: true });

  let config: CursorConfig = {};
  let created = false;
  let backupPath: string | undefined;

  try {
    const raw = await readFile(configPath, "utf8");
    config = normalizeCursorConfig(JSON.parse(raw) as CursorConfig);
    const backup = await createBackup(configPath);
    backupPath = backup.backupPath;
  } catch {
    created = true;
    config = normalizeCursorConfig({});
  }

  const beaconEntry = buildBeaconEntry();
  const current = config.mcpServers?.beacon;
  const alreadyConfigured =
    current?.command === beaconEntry.command &&
    JSON.stringify(current.args ?? []) === JSON.stringify(beaconEntry.args);

  config.mcpServers!.beacon = beaconEntry;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  return {
    client: "cursor",
    configPath,
    backupPath,
    created,
    updated: true,
    alreadyConfigured,
  };
}
