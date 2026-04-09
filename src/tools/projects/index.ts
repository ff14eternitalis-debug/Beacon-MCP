import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID, createHash } from "crypto";

import { ToolDefinition } from "../../registry.js";
import {
  textResult,
  formatApiError,
  gameName,
  registerToolGroup,
  requireGame,
  type Game,
  requireString,
  optionalString,
  optionalNumber,
  invalidParams,
} from "../shared.js";
import { beaconClient } from "../../api/client.js";
import type { ProjectGame } from "./shared.js";
import {
  PROJECT_GAMES,
  CONFIG_OPTION_GAMES,
  GAME_VARIABLE_GAMES,
  buildBeaconBinary,
  buildInitialProjectData,
  searchProjectsForCurrentUser,
  expectedGameId,
  resolveProjectReference,
} from "./shared.js";
import { modProjectTools } from "./mod-tools.js";
import { engramProjectTools } from "./engram-tools.js";
import { lootProjectTools } from "./loot-tools.js";
import { exportProjectTools } from "./export-tools.js";

const listProjectsTool: ToolDefinition = {
  name: "beacon_list_projects",
  description: "Liste tous les projets Beacon de l'utilisateur connecté.",
  inputSchema: { type: "object", properties: {} },
  handler: async () => {
    try {
      const res = await beaconClient.get("/projects");
      const projects: Record<string, unknown>[] = res.data?.results ?? res.data ?? [];
      if (!Array.isArray(projects) || projects.length === 0) {
        return textResult("Aucun projet trouvé.", [], { count: 0 });
      }
      const lines = projects.map(
        (p, i) => `${i + 1}. [${p.projectId}] ${p.name ?? "Sans nom"} (${p.gameId ?? ""})`
      );
      return textResult(`Projets (${projects.length}) :\n${lines.join("\n")}`, projects, {
        count: projects.length,
      });
    } catch (err) {
      return formatApiError(err);
    }
  },
};

