import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolDefinition } from "../registry.js";
import { textResult, formatApiError, isValidGame, gameName, SUPPORTED_GAMES, registerToolGroup } from "./shared.js";
import { beaconClient } from "../api/client.js";
import { randomUUID, createHash } from "crypto";
import { gzip } from "zlib";
import { promisify } from "util";

const gzipAsync = promisify(gzip);

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
        return textResult("Aucun projet trouvé.");
      }
      const lines = projects.map(
        (p, i) => `${i + 1}. [${p.projectId}] ${p.name ?? "Sans nom"} (${p.gameId ?? ""})`
      );
      return textResult(`Projets (${projects.length}) :\n${lines.join("\n")}`);
    } catch (err) {
      return textResult(formatApiError(err));
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
    const { projectId } = args;
    if (typeof projectId !== "string" || !projectId) {
      return textResult("Paramètre projectId requis.");
    }
    try {
      const res = await beaconClient.get(`/projects/${projectId}`, {
        headers: { Accept: "application/json" },
      });
      if (typeof res.data === "object" && res.data !== null) {
        return textResult(JSON.stringify(res.data, null, 2));
      }
      return textResult(
        "Le projet existe mais retourne un format binaire. " +
          "Utilise beacon_generate_game_ini pour lire sa configuration."
      );
    } catch (err) {
      return textResult(formatApiError(err));
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
        enum: ["ark", "arksa"],
        description: "Jeu cible : 'ark' ou 'arksa'",
      },
      name: { type: "string", description: "Nom du projet" },
      description: { type: "string", description: "Description du projet (optionnel)" },
    },
    required: ["game", "name"],
  },
  handler: async (args) => {
    const { game, name, description } = args;
    if (!isValidGame(game)) {
      return textResult(`Jeu invalide. Valeurs acceptées : ${SUPPORTED_GAMES.join(", ")}`);
    }
    if (typeof name !== "string" || !name.trim()) {
      return textResult("Paramètre name requis.");
    }
    try {
      const meRes = await beaconClient.get("/users/me");
      const userId: string = meRes.data?.userId;
      if (!userId) {
        return textResult("Impossible de récupérer l'userId. Vérifiez la connexion avec beacon_auth_status.");
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
        name: name.trim(),
        description: typeof description === "string" ? description.trim() : "",
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
        ].join("\n")
      );
    } catch (err) {
      return textResult(formatApiError(err));
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
        enum: ["ark", "arksa"],
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
    const { projectId, game, qualityScale, difficultyValue, mapMask } = args;
    if (typeof projectId !== "string" || !projectId) {
      return textResult("Paramètre projectId requis.");
    }
    if (!isValidGame(game)) {
      return textResult(`Jeu invalide. Valeurs acceptées : ${SUPPORTED_GAMES.join(", ")}`);
    }
    try {
      const params: Record<string, unknown> = {};
      if (typeof qualityScale === "number") params.qualityScale = qualityScale;
      if (typeof difficultyValue === "number") params.difficultyValue = difficultyValue;
      if (typeof mapMask === "string" && mapMask.trim()) params.mapMask = mapMask.trim();

      const res = await beaconClient.get(`/${game}/projects/${projectId}/Game.ini`, {
        params,
        responseType: "text",
      });
      const ini = typeof res.data === "string" ? res.data : JSON.stringify(res.data, null, 2);
      return textResult(`Game.ini — ${gameName(game)} (projet ${projectId}) :\n\n${ini}`);
    } catch (err) {
      return textResult(formatApiError(err));
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
        enum: ["ark", "arksa"],
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
    const { projectId, game, content } = args;
    if (typeof projectId !== "string" || !projectId) {
      return textResult("Paramètre projectId requis.");
    }
    if (!isValidGame(game)) {
      return textResult(`Jeu invalide. Valeurs acceptées : ${SUPPORTED_GAMES.join(", ")}`);
    }
    if (typeof content !== "string" || !content.trim()) {
      return textResult("Paramètre content requis (contenu INI).");
    }
    try {
      await beaconClient.put(`/${game}/projects/${projectId}/Game.ini`, content, {
        headers: { "Content-Type": "text/plain" },
      });
      return textResult(
        `Game.ini mis à jour avec succès pour le projet ${projectId} (${gameName(game)}).`
      );
    } catch (err) {
      return textResult(formatApiError(err));
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
    const { game, filter } = args;
    if (!isValidGame(game)) {
      return textResult(`Jeu invalide. Valeurs acceptées : ${SUPPORTED_GAMES.join(", ")}`);
    }
    try {
      const params: Record<string, string> = { pageSize: "250" };
      if (typeof filter === "string" && filter.trim()) params.search = filter.trim();
      const res = await beaconClient.get(`/${game}/configOptions`, { params });
      const options: Record<string, unknown>[] = res.data?.results ?? res.data ?? [];
      if (!Array.isArray(options) || options.length === 0) {
        return textResult(`Aucune option de configuration trouvée pour ${gameName(game)}.`);
      }
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
        `Options de configuration pour ${gameName(game)} (${options.length}) :\n${lines.join("\n")}`
      );
    } catch (err) {
      return textResult(formatApiError(err));
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
    getConfigOptionsTool,
  ]);
}
