import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beaconClient } from "../api/client.js";
import { ToolDefinition } from "../registry.js";
import {
  formatApiError,
  invalidParams,
  optionalNumber,
  optionalString,
  registerToolGroup,
  requireLiteralString,
  requireString,
  textResult,
} from "./shared.js";

type SentinelRecord = Record<string, unknown>;

function listLabel(record: SentinelRecord, config: { kind: string; idKeys: string[]; labelKeys: string[] }): string {
  const id = config.idKeys.map((key) => record[key]).find((value) => value !== undefined && value !== null);
  const label = config.labelKeys
    .map((key) => record[key])
    .find((value) => typeof value === "string" && value.trim().length > 0);

  switch (config.kind) {
    case "service":
      return (
        `• [${id ?? "?"}] ${label ?? "Service sans nom"}` +
        ` — jeu: ${record.gameId ?? "?"}` +
        ` — connecte: ${record.isConnected === true ? "oui" : "non"}` +
        ` — joueurs: ${record.currentPlayers ?? 0}/${record.maxPlayers ?? 0}`
      );
    case "group":
      return (
        `• [${id ?? "?"}] ${label ?? "Groupe sans nom"}` +
        (record.color ? ` — couleur: ${record.color}` : "") +
        ` — chat groupe: ${record.enableGroupChat === true ? "oui" : "non"}`
      );
    case "bucket":
      return (
        `• [${id ?? "?"}] ${label ?? "Bucket sans nom"}` +
        (record.username ? ` — owner: ${record.username}` : "")
      );
    case "script":
      return (
        `• [${id ?? "?"}] ${label ?? "Script sans nom"}` +
        (record.approvalStatus ? ` — statut: ${record.approvalStatus}` : "") +
        (record.communityStatus ? ` — communaute: ${record.communityStatus}` : "")
      );
    default:
      return `• [${id ?? "?"}] ${label ?? "Sans nom"}`;
  }
}

async function listSentinelEndpoint(
  endpoint: string,
  filters?: Record<string, string | undefined>
): Promise<{ items: SentinelRecord[]; total: number }> {
  const params: Record<string, string> = { pageSize: "100" };
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (typeof value === "string" && value.trim().length > 0) {
      params[key] = value;
    }
  }

  const res = await beaconClient.get(`/sentinel/${endpoint}`, { params });
  const items: SentinelRecord[] = res.data?.results ?? res.data ?? [];
  const total: number = res.data?.totalResults ?? res.data?.totalCount ?? items.length;
  return { items, total };
}

async function getSentinelEndpoint(endpoint: string, id: string): Promise<SentinelRecord> {
  const res = await beaconClient.get(`/sentinel/${endpoint}/${id}`);
  return res.data as SentinelRecord;
}

function buildSentinelListTool(config: {
  name: string;
  description: string;
  endpoint: string;
  title: string;
  emptyLabel: string;
  kind: "service" | "group" | "bucket" | "script";
  idKeys: string[];
  labelKeys: string[];
  filterField: "name" | "searchableName";
  extraFilter?: {
    field: string;
    description: string;
  };
}) {
  const inputProperties: Record<string, unknown> = {
    filter: {
      type: "string",
      description: "Filtre textuel optionnel",
    },
  };

  if (config.extraFilter) {
    inputProperties[config.extraFilter.field] = {
      type: "string",
      description: config.extraFilter.description,
    };
  }

  const tool: ToolDefinition = {
    name: config.name,
    description: config.description,
    inputSchema: {
      type: "object",
      properties: inputProperties,
    },
    handler: async (args) => {
      const filterResult = optionalString(args, "filter");
      if (!filterResult.ok) return filterResult.result;

      const extraValueResult = config.extraFilter
        ? optionalString(args, config.extraFilter.field)
        : { ok: true as const, value: undefined };
      if (!extraValueResult.ok) return extraValueResult.result;

      const filter = filterResult.value;
      const extraValue = extraValueResult.value;

      try {
        const { items, total } = await listSentinelEndpoint(config.endpoint, {
          [config.filterField]: filter,
          ...(config.extraFilter ? { [config.extraFilter.field]: extraValue } : {}),
        });

        if (!Array.isArray(items) || items.length === 0) {
          return textResult(
            config.emptyLabel + (filter ? ` (filtre : "${filter}")` : ""),
            [],
            {
              count: 0,
              total: 0,
              endpoint: config.endpoint,
              filter,
              ...(config.extraFilter ? { [config.extraFilter.field]: extraValue } : {}),
            }
          );
        }

        const lines = items.map((item) => listLabel(item, config));
        const header =
          `${config.title}` +
          (filter ? ` (filtre : "${filter}")` : "") +
          ` — ${items.length}/${total} resultats :`;

        return textResult(`${header}\n${lines.join("\n")}`, items, {
          count: items.length,
          total,
          endpoint: config.endpoint,
          filter,
          ...(config.extraFilter ? { [config.extraFilter.field]: extraValue } : {}),
        });
      } catch (err) {
        return formatApiError(err, "sentinel");
      }
    },
  };

  return tool;
}

