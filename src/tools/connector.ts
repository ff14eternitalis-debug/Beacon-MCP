import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolDefinition, ToolResult } from "../registry.js";
import { sendConnectorCommand, ConnectorConfig } from "../connector/client.js";
import {
  textResult,
  registerToolGroup,
  errorResult,
  requireString,
  optionalNumber,
} from "./shared.js";

/** Extrait et valide la config connector depuis les args MCP. */
function extractConfig(args: Record<string, unknown>): ConnectorConfig | ToolResult {
  const hostResult = requireString(args, "host");
  if (!hostResult.ok) return hostResult.result;
  const keyResult = requireString(args, "key");
  if (!keyResult.ok) return keyResult.result;
  const portResult = optionalNumber(args, "port");
  if (!portResult.ok) return portResult.result;

  const config: ConnectorConfig = { host: hostResult.value, key: keyResult.value };
  if (portResult.value !== undefined && portResult.value > 0) config.port = portResult.value;
  return config;
}

function formatConnectorError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("ECONNREFUSED")) {
    return `Impossible de se connecter : connexion refusée. Vérifiez que le Connector est démarré sur ${msg.match(/\d+\.\d+\.\d+\.\d+:\d+/)?.[0] ?? "l'hôte"}.`;
  }
  if (msg.includes("ETIMEDOUT") || msg.includes("Timeout")) {
    return `Timeout — le Connector ne répond pas. Vérifiez l'adresse et le pare-feu.`;
  }
  if (msg.includes("CRC32")) {
    return `Erreur de déchiffrement (CRC32). La clé pré-partagée est peut-être incorrecte.`;
  }
  return msg;
}

// ---- beacon_start_server ----

const startServerTool: ToolDefinition = {
  name: "beacon_start_server",
  description:
    "Démarre le serveur de jeu via le Connector Beacon (démon local TCP). " +
    "host : adresse IP ou hostname de la machine hébergeant le Connector. " +
    "key : clé pré-partagée (champ 'Encryption Key' dans config.json du Connector). " +
    "port : optionnel, défaut 48962.",
  inputSchema: {
    type: "object",
    properties: {
      host: { type: "string", description: "Adresse IP ou hostname du Connector" },
      key: {
        type: "string",
        description: "Clé pré-partagée du Connector (hex 64 chars ou chaîne quelconque)",
      },
      port: { type: "number", description: "Port TCP du Connector (défaut : 48962)" },
    },
    required: ["host", "key"],
  },
  handler: async (args) => {
    const config = extractConfig(args);
    if ("content" in config) return config;
    try {
      const res = await sendConnectorCommand(config, "Start");
      const success = res["Success"] === true;
      return success
        ? textResult(
        success
          ? `Serveur démarré avec succès sur ${config.host}.`
          : `Le Connector a retourné un échec lors du démarrage.`,
        res,
        { host: config.host, port: config.port }
      )
        : errorResult(`Le Connector a retourné un échec lors du démarrage.`, "connector_start_failed", res, {
            host: config.host,
            port: config.port,
          });
    } catch (err) {
      return errorResult(formatConnectorError(err), "connector_error");
    }
  },
};

// ---- beacon_stop_server ----

const stopServerTool: ToolDefinition = {
  name: "beacon_stop_server",
  description:
    "Arrête le serveur de jeu via le Connector Beacon. " +
    "message : message affiché aux joueurs avant l'arrêt (optionnel, substitué via %message% dans la Stop Command). " +
    "host : adresse IP ou hostname. key : clé pré-partagée. port : optionnel.",
  inputSchema: {
    type: "object",
    properties: {
      host: { type: "string", description: "Adresse IP ou hostname du Connector" },
      key: { type: "string", description: "Clé pré-partagée du Connector" },
      port: { type: "number", description: "Port TCP (défaut : 48962)" },
      message: {
        type: "string",
        description: "Message de shutdown affiché aux joueurs (remplace %message% dans la Stop Command)",
      },
    },
    required: ["host", "key"],
  },
  handler: async (args) => {
    const config = extractConfig(args);
    if ("content" in config) return config;
    const extra: Record<string, unknown> = {};
    if (typeof args.message === "string" && args.message.trim()) {
      extra["Message"] = args.message.trim();
    }
    try {
      const res = await sendConnectorCommand(config, "Stop", extra);
      const success = res["Success"] === true;
      return success
        ? textResult(
        success
          ? `Serveur arrêté avec succès sur ${config.host}.`
          : `Le Connector a retourné un échec lors de l'arrêt.`,
        res,
        { host: config.host, port: config.port, message: extra["Message"] }
      )
        : errorResult(`Le Connector a retourné un échec lors de l'arrêt.`, "connector_stop_failed", res, {
            host: config.host,
            port: config.port,
            message: extra["Message"],
          });
    } catch (err) {
      return errorResult(formatConnectorError(err), "connector_error");
    }
  },
};

