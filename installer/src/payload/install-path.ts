import os from "node:os";
import path from "node:path";
import { RuntimeLayout } from "../types/index.js";

export const INSTALL_DIR_NAME = "BeaconMCP";

export function getLocalAppDataPath(): string {
  return process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
}

export function getInstallRoot(): string {
  return path.join(getLocalAppDataPath(), INSTALL_DIR_NAME);
}

export function getRuntimeEntryPath(installRoot = getInstallRoot()): string {
  return path.join(installRoot, "dist", "index.js");
}

export function getRuntimeLayout(): RuntimeLayout {
  const installRoot = getInstallRoot();
  const runtimeEntryPath = getRuntimeEntryPath(installRoot);

  return {
    installRoot,
    runtimeEntryPath,
    commandConfig: {
      command: "node",
      args: [runtimeEntryPath],
    },
  };
}