function buildSentinelGetTool(config: {
  name: string;
  description: string;
  endpoint: string;
  idParam: string;
}) {
  const tool: ToolDefinition = {
    name: config.name,
    description: config.description,
    inputSchema: {
      type: "object",
      properties: {
        [config.idParam]: {
          type: "string",
          description: `Identifiant Sentinel (${config.idParam})`,
        },
      },
      required: [config.idParam],
    },
    handler: async (args) => {
      const idResult = requireString(args, config.idParam);
      if (!idResult.ok) return idResult.result;

      const id = idResult.value;

      try {
        const data = await getSentinelEndpoint(config.endpoint, id);
        return textResult(JSON.stringify(data, null, 2), data, {
          endpoint: config.endpoint,
          [config.idParam]: id,
        });
      } catch (err) {
        return formatApiError(err, "sentinel");
      }
    },
  };

  return tool;
}

const listSentinelServicesTool = buildSentinelListTool({
  name: "beacon_list_sentinel_services",
  description:
    "Liste les services Sentinel accessibles au compte Beacon courant. " +
    "Utile pour decouvrir les serveurs disponibles avant de lancer une action Sentinel.",
  endpoint: "services",
  title: "Services Sentinel",
  emptyLabel: "Aucun service Sentinel trouve.",
  kind: "service",
  idKeys: ["serviceId", "id"],
  labelKeys: ["displayName", "name", "miniDisplayName", "nickname"],
  filterField: "searchableName",
  extraFilter: {
    field: "gameId",
    description: "Filtrer par jeu Beacon (ex: Ark, ArkSA)",
  },
});

const getSentinelServiceTool = buildSentinelGetTool({
  name: "beacon_get_sentinel_service",
  description:
    "Retourne le detail complet d'un service Sentinel. " +
    "Permet d'inspecter connexion, jeu, capacite, permissions et metadonnees de service.",
  endpoint: "services",
  idParam: "serviceId",
});

const listSentinelGroupsTool = buildSentinelListTool({
  name: "beacon_list_sentinel_groups",
  description:
    "Liste les groupes Sentinel accessibles au compte courant. " +
    "Utile pour identifier les groupes de services, le chat de groupe et les integrations Discord.",
  endpoint: "groups",
  title: "Groupes Sentinel",
  emptyLabel: "Aucun groupe Sentinel trouve.",
  kind: "group",
  idKeys: ["groupId", "id"],
  labelKeys: ["name"],
  filterField: "name",
});

const getSentinelGroupTool = buildSentinelGetTool({
  name: "beacon_get_sentinel_group",
  description:
    "Retourne le detail complet d'un groupe Sentinel. " +
    "Permet d'inspecter permissions, chat de groupe et liaison Discord.",
  endpoint: "groups",
  idParam: "groupId",
});

const listSentinelBucketsTool = buildSentinelListTool({
  name: "beacon_list_sentinel_buckets",
  description:
    "Liste les buckets Sentinel accessibles au compte courant. " +
    "Utile pour decouvrir les conteneurs de valeurs partagees utilises par Sentinel.",
  endpoint: "buckets",
  title: "Buckets Sentinel",
  emptyLabel: "Aucun bucket Sentinel trouve.",
  kind: "bucket",
  idKeys: ["bucketId", "id"],
  labelKeys: ["name"],
  filterField: "name",
});

