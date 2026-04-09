import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolDefinition } from "../registry.js";
import { beaconClient } from "../api/client.js";
import {
  textResult,
  formatApiError,
  gameName,
  registerToolGroup,
  requireGame,
  type Game,
  optionalString,
  requireString,
} from "./shared.js";

type GameDataRecord = Record<string, unknown>;
const ARK_GAMES = ["ark", "arksa"] as const;
const GAMES_WITH_GAME_VARIABLES = ["ark", "arksa", "palworld"] as const;

function describeRecord(record: GameDataRecord, idKeyCandidates: string[], labelKeyCandidates: string[]): string {
  const id = idKeyCandidates.map((key) => record[key]).find((value) => value !== undefined && value !== null);
  const label = labelKeyCandidates
    .map((key) => record[key])
    .find((value) => typeof value === "string" && value.trim().length > 0);
  return `• [${id ?? "?"}] ${label ?? "Sans nom"}`;
}

async function listEndpoint(
  game: Game,
  endpoint: string,
  options?: {
    filter?: string;
    contentPackId?: string;
    pageSize?: number;
  }
): Promise<{ items: GameDataRecord[]; total: number }> {
  const params: Record<string, string> = { pageSize: String(options?.pageSize ?? 100) };
  if (options?.filter) params.search = options.filter;
  if (options?.contentPackId) params.contentPackId = options.contentPackId;

  const res = await beaconClient.get(`/${game}/${endpoint}`, { params });
  const items: GameDataRecord[] = res.data?.results ?? res.data ?? [];
  const total: number = res.data?.totalResults ?? items.length;
  return { items, total };
}

async function getEndpoint(
  game: Game,
  endpoint: string,
  id: string
): Promise<GameDataRecord> {
  const res = await beaconClient.get(`/${game}/${endpoint}/${id}`);
  return res.data as GameDataRecord;
}

function buildListTool(config: {
  name: string;
  description: string;
  endpoint: string;
  emptyLabel: string;
  title: string;
  idKeys: string[];
  labelKeys: string[];
  pageSize?: number;
  supportsContentPackId?: boolean;
  supportedGames?: readonly Game[];
}) {
  const supportedGames = config.supportedGames ?? ARK_GAMES;
  const tool: ToolDefinition = {
    name: config.name,
    description: config.description,
    inputSchema: {
      type: "object",
      properties: {
        game: {
          type: "string",
          enum: [...supportedGames],
          description: `Jeu cible : ${supportedGames.map((game) => `'${game}'`).join(" ou ")}`,
        },
        filter: {
          type: "string",
          description: "Filtre textuel optionnel",
        },
        ...(config.supportsContentPackId
          ? {
              contentPackId: {
                type: "string",
                description: "UUID du content pack (mod) pour filtrer les résultats",
              },
            }
          : {}),
      },
      required: ["game"],
    },
    handler: async (args) => {
      const gameResult = requireGame(args, "game", supportedGames);
      if (!gameResult.ok) return gameResult.result;
      const filterResult = optionalString(args, "filter");
      if (!filterResult.ok) return filterResult.result;
      const contentPackResult = optionalString(args, "contentPackId");
      if (!contentPackResult.ok) return contentPackResult.result;

      const game = gameResult.value;
      const filter = filterResult.value;
      const contentPackId = contentPackResult.value;

      try {
        const { items, total } = await listEndpoint(game, config.endpoint, {
          filter,
          contentPackId: config.supportsContentPackId ? contentPackId : undefined,
          pageSize: config.pageSize,
        });

        if (!Array.isArray(items) || items.length === 0) {
          return textResult(config.emptyLabel.replace("{game}", gameName(game)), [], {
            count: 0,
            total: 0,
            game,
            endpoint: config.endpoint,
          });
        }

        const lines = items.map((item) => describeRecord(item, config.idKeys, config.labelKeys));
        const header =
          `${config.title} pour ${gameName(game)}` +
          (filter ? ` (filtre : "${filter}")` : "") +
          ` — ${items.length}/${total} résultats :`;

        return textResult(`${header}\n${lines.join("\n")}`, items, {
          count: items.length,
          total,
          game,
          endpoint: config.endpoint,
          filter,
          ...(config.supportsContentPackId ? { contentPackId } : {}),
        });
      } catch (err) {
        return formatApiError(err);
      }
    },
  };

  return tool;
}

