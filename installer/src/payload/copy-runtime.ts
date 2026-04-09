import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { getInstallRoot } from "./install-path.js";

function getProjectRoot(): string {
  return path.resolve(__dirname, "..", "..", "..");
}

const RUNTIME_ITEMS = ["dist", "node_modules", "package.json", ".env.example", "README.md"];

export async function copyRuntimeToInstallRoot(installRoot = getInstallRoot()): Promise<string> {
  const projectRoot = getProjectRoot();

  await mkdir(installRoot, { recursive: true });

  for (const item of RUNTIME_ITEMS) {
    const source = path.join(projectRoot, item);
    const target = path.join(installRoot, item);

    await rm(target, { recursive: true, force: true });
    await cp(source, target, { recursive: true, force: true });
  }

  return installRoot;
}
