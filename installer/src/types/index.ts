export type SupportedClient = "codex" | "claude" | "cursor";

export type RecommendedAction =
  | "configure"
  | "already_configured"
  | "restart_recommended"
  | "not_found"
  | "read_only";

export interface ClientDetectionResult {
  client: SupportedClient;
  detected: boolean;
  configPath?: string;
  configExists?: boolean;
  isWritable?: boolean;
  isRunning?: boolean;
  recommendedAction: RecommendedAction;
  details?: string;
}

export interface BackupResult {
  originalPath: string;
  backupPath: string;
}

export interface PatchResult {
  client: SupportedClient;
  configPath: string;
  backupPath?: string;
  created: boolean;
  updated: boolean;
  alreadyConfigured: boolean;
}

export interface BeaconMcpCommandConfig {
  command: string;
  args: string[];
}

export interface RuntimeLayout {
  installRoot: string;
  runtimeEntryPath: string;
  commandConfig: BeaconMcpCommandConfig;
}

export interface NodeRuntimeDetectionResult {
  detected: boolean;
  executable: string;
  version?: string;
  major?: number;
  supported: boolean;
  message: string;
}

export interface InstallOptions {
  configureCodex?: boolean;
  configureClaude?: boolean;
  configureCursor?: boolean;
}

export interface ClientInstallResult {
  client: SupportedClient;
  selected: boolean;
  detection: ClientDetectionResult;
  patch?: PatchResult;
  skippedReason?: string;
}

export interface PostInstallValidationResult {
  installRootExists: boolean;
  runtimeEntryExists: boolean;
  runtimeStartupOk: boolean;
  runtimeStartupError?: string;
  clientConfigChecks: Array<{
    client: SupportedClient;
    configPath?: string;
    exists: boolean;
  }>;
}

export interface InstallRunResult {
  nodeRuntime: NodeRuntimeDetectionResult;
  installRoot: string;
  runtimeEntryPath: string;
  clients: ClientInstallResult[];
  validation: PostInstallValidationResult;
}
