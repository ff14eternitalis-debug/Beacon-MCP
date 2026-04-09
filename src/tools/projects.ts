import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolDefinition } from "../registry.js";
import {
  textResult,
  formatApiError,
  gameName,
  registerToolGroup,
  requireGame,
  type Game,
  requireString,
  requireRawString,
  optionalString,
  optionalNumber,
  invalidParams,
} from "./shared.js";
import { beaconClient } from "../api/client.js";
import { randomUUID, createHash } from "crypto";
import { gzip } from "zlib";
import { promisify } from "util";

const gzipAsync = promisify(gzip);
const PROJECT_GAMES = ["ark", "arksa"] as const;
const CONFIG_OPTION_GAMES = ["ark", "arksa", "palworld", "7dtd"] as const;
const GAME_VARIABLE_GAMES = ["ark", "arksa", "palworld"] as const;

// ---------------------------------------------------------------------------
// Format binaire .beacon
// Source : Website/api/v4/classes/Project.php + requests/projects/write.php
//
// Structure : [8 bytes magic] + [TAR.GZ]
// TAR.GZ contient :
//   - Manifest.json : métadonnées + données du projet (projectId, gameId, members…)
//   - v7.json       : configuration jeu (vide pour un nouveau projet)
// ---------------------------------------------------------------------------

const BEACON_MAGIC = Buffer.from("3029a1c4fab67728", "hex");

function tarPadBlock(data: Buffer): Buffer {
  const rem = data.length % 512;
  return rem === 0 ? data : Buffer.concat([data, Buffer.alloc(512 - rem)]);
}

function tarHeader(filename: string, size: number): Buffer {
  const h = Buffer.alloc(512);
  h.write(filename, 0, "utf8");
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(size.toString(8).padStart(11, "0") + "\0", 124);
  h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 136);
  h.fill(0x20, 148, 156);
  h.write("0", 156);
  h.write("ustar ", 257);
  h.write("00", 263);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i];
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return h;
}

async function buildBeaconBinary(
  manifest: Record<string, unknown>,
  v7data: Record<string, unknown>
): Promise<Buffer> {
  const manifestBuf = Buffer.from(JSON.stringify(manifest));
  const v7Buf = Buffer.from(JSON.stringify(v7data));

  const tar = Buffer.concat([
    tarHeader("Manifest.json", manifestBuf.length),
    tarPadBlock(manifestBuf),
    tarHeader("v7.json", v7Buf.length),
    tarPadBlock(v7Buf),
    Buffer.alloc(1024),
  ]);

  const gz = await gzipAsync(tar);
  return Buffer.concat([BEACON_MAGIC, gz]);
}

async function getProjectConfigFile(
  projectId: string,
  game: (typeof PROJECT_GAMES)[number],
  fileName: "Game.ini" | "GameUserSettings.ini",
  params?: Record<string, unknown>
): Promise<string> {
  const res = await beaconClient.get(`/${game}/projects/${projectId}/${fileName}`, {
    params,
    responseType: "text",
  });
  return typeof res.data === "string" ? res.data : JSON.stringify(res.data, null, 2);
}

async function putProjectConfigFile(
  projectId: string,
  game: (typeof PROJECT_GAMES)[number],
  fileName: "Game.ini" | "GameUserSettings.ini",
  content: string
): Promise<void> {
  await beaconClient.put(`/${game}/projects/${projectId}/${fileName}`, content, {
    headers: { "Content-Type": "text/plain" },
  });
}

// ---- beacon_list_projects ----

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

// ---- beacon_get_project ----

