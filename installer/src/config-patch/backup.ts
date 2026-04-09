import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { BackupResult } from "../types/index.js";

function timestamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

export async function createBackup(originalPath: string): Promise<BackupResult> {
  const backupPath = `${originalPath}.${timestamp()}.bak`;
  await mkdir(path.dirname(originalPath), { recursive: true });
  await copyFile(originalPath, backupPath);
  return { originalPath, backupPath };
}
