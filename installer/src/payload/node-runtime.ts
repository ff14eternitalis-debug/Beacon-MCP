import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NodeRuntimeDetectionResult } from "../types/index.js";

const execFileAsync = promisify(execFile);
const MIN_SUPPORTED_NODE_MAJOR = 20;

function parseNodeMajor(version?: string): number | undefined {
  if (!version) return undefined;
  const normalized = version.trim().replace(/^v/, "");
  const major = Number.parseInt(normalized.split(".")[0] ?? "", 10);
  return Number.isNaN(major) ? undefined : major;
}

export async function detectNodeRuntime(executable = "node"): Promise<NodeRuntimeDetectionResult> {
  try {
    const { stdout, stderr } = await execFileAsync(executable, ["--version"], {
      windowsHide: true,
      timeout: 3000,
    });

    const version = (stdout || stderr || "").trim();
    const major = parseNodeMajor(version);
    const supported = typeof major === "number" && major >= MIN_SUPPORTED_NODE_MAJOR;

    return {
      detected: true,
      executable,
      version,
      major,
      supported,
      message: supported
        ? `Node.js detected (${version}).`
        : `Node.js detected (${version}) but version ${MIN_SUPPORTED_NODE_MAJOR}+ is required.`,
    };
  } catch {
    return {
      detected: false,
      executable,
      supported: false,
      message: `Node.js was not found in PATH. Install Node.js ${MIN_SUPPORTED_NODE_MAJOR}+ before running the local Beacon MCP installer.`,
    };
  }
}

export class InstallerPrerequisiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallerPrerequisiteError";
  }
}