const getSentinelBucketTool = buildSentinelGetTool({
  name: "beacon_get_sentinel_bucket",
  description:
    "Retourne le detail complet d'un bucket Sentinel. " +
    "Permet d'inspecter son nom, son proprietaire et ses permissions.",
  endpoint: "buckets",
  idParam: "bucketId",
});

const listSentinelScriptsTool = buildSentinelListTool({
  name: "beacon_list_sentinel_scripts",
  description:
    "Liste les scripts Sentinel accessibles au compte courant. " +
    "Utile pour decouvrir les scripts disponibles avant affectation a un service ou a un groupe.",
  endpoint: "scripts",
  title: "Scripts Sentinel",
  emptyLabel: "Aucun script Sentinel trouve.",
  kind: "script",
  idKeys: ["scriptId", "id"],
  labelKeys: ["name", "preview"],
  filterField: "name",
});

const getSentinelScriptTool = buildSentinelGetTool({
  name: "beacon_get_sentinel_script",
  description:
    "Retourne le detail complet d'un script Sentinel. " +
    "Permet d'inspecter revision, statut d'approbation, parametres et evenements.",
  endpoint: "scripts",
  idParam: "scriptId",
});

// ---- beacon_list_players ----

const listPlayersTool: ToolDefinition = {
  name: "beacon_list_players",
  description:
    "Liste les joueurs connus d'un service Sentinel (historique des connexions). " +
    "Retourne les IDs EOS/Steam et noms de joueurs. " +
    "Necessite un token Sentinel configure pour le service. " +
    "serviceId : ID UUID du service Sentinel.",
  inputSchema: {
    type: "object",
    properties: {
      serviceId: { type: "string", description: "ID UUID du service Sentinel" },
    },
    required: ["serviceId"],
  },
  handler: async (args) => {
    const serviceIdResult = requireString(args, "serviceId");
    if (!serviceIdResult.ok) return serviceIdResult.result;
    const serviceId = serviceIdResult.value;
    try {
      const res = await beaconClient.get("/sentinel/players", {
        params: { serviceId, pageSize: "100" },
      });
      const players: SentinelRecord[] = res.data?.results ?? res.data ?? [];
      const total: number = res.data?.totalResults ?? res.data?.totalCount ?? players.length;
      if (!Array.isArray(players) || players.length === 0) {
        return textResult(`Aucun joueur trouve pour le service ${serviceId}.`, [], { count: 0, serviceId });
      }
      const lines = players.map(
        (player) => `• [${player.playerId ?? player.id}] ${player.playerName ?? player.name ?? "Inconnu"}`
      );
      return textResult(
        `Joueurs du service ${serviceId} — ${players.length}/${total} :\n${lines.join("\n")}`,
        players,
        { count: players.length, total, serviceId }
      );
    } catch (err) {
      return formatApiError(err, "sentinel");
    }
  },
};

// ---- beacon_ban_player ----

