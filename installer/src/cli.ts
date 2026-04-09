import { detectClaudeDesktop } from "./app-detection/claude.js";
import { detectCodex } from "./app-detection/codex.js";
import { detectCursor } from "./app-detection/cursor.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectNodeRuntime, InstallerPrerequisiteError } from "./payload/node-runtime.js";
import { getFirstTestGuide } from "./post-install/first-test.js";
import { runInstaller } from "./install.js";
import { ClientDetectionResult, InstallOptions, InstallRunResult } from "./types/index.js";

type CliFlags = {
  detectOnly: boolean;
  checkNodeOnly: boolean;
  installDefaults: boolean;
  json: boolean;
  jsonFile?: string;
  help: boolean;
  install: InstallOptions;
};

function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = {
    detectOnly: false,
    checkNodeOnly: false,
    installDefaults: false,
    json: false,
    help: false,
    install: {},
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--detect":
        flags.detectOnly = true;
        break;
      case "--install-defaults":
        flags.installDefaults = true;
        break;
      case "--check-node":
        flags.checkNodeOnly = true;
        break;
      case "--json":
        flags.json = true;
        break;
      case "--json-file":
        flags.jsonFile = argv[index + 1];
        index += 1;
        break;
      case "--help":
      case "-h":
        flags.help = true;
        break;
      case "--codex":
        flags.install.configureCodex = true;
        break;
      case "--claude":
        flags.install.configureClaude = true;
        break;
      case "--cursor":
        flags.install.configureCursor = true;
        break;
      case "--all":
        flags.install.configureCodex = true;
        flags.install.configureClaude = true;
        flags.install.configureCursor = true;
        break;
    }
  }

  return flags;
}

function printHelp(): void {
  console.log(
    [
      "Beacon MCP installer runner",
      "",
      "Usage:",
      "  node dist/cli.js --detect",
      "  node dist/cli.js --check-node",
      "  node dist/cli.js --install-defaults",
      "  node dist/cli.js --all",
      "  node dist/cli.js --codex --claude",
      "  node dist/cli.js --all --json",
      '  node dist/cli.js --install-defaults --json-file "C:\\path\\result.json"',
      "",
      "Options:",
      "  --detect   Detect supported clients only",
      "  --check-node  Check Node.js availability for v1 local runtime",
      "  --install-defaults  Configure detected writable clients automatically",
      "  --codex    Configure Codex",
      "  --claude   Configure Claude Desktop",
      "  --cursor   Configure Cursor",
      "  --all      Configure all supported clients",
      "  --json     Output JSON in addition to text summary",
      "  --json-file <path>  Write the result payload to a JSON file",
      "  --help     Show this help",
    ].join("\n")
  );
}

async function detectAllClients(): Promise<ClientDetectionResult[]> {
  return await Promise.all([detectCodex(), detectClaudeDesktop(), detectCursor()]);
}

function buildDefaultInstallOptions(detections: ClientDetectionResult[]): InstallOptions {
  const install: InstallOptions = {};

  for (const detection of detections) {
    const shouldConfigure = detection.detected && detection.isWritable === true;
    switch (detection.client) {
      case "codex":
        install.configureCodex = shouldConfigure;
        break;
      case "claude":
        install.configureClaude = shouldConfigure;
        break;
      case "cursor":
        install.configureCursor = shouldConfigure;
        break;
    }
  }

  return install;
}

function formatDetection(results: ClientDetectionResult[]): string {
  return [
    "Detected MCP clients:",
    ...results.map((result) =>
      [
        `- ${result.client}: ${result.detected ? "detected" : "not found"}`,
        result.configPath ? `  config: ${result.configPath}` : "",
        typeof result.isWritable === "boolean" ? `  writable: ${result.isWritable ? "yes" : "no"}` : "",
        typeof result.isRunning === "boolean" ? `  running: ${result.isRunning ? "yes" : "no"}` : "",
        result.details ? `  details: ${result.details}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    ),
  ].join("\n");
}

function formatInstallSummary(result: InstallRunResult): string {
  const clientLines = result.clients.map((clientResult) => {
    const status = clientResult.selected
      ? clientResult.patch
        ? clientResult.patch.alreadyConfigured
          ? "already configured"
          : "configured"
        : `skipped (${clientResult.skippedReason ?? "unknown reason"})`
      : "not selected";

    return [
      `- ${clientResult.client}: ${status}`,
      clientResult.detection.configPath ? `  config: ${clientResult.detection.configPath}` : "",
      clientResult.patch?.backupPath ? `  backup: ${clientResult.patch.backupPath}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [
    "Beacon MCP installation summary",
    `Install root: ${result.installRoot}`,
    `Runtime entry: ${result.runtimeEntryPath}`,
    "",
    "Client configuration:",
    ...clientLines,
    "",
    "Validation:",
    `- install root exists: ${result.validation.installRootExists ? "yes" : "no"}`,
    `- runtime entry exists: ${result.validation.runtimeEntryExists ? "yes" : "no"}`,
    `- runtime startup: ${result.validation.runtimeStartupOk ? "ok" : "failed"}`,
    result.validation.runtimeStartupError ? `- runtime error: ${result.validation.runtimeStartupError}` : "",
    "",
    "First test:",
    getFirstTestGuide(),
  ]
    .filter(Boolean)
    .join("\n");
}

async function writeJsonFile(targetPath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help) {
    printHelp();
    return;
  }

  if (flags.detectOnly) {
    const detections = await detectAllClients();
    console.log(formatDetection(detections));
    if (flags.jsonFile) {
      await writeJsonFile(flags.jsonFile, detections);
    }
    if (flags.json) {
      console.log("\nJSON:");
      console.log(JSON.stringify(detections, null, 2));
    }
    return;
  }

  if (flags.checkNodeOnly) {
    const nodeRuntime = await detectNodeRuntime();
    console.log(nodeRuntime.message);
    if (flags.jsonFile) {
      await writeJsonFile(flags.jsonFile, nodeRuntime);
    }
    if (flags.json) {
      console.log("\nJSON:");
      console.log(JSON.stringify(nodeRuntime, null, 2));
    }
    if (!nodeRuntime.detected || !nodeRuntime.supported) {
      process.exitCode = 2;
    }
    return;
  }

  if (flags.installDefaults) {
    const detections = await detectAllClients();
    flags.install = buildDefaultInstallOptions(detections);
  }

  const hasSelection = Object.values(flags.install).some(Boolean);
  if (!hasSelection) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const result = await runInstaller(flags.install);
  console.log(formatInstallSummary(result));
  if (flags.jsonFile) {
    await writeJsonFile(flags.jsonFile, result);
  }
  if (flags.json) {
    console.log("\nJSON:");
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch(async (err) => {
  if (err instanceof InstallerPrerequisiteError) {
    console.error(`Prerequisite check failed: ${err.message}`);
    process.exit(2);
    return;
  }
  console.error("Installer run failed:", err);
  process.exit(1);
});
