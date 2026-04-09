import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { getRuntimeLayout } from "../payload/install-path.js";
import { runtimeEntryExists, verifyRuntimeStartup } from "../payload/runtime-check.js";
import { ClientInstallResult, PostInstallValidationResult } from "../types/index.js";

async function pathExists(filePath?: string): Promise<boolean> {
  if (!filePath) return false;
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function validateInstallation(
  clients: ClientInstallResult[]
): Promise<PostInstallValidationResult> {
  const runtime = getRuntimeLayout();
  const installRootExists = await pathExists(runtime.installRoot);
  const entryExists = await runtimeEntryExists();
  const startup = await verifyRuntimeStartup();

  const clientConfigChecks = await Promise.all(
    clients
      .filter((client) => client.selected)
      .map(async (client) => ({
        client: client.client,
        configPath: client.detection.configPath,
        exists: await pathExists(client.detection.configPath),
      }))
  );

  return {
    installRootExists,
    runtimeEntryExists: entryExists,
    runtimeStartupOk: startup.ok,
    runtimeStartupError: startup.stderr,
    clientConfigChecks,
  };
}