const banPlayerTool: ToolDefinition = {
  name: "beacon_ban_player",
  description:
    "Bannit un joueur d'un service Sentinel. " +
    "serviceId : ID UUID du service. " +
    "playerId : ID du joueur (format '0002EPICID', recuperable via beacon_list_players). " +
    "reason : raison du ban (optionnel). " +
    "expiration : timestamp Unix d'expiration du ban (optionnel, permanent si absent).",
  inputSchema: {
    type: "object",
    properties: {
      serviceId: { type: "string", description: "ID UUID du service Sentinel" },
      playerId: {
        type: "string",
        description: "ID du joueur a bannir (format EOS: '0002...', recuperable via beacon_list_players)",
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
    const serviceIdResult = requireString(args, "serviceId");
    if (!serviceIdResult.ok) return serviceIdResult.result;
    const playerIdResult = requireString(args, "playerId");
    if (!playerIdResult.ok) return playerIdResult.result;
    const reasonResult = optionalString(args, "reason");
    if (!reasonResult.ok) return reasonResult.result;
    const expirationResult = optionalNumber(args, "expiration");
    if (!expirationResult.ok) return expirationResult.result;

    const serviceId = serviceIdResult.value;
    const playerId = playerIdResult.value;
    const reason = reasonResult.value;
    const expiration = expirationResult.value;
    try {
      const banId = randomUUID();
      const body: Record<string, unknown> = { serviceId, playerId };
      if (reason) body.comments = reason;
      if (expiration !== undefined) body.expiration = expiration;

      await beaconClient.post(`/sentinel/serviceBans/${banId}`, body);
      return textResult(
        [
          `Joueur ${playerId} banni du service ${serviceId}.`,
          `ID du ban : ${banId}`,
          reason ? `Raison : ${reason}` : "",
          expiration
            ? `Expiration : ${new Date(expiration * 1000).toLocaleString("fr-FR")}`
            : "Duree : permanente",
        ]
          .filter(Boolean)
          .join("\n"),
        { banId, serviceId, playerId, expiration, reason }
      );
    } catch (err) {
      return formatApiError(err, "sentinel");
    }
  },
};

// ---- beacon_unban_player ----

const unbanPlayerTool: ToolDefinition = {
  name: "beacon_unban_player",
  description:
    "Leve le ban d'un joueur sur un service Sentinel. " +
    "serviceId : ID UUID du service. playerId : ID du joueur a debannir.",
  inputSchema: {
    type: "object",
    properties: {
      serviceId: { type: "string", description: "ID UUID du service Sentinel" },
      playerId: { type: "string", description: "ID du joueur a debannir" },
    },
    required: ["serviceId", "playerId"],
  },
  handler: async (args) => {
    const serviceIdResult = requireString(args, "serviceId");
    if (!serviceIdResult.ok) return serviceIdResult.result;
    const playerIdResult = requireString(args, "playerId");
    if (!playerIdResult.ok) return playerIdResult.result;

    const serviceId = serviceIdResult.value;
    const playerId = playerIdResult.value;
    try {
      const listRes = await beaconClient.get("/sentinel/serviceBans", {
        params: { serviceId, playerId, expired: "false" },
      });
      const bans: SentinelRecord[] = listRes.data?.results ?? listRes.data ?? [];
      if (!Array.isArray(bans) || bans.length === 0) {
        return textResult(
          `Aucun ban actif trouve pour le joueur ${playerId} sur le service ${serviceId}.`,
          [],
          { count: 0, serviceId, playerId }
        );
      }

      const banIds = bans
        .map((ban) => ban.serviceBanId ?? ban.banId ?? ban.id)
        .filter((banId): banId is string => typeof banId === "string" && banId.length > 0);

      if (banIds.length === 0) {
        return invalidParams("Impossible d'identifier les bans a supprimer.", {
          serviceId,
          playerId,
        });
      }

      await Promise.all(banIds.map((banId) => beaconClient.delete(`/sentinel/serviceBans/${banId}`)));
      return textResult(
        `Ban(s) leve(s) pour le joueur ${playerId} sur le service ${serviceId}. (${banIds.length} ban(s) supprime(s))`,
        { serviceId, playerId, banIds }
      );
    } catch (err) {
      return formatApiError(err, "sentinel");
    }
  },
};

// ---- beacon_send_chat ----

const sendChatTool: ToolDefinition = {
  name: "beacon_send_chat",
  description:
    "Envoie un message dans le chat in-game d'un serveur via Sentinel. " +
    "serviceId : ID UUID du service Sentinel. " +
    "message : texte a envoyer. " +
    "senderName : nom de l'expediteur affiche (optionnel, defaut : 'Server'). " +
    "languageCode : code langue ISO (optionnel, ex: 'fr', defaut : 'en').",
  inputSchema: {
    type: "object",
    properties: {
      serviceId: { type: "string", description: "ID UUID du service Sentinel" },
      message: { type: "string", description: "Message a envoyer dans le chat in-game" },
      senderName: {
        type: "string",
        description: "Nom affiche comme expediteur (optionnel, ex: 'Server', 'Admin')",
      },
      languageCode: {
        type: "string",
        description: "Code langue ISO 639-1 (optionnel, ex: 'fr', 'en')",
      },
    },
    required: ["serviceId", "message"],
  },
  handler: async (args) => {
    const serviceIdResult = requireString(args, "serviceId");
    if (!serviceIdResult.ok) return serviceIdResult.result;
    const messageResult = requireString(args, "message");
    if (!messageResult.ok) return messageResult.result;
    const senderNameResult = optionalString(args, "senderName");
    if (!senderNameResult.ok) return senderNameResult.result;
    const languageCodeResult = optionalString(args, "languageCode");
    if (!languageCodeResult.ok) return languageCodeResult.result;

    const serviceId = serviceIdResult.value;
    const message = messageResult.value;
    const senderName = senderNameResult.value;
    const languageCode = languageCodeResult.value;
    try {
      const body: Record<string, unknown> = { serviceId, message };
      if (senderName) body.senderName = senderName;
      if (languageCode) body.languageCode = languageCode;

      await beaconClient.post("/sentinel/chat", body);
      return textResult(`Message envoye dans le chat du service ${serviceId} : "${message}"`, {
        serviceId,
        message,
        senderName,
        languageCode,
      });
    } catch (err) {
      return formatApiError(err, "sentinel");
    }
  },
};

// ---- beacon_run_rcon ----

const runRconTool: ToolDefinition = {
  name: "beacon_run_rcon",
  description:
    "Execute une commande ou diffuse un message sur un serveur de jeu via Sentinel. " +
    "type : 'admin' (commande RCON brute), 'broadcast' (message a tous), 'chat' (message chat). " +
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
          "Commande RCON a executer (pour type 'admin', ex: SaveWorld, banplayer 0002ID, cheat god)",
      },
      message: {
        type: "string",
        description: "Message a diffuser (pour type 'broadcast' ou 'chat')",
      },
      senderName: {
        type: "string",
        description: "Nom de l'expediteur (optionnel, pour broadcast/chat)",
      },
    },
    required: ["serviceId", "type"],
  },
  handler: async (args) => {
    const serviceIdResult = requireString(args, "serviceId");
    if (!serviceIdResult.ok) return serviceIdResult.result;
    const typeResult = requireLiteralString(args, "type", ["admin", "broadcast", "chat"] as const);
    if (!typeResult.ok) return typeResult.result;
    const commandResult = optionalString(args, "command");
    if (!commandResult.ok) return commandResult.result;
    const messageResult = optionalString(args, "message");
    if (!messageResult.ok) return messageResult.result;
    const senderNameResult = optionalString(args, "senderName");
    if (!senderNameResult.ok) return senderNameResult.result;

    const serviceId = serviceIdResult.value;
    const type = typeResult.value;
    const command = commandResult.value;
    const message = messageResult.value;
    const senderName = senderNameResult.value;

    const body: Record<string, unknown> = { serviceId, type };

    if (type === "admin") {
      if (!command) {
        return invalidParams("Parametre command requis pour type 'admin'.", {
          field: "command",
          type,
        });
      }
      body.command = command;
    } else {
      if (!message) {
        return invalidParams("Parametre message requis pour type 'broadcast'/'chat'.", {
          field: "message",
          type,
        });
      }
      body.message = message;
      if (senderName) body.senderName = senderName;
    }

    try {
      await beaconClient.post("/sentinel/gameCommands", body);
      const summary =
        type === "admin"
          ? `Commande RCON executee : ${command}`
          : `Message diffuse (${type}) sur le service ${serviceId} : "${message}"`;
      return textResult(summary, { serviceId, type, command, message, senderName });
    } catch (err) {
      return formatApiError(err, "sentinel");
    }
  },
};

export function registerSentinelTools(server: McpServer): void {
  registerToolGroup(server, [
    listSentinelServicesTool,
    getSentinelServiceTool,
    listSentinelGroupsTool,
    getSentinelGroupTool,
    listSentinelBucketsTool,
    getSentinelBucketTool,
    listSentinelScriptsTool,
    getSentinelScriptTool,
    listPlayersTool,
    banPlayerTool,
    unbanPlayerTool,
    sendChatTool,
    runRconTool,
  ]);
}
