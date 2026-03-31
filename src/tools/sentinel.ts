import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolDefinition } from "../registry.js";
import { beaconClient } from "../api/client.js";
import { randomUUID } from "crypto";
import { textResult, formatApiError, registerToolGroup } from "./shared.js";

// ---- beacon_list_players ----

const listPlayersTool: ToolDefinition = {
  name: "beacon_list_players",
  description:
    "Liste les joueurs connus d'un service Sentinel (historique des connexions). " +
    "Retourne les IDs EOS/Steam et noms de joueurs. " +
    "Nécessite un token Sentinel configuré pour le service. " +
    "serviceId : ID UUID du service Sentinel.",
  inputSchema: {
    type: "object",
    properties: {
      serviceId: { type: "string", description: "ID UUID du service Sentinel" },
    },
    required: ["serviceId"],
  },
  handler: async (args) => {
    const { serviceId } = args;
    if (typeof serviceId !== "string" || !serviceId) {
      return textResult("Paramètre serviceId requis.");
    }
    try {
      const res = await beaconClient.get("/sentinel/players", {
        params: { serviceId, pageSize: "100" },
      });
      const players: Record<string, unknown>[] = res.data?.results ?? res.data ?? [];
      const total: number = res.data?.totalResults ?? res.data?.totalCount ?? players.length;
      if (!Array.isArray(players) || players.length === 0) {
        return textResult(`Aucun joueur trouvé pour le service ${serviceId}.`);
      }
      const lines = players.map(
        (p) =>
          `• [${p.playerId ?? p.id}] ${p.playerName ?? p.name ?? "Inconnu"}`
      );
      return textResult(
        `Joueurs du service ${serviceId} — ${players.length}/${total} :\n${lines.join("\n")}`
      );
    } catch (err) {
      return textResult(formatApiError(err, "sentinel"));
    }
  },
};

// ---- beacon_ban_player ----

const banPlayerTool: ToolDefinition = {
  name: "beacon_ban_player",
  description:
    "Bannit un joueur d'un service Sentinel. " +
    "serviceId : ID UUID du service. " +
    "playerId : ID du joueur (format '0002EPICID', récupérable via beacon_list_players). " +
    "reason : raison du ban (optionnel). " +
    "expiration : timestamp Unix d'expiration du ban (optionnel, permanent si absent).",
  inputSchema: {
    type: "object",
    properties: {
      serviceId: { type: "string", description: "ID UUID du service Sentinel" },
      playerId: {
        type: "string",
        description: "ID du joueur à bannir (format EOS: '0002...', récupérable via beacon_list_players)",
      },
      reason: { type: "string", description: "Raison du ban (optionnel)" },
      expiration: {
        type: "number",
        description: "Timestamp Unix d'expiration du ban (optionnel, ban permanent si absent)",
      },
    },
    required: ["serviceId", "playerId"],
  },
  handler: async (args) => {
    const { serviceId, playerId, reason, expiration } = args;
    if (typeof serviceId !== "string" || !serviceId) {
      return textResult("Paramètre serviceId requis.");
    }
    if (typeof playerId !== "string" || !playerId) {
      return textResult("Paramètre playerId requis.");
    }
    try {
      // L'API attend un ID côté client (POST /sentinel/serviceBans/{id})
      const banId = randomUUID();
      const body: Record<string, unknown> = { serviceId, playerId };
      if (typeof reason === "string" && reason.trim()) body.comments = reason.trim();
      if (typeof expiration === "number") body.expiration = expiration;

      await beaconClient.post(`/sentinel/serviceBans/${banId}`, body);
      return textResult(
        [
          `Joueur ${playerId} banni du service ${serviceId}.`,
          `ID du ban : ${banId}`,
          reason ? `Raison : ${reason}` : "",
          expiration
            ? `Expiration : ${new Date((expiration as number) * 1000).toLocaleString("fr-FR")}`
            : "Durée : permanente",
        ]
          .filter(Boolean)
          .join("\n")
      );
    } catch (err) {
      return textResult(formatApiError(err, "sentinel"));
    }
  },
};

// ---- beacon_unban_player ----

const unbanPlayerTool: ToolDefinition = {
  name: "beacon_unban_player",
  description:
    "Lève le ban d'un joueur sur un service Sentinel. " +
    "serviceId : ID UUID du service. playerId : ID du joueur à débannir.",
  inputSchema: {
    type: "object",
    properties: {
      serviceId: { type: "string", description: "ID UUID du service Sentinel" },
      playerId: { type: "string", description: "ID du joueur à débannir" },
    },
    required: ["serviceId", "playerId"],
  },
  handler: async (args) => {
    const { serviceId, playerId } = args;
    if (typeof serviceId !== "string" || !serviceId) {
      return textResult("Paramètre serviceId requis.");
    }
    if (typeof playerId !== "string" || !playerId) {
      return textResult("Paramètre playerId requis.");
    }
    try {
      // 1. Chercher les bans actifs pour ce joueur sur ce service
      const listRes = await beaconClient.get("/sentinel/serviceBans", {
        params: { serviceId, playerId, expired: "false" },
      });
      const bans: Record<string, unknown>[] =
        listRes.data?.results ?? listRes.data ?? [];
      if (!Array.isArray(bans) || bans.length === 0) {
        return textResult(
          `Aucun ban actif trouvé pour le joueur ${playerId} sur le service ${serviceId}.`
        );
      }
      // 2. Supprimer tous les bans actifs trouvés
      const banIds = bans.map((b) => b.serviceBanId ?? b.banId ?? b.id);
      await Promise.all(banIds.map((banId) => beaconClient.delete(`/sentinel/serviceBans/${banId}`)));
      return textResult(
        `Ban(s) levé(s) pour le joueur ${playerId} sur le service ${serviceId}. ` +
          `(${banIds.length} ban(s) supprimé(s))`
      );
    } catch (err) {
      return textResult(formatApiError(err, "sentinel"));
    }
  },
};