function buildGetTool(config: {
  name: string;
  description: string;
  endpoint: string;
  idParam: string;
  emptyHint?: string;
  supportedGames?: readonly Game[];
}) {
  const supportedGames = config.supportedGames ?? ARK_GAMES;
  const tool: ToolDefinition = {
    name: config.name,
    description: config.description,
    inputSchema: {
      type: "object",
      properties: {
        game: {
          type: "string",
          enum: [...supportedGames],
          description: `Jeu cible : ${supportedGames.map((game) => `'${game}'`).join(" ou ")}`,
        },
        [config.idParam]: {
          type: "string",
          description: `Identifiant Beacon de l'objet (${config.idParam})`,
        },
      },
      required: ["game", config.idParam],
    },
    handler: async (args) => {
      const gameResult = requireGame(args, "game", supportedGames);
      if (!gameResult.ok) return gameResult.result;
      const idResult = requireString(args, config.idParam);
      if (!idResult.ok) return idResult.result;

      const game = gameResult.value;
      const id = idResult.value;

      try {
        const data = await getEndpoint(game, config.endpoint, id);
        return textResult(JSON.stringify(data, null, 2), data, {
          game,
          endpoint: config.endpoint,
          [config.idParam]: id,
        });
      } catch (err) {
        return formatApiError(err);
      }
    },
  };

  return tool;
}

const listBlueprintsTool = buildListTool({
  name: "beacon_list_blueprints",
  description:
    "Liste les blueprints (créatures, items, structures) disponibles dans Beacon pour un jeu. " +
    "Chaque blueprint contient son chemin UE4 exact, indispensable pour la configuration du loot. " +
    "game : 'ark' ou 'arksa'. filter : texte de recherche optionnel. " +
    "contentPackId : UUID du mod pour filtrer par content pack.",
  endpoint: "blueprints",
  emptyLabel: "Aucun blueprint trouvé pour {game}.",
  title: "Blueprints",
  idKeys: ["blueprintId", "objectId", "id"],
  labelKeys: ["label", "name", "classString", "path"],
  supportsContentPackId: true,
});

const getBlueprintTool = buildGetTool({
  name: "beacon_get_blueprint",
  description:
    "Retourne le détail complet d'un blueprint Beacon par son identifiant. " +
    "Utile pour inspecter un objet précis au lieu de relire une liste complète.",
  endpoint: "blueprints",
  idParam: "blueprintId",
});

const listEngramsTool = buildListTool({
  name: "beacon_list_engrams",
  description:
    "Liste les engrams (items craftables) disponibles dans Beacon pour un jeu. " +
    "game : 'ark' ou 'arksa'. filter : texte de recherche optionnel. " +
    "contentPackId : UUID du mod pour filtrer par content pack.",
  endpoint: "engrams",
  emptyLabel: "Aucun engram trouvé pour {game}.",
  title: "Engrams",
  idKeys: ["engramId", "objectId", "id"],
  labelKeys: ["label", "name", "classString", "path"],
  supportsContentPackId: true,
});

const getEngramTool = buildGetTool({
  name: "beacon_get_engram",
  description:
    "Retourne le détail complet d'un engram Beacon par son identifiant. " +
    "Utile pour inspecter recette, stack size, niveau requis et autres métadonnées.",
  endpoint: "engrams",
  idParam: "engramId",
});

const listCreaturesTool = buildListTool({
  name: "beacon_list_creatures",
  description:
    "Liste les créatures disponibles dans Beacon pour un jeu. " +
    "game : 'ark' ou 'arksa'. filter : texte de recherche optionnel. " +
    "contentPackId : UUID du mod pour filtrer par content pack.",
  endpoint: "creatures",
  emptyLabel: "Aucune créature trouvée pour {game}.",
  title: "Créatures",
  idKeys: ["creatureId", "blueprintId", "objectId", "id"],
  labelKeys: ["label", "name", "classString", "path"],
  supportsContentPackId: true,
});

const getCreatureTool = buildGetTool({
  name: "beacon_get_creature",
  description:
    "Retourne le détail complet d'une créature Beacon par son identifiant. " +
    "Utile pour inspecter stats, temps d'incubation, reproduction ou autres propriétés.",
  endpoint: "creatures",
  idParam: "creatureId",
});

const listLootDropsTool = buildListTool({
  name: "beacon_list_loot_drops",
  description:
    "Liste les loot drops (containers de loot : crates, beacons, coffres...) disponibles dans Beacon. " +
    "Chaque loot drop peut être personnalisé dans un projet via ses ItemSets. game : 'ark' ou 'arksa'.",
  endpoint: "lootDrops",
  emptyLabel: "Aucun loot drop trouvé pour {game}.",
  title: "Loot drops",
  idKeys: ["lootDropId", "blueprintId", "objectId", "id"],
  labelKeys: ["label", "name", "classString", "path"],
  pageSize: 250,
});