const findProjectTool: ToolDefinition = {
  name: "beacon_find_project",
  description:
    "Recherche un projet Beacon par nom ou fragment de nom pour éviter d'avoir à fournir un UUID. " +
    "Peut être filtré par jeu et retourne les meilleurs candidats.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Nom complet ou fragment de nom à rechercher" },
      game: { type: "string", enum: [...PROJECT_GAMES], description: "Jeu cible optionnel : 'ark' ou 'arksa'" },
      limit: { type: "number", description: "Nombre maximum de résultats à retourner (défaut : 10, max : 25)" },
    },
    required: ["query"],
  },
  handler: async (args) => {
    const queryResult = requireString(args, "query");
    if (!queryResult.ok) return queryResult.result;
    const gameResult = optionalString(args, "game");
    if (!gameResult.ok) return gameResult.result;
    const limitResult = optionalNumber(args, "limit");
    if (!limitResult.ok) return limitResult.result;

    const query = queryResult.value.trim();
    const requestedGame = gameResult.value?.trim().toLowerCase();
    if (requestedGame && !PROJECT_GAMES.includes(requestedGame as ProjectGame)) {
      return invalidParams("Paramètre game invalide. Valeurs acceptées : ark, arksa.", {
        field: "game",
        acceptedValues: PROJECT_GAMES,
      });
    }
    const game = requestedGame as ProjectGame | undefined;
    const limit = Math.min(25, Math.max(1, Math.floor(limitResult.value ?? 10)));

    try {
      const projects = await searchProjectsForCurrentUser(query);
      const normalized = query.toLowerCase();
      const filtered = projects
        .filter((project) => {
          const gameId = String(project.gameId ?? "");
          if (game && gameId !== expectedGameId(game)) return false;
          const name = String(project.name ?? "").toLowerCase();
          return name.includes(normalized);
        })
        .sort((a, b) => {
          const aName = String(a.name ?? "").toLowerCase();
          const bName = String(b.name ?? "").toLowerCase();
          const aExact = aName === normalized ? 0 : aName.startsWith(normalized) ? 1 : 2;
          const bExact = bName === normalized ? 0 : bName.startsWith(normalized) ? 1 : 2;
          if (aExact !== bExact) return aExact - bExact;
          return aName.localeCompare(bName);
        })
        .slice(0, limit);

      if (filtered.length === 0) {
        return textResult(`Aucun projet trouvé pour "${query}".`, [], { count: 0, query, game });
      }

      const lines = filtered.map((project, index) => {
        const name = String(project.name ?? "Sans nom");
        const projectId = String(project.projectId ?? "");
        const gameId = String(project.gameId ?? "");
        return `${index + 1}. [${projectId}] ${name} (${gameId})`;
      });

      return textResult(
        `Projets trouvés pour "${query}" (${filtered.length}) :\n${lines.join("\n")}`,
        filtered,
        { count: filtered.length, query, game }
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
};

const getProjectTool: ToolDefinition = {
  name: "beacon_get_project",
  description: "Retourne les métadonnées d'un projet Beacon par son ID ou son nom.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", description: "Identifiant UUID du projet" },
      projectName: { type: "string", description: "Nom exact du projet si l'UUID n'est pas connu" },
    },
  },
  handler: async (args) => {
    const projectIdResult = optionalString(args, "projectId");
    if (!projectIdResult.ok) return projectIdResult.result;
    const projectNameResult = optionalString(args, "projectName");
    if (!projectNameResult.ok) return projectNameResult.result;
    const resolved = await resolveProjectReference({
      projectId: projectIdResult.value,
      projectName: projectNameResult.value,
    });
    if (!resolved.ok) return resolved.result;
    const projectId = resolved.projectId;
    try {
      const res = await beaconClient.get(`/projects/${projectId}`, { headers: { Accept: "application/json" } });
      if (typeof res.data === "object" && res.data !== null) {
        return textResult(JSON.stringify(res.data, null, 2), res.data, { projectId });
      }
      return invalidParams(
        "Le projet existe mais retourne un format binaire. Utilise beacon_generate_game_ini pour lire sa configuration."
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
};

const createProjectTool: ToolDefinition = {
  name: "beacon_create_project",
  description:
    "Crée un nouveau projet Beacon vide. " +
    "game : 'ark' (ARK: Survival Evolved) ou 'arksa' (ARK: Survival Ascended). " +
    "name : nom du projet. description : description optionnelle. " +
    "mapMask : masque de carte optionnel (par défaut Beacon : 1, généralement The Island).",
  inputSchema: {
    type: "object",
    properties: {
      game: { type: "string", enum: [...PROJECT_GAMES], description: "Jeu cible : 'ark' ou 'arksa'" },
      name: { type: "string", description: "Nom du projet" },
      description: { type: "string", description: "Description du projet (optionnel)" },
      mapMask: { type: "number", description: "Masque de carte optionnel (ex : 1 pour The Island dans les projets Ark/ArkSA)" },
    },
    required: ["game", "name"],
  },
  handler: async (args) => {
    const gameResult = requireGame(args, "game", PROJECT_GAMES);
    if (!gameResult.ok) return gameResult.result;
    const nameResult = requireString(args, "name");
    if (!nameResult.ok) return nameResult.result;
    const descriptionResult = optionalString(args, "description");
    if (!descriptionResult.ok) return descriptionResult.result;
    const mapMaskResult = optionalNumber(args, "mapMask");
    if (!mapMaskResult.ok) return mapMaskResult.result;

    const game = gameResult.value as (typeof PROJECT_GAMES)[number];
    try {
      const meRes = await beaconClient.get("/user");
      const userId: string = meRes.data?.userId;
      if (!userId) {
        return invalidParams("Impossible de récupérer l'userId. Vérifiez la connexion avec beacon_auth_status.");
      }

      const projectId = randomUUID();
      const gameId = game === "ark" ? "Ark" : "ArkSA";
      const manifest: Record<string, unknown> = {
        version: 7,
        isFull: true,
        timestamp: Math.floor(Date.now() / 1000),
        files: ["v7.json"],
        projectId,
        gameId,
        name: nameResult.value,
        description: descriptionResult.value ?? "",
        ...(mapMaskResult.value !== undefined ? { map: mapMaskResult.value } : {}),
        members: { [userId]: { role: "Owner", encryptedPassword: null, fingerprint: null } },
      };

      const binary = await buildBeaconBinary(manifest, buildInitialProjectData());
      const sha256 = createHash("sha256").update(binary).digest("hex");
      const res = await beaconClient.post("/projects", binary, {
        headers: {
          "Content-Type": "application/x-beacon-project",
          "X-Beacon-SHA256": sha256,
        },
        maxBodyLength: Infinity,
      });

      const created = res.data as Record<string, unknown>;
      return textResult(
        ["Projet créé avec succès.", `ID   : ${created.projectId ?? projectId}`, `Nom  : ${created.name ?? nameResult.value}`, `Jeu  : ${gameName(game)}`].join("\n"),
        created,
        { projectId: created.projectId ?? projectId, game }
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
};

const getConfigOptionsTool: ToolDefinition = {
  name: "beacon_get_config_options",
  description:
    "Liste les options de configuration disponibles pour un jeu Beacon. " +
    "Chaque option indique sa section INI (header), sa clé, son type, sa valeur par défaut et sa description. " +
    "Appeler ce tool avant de modifier un Game.ini pour connaître les paramètres valides. " +
    "game : 'ark' ou 'arksa'. filter : filtre optionnel sur le nom.",
  inputSchema: {
    type: "object",
    properties: {
      game: { type: "string", enum: [...CONFIG_OPTION_GAMES], description: "Jeu cible : 'ark', 'arksa', 'palworld' ou '7dtd'" },
      filter: { type: "string", description: "Filtre optionnel sur le nom ou la clé de l'option" },
    },
    required: ["game"],
  },
  handler: async (args) => {
    const gameResult = requireGame(args);
    if (!gameResult.ok) return gameResult.result;
    const filterResult = optionalString(args, "filter");
    if (!filterResult.ok) return filterResult.result;

    const game = gameResult.value;
    const filter = filterResult.value;
    try {
      const params: Record<string, string> = { pageSize: "250" };
      if (filter) params.search = filter;
      const res = await beaconClient.get(`/${game}/configOptions`, { params });
      const options: Record<string, unknown>[] = res.data?.results ?? res.data ?? [];

      if (!Array.isArray(options) || options.length === 0) {
        return textResult(`Aucune option de configuration trouvée pour ${gameName(game)}.`, [], {
          count: 0,
          game,
          filter,
        });
      }

      const lines = options.map((o) => {
        const header = String(o.header ?? o.file ?? "?");
        const key = o.key ?? o.configOptionId;
        const type = o.valueType ?? "?";
        const def = o.defaultValue !== undefined && o.defaultValue !== null ? ` (défaut : ${o.defaultValue})` : "";
        const desc = o.description ? ` — ${o.description}` : "";
        return `• [${header}] ${key} [${type}]${def}${desc}`;
      });

      return textResult(
        `Options de configuration pour ${gameName(game)} (${options.length}) :\n${lines.join("\n")}`,
        options,
        { count: options.length, game, filter }
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
};

const listCommandLineOptionsTool: ToolDefinition = {
  name: "beacon_list_command_line_options",
  description:
    "Liste les options Beacon liées à la ligne de commande pour un jeu. " +
    "Ces options proviennent de la classe ConfigOption et sont filtrées sur les fichiers 'CommandLineFlag' et 'CommandLineOption'. " +
    "kind : 'all', 'flag' ou 'option'. filter : filtre textuel optionnel.",
  inputSchema: {
    type: "object",
    properties: {
      game: { type: "string", enum: [...GAME_VARIABLE_GAMES], description: "Jeu cible : 'ark', 'arksa' ou 'palworld'" },
      kind: { type: "string", enum: ["all", "flag", "option"], description: "Type de paramètres à lister" },
      filter: { type: "string", description: "Filtre optionnel sur le label ou la clé" },
    },
    required: ["game"],
  },
  handler: async (args) => {
    const gameResult = requireGame(args);
    if (!gameResult.ok) return gameResult.result;
    const filterResult = optionalString(args, "filter");
    if (!filterResult.ok) return filterResult.result;
    const kindRawResult = optionalString(args, "kind");
    if (!kindRawResult.ok) return kindRawResult.result;

    const game = gameResult.value as Game;
    const filter = filterResult.value;
    const kind = (kindRawResult.value ?? "all") as "all" | "flag" | "option";
    if (!["all", "flag", "option"].includes(kind)) {
      return invalidParams("Paramètre kind invalide. Valeurs acceptées : all, flag, option.", {
        field: "kind",
        acceptedValues: ["all", "flag", "option"],
      });
    }

    try {
      const params: Record<string, string> = { pageSize: "250" };
      if (filter) params.search = filter;
      const res = await beaconClient.get(`/${game}/configOptions`, { params });
      const options: Record<string, unknown>[] = res.data?.results ?? res.data ?? [];
      const fileFilter =
        kind === "flag"
          ? ["CommandLineFlag"]
          : kind === "option"
          ? ["CommandLineOption"]
          : ["CommandLineFlag", "CommandLineOption"];
      const filtered = Array.isArray(options)
        ? options.filter((o) => fileFilter.includes(String(o.file ?? "")))
        : [];

      if (filtered.length === 0) {
        return textResult(`Aucune option de ligne de commande trouvée pour ${gameName(game)}.`, [], {
          count: 0,
          game,
          kind,
          filter,
        });
      }

      const lines = filtered.map((o) => {
        const file = String(o.file ?? "");
        const key = o.key ?? o.configOptionId;
        const type = o.valueType ?? "?";
        const def = o.defaultValue !== undefined && o.defaultValue !== null ? ` (défaut : ${o.defaultValue})` : "";
        const desc = o.description ? ` — ${o.description}` : "";
        return `• [${file}] ${key} [${type}]${def}${desc}`;
      });

      return textResult(
        `Options de ligne de commande pour ${gameName(game)} (${filtered.length}) :\n${lines.join("\n")}`,
        filtered,
        { count: filtered.length, game, kind, filter }
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
};

export function registerProjectTools(server: McpServer): void {
  registerToolGroup(server, [
    listProjectsTool,
    findProjectTool,
    getProjectTool,
    createProjectTool,
    ...modProjectTools,
    ...engramProjectTools,
    ...lootProjectTools,
    ...exportProjectTools,
    getConfigOptionsTool,
    listCommandLineOptionsTool,
  ]);
}