// ---- beacon_send_chat ----

const sendChatTool: ToolDefinition = {
  name: "beacon_send_chat",
  description:
    "Envoie un message dans le chat in-game d'un serveur via Sentinel. " +
    "serviceId : ID UUID du service Sentinel. " +
    "message : texte à envoyer. " +
    "senderName : nom de l'expéditeur affiché (optionnel, défaut : 'Server'). " +
    "languageCode : code langue ISO (optionnel, ex: 'fr', défaut : 'en').",
  inputSchema: {
    type: "object",
    properties: {
      serviceId: { type: "string", description: "ID UUID du service Sentinel" },
      message: { type: "string", description: "Message à envoyer dans le chat in-game" },
      senderName: {
        type: "string",
        description: "Nom affiché comme expéditeur (optionnel, ex: 'Server', 'Admin')",
      },
      languageCode: {
        type: "string",
        description: "Code langue ISO 639-1 (optionnel, ex: 'fr', 'en')",
      },
    },
    required: ["serviceId", "message"],
  },
  handler: async (args) => {
    const { serviceId, message, senderName, languageCode } = args;
    if (typeof serviceId !== "string" || !serviceId) {
      return textResult("Paramètre serviceId requis.");
    }
    if (typeof message !== "string" || !message.trim()) {
      return textResult("Paramètre message requis.");
    }
    try {
      const body: Record<string, unknown> = { serviceId, message };
      if (typeof senderName === "string" && senderName.trim()) body.senderName = senderName.trim();
      if (typeof languageCode === "string" && languageCode.trim()) body.languageCode = languageCode.trim();

      await beaconClient.post("/sentinel/chat", body);
      // L'API retourne 204 No Content en cas de succès
      return textResult(
        `Message envoyé dans le chat du service ${serviceId} : "${message}"`
      );
    } catch (err) {
      return textResult(formatApiError(err, "sentinel"));
    }
  },
};

// ---- beacon_run_rcon ----

const runRconTool: ToolDefinition = {
  name: "beacon_run_rcon",
  description:
    "Exécute une commande ou diffuse un message sur un serveur de jeu via Sentinel. " +
    "type : 'admin' (commande RCON brute), 'broadcast' (message à tous), 'chat' (message chat). " +
    "Pour type 'admin' : renseigner command (ex: SaveWorld, banplayer EPICID, destroywilddinos). " +
    "Pour type 'broadcast' ou 'chat' : renseigner message. " +
    "serviceId : ID UUID du service Sentinel.",
  inputSchema: {
    type: "object",
    properties: {
      serviceId: { type: "string", description: "ID UUID du service Sentinel" },
      type: {
        type: "string",
        enum: ["admin", "broadcast", "chat"],
        description:
          "Type de commande : 'admin' (RCON brut), 'broadcast' (message global), 'chat' (message chat)",
      },
      command: {
        type: "string",
        description:
          "Commande RCON à exécuter (pour type 'admin', ex: SaveWorld, banplayer 0002ID, cheat god)",
      },
      message: {
        type: "string",
        description: "Message à diffuser (pour type 'broadcast' ou 'chat')",
      },
      senderName: {
        type: "string",
        description: "Nom de l'expéditeur (optionnel, pour broadcast/chat)",
      },
    },
    required: ["serviceId", "type"],
  },
  handler: async (args) => {
    const { serviceId, type, command, message, senderName } = args;
    if (typeof serviceId !== "string" || !serviceId) {
      return textResult("Paramètre serviceId requis.");
    }
    if (!["admin", "broadcast", "chat"].includes(type as string)) {
      return textResult("Paramètre type invalide. Valeurs : 'admin', 'broadcast', 'chat'.");
    }

    const body: Record<string, unknown> = { serviceId, type };

    if (type === "admin") {
      if (typeof command !== "string" || !command.trim()) {
        return textResult("Paramètre command requis pour type 'admin'.");
      }
      body.command = command.trim();
    } else {
      if (typeof message !== "string" || !message.trim()) {
        return textResult("Paramètre message requis pour type 'broadcast'/'chat'.");
      }
      body.message = message.trim();
      if (typeof senderName === "string" && senderName.trim()) body.senderName = senderName.trim();
    }

    try {
      await beaconClient.post("/sentinel/gameCommands", body);
      // L'API retourne 204 No Content en cas de succès
      const summary =
        type === "admin"
          ? `Commande RCON exécutée : ${command}`
          : `Message diffusé (${type}) sur le service ${serviceId} : "${message}"`;
      return textResult(summary);
    } catch (err) {
      return textResult(formatApiError(err, "sentinel"));
    }
  },
};

// ---- Enregistrement ----

export function registerSentinelTools(server: McpServer): void {
  registerToolGroup(server, [
    listPlayersTool,
    banPlayerTool,
    unbanPlayerTool,
    sendChatTool,
    runRconTool,
  ]);
}
