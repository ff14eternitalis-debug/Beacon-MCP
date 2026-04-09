import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createBackup } from "./backup.js";
import { getRuntimeLayout } from "../payload/install-path.js";
import { PatchResult } from "../types/index.js";

const SECTION_HEADER = "[mcp_servers.beacon]";

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildBeaconSection(): string {
  const runtime = getRuntimeLayout();
  const args = runtime.commandConfig.args.map((arg) => `"${escapeTomlString(arg)}"`).join(", ");
  return [
    SECTION_HEADER,
    `command = "${escapeTomlString(runtime.commandConfig.command)}"`,
    `args = [${args}]`,
    "",
    "",
  ].join("\n");
}

function upsertBeaconSection(content: string): { content: string; alreadyConfigured: boolean; updated: boolean } {
  const beaconSection = buildBeaconSection();
  const trimmedOriginal = content.trim();
  const sectionRegex = /^\[mcp_servers\.beacon\]\r?\n(?:.*(?:\r?\n|$))*?(?=^\[|\Z)/m;
  const normalizedBeaconSection = beaconSection.endsWith("\n") ? beaconSection : `${beaconSection}\n`;

  if (sectionRegex.test(content)) {
    const replaced = content.replace(sectionRegex, normalizedBeaconSection);
    return {
      content: replaced.endsWith("\n") ? replaced : `${replaced}\n`,
      alreadyConfigured: trimmedOriginal.includes(normalizedBeaconSection.trim()),
      updated: true,
    };
  }

  const separator = trimmedOriginal.length > 0 ? "\n\n" : "";
  return {
    content: `${trimmedOriginal}${separator}${normalizedBeaconSection}`.replace(/^\n+/, ""),
    alreadyConfigured: false,
    updated: true,
  };
}

export async function patchCodexConfig(configPath: string): Promise<PatchResult> {
  await mkdir(path.dirname(configPath), { recursive: true });

  let existing = "";
  let created = false;
  let backupPath: string | undefined;

  try {
    existing = await readFile(configPath, "utf8");
    const backup = await createBackup(configPath);
    backupPath = backup.backupPath;
  } catch {
    created = true;
  }

  const result = upsertBeaconSection(existing);
  await writeFile(configPath, result.content, "utf8");

  return {
    client: "codex",
    configPath,
    backupPath,
    created,
    updated: result.updated,
    alreadyConfigured: result.alreadyConfigured,
  };
}
