import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolDefinition } from "../registry.js";
import { beaconClient } from "../api/client.js";
import { textResult, formatApiError, isValidGame, gameName, SUPPORTED_GAMES, registerToolGroup } from "./shared.js";

// ---- beacon_list_blueprints ----

const listBlueprintsTool: ToolDefinition = {
  name: "beacon_list_blueprints",
  description:
    "Liste les blueprints (créatures, items, structures) disponibles dans Beacon pour un jeu. " +
    "Chaque blueprint contient son chemin UE4 exact, indispensable pour la configuration du loot. " +
    "game : 'ark' ou 'arksa'. " +
    "filter : texte de recherche sur le nom (optionnel). " +
    "contentPackId : UUID du mod pour filtrer par content pack (optionnel).",
  inputSchema: {
    type: "object",
    properties: {
      game: {
        type: "string",
        enum: ["ark", "arksa"],
        description: "Jeu cible : 'ark' ou 'arksa'",
      },
      filter: {
        type: "string",
        description: "Filtre textuel sur le nom du blueprint (recherche partielle)",
      },
      contentPackId: {
        type: "string",
        description: "UUID du content pack (mod) pour restreindre la liste à ce mod",
      },
    },
    required: ["game"],
  },
  handler: async (args) => {
    const { game, filter, contentPackId } = args;
    if (!isValidGame(game)) {
      return textResult(`Jeu invalide. Valeurs acceptées : ${SUPPORTED_GAMES.join(", ")}`);
    }
    try {
      const params: Record<string, string> = { pageSize: "100" };
      if (typeof filter === "string" && filter.trim()) params.search = filter.trim();
      if (typeof contentPackId === "string" && contentPackId.trim()) {
        params.contentPackId = contentPackId.trim();
      }
      const res = await beaconClient.get(`/${game}/blueprints`, { params });
      const blueprints: Record<string, unknown>[] = res.data?.results ?? res.data ?? [];
      const total: number = res.data?.totalResults ?? blueprints.length;
      if (!Array.isArray(blueprints) || blueprints.length === 0) {
        return textResult(`Aucun blueprint trouvé pour ${gameName(game)}.`);
      }
      const lines = blueprints.map(
        (b) => `• [${b.blueprintId ?? b.id}] ${b.label ?? b.name ?? "Sans nom"}`
      );
      const header =
        `Blueprints pour ${gameName(game)}` +
        (filter ? ` (filtre : "${filter}")` : "") +
        ` — ${blueprints.length}/${total} résultats :`;
      return textResult(`${header}\n${lines.join("\n")}`);
    } catch (err) {
      return textResult(formatApiError(err));
    }
  },
};

// ---- beacon_list_engrams ----

const listEngramsTool: ToolDefinition = {
  name: "beacon_list_engrams",
  description:
    "Liste les engrams (items craftables) disponibles dans Beacon pour un jeu. " +
    "Les engrams sont référencés par leur UUID Beacon lors de la configuration du loot. " +
    "game : 'ark' ou 'arksa'. " +
    "filter : texte de recherche sur le nom (optionnel). " +
    "contentPackId : UUID du mod pour filtrer par content pack (optionnel).",
  inputSchema: {
    type: "object",
    properties: {
      game: {
        type: "string",
        enum: ["ark", "arksa"],
        description: "Jeu cible : 'ark' ou 'arksa'",
      },
      filter: {
        type: "string",
        description: "Filtre textuel sur le nom de l'engram (recherche partielle)",
      },
      contentPackId: {
        type: "string",
        description: "UUID du content pack (mod) pour restreindre la liste à ce mod",
      },
    },
    required: ["game"],
  },
  handler: async (args) => {
    const { game, filter, contentPackId } = args;
    if (!isValidGame(game)) {
      return textResult(`Jeu invalide. Valeurs acceptées : ${SUPPORTED_GAMES.join(", ")}`);
    }
    try {
      const params: Record<string, string> = { pageSize: "100" };
      if (typeof filter === "string" && filter.trim()) params.search = filter.trim();
      if (typeof contentPackId === "string" && contentPackId.trim()) {
        params.contentPackId = contentPackId.trim();
      }
      const res = await beaconClient.get(`/${game}/engrams`, { params });
      const engrams: Record<string, unknown>[] = res.data?.results ?? res.data ?? [];
      const total: number = res.data?.totalResults ?? engrams.length;
      if (!Array.isArray(engrams) || engrams.length === 0) {
        return textResult(`Aucun engram trouvé pour ${gameName(game)}.`);
      }
      const lines = engrams.map(
        (e) => `• [${e.engramId ?? e.id}] ${e.label ?? e.name ?? "Sans nom"}`
      );
      const header =
        `Engrams pour ${gameName(game)}` +
        (filter ? ` (filtre : "${filter}")` : "") +
        ` — ${engrams.length}/${total} résultats :`;
      return textResult(`${header}\n${lines.join("\n")}`);
    } catch (err) {
      return textResult(formatApiError(err));
    }
  },
};

