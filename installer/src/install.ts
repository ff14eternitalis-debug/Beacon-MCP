import { detectClaudeDesktop } from "./app-detection/claude.js";
import { detectCodex } from "./app-detection/codex.js";
import { detectCursor } from "./app-detection/cursor.js";
import { patchClaudeConfig } from "./config-patch/claude-config.js";
import { patchCodexConfig } from "./config-patch/codex-config.js";
import { patchCursorConfig } from "./config-patch/cursor-config.js";
import { copyRuntimeToInstallRoot } from "./payload/copy-runtime.js";
import { getRuntimeLayout } from "./payload/install-path.js";
import { detectNodeRuntime, InstallerPrerequisiteError } from "./payload/node-runtime.js";
import { validateInstallation } from "./post-install/validation.js";
import { ClientInstallResult, InstallOptions, InstallRunResult } from "./types/index.js";

export async function runInstaller(options: InstallOptions = {}): Promise<InstallRunResult> {
  const runtime = getRuntimeLayout();
  const nodeRuntime = await detectNodeRuntime(runtime.commandConfig.command);

  if (!nodeRuntime.detected || !nodeRuntime.supported) {
    throw new InstallerPrerequisiteError(nodeRuntime.message);
  }

  await copyRuntimeToInstallRoot(runtime.installRoot);

  const [codexDetection, claudeDetection, cursorDetection] = await Promise.all([
    detectCodex(),
    detectClaudeDesktop(),
    detectCursor(),
  ]);

  const results: ClientInstallResult[] = [];

  if (options.configureCodex) {
    if (codexDetection.detected && codexDetection.configPath && codexDetection.isWritable) {
      const patch = await patchCodexConfig(codexDetection.configPath);
      results.push({ client: "codex", selected: true, detection: codexDetection, patch });
    } else {
      results.push({
        client: "codex",
        selected: true,
        detection: codexDetection,
        skippedReason: codexDetection.detected ? "Config not writable." : "Client config not found.",
      });
    }
  } else {
    results.push({ client: "codex", selected: false, detection: codexDetection, skippedReason: "Not selected." });
  }

  if (options.configureClaude) {
    if (claudeDetection.detected && claudeDetection.configPath && claudeDetection.isWritable) {
      const patch = await patchClaudeConfig(claudeDetection.configPath);
      results.push({ client: "claude", selected: true, detection: claudeDetection, patch });
    } else {
      results.push({
        client: "claude",
        selected: true,
        detection: claudeDetection,
        skippedReason: claudeDetection.detected ? "Config not writable." : "Client config not found.",
      });
    }
  } else {
    results.push({ client: "claude", selected: false, detection: claudeDetection, skippedReason: "Not selected." });
  }

  if (options.configureCursor) {
    if (cursorDetection.configPath && (cursorDetection.isWritable || !cursorDetection.detected)) {
      const patch = await patchCursorConfig(cursorDetection.configPath);
      results.push({ client: "cursor", selected: true, detection: cursorDetection, patch });
    } else {
      results.push({
        client: "cursor",
        selected: true,
        detection: cursorDetection,
        skippedReason: cursorDetection.detected ? "Config not writable." : "Client config path unavailable.",
      });
    }
  } else {
    results.push({ client: "cursor", selected: false, detection: cursorDetection, skippedReason: "Not selected." });
  }

  const validation = await validateInstallation(results);

  return {
    nodeRuntime,
    installRoot: runtime.installRoot,
    runtimeEntryPath: runtime.runtimeEntryPath,
    clients: results,
    validation,
  };
}