const getProjectTool: ToolDefinition = {
  name: "beacon_get_project",
  description: "Retourne les métadonnées d'un projet Beacon par son ID.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", description: "Identifiant UUID du projet" },
    },
    required: ["projectId"],
  },
  handler: async (args) => {
    const projectIdResult = requireString(args, "projectId");
    if (!projectIdResult.ok) return projectIdResult.result;
    const projectId = projectIdResult.value;
    try {
      const res = await beaconClient.get(`/projects/${projectId}`, {
        headers: { Accept: "application/json" },
      });
      if (typeof res.data === "object" && res.data !== null) {
        return textResult(JSON.stringify(res.data, null, 2), res.data, { projectId });
      }
      return invalidParams(
        "Le projet existe mais retourne un format binaire. " +
          "Utilise beacon_generate_game_ini pour lire sa configuration."
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
};

// ---- beacon_create_project ----

const createProjectTool: ToolDefinition = {
  name: "beacon_create_project",
  description:
    "Crée un nouveau projet Beacon vide. " +
    "game : 'ark' (ARK: Survival Evolved) ou 'arksa' (ARK: Survival Ascended). " +
    "name : nom du projet. description : description optionnelle.",
  inputSchema: {
    type: "object",
    properties: {
      game: {
        type: "string",
        enum: [...PROJECT_GAMES],
        description: "Jeu cible : 'ark' ou 'arksa'",
      },
      name: { type: "string", description: "Nom du projet" },
      description: { type: "string", description: "Description du projet (optionnel)" },
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

    const game = gameResult.value as (typeof PROJECT_GAMES)[number];
    const name = nameResult.value;
    const description = descriptionResult.value;
    try {
      const meRes = await beaconClient.get("/users/me");
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
        name,
        description: description ?? "",
        members: {
          [userId]: { role: "Owner", encryptedPassword: null, fingerprint: null },
        },
      };

      const binary = await buildBeaconBinary(manifest, {});
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
        [
          "Projet créé avec succès.",
          `ID   : ${created.projectId ?? projectId}`,
          `Nom  : ${created.name ?? name}`,
          `Jeu  : ${gameName(game)}`,
        ].join("\n"),
        created,
        { projectId: created.projectId ?? projectId, game }
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
};

// ---- beacon_generate_game_ini ----

const generateGameIniTool: ToolDefinition = {
  name: "beacon_generate_game_ini",
  description:
    "Génère et retourne le contenu du fichier Game.ini pour un projet Beacon. " +
    "Utiliser ce tool pour lire la configuration actuelle avant de la modifier. " +
    "game : 'ark' (ARK: Survival Evolved) ou 'arksa' (ARK: Survival Ascended). " +
    "qualityScale, difficultyValue, mapMask : paramètres optionnels de génération.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", description: "ID du projet" },
      game: {
        type: "string",
        enum: [...PROJECT_GAMES],
        description: "Jeu cible : 'ark' ou 'arksa'",
      },
      qualityScale: {
        type: "number",
        description: "Multiplicateur de qualité des items (optionnel)",
      },
      difficultyValue: {
        type: "number",
        description: "Valeur de difficulté (optionnel)",
      },
      mapMask: {
        type: "string",
        description: "Masque de carte (optionnel)",
      },
    },
    required: ["projectId", "game"],
  },
  handler: async (args) => {
    const projectIdResult = requireString(args, "projectId");
    if (!projectIdResult.ok) return projectIdResult.result;
    const gameResult = requireGame(args, "game", PROJECT_GAMES);
    if (!gameResult.ok) return gameResult.result;
    const qualityScaleResult = optionalNumber(args, "qualityScale");
    if (!qualityScaleResult.ok) return qualityScaleResult.result;
    const difficultyValueResult = optionalNumber(args, "difficultyValue");
    if (!difficultyValueResult.ok) return difficultyValueResult.result;
    const mapMaskResult = optionalString(args, "mapMask");
    if (!mapMaskResult.ok) return mapMaskResult.result;

    const projectId = projectIdResult.value;
    const game = gameResult.value as (typeof PROJECT_GAMES)[number];
    const qualityScale = qualityScaleResult.value;
    const difficultyValue = difficultyValueResult.value;
    const mapMask = mapMaskResult.value;
    try {
      const params: Record<string, unknown> = {};
      if (qualityScale !== undefined) params.qualityScale = qualityScale;
      if (difficultyValue !== undefined) params.difficultyValue = difficultyValue;
      if (mapMask) params.mapMask = mapMask;

      const ini = await getProjectConfigFile(projectId, game, "Game.ini", params);
      return textResult(`Game.ini — ${gameName(game)} (projet ${projectId}) :\n\n${ini}`, {
        projectId,
        game,
        file: "Game.ini",
        content: ini,
      });
    } catch (err) {
      return formatApiError(err);
    }
  },
};

// ---- beacon_put_game_ini ----

const putGameIniTool: ToolDefinition = {
  name: "beacon_put_game_ini",
  description:
    "Met à jour le fichier Game.ini d'un projet Beacon en envoyant le contenu INI complet. " +
    "Workflow recommandé : 1) appeler beacon_generate_game_ini pour lire le contenu actuel, " +
    "2) modifier le texte INI, 3) appeler ce tool pour sauvegarder. " +
    "game : 'ark' ou 'arksa'. content : contenu complet du fichier Game.ini (texte brut).",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", description: "ID du projet" },
      game: {
        type: "string",
        enum: [...PROJECT_GAMES],
        description: "Jeu cible : 'ark' ou 'arksa'",
      },
      content: {
        type: "string",
        description: "Contenu complet du fichier Game.ini (texte brut INI)",
      },
    },
    required: ["projectId", "game", "content"],
  },
  handler: async (args) => {
    const projectIdResult = requireString(args, "projectId");
    if (!projectIdResult.ok) return projectIdResult.result;
    const gameResult = requireGame(args, "game", PROJECT_GAMES);
    if (!gameResult.ok) return gameResult.result;
    const contentResult = requireRawString(args, "content", "content");
    if (!contentResult.ok) return contentResult.result;

    const projectId = projectIdResult.value;
    const game = gameResult.value as (typeof PROJECT_GAMES)[number];
    const content = contentResult.value;
    try {
      await putProjectConfigFile(projectId, game, "Game.ini", content);
      return textResult(
        `Game.ini mis à jour avec succès pour le projet ${projectId} (${gameName(game)}).`,
        { projectId, game, file: "Game.ini" }
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
};

// ---- beacon_generate_game_user_settings_ini ----

const generateGameUserSettingsIniTool: ToolDefinition = {
  name: "beacon_generate_game_user_settings_ini",
  description:
    "Génère et retourne le contenu du fichier GameUserSettings.ini pour un projet Beacon. " +
    "Utiliser ce tool pour lire la configuration actuelle avant de la modifier. " +
    "game : 'ark' (ARK: Survival Evolved) ou 'arksa' (ARK: Survival Ascended).",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", description: "ID du projet" },
      game: {
        type: "string",
        enum: [...PROJECT_GAMES],
        description: "Jeu cible : 'ark' ou 'arksa'",
      },
    },
    required: ["projectId", "game"],
  },
  handler: async (args) => {
    const projectIdResult = requireString(args, "projectId");
    if (!projectIdResult.ok) return projectIdResult.result;
    const gameResult = requireGame(args, "game", PROJECT_GAMES);
    if (!gameResult.ok) return gameResult.result;

    const projectId = projectIdResult.value;
    const game = gameResult.value as (typeof PROJECT_GAMES)[number];
    try {
      const ini = await getProjectConfigFile(projectId, game, "GameUserSettings.ini");
      return textResult(
        `GameUserSettings.ini — ${gameName(game)} (projet ${projectId}) :\n\n${ini}`,
        {
          projectId,
          game,
          file: "GameUserSettings.ini",
          content: ini,
        }
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
};

// ---- beacon_put_game_user_settings_ini ----

const putGameUserSettingsIniTool: ToolDefinition = {
  name: "beacon_put_game_user_settings_ini",
  description:
    "Met à jour le fichier GameUserSettings.ini d'un projet Beacon en envoyant le contenu INI complet. " +
    "Workflow recommandé : 1) appeler beacon_generate_game_user_settings_ini pour lire le contenu actuel, " +
    "2) modifier le texte INI, 3) appeler ce tool pour sauvegarder. " +
    "game : 'ark' ou 'arksa'. content : contenu complet du fichier GameUserSettings.ini (texte brut).",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", description: "ID du projet" },
      game: {
        type: "string",
        enum: [...CONFIG_OPTION_GAMES],
        description: "Jeu cible : 'ark', 'arksa', 'palworld' ou '7dtd'",
      },
      content: {
        type: "string",
        description: "Contenu complet du fichier GameUserSettings.ini (texte brut INI)",
      },
    },
    required: ["projectId", "game", "content"],
  },
  handler: async (args) => {
    const projectIdResult = requireString(args, "projectId");
    if (!projectIdResult.ok) return projectIdResult.result;
    const gameResult = requireGame(args, "game", PROJECT_GAMES);
    if (!gameResult.ok) return gameResult.result;
    const contentResult = requireRawString(args, "content", "content");
    if (!contentResult.ok) return contentResult.result;

    const projectId = projectIdResult.value;
    const game = gameResult.value as (typeof PROJECT_GAMES)[number];
    const content = contentResult.value;
    try {
      await putProjectConfigFile(projectId, game, "GameUserSettings.ini", content);
      return textResult(
        `GameUserSettings.ini mis à jour avec succès pour le projet ${projectId} (${gameName(game)}).`,
        { projectId, game, file: "GameUserSettings.ini" }
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
};

// ---- beacon_get_config_options ----

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
      game: {
        type: "string",
        enum: ["ark", "arksa"],
        description: "Jeu cible : 'ark' ou 'arksa'",
      },
      filter: {
        type: "string",
        description: "Filtre optionnel sur le nom ou la clé de l'option",
      },
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
        });
      }
      const supportsGameVariables = (GAME_VARIABLE_GAMES as readonly Game[]).includes(game);
      const lines = options.map((o) => {
        const header = o.header ? `[${o.header}]` : "";
        const key = o.key ?? o.configOptionId;
        const type = o.valueType ?? "?";
        const def = o.defaultValue !== undefined && o.defaultValue !== null
          ? ` (défaut : ${o.defaultValue})`
          : "";
        const file = o.file ? ` {${o.file}}` : "";
        const desc = o.description ? ` — ${o.description}` : "";
        return `• ${header} ${key} [${type}]${def}${file}${desc}`;
      });
      return textResult(
        `Options de configuration pour ${gameName(game)} (${options.length}) :\n${lines.join("\n")}` +
          (supportsGameVariables
            ? "\n\nLes variables de jeu associees peuvent etre explorees avec beacon_list_game_variables."
            : ""),
        options,
        { count: options.length, game, filter }
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
};

// ---- beacon_list_command_line_options ----

const listCommandLineOptionsTool: ToolDefinition = {
  name: "beacon_list_command_line_options",
  description:
    "Liste les options Beacon liées à la ligne de commande pour un jeu. " +
    "Ces options proviennent de la classe ConfigOption et sont filtrées sur les fichiers " +
    "'CommandLineFlag' et 'CommandLineOption'. " +
    "kind : 'all', 'flag' ou 'option'. filter : filtre textuel optionnel.",
  inputSchema: {
    type: "object",
    properties: {
      game: {
        type: "string",
        enum: ["ark", "arksa"],
        description: "Jeu cible : 'ark' ou 'arksa'",
      },
      kind: {
        type: "string",
        enum: ["all", "flag", "option"],
        description: "Type de paramètres à lister",
      },
      filter: {
        type: "string",
        description: "Filtre optionnel sur le label ou la clé",
      },
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

    const game = gameResult.value;
    const filter = filterResult.value;
    const allowedKinds = ["all", "flag", "option"] as const;
    const kind = (kindRawResult.value ?? "all") as (typeof allowedKinds)[number];
    if (!allowedKinds.includes(kind)) {
      return invalidParams("Paramètre kind invalide. Valeurs acceptées : all, flag, option.", {
        field: "kind",
        acceptedValues: allowedKinds,
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
        return textResult(
          `Aucune option de ligne de commande trouvée pour ${gameName(game)}.`,
          [],
          { count: 0, game, kind, filter }
        );
      }

      const lines = filtered.map((o) => {
        const file = String(o.file ?? "");
        const key = o.key ?? o.configOptionId;
        const type = o.valueType ?? "?";
        const def =
          o.defaultValue !== undefined && o.defaultValue !== null
            ? ` (défaut : ${o.defaultValue})`
            : "";
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

// ---- Enregistrement ----

export function registerProjectTools(server: McpServer): void {
  registerToolGroup(server, [
    listProjectsTool,
    getProjectTool,
    createProjectTool,
    generateGameIniTool,
    putGameIniTool,
    generateGameUserSettingsIniTool,
    putGameUserSettingsIniTool,
    getConfigOptionsTool,
    listCommandLineOptionsTool,
  ]);
}
