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
import { gzip, gunzip } from "zlib";
import { promisify } from "util";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const PROJECT_GAMES = ["ark", "arksa"] as const;
const CONFIG_OPTION_GAMES = ["ark", "arksa", "palworld", "7dtd"] as const;
const GAME_VARIABLE_GAMES = ["ark", "arksa", "palworld"] as const;
type ProjectGame = (typeof PROJECT_GAMES)[number];
type JsonRecord = Record<string, unknown>;

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
const BASE_CONFIG_SET_ID = "94c9797d-857d-574a-bdb9-30ee6543ed12";

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
  manifest: JsonRecord,
  v7data: JsonRecord
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

function parseJsonBuffer(buffer: Buffer, label: string): JsonRecord {
  const parsed = JSON.parse(buffer.toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} ne contient pas un objet JSON valide.`);
  }
  return parsed as JsonRecord;
}

function parseTarEntries(tar: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const rawName = header.subarray(0, 100).toString("utf8");
    const name = rawName.replace(/\0.*$/, "").trim();
    const rawSize = header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim();
    const size = parseInt(rawSize || "0", 8);
    if (!name || Number.isNaN(size)) {
      throw new Error("Archive .beacon invalide : entrée TAR illisible.");
    }

    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    entries.set(name, tar.subarray(dataStart, dataEnd));
    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  return entries;
}

async function parseBeaconBinary(binary: Buffer): Promise<{ manifest: JsonRecord; v7data: JsonRecord }> {
  if (binary.length < BEACON_MAGIC.length || !binary.subarray(0, BEACON_MAGIC.length).equals(BEACON_MAGIC)) {
    throw new Error("Fichier projet Beacon invalide : magic header absent.");
  }

  const tar = await gunzipAsync(binary.subarray(BEACON_MAGIC.length));
  const entries = parseTarEntries(tar);
  const manifestBuffer = entries.get("Manifest.json");
  const v7Buffer = entries.get("v7.json");
  if (!manifestBuffer || !v7Buffer) {
    throw new Error("Fichier projet Beacon incomplet : Manifest.json ou v7.json absent.");
  }

  return {
    manifest: parseJsonBuffer(manifestBuffer, "Manifest.json"),
    v7data: parseJsonBuffer(v7Buffer, "v7.json"),
  };
}

async function fetchProjectBinary(projectId: string): Promise<Buffer> {
  const res = await beaconClient.get(`/projects/${projectId}`, {
    responseType: "arraybuffer",
  });
  return Buffer.from(res.data);
}

async function saveProjectBinary(manifest: JsonRecord, v7data: JsonRecord): Promise<JsonRecord> {
  manifest.timestamp = Math.floor(Date.now() / 1000);
  const binary = await buildBeaconBinary(manifest, v7data);
  const sha256 = createHash("sha256").update(binary).digest("hex");
  const res = await beaconClient.post("/projects", binary, {
    headers: {
      "Content-Type": "application/x-beacon-project",
      "X-Beacon-SHA256": sha256,
    },
    maxBodyLength: Infinity,
  });
  return (res.data ?? {}) as JsonRecord;
}

async function writeProjectBackup(projectId: string, binary: Buffer): Promise<{ path: string; sha256: string }> {
  const backupDir = join(homedir(), ".beacon-mcp", "backups");
  await mkdir(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(backupDir, `${projectId}-${timestamp}.beacon`);
  await writeFile(backupPath, binary);
  return {
    path: backupPath,
    sha256: createHash("sha256").update(binary).digest("hex"),
  };
}

function buildInitialProjectData(): JsonRecord {
  return {
    configSets: [{ name: "Base", configSetId: BASE_CONFIG_SET_ID }],
    configSetPriorities: [{ ConfigSetId: BASE_CONFIG_SET_ID, Enabled: true }],
    configSetData: {
      [BASE_CONFIG_SET_ID]: {},
    },
  };
}

async function getProjectConfigFile(
  projectId: string,
  game: ProjectGame,
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
  game: ProjectGame,
  fileName: "Game.ini" | "GameUserSettings.ini",
  content: string
): Promise<void> {
  await beaconClient.put(`/${game}/projects/${projectId}/${fileName}`, content, {
    headers: { "Content-Type": "text/plain" },
  });
}

function optionalBoolean(args: Record<string, unknown>, key: string, defaultValue?: boolean) {
  const value = args[key];
  if (value === undefined || value === null || value === "") {
    return { ok: true as const, value: defaultValue };
  }
  if (typeof value !== "boolean") {
    return {
      ok: false as const,
      result: invalidParams(`Paramètre ${key} invalide.`, { field: key, expected: "boolean" }),
    };
  }
  return { ok: true as const, value };
}

function expectedGameId(game: ProjectGame): "Ark" | "ArkSA" {
  return game === "ark" ? "Ark" : "ArkSA";
}

async function assertProjectOwnershipAndGame(projectId: string, game: ProjectGame) {
  const [meRes, binary] = await Promise.all([beaconClient.get("/user"), fetchProjectBinary(projectId)]);
  const userId = String(meRes.data?.userId ?? "");
  if (!userId) {
    throw new Error("Impossible de récupérer l'userId. Vérifiez la connexion avec beacon_auth_status.");
  }

  const parsed = await parseBeaconBinary(binary);
  const members = parsed.manifest.members;
  const member = members && typeof members === "object" && !Array.isArray(members)
    ? (members as JsonRecord)[userId]
    : undefined;
  const role = member && typeof member === "object" && !Array.isArray(member)
    ? String((member as JsonRecord).role ?? "")
    : "";
  if (role !== "Owner") {
    throw new Error("Garde-fou : le projet n'appartient pas à l'utilisateur connecté avec le rôle Owner.");
  }

  const manifestGameId = String(parsed.manifest.gameId ?? "");
  if (manifestGameId !== expectedGameId(game)) {
    throw new Error(`Garde-fou : le projet est ${manifestGameId || "inconnu"}, pas ${expectedGameId(game)}.`);
  }

  return { ...parsed, binary, userId };
}

function getModSelections(manifest: JsonRecord): Record<string, boolean> {
  const selections = manifest.modSelections;
  if (!selections || typeof selections !== "object" || Array.isArray(selections)) return {};

  const out: Record<string, boolean> = {};
  for (const [id, enabled] of Object.entries(selections as JsonRecord)) {
    out[id] = Boolean(enabled);
  }
  return out;
}

async function searchContentPacks(game: ProjectGame, query?: string): Promise<JsonRecord[]> {
  const params: Record<string, string> = { gameId: expectedGameId(game), pageSize: "50" };
  if (query) params.search = query;
  const res = await beaconClient.get("/contentPacks", { params });
  const packs: JsonRecord[] = res.data?.results ?? res.data ?? [];
  return Array.isArray(packs) ? packs : [];
}

async function getContentPackById(game: ProjectGame, contentPackId: string): Promise<JsonRecord | undefined> {
  try {
    const res = await beaconClient.get(`/contentPacks/${contentPackId}`);
    const pack = res.data as JsonRecord;
    if (String(pack.contentPackId ?? pack.id ?? "") !== contentPackId) return undefined;
    if (pack.gameId && String(pack.gameId) !== expectedGameId(game)) return undefined;
    return pack;
  } catch {
    return undefined;
  }
}

async function resolveContentPack(game: ProjectGame, contentPackId?: string, modName?: string) {
  if (!contentPackId && !modName) {
    return {
      ok: false as const,
      result: invalidParams("Paramètre contentPackId ou modName requis.", {
        acceptedFields: ["contentPackId", "modName"],
      }),
    };
  }

  if (contentPackId) {
    const pack = await getContentPackById(game, contentPackId);
    if (pack) {
      return { ok: true as const, pack, choices: [pack] };
    }
  }

  const packs = await searchContentPacks(game, contentPackId ?? modName);
  const matches = contentPackId
    ? packs.filter((pack) => String(pack.contentPackId ?? pack.id ?? "") === contentPackId)
    : packs;

  if (matches.length === 0) {
    return {
      ok: false as const,
      result: invalidParams(
        `Aucun mod trouvé pour ${gameName(game)}${modName ? ` avec "${modName}"` : ""}. ` +
          "Importez le mod dans Beacon si nécessaire, puis relancez la recherche.",
        { game, contentPackId, modName }
      ),
    };
  }

  if (!contentPackId && matches.length > 1) {
    const exactMatches = modName
      ? matches.filter((pack) => String(pack.name ?? "").toLowerCase() === modName.toLowerCase())
      : [];
    if (exactMatches.length === 1) {
      return { ok: true as const, pack: exactMatches[0], choices: matches };
    }

    const lines = matches
      .slice(0, 10)
      .map((pack) => `• [${pack.contentPackId ?? pack.id}] ${pack.name ?? "Sans nom"}`)
      .join("\n");
    return {
      ok: false as const,
      result: invalidParams(
        "Plusieurs mods correspondent à cette recherche. Confirmez avec contentPackId avant modification :\n" + lines,
        { game, modName, choices: matches }
      ),
    };
  }

  return { ok: true as const, pack: matches[0], choices: matches };
}

async function getEngram(game: ProjectGame, engramId: string): Promise<JsonRecord> {
  const res = await beaconClient.get(`/${game}/engrams/${engramId}`);
  return res.data as JsonRecord;
}

function engramControlName(game: ProjectGame): "Ark.EngramControl" | "ArkSA.EngramControl" {
  return game === "ark" ? "Ark.EngramControl" : "ArkSA.EngramControl";
}

function blueprintAttributeManagerSchema(game: ProjectGame): "Ark.BlueprintAttributeManager" | "ArkSA.BlueprintAttributeManager" {
  return game === "ark" ? "Ark.BlueprintAttributeManager" : "ArkSA.BlueprintAttributeManager";
}

function getConfigSetData(v7data: JsonRecord): JsonRecord {
  if (!v7data.configSetData || typeof v7data.configSetData !== "object" || Array.isArray(v7data.configSetData)) {
    v7data.configSetData = {};
  }
  return v7data.configSetData as JsonRecord;
}

function getBaseConfigSet(v7data: JsonRecord): JsonRecord {
  const configSetData = getConfigSetData(v7data);
  let configSetId = BASE_CONFIG_SET_ID;

  if (!configSetData[configSetId]) {
    const configSets = Array.isArray(v7data.configSets) ? v7data.configSets : [];
    const firstConfigSet = configSets.find((item) => item && typeof item === "object") as JsonRecord | undefined;
    const existingId = firstConfigSet?.configSetId;
    if (typeof existingId === "string" && existingId) {
      configSetId = existingId;
    }
  }

  if (!configSetData[configSetId] || typeof configSetData[configSetId] !== "object") {
    configSetData[configSetId] = {};
  }

  return configSetData[configSetId] as JsonRecord;
}

function ensureEditor(v7data: JsonRecord, editorName: string): void {
  const editors = Array.isArray(v7data.editors) ? v7data.editors.map(String) : [];
  if (!editors.includes(editorName)) editors.push(editorName);
  v7data.editors = editors;
}

function buildBlueprintReference(engram: JsonRecord): JsonRecord {
  return {
    schema: "blueprintReference",
    version: 2,
    kind: "engram",
    label: engram.label ?? engram.name ?? engram.classString ?? "Engram",
    blueprintId: engram.engramId ?? engram.blueprintId ?? engram.objectId ?? engram.id,
    path: engram.path,
    classString: engram.classString,
    contentPackId: engram.contentPackId,
    contentPackName: engram.contentPackName,
  };
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
    "name : nom du projet. description : description optionnelle. " +
    "mapMask : masque de carte optionnel (par défaut Beacon : 1, généralement The Island).",
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
      mapMask: {
        type: "number",
        description: "Masque de carte optionnel (ex : 1 pour The Island dans les projets Ark/ArkSA)",
      },
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
    const name = nameResult.value;
    const description = descriptionResult.value;
    const mapMask = mapMaskResult.value;
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
        name,
        description: description ?? "",
        ...(mapMask !== undefined ? { map: mapMask } : {}),
        members: {
          [userId]: { role: "Owner", encryptedPassword: null, fingerprint: null },
        },
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

// ---- beacon_set_project_mod ----

const setProjectModTool: ToolDefinition = {
  name: "beacon_set_project_mod",
  description:
    "Active ou désactive un mod Beacon dans un projet existant sans écraser les autres mods. " +
    "Garde-fous : vérifie le propriétaire, vérifie le jeu, recherche le mod, sauvegarde le projet localement, " +
    "fusionne modSelections, puis relit le projet pour confirmer. " +
    "Si modName retourne plusieurs résultats, le tool demande une confirmation via contentPackId.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", description: "ID UUID du projet Beacon" },
      game: {
        type: "string",
        enum: [...PROJECT_GAMES],
        description: "Jeu cible : 'ark' ou 'arksa'",
      },
      contentPackId: {
        type: "string",
        description: "UUID du content pack à activer/désactiver (recommandé si plusieurs mods correspondent)",
      },
      modName: {
        type: "string",
        description: "Nom du mod à rechercher si contentPackId n'est pas fourni",
      },
      enabled: {
        type: "boolean",
        description: "true pour activer le mod, false pour le désactiver. Défaut : true",
      },
      backupLocal: {
        type: "boolean",
        description: "Créer une sauvegarde locale du projet avant écriture. Défaut : true",
      },
    },
    required: ["projectId", "game"],
  },
  handler: async (args) => {
    const projectIdResult = requireString(args, "projectId");
    if (!projectIdResult.ok) return projectIdResult.result;
    const gameResult = requireGame(args, "game", PROJECT_GAMES);
    if (!gameResult.ok) return gameResult.result;
    const contentPackIdResult = optionalString(args, "contentPackId");
    if (!contentPackIdResult.ok) return contentPackIdResult.result;
    const modNameResult = optionalString(args, "modName");
    if (!modNameResult.ok) return modNameResult.result;
    const enabledResult = optionalBoolean(args, "enabled", true);
    if (!enabledResult.ok) return enabledResult.result;
    const backupLocalResult = optionalBoolean(args, "backupLocal", true);
    if (!backupLocalResult.ok) return backupLocalResult.result;

    const projectId = projectIdResult.value;
    const game = gameResult.value as ProjectGame;
    const enabled = enabledResult.value ?? true;

    try {
      const packResult = await resolveContentPack(game, contentPackIdResult.value, modNameResult.value);
      if (!packResult.ok) return packResult.result;

      const pack = packResult.pack;
      const targetContentPackId = String(pack.contentPackId ?? pack.id ?? "");
      if (!targetContentPackId) {
        return invalidParams("Le mod trouvé ne contient pas de contentPackId exploitable.", { pack });
      }

      const { manifest, v7data, binary } = await assertProjectOwnershipAndGame(projectId, game);
      const beforeSelections = getModSelections(manifest);
      const backup = backupLocalResult.value === false ? undefined : await writeProjectBackup(projectId, binary);

      manifest.modSelections = {
        ...beforeSelections,
        [targetContentPackId]: enabled,
      };

      const saveResponse = await saveProjectBinary(manifest, v7data);
      const verificationBinary = await fetchProjectBinary(projectId);
      const verification = await parseBeaconBinary(verificationBinary);
      const afterSelections = getModSelections(verification.manifest);
      const verified = afterSelections[targetContentPackId] === enabled;

      if (!verified) {
        return invalidParams("La sauvegarde a été envoyée, mais la relecture ne confirme pas le mod demandé.", {
          projectId,
          targetContentPackId,
          expected: enabled,
          actual: afterSelections[targetContentPackId],
          backup,
          saveResponse,
        });
      }

      return textResult(
        [
          `Mod ${enabled ? "activé" : "désactivé"} avec succès dans le projet ${projectId}.`,
          `Mod : ${pack.name ?? "Sans nom"} [${targetContentPackId}]`,
          backup ? `Sauvegarde locale : ${backup.path}` : "Sauvegarde locale : désactivée",
          "Les autres mods existants ont été conservés.",
        ].join("\n"),
        {
          projectId,
          game,
          mod: pack,
          enabled,
          beforeModSelections: beforeSelections,
          afterModSelections: afterSelections,
          backup,
          saveResponse,
        },
        { projectId, game, contentPackId: targetContentPackId, verified }
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
};

// ---- beacon_set_engram_unlock ----

const setEngramUnlockTool: ToolDefinition = {
  name: "beacon_set_engram_unlock",
  description:
    "Ajoute ou met à jour un override d'engram dans le projet, par exemple CS Tek Forge niveau 180. " +
    "Garde-fous : vérifie propriétaire + jeu, vérifie l'engram, refuse si le mod requis n'est pas activé " +
    "sauf si enableRequiredMod=true, sauvegarde localement, conserve les autres overrides, puis relit le projet.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", description: "ID UUID du projet Beacon" },
      game: {
        type: "string",
        enum: [...PROJECT_GAMES],
        description: "Jeu cible : 'ark' ou 'arksa'",
      },
      engramId: {
        type: "string",
        description: "ID Beacon de l'engram à modifier",
      },
      level: {
        type: "number",
        description: "Niveau requis souhaité pour débloquer l'engram",
      },
      points: {
        type: "number",
        description: "Points d'engram requis. Défaut : 0",
      },
      autoUnlock: {
        type: "boolean",
        description: "Active l'auto unlock au niveau indiqué. Défaut : true",
      },
      removePrerequisites: {
        type: "boolean",
        description: "Supprimer les prérequis de l'engram. Optionnel",
      },
      enableRequiredMod: {
        type: "boolean",
        description: "Active automatiquement le mod requis si l'engram vient d'un mod. Défaut : false",
      },
      backupLocal: {
        type: "boolean",
        description: "Créer une sauvegarde locale du projet avant écriture. Défaut : true",
      },
    },
    required: ["projectId", "game", "engramId", "level"],
  },
  handler: async (args) => {
    const projectIdResult = requireString(args, "projectId");
    if (!projectIdResult.ok) return projectIdResult.result;
    const gameResult = requireGame(args, "game", PROJECT_GAMES);
    if (!gameResult.ok) return gameResult.result;
    const engramIdResult = requireString(args, "engramId");
    if (!engramIdResult.ok) return engramIdResult.result;
    const levelResult = optionalNumber(args, "level");
    if (!levelResult.ok) return levelResult.result;
    const pointsResult = optionalNumber(args, "points");
    if (!pointsResult.ok) return pointsResult.result;
    const autoUnlockResult = optionalBoolean(args, "autoUnlock", true);
    if (!autoUnlockResult.ok) return autoUnlockResult.result;
    const removePrerequisitesResult = optionalBoolean(args, "removePrerequisites");
    if (!removePrerequisitesResult.ok) return removePrerequisitesResult.result;
    const enableRequiredModResult = optionalBoolean(args, "enableRequiredMod", false);
    if (!enableRequiredModResult.ok) return enableRequiredModResult.result;
    const backupLocalResult = optionalBoolean(args, "backupLocal", true);
    if (!backupLocalResult.ok) return backupLocalResult.result;

    const projectId = projectIdResult.value;
    const game = gameResult.value as ProjectGame;
    const level = levelResult.value;
    if (level === undefined || !Number.isFinite(level) || level < 1) {
      return invalidParams("Paramètre level invalide. Le niveau doit être un nombre supérieur ou égal à 1.", {
        field: "level",
      });
    }

    try {
      const engram = await getEngram(game, engramIdResult.value);
      const targetEngramId = String(engram.engramId ?? engram.blueprintId ?? engram.objectId ?? engram.id ?? "");
      if (!targetEngramId) {
        return invalidParams("L'engram trouvé ne contient pas d'identifiant exploitable.", { engram });
      }

      const { manifest, v7data, binary } = await assertProjectOwnershipAndGame(projectId, game);
      const beforeSelections = getModSelections(manifest);
      const requiredContentPackId = typeof engram.contentPackId === "string" ? engram.contentPackId : undefined;
      const hasRequiredMod = !requiredContentPackId || beforeSelections[requiredContentPackId] === true;

      if (!hasRequiredMod && enableRequiredModResult.value !== true) {
        return invalidParams(
          "Garde-fou : l'engram appartient à un mod qui n'est pas activé dans ce projet. " +
            "Activez d'abord le mod avec beacon_set_project_mod, ou relancez avec enableRequiredMod=true.",
          {
            projectId,
            game,
            engramId: targetEngramId,
            requiredContentPackId,
            contentPackName: engram.contentPackName,
          }
        );
      }

      const backup = backupLocalResult.value === false ? undefined : await writeProjectBackup(projectId, binary);
      if (requiredContentPackId && enableRequiredModResult.value === true) {
        manifest.modSelections = {
          ...beforeSelections,
          [requiredContentPackId]: true,
        };
      }

      const baseConfig = getBaseConfigSet(v7data);
      const controlName = engramControlName(game);
      const currentControl =
        baseConfig[controlName] && typeof baseConfig[controlName] === "object"
          ? (baseConfig[controlName] as JsonRecord)
          : {};
      const overrides =
        currentControl.Overrides && typeof currentControl.Overrides === "object" && !Array.isArray(currentControl.Overrides)
          ? (currentControl.Overrides as JsonRecord)
          : {};
      const attributes = Array.isArray(overrides.Attributes) ? overrides.Attributes : [];
      const nextAttributes = attributes.filter((attribute) => {
        if (!attribute || typeof attribute !== "object" || Array.isArray(attribute)) return true;
        const record = attribute as JsonRecord;
        const blueprint = record.Blueprint;
        const blueprintId =
          blueprint && typeof blueprint === "object" && !Array.isArray(blueprint)
            ? String((blueprint as JsonRecord).blueprintId ?? "")
            : "";
        return blueprintId !== targetEngramId && String(record["Entry String"] ?? "") !== String(engram.entryString ?? "");
      });

      const override: JsonRecord = {
        Blueprint: buildBlueprintReference({ ...engram, engramId: targetEngramId }),
        "Entry String": engram.entryString ?? engram.classString,
        "Player Level": level,
        "Unlock Points": pointsResult.value ?? 0,
        "Auto Unlock Level": autoUnlockResult.value ?? true,
      };
      if (removePrerequisitesResult.value !== undefined) {
        override["Remove Prerequisites"] = removePrerequisitesResult.value;
      }

      baseConfig[controlName] = {
        ...currentControl,
        Overrides: {
          Schema: blueprintAttributeManagerSchema(game),
          Version: 1,
          ...overrides,
          Attributes: [...nextAttributes, override],
        },
        "Auto Unlock All": currentControl["Auto Unlock All"] ?? false,
        "Whitelist Mode": currentControl["Whitelist Mode"] ?? false,
      };
      ensureEditor(v7data, controlName);

      const saveResponse = await saveProjectBinary(manifest, v7data);
      const verificationBinary = await fetchProjectBinary(projectId);
      const verification = await parseBeaconBinary(verificationBinary);
      const verifiedConfig = getBaseConfigSet(verification.v7data)[controlName] as JsonRecord | undefined;
      const verifiedAttributes =
        verifiedConfig?.Overrides &&
        typeof verifiedConfig.Overrides === "object" &&
        !Array.isArray(verifiedConfig.Overrides) &&
        Array.isArray((verifiedConfig.Overrides as JsonRecord).Attributes)
          ? ((verifiedConfig.Overrides as JsonRecord).Attributes as unknown[])
          : [];
      const verified = verifiedAttributes.some((attribute) => {
        if (!attribute || typeof attribute !== "object" || Array.isArray(attribute)) return false;
        const record = attribute as JsonRecord;
        const blueprint = record.Blueprint;
        const blueprintId =
          blueprint && typeof blueprint === "object" && !Array.isArray(blueprint)
            ? String((blueprint as JsonRecord).blueprintId ?? "")
            : "";
        return blueprintId === targetEngramId && Number(record["Player Level"]) === level;
      });

      if (!verified) {
        return invalidParams("La sauvegarde a été envoyée, mais la relecture ne confirme pas l'override d'engram.", {
          projectId,
          game,
          engramId: targetEngramId,
          backup,
          saveResponse,
        });
      }

      return textResult(
        [
          `Override d'engram appliqué avec succès dans le projet ${projectId}.`,
          `Engram : ${engram.label ?? engram.name ?? targetEngramId} [${targetEngramId}]`,
          `Niveau : ${level}`,
          requiredContentPackId && enableRequiredModResult.value === true
            ? `Mod requis activé : ${engram.contentPackName ?? requiredContentPackId}`
            : "Mods existants conservés.",
          backup ? `Sauvegarde locale : ${backup.path}` : "Sauvegarde locale : désactivée",
        ].join("\n"),
        {
          projectId,
          game,
          engram,
          override,
          backup,
          saveResponse,
          requiredContentPackId,
          modSelections: getModSelections(verification.manifest),
        },
        { projectId, game, engramId: targetEngramId, verified }
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
    setProjectModTool,
    setEngramUnlockTool,
    generateGameIniTool,
    putGameIniTool,
    generateGameUserSettingsIniTool,
    putGameUserSettingsIniTool,
    getConfigOptionsTool,
    listCommandLineOptionsTool,
  ]);
}