// ---- beacon_list_loot_drops ----

const listLootDropsTool: ToolDefinition = {
  name: "beacon_list_loot_drops",
  description:
    "Liste les loot drops (containers de loot : crates, beacons, coffres...) disponibles dans Beacon. " +
    "Chaque loot drop peut être personnalisé dans un projet via ses ItemSets. " +
    "game : 'ark' ou 'arksa'.",
  inputSchema: {
    type: "object",
    properties: {
      game: {
        type: "string",
        enum: ["ark", "arksa"],
        description: "Jeu cible : 'ark' ou 'arksa'",
      },
    },
    required: ["game"],
  },
  handler: async (args) => {
    const { game } = args;
    if (!isValidGame(game)) {
      return textResult(`Jeu invalide. Valeurs acceptées : ${SUPPORTED_GAMES.join(", ")}`);
    }
    try {
      const res = await beaconClient.get(`/${game}/lootDrops`, {
        params: { pageSize: "250" },
      });
      const drops: Record<string, unknown>[] = res.data?.results ?? res.data ?? [];
      if (!Array.isArray(drops) || drops.length === 0) {
        return textResult(`Aucun loot drop trouvé pour ${gameName(game)}.`);
      }
      const lines = drops.map(
        (d) => `• [${d.lootDropId ?? d.id}] ${d.label ?? d.name ?? "Sans nom"}`
      );
      return textResult(
        `Loot drops pour ${gameName(game)} (${drops.length}) :\n${lines.join("\n")}`
      );
    } catch (err) {
      return textResult(formatApiError(err));
    }
  },
};

// ---- beacon_search_mods ----

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
    const { game, query } = args;
    if (!isValidGame(game)) {
      return textResult(`Jeu invalide. Valeurs acceptées : ${SUPPORTED_GAMES.join(", ")}`);
    }
    try {
      // L'API attend "Ark" ou "ArkSA" (pas "ark" / "arksa")
      const gameId = game === "ark" ? "Ark" : "ArkSA";
      const params: Record<string, string> = { gameId, pageSize: "50" };
      if (typeof query === "string" && query.trim()) params.search = query.trim();
      const res = await beaconClient.get("/contentPacks", { params });
      const packs: Record<string, unknown>[] = res.data?.results ?? res.data ?? [];
      if (!Array.isArray(packs) || packs.length === 0) {
        return textResult(
          `Aucun mod trouvé pour ${gameName(game)}${query ? ` (recherche : "${query}")` : ""}.\n` +
            "Si le mod n'est pas listé, importez-le via l'interface Beacon d'abord."
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
      return textResult(`${header}\n${lines.join("\n")}`);
    } catch (err) {
      return textResult(formatApiError(err));
    }
  },
};

// ---- Enregistrement ----

export function registerGameDataTools(server: McpServer): void {
  registerToolGroup(server, [
    listBlueprintsTool,
    listEngramsTool,
    listLootDropsTool,
    searchModsTool,
  ]);
}
