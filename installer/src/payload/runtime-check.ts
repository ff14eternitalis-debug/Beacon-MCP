import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { getRuntimeLayout } from "./install-path.js";
import { detectNodeRuntime } from "./node-runtime.js";

export async function runtimeEntryExists(): Promise<boolean> {
  try {
    await access(getRuntimeLayout().runtimeEntryPath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function verifyRuntimeStartup(timeoutMs = 1500): Promise<{ ok: boolean; stderr?: string }> {
  const runtime = getRuntimeLayout();
  const exists = await runtimeEntryExists();
  if (!exists) {
    return { ok: false, stderr: "Runtime entry not found." };
  }

  const nodeRuntime = await detectNodeRuntime(runtime.commandConfig.command);
  if (!nodeRuntime.detected || !nodeRuntime.supported) {
    return { ok: false, stderr: nodeRuntime.message };
  }

  return await new Promise((resolve) => {
    const child = spawn(runtime.commandConfig.command, runtime.commandConfig.args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stderr = "";
    let settled = false;
    const successMarker = "Beacon MCP server démarré (stdio)";

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      const normalized = stderr.trim();
      resolve({
        ok: normalized.length === 0 || normalized.includes(successMarker),
        stderr: normalized && !normalized.includes(successMarker) ? normalized : undefined,
      });
    }, timeoutMs);

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const normalized = stderr.trim();
      resolve({
        ok: code === 0 || normalized.includes(successMarker),
        stderr: normalized && !normalized.includes(successMarker) ? normalized : undefined,
      });
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stderr: err.message });
    });
  });
}