// ---- beacon_get_server_status ----

const getServerStatusTool: ToolDefinition = {
  name: "beacon_get_server_status",
  description:
    "Vérifie si le serveur de jeu est démarré ou arrêté via le Connector Beacon. " +
    "host : adresse IP ou hostname. key : clé pré-partagée. port : optionnel.",
  inputSchema: {
    type: "object",
    properties: {
      host: { type: "string", description: "Adresse IP ou hostname du Connector" },
      key: { type: "string", description: "Clé pré-partagée du Connector" },
      port: { type: "number", description: "Port TCP (défaut : 48962)" },
    },
    required: ["host", "key"],
  },
  handler: async (args) => {
    const config = extractConfig(args);
    if ("content" in config) return config;
    try {
      const res = await sendConnectorCommand(config, "Status");
      const status = res["Status"] as string | undefined;
      const label =
        status === "started"
          ? "Serveur en cours d'exécution."
          : status === "stopped"
          ? "Serveur arrêté."
          : `Statut inconnu : ${status}`;
      return textResult(`${config.host} — ${label}`, res, { host: config.host, port: config.port });
    } catch (err) {
      return errorResult(formatConnectorError(err), "connector_error");
    }
  },
};

// ---- beacon_set_server_param ----

const setServerParamTool: ToolDefinition = {
  name: "beacon_set_server_param",
  description:
    "Modifie un paramètre de configuration du serveur via le Connector Beacon (en live, sans redémarrage). " +
    "param : nom du paramètre (remplace %key% dans la Set Parameter Command). " +
    "value : nouvelle valeur (remplace %value%). " +
    "host : adresse IP ou hostname. key : clé pré-partagée. port : optionnel.",
  inputSchema: {
    type: "object",
    properties: {
      host: { type: "string", description: "Adresse IP ou hostname du Connector" },
      key: { type: "string", description: "Clé pré-partagée du Connector" },
      port: { type: "number", description: "Port TCP (défaut : 48962)" },
      param: {
        type: "string",
        description: "Nom du paramètre à modifier (remplace %key% dans la Set Parameter Command)",
      },
      value: {
        type: "string",
        description: "Nouvelle valeur du paramètre (remplace %value%)",
      },
    },
    required: ["host", "key", "param", "value"],
  },
  handler: async (args) => {
    const config = extractConfig(args);
    if ("content" in config) return config;
    const paramResult = requireString(args, "param");
    if (!paramResult.ok) return paramResult.result;
    const valueResult = requireString(args, "value");
    if (!valueResult.ok) return valueResult.result;
    const param = paramResult.value;
    const value = valueResult.value;
    try {
      const res = await sendConnectorCommand(config, "Param", {
        Param: param,
        Value: value,
      });
      const success = res["Success"] === true;
      if (success) {
        return textResult(`Paramètre "${param}" mis à jour avec la valeur "${value}".`, res, {
          host: config.host,
          port: config.port,
          param,
          value,
        });
      }
      const reason = (res["Reason"] as string | undefined) ?? "Raison inconnue";
      return errorResult(`Échec de la mise à jour du paramètre : ${reason}`, "connector_param_failed", res, {
        host: config.host,
        port: config.port,
        param,
      });
    } catch (err) {
      return errorResult(formatConnectorError(err), "connector_error");
    }
  },
};

// ---- Enregistrement ----

export function registerConnectorTools(server: McpServer): void {
  registerToolGroup(server, [
    startServerTool,
    stopServerTool,
    getServerStatusTool,
    setServerParamTool,
  ]);
}