const listSpawnPointsTool = buildListTool({
  name: "beacon_list_spawn_points",
  description:
    "Liste les spawn points disponibles dans Beacon pour un jeu. " +
    "game : 'ark' ou 'arksa'. filter : texte de recherche optionnel. " +
    "contentPackId : UUID du mod pour filtrer par content pack.",
  endpoint: "spawnPoints",
  emptyLabel: "Aucun spawn point trouvé pour {game}.",
  title: "Spawn points",
  idKeys: ["spawnPointId", "blueprintId", "objectId", "id"],
  labelKeys: ["label", "name", "classString", "path"],
  supportsContentPackId: true,
});

const getSpawnPointTool = buildGetTool({
  name: "beacon_get_spawn_point",
  description:
    "Retourne le détail complet d'un spawn point Beacon par son identifiant. " +
    "Utile pour inspecter sets, limites et populations.",
  endpoint: "spawnPoints",
  idParam: "spawnPointId",
});

const listMapsTool = buildListTool({
  name: "beacon_list_maps",
  description:
    "Liste les maps disponibles dans Beacon pour un jeu. " +
    "game : 'ark' ou 'arksa'. filter : texte de recherche optionnel.",
  endpoint: "maps",
  emptyLabel: "Aucune map trouvée pour {game}.",
  title: "Maps",
  idKeys: ["mapId", "id"],
  labelKeys: ["label", "arkIdentifier", "worldName"],
  pageSize: 250,
});

const listGameVariablesTool = buildListTool({
  name: "beacon_list_game_variables",
  description:
    "Liste les variables de jeu exposées par Beacon pour un jeu. " +
    "game : 'ark' ou 'arksa'. filter : texte de recherche optionnel.",
  endpoint: "gameVariables",
  emptyLabel: "Aucune variable de jeu trouvée pour {game}.",
  title: "Variables de jeu",
  idKeys: ["key", "id"],
  labelKeys: ["key", "value"],
  pageSize: 250,
  supportedGames: GAMES_WITH_GAME_VARIABLES,
});

const searchModsTool: ToolDefinition = {
  name: "beacon_search_mods",
  description:
    "Recherche des mods (content packs) indexés dans Beacon pour un jeu. " +
    "Un mod doit être indexé dans Beacon avant de pouvoir l'utiliser dans un projet. " +
    "Si un mod n'apparaît pas, il faut l'importer via l'interface Beacon d'abord. " +
    "game : 'ark' ou 'arksa'. query : terme de recherche.",
  inputSchema: {
    type: "object",
    properties: {
      game: {
        type: "string",
        enum: ["ark", "arksa"],
        description: "Jeu cible : 'ark' ou 'arksa'",
      },
      query: {
        type: "string",
        description: "Terme de recherche (nom du mod, auteur, etc.)",
      },
    },
    required: ["game"],
  },
  handler: async (args) => {
    const gameResult = requireGame(args);
    if (!gameResult.ok) return gameResult.result;
    const queryResult = optionalString(args, "query");
    if (!queryResult.ok) return queryResult.result;

    const game = gameResult.value;
    const query = queryResult.value;
    try {
      const gameId = game === "ark" ? "Ark" : "ArkSA";
      const params: Record<string, string> = { gameId, pageSize: "50" };
      if (query) params.search = query;
      const res = await beaconClient.get("/contentPacks", { params });
      const packs: GameDataRecord[] = res.data?.results ?? res.data ?? [];
      if (!Array.isArray(packs) || packs.length === 0) {
        return textResult(
          `Aucun mod trouvé pour ${gameName(game)}${query ? ` (recherche : "${query}")` : ""}.\n` +
            "Si le mod n'est pas listé, importez-le via l'interface Beacon d'abord.",
          [],
          { count: 0, game, query }
        );
      }
      const lines = packs.map(
        (p) =>
          `• [${p.contentPackId ?? p.id}] ${p.name ?? "Sans nom"}` +
          (p.marketplaceId ? ` — Steam/CurseForge ID : ${p.marketplaceId}` : "")
      );
      const header =
        `Mods disponibles pour ${gameName(game)}` +
        (query ? ` (recherche : "${query}")` : "") +
        ` — ${packs.length} résultats :`;
      return textResult(`${header}\n${lines.join("\n")}`, packs, {
        count: packs.length,
        game,
        query,
      });
    } catch (err) {
      return formatApiError(err);
    }
  },
};

export function registerGameDataTools(server: McpServer): void {
  registerToolGroup(server, [
    listBlueprintsTool,
    getBlueprintTool,
    listEngramsTool,
    getEngramTool,
    listCreaturesTool,
    getCreatureTool,
    listLootDropsTool,
    listSpawnPointsTool,
    getSpawnPointTool,
    listMapsTool,
    listGameVariablesTool,
    searchModsTool,
  ]);
}
