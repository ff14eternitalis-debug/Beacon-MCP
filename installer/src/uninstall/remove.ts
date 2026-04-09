import { rm } from "node:fs/promises";
import { getInstallRoot } from "../payload/install-path.js";

export async function removeInstalledRuntime(installRoot = getInstallRoot()): Promise<void> {
  await rm(installRoot, { recursive: true, force: true });
}
