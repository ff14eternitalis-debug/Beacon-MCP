import axios from "axios";
import {
  textResult,
  formatApiError,
  gameName,
  invalidParams,
} from "../shared.js";
import { beaconClient } from "../../api/client.js";
import { randomUUID, createHash } from "crypto";
import { gzip, gunzip } from "zlib";
import { promisify } from "util";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export const gzipAsync = promisify(gzip);
export const gunzipAsync = promisify(gunzip);
export const PROJECT_GAMES = ["ark", "arksa"] as const;
export const CONFIG_OPTION_GAMES = ["ark", "arksa", "palworld", "7dtd"] as const;
export const GAME_VARIABLE_GAMES = ["ark", "arksa", "palworld"] as const;
export type ProjectGame = (typeof PROJECT_GAMES)[number];
export type JsonRecord = Record<string, unknown>;
export type LootExportFile = "all" | "game" | "gus";
export type LootOverrideRecord = JsonRecord;

// ---------------------------------------------------------------------------
// Format binaire .beacon
// Source : Website/api/v4/classes/Project.php + requests/projects/write.php
//
// Structure : [8 bytes magic] + [TAR.GZ]
// TAR.GZ contient :
//   - Manifest.json : métadonnées + données du projet (projectId, gameId, members…)
//   - v7.json       : configuration jeu (vide pour un nouveau projet)
// ---------------------------------------------------------------------------

export const BEACON_MAGIC = Buffer.from("3029a1c4fab67728", "hex");
export const BASE_CONFIG_SET_ID = "94c9797d-857d-574a-bdb9-30ee6543ed12";

export function tarPadBlock(data: Buffer): Buffer {
  const rem = data.length % 512;
  return rem === 0 ? data : Buffer.concat([data, Buffer.alloc(512 - rem)]);
}

export function tarHeader(filename: string, size: number): Buffer {
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

export async function buildBeaconBinary(
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

export function parseJsonBuffer(buffer: Buffer, label: string): JsonRecord {
  const parsed = JSON.parse(buffer.toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} ne contient pas un objet JSON valide.`);
  }
  return parsed as JsonRecord;
}

export function parseTarEntries(tar: Buffer): Map<string, Buffer> {
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

export async function parseBeaconBinary(binary: Buffer): Promise<{ manifest: JsonRecord; v7data: JsonRecord }> {
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

export async function fetchProjectBinary(projectId: string): Promise<Buffer> {
  const res = await beaconClient.get(`/projects/${projectId}`, {
    responseType: "arraybuffer",
  });
  return Buffer.from(res.data);
}

export async function saveProjectBinary(manifest: JsonRecord, v7data: JsonRecord): Promise<JsonRecord> {
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

export async function writeProjectBackup(projectId: string, binary: Buffer): Promise<{ path: string; sha256: string }> {
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

export function createTimestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function sanitizeFileSegment(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export async function writeProjectExportFile(filename: string, content: string): Promise<string> {
  const exportDir = join(homedir(), ".beacon-mcp", "exports");
  await mkdir(exportDir, { recursive: true });
  const exportPath = join(exportDir, filename);
  await writeFile(exportPath, content, "utf8");
  return exportPath;
}

export function buildInitialProjectData(): JsonRecord {
  return {
    configSets: [{ name: "Base", configSetId: BASE_CONFIG_SET_ID }],
    configSetPriorities: [{ ConfigSetId: BASE_CONFIG_SET_ID, Enabled: true }],
    configSetData: {
      [BASE_CONFIG_SET_ID]: {},
    },
  };
}

export async function getProjectConfigFile(
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

export async function getProjectConfigFileOptional(
  projectId: string,
  game: ProjectGame,
  fileName: "Game.ini" | "GameUserSettings.ini",
  params?: Record<string, unknown>
): Promise<string | undefined> {
  try {
    return await getProjectConfigFile(projectId, game, fileName, params);
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      return undefined;
    }
    throw err;
  }
}

export async function putProjectConfigFile(
  projectId: string,
  game: ProjectGame,
  fileName: "Game.ini" | "GameUserSettings.ini",
  content: string
): Promise<void> {
  await beaconClient.put(`/${game}/projects/${projectId}/${fileName}`, content, {
    headers: { "Content-Type": "text/plain" },
  });
}

export function buildConfigParams(
  qualityScale?: number,
  difficultyValue?: number,
  mapMask?: string
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (qualityScale !== undefined) params.qualityScale = qualityScale;
  if (difficultyValue !== undefined) params.difficultyValue = difficultyValue;
  if (mapMask) params.mapMask = mapMask;
  return params;
}

export function optionalBoolean(args: Record<string, unknown>, key: string, defaultValue?: boolean) {
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

export function expectedGameId(game: ProjectGame): "Ark" | "ArkSA" {
  return game === "ark" ? "Ark" : "ArkSA";
}

export async function assertProjectOwnershipAndGame(projectId: string, game: ProjectGame) {
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

export function getModSelections(manifest: JsonRecord): Record<string, boolean> {
  const selections = manifest.modSelections;
  if (!selections || typeof selections !== "object" || Array.isArray(selections)) return {};

  const out: Record<string, boolean> = {};
  for (const [id, enabled] of Object.entries(selections as JsonRecord)) {
    out[id] = Boolean(enabled);
  }
  return out;
}

export async function searchContentPacks(game: ProjectGame, query?: string): Promise<JsonRecord[]> {
  const params: Record<string, string> = { gameId: expectedGameId(game), pageSize: "50" };
  if (query) params.search = query;
  const res = await beaconClient.get("/contentPacks", { params });
  const packs: JsonRecord[] = res.data?.results ?? res.data ?? [];
  return Array.isArray(packs) ? packs : [];
}

export async function getContentPackById(game: ProjectGame, contentPackId: string): Promise<JsonRecord | undefined> {
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

export async function resolveContentPack(game: ProjectGame, contentPackId?: string, modName?: string) {
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

export async function searchProjectsForCurrentUser(search?: string): Promise<JsonRecord[]> {
  const meRes = await beaconClient.get("/user");
  const userId = String(meRes.data?.userId ?? "");
  if (!userId) {
    throw new Error("Impossible de récupérer l'userId. Vérifiez la connexion avec beacon_auth_status.");
  }
  const params: Record<string, string> = {};
  if (search) params.search = search;
  const res = await beaconClient.get(`/users/${userId}/projects`, { params });
  const projects = res.data?.results ?? res.data ?? [];
  return Array.isArray(projects) ? (projects as JsonRecord[]) : [];
}

export async function resolveProjectReference(
  reference: { projectId?: string; projectName?: string },
  options?: { game?: ProjectGame; fieldPrefix?: string }
): Promise<
  | { ok: true; projectId: string; project: JsonRecord }
  | { ok: false; result: ReturnType<typeof invalidParams> }
> {
  const fieldPrefix = options?.fieldPrefix ? `${options.fieldPrefix}` : "";
  const projectId = String(reference.projectId ?? "").trim();
  const projectName = String(reference.projectName ?? "").trim();

  if (projectId) {
    try {
      const project = await fetchReadableProject(projectId);
      const gameId = String(project.manifest.gameId ?? "");
      if (options?.game && gameId !== expectedGameId(options.game)) {
        return {
          ok: false,
          result: invalidParams(`Le projet est ${gameId || "inconnu"}, pas ${expectedGameId(options.game)}.`, {
            projectId,
            game: options.game,
          }),
        };
      }
      return {
        ok: true,
        projectId,
        project: {
          projectId,
          name: project.manifest.name ?? projectId,
          gameId,
        },
      };
    } catch (err) {
      return { ok: false, result: formatApiError(err) };
    }
  }

  if (!projectName) {
    return {
      ok: false,
      result: invalidParams(`Paramètre ${fieldPrefix}projectId ou ${fieldPrefix}projectName requis.`, {
        acceptedFields: [`${fieldPrefix}projectId`, `${fieldPrefix}projectName`],
      }),
    };
  }

  try {
    const projects = await searchProjectsForCurrentUser(projectName);
    const filtered = projects.filter((project) => {
      const name = String(project.name ?? "");
      const gameId = String(project.gameId ?? "");
      const gameMatches = options?.game ? gameId === expectedGameId(options.game) : true;
      return gameMatches;
    });
    const exactMatches = filtered.filter(
      (project) => String(project.name ?? "").toLowerCase() === projectName.toLowerCase()
    );
    const matches = exactMatches.length > 0 ? exactMatches : filtered;

    if (matches.length === 0) {
      return {
        ok: false,
        result: invalidParams(`Aucun projet trouvé avec le nom "${projectName}".`, {
          [`${fieldPrefix}projectName`]: projectName,
          game: options?.game,
        }),
      };
    }

    if (matches.length > 1) {
      const lines = matches
        .slice(0, 10)
        .map((project) => `• [${project.projectId}] ${project.name ?? "Sans nom"} (${project.gameId ?? ""})`)
        .join("\n");
      return {
        ok: false,
        result: invalidParams(
          `Plusieurs projets correspondent à "${projectName}". Confirmez avec ${fieldPrefix}projectId :\n${lines}`,
          {
            [`${fieldPrefix}projectName`]: projectName,
            choices: matches,
          }
        ),
      };
    }

    const project = matches[0];
    return {
      ok: true,
      projectId: String(project.projectId ?? ""),
      project,
    };
  } catch (err) {
    return { ok: false, result: formatApiError(err) };
  }
}

export async function getEngram(game: ProjectGame, engramId: string): Promise<JsonRecord> {
  const res = await beaconClient.get(`/${game}/engrams/${engramId}`);
  return res.data as JsonRecord;
}

export async function searchEngrams(
  game: ProjectGame,
  query?: string,
  options?: { contentPackId?: string; pageSize?: number }
): Promise<JsonRecord[]> {
  const params: Record<string, string> = { pageSize: String(options?.pageSize ?? 50) };
  if (query) params.search = query;
  if (options?.contentPackId) params.contentPackId = options.contentPackId;
  const res = await beaconClient.get(`/${game}/engrams`, { params });
  const items = res.data?.results ?? res.data ?? [];
  return Array.isArray(items) ? (items as JsonRecord[]) : [];
}

export async function resolveEngramReference(
  game: ProjectGame,
  reference: {
    engramId?: string;
    engramName?: string;
    contentPackId?: string;
    modName?: string;
  }
): Promise<
  | { ok: true; engram: JsonRecord; engramId: string; contentPack?: JsonRecord }
  | { ok: false; result: ReturnType<typeof invalidParams> }
> {
  const engramId = String(reference.engramId ?? "").trim();
  const engramName = String(reference.engramName ?? "").trim();
  const contentPackId = String(reference.contentPackId ?? "").trim();
  const modName = String(reference.modName ?? "").trim();

  let resolvedContentPack: JsonRecord | undefined;
  let resolvedContentPackId = contentPackId || undefined;

  if (!resolvedContentPackId && modName) {
    const packResult = await resolveContentPack(game, undefined, modName);
    if (!packResult.ok) return { ok: false, result: packResult.result };
    resolvedContentPack = packResult.pack;
    resolvedContentPackId = String(packResult.pack.contentPackId ?? packResult.pack.id ?? "").trim() || undefined;
  } else if (resolvedContentPackId) {
    resolvedContentPack = await getContentPackById(game, resolvedContentPackId);
  }

  if (engramId) {
    try {
      const engram = await getEngram(game, engramId);
      const actualId = String(engram.engramId ?? engram.blueprintId ?? engram.objectId ?? engram.id ?? "").trim();
      if (!actualId) {
        return {
          ok: false,
          result: invalidParams("L'engram trouvé ne contient pas d'identifiant exploitable.", { engramId, game }),
        };
      }
      if (resolvedContentPackId) {
        const engramPackId = String(engram.contentPackId ?? "").trim();
        if (engramPackId && engramPackId !== resolvedContentPackId) {
          return {
            ok: false,
            result: invalidParams("L'engram trouvé n'appartient pas au mod demandé.", {
              game,
              engramId: actualId,
              engramName,
              contentPackId: resolvedContentPackId,
              modName,
            }),
          };
        }
      }
      return { ok: true, engram, engramId: actualId, contentPack: resolvedContentPack };
    } catch (err) {
      return { ok: false, result: formatApiError(err) };
    }
  }

  if (!engramName) {
    return {
      ok: false,
      result: invalidParams("Paramètre engramId ou engramName requis.", {
        acceptedFields: ["engramId", "engramName"],
      }),
    };
  }

  try {
    const matches = await searchEngrams(game, engramName, {
      contentPackId: resolvedContentPackId,
      pageSize: 50,
    });

    if (matches.length === 0) {
      return {
        ok: false,
        result: invalidParams(
          `Aucun engram trouvé pour ${gameName(game)} avec "${engramName}".`,
          { game, engramName, contentPackId: resolvedContentPackId, modName }
        ),
      };
    }

    const exactMatches = matches.filter((engram) => {
      const candidates = [
        engram.label,
        engram.name,
        engram.classString,
        engram.entryString,
      ]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.toLowerCase());
      return candidates.includes(engramName.toLowerCase());
    });

    const selectedMatches = exactMatches.length > 0 ? exactMatches : matches;
    if (selectedMatches.length > 1) {
      const lines = selectedMatches
        .slice(0, 10)
        .map((engram) => {
          const id = String(engram.engramId ?? engram.objectId ?? engram.id ?? "?");
          const label = String(engram.label ?? engram.name ?? engram.classString ?? "Sans nom");
          const packName = String(engram.contentPackName ?? engram.contentPackId ?? "jeu de base");
          return `• [${id}] ${label} (${packName})`;
        })
        .join("\n");
      return {
        ok: false,
        result: invalidParams(
          "Plusieurs engrams correspondent à cette recherche. Confirmez avec engramId ou précisez le mod :\n" + lines,
          {
            game,
            engramName,
            modName,
            contentPackId: resolvedContentPackId,
            choices: selectedMatches,
          }
        ),
      };
    }

    const selected = selectedMatches[0];
    const selectedId = String(
      selected.engramId ?? selected.blueprintId ?? selected.objectId ?? selected.id ?? ""
    ).trim();
    if (!selectedId) {
      return {
        ok: false,
        result: invalidParams("L'engram trouvé ne contient pas d'identifiant exploitable.", {
          game,
          engramName,
        }),
      };
    }
    const engram = await getEngram(game, selectedId);
    const actualId = String(engram.engramId ?? engram.blueprintId ?? engram.objectId ?? engram.id ?? "").trim();
    if (!actualId) {
      return {
        ok: false,
        result: invalidParams("L'engram trouvé ne contient pas d'identifiant exploitable.", {
          game,
          engramName,
        }),
      };
    }

    return { ok: true, engram, engramId: actualId, contentPack: resolvedContentPack };
  } catch (err) {
    return { ok: false, result: formatApiError(err) };
  }
}

export function engramControlName(game: ProjectGame): "Ark.EngramControl" | "ArkSA.EngramControl" {
  return game === "ark" ? "Ark.EngramControl" : "ArkSA.EngramControl";
}

export function blueprintAttributeManagerSchema(game: ProjectGame): "Ark.BlueprintAttributeManager" | "ArkSA.BlueprintAttributeManager" {
  return game === "ark" ? "Ark.BlueprintAttributeManager" : "ArkSA.BlueprintAttributeManager";
}

export function getConfigSetData(v7data: JsonRecord): JsonRecord {
  if (!v7data.configSetData || typeof v7data.configSetData !== "object" || Array.isArray(v7data.configSetData)) {
    v7data.configSetData = {};
  }
  return v7data.configSetData as JsonRecord;
}

export function getBaseConfigSet(v7data: JsonRecord): JsonRecord {
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

export function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function optionalStringArray(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (value === undefined || value === null || value === "") {
    return { ok: true as const, value: undefined as string[] | undefined };
  }
  if (Array.isArray(value)) {
    const items = value
      .filter((item) => item !== undefined && item !== null && String(item).trim().length > 0)
      .map((item) => String(item).trim());
    return { ok: true as const, value: items };
  }
  if (typeof value === "string") {
    const items = value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return { ok: true as const, value: items };
  }
  return {
    ok: false as const,
    result: invalidParams(`Paramètre ${key} invalide.`, {
      field: key,
      expected: "string[] | comma-separated string",
    }),
  };
}

export function optionalRecord(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (value === undefined || value === null || value === "") {
    return { ok: true as const, value: undefined as JsonRecord | undefined };
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return { ok: true as const, value: value as JsonRecord };
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ok: true as const, value: parsed as JsonRecord };
      }
    } catch {
      // handled below
    }
  }
  return {
    ok: false as const,
    result: invalidParams(`Paramètre ${key} invalide.`, {
      field: key,
      expected: "object | JSON object string",
    }),
  };
}

export function lootDropsConfigName(game: ProjectGame): "Ark.LootDrops" | "ArkSA.LootDrops" {
  return game === "ark" ? "Ark.LootDrops" : "ArkSA.LootDrops";
}

export function getLootDropsConfig(v7data: JsonRecord, game: ProjectGame): JsonRecord {
  const baseConfig = getBaseConfigSet(v7data);
  const configName = lootDropsConfigName(game);
  const current = baseConfig[configName];
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    baseConfig[configName] = {
      Implicit: false,
      overrides: [],
    };
  }
  return baseConfig[configName] as JsonRecord;
}

export function getLootOverrides(v7data: JsonRecord, game: ProjectGame): LootOverrideRecord[] {
  const lootConfig = getLootDropsConfig(v7data, game);
  if (!Array.isArray(lootConfig.overrides)) {
    lootConfig.overrides = [];
  }
  return (lootConfig.overrides as unknown[]).filter(
    (item): item is LootOverrideRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

export function setLootOverrides(v7data: JsonRecord, game: ProjectGame, overrides: LootOverrideRecord[]): void {
  const lootConfig = getLootDropsConfig(v7data, game);
  lootConfig.Implicit = false;
  lootConfig.overrides = overrides;
}

export function getOverrideDefinition(override: LootOverrideRecord): JsonRecord | undefined {
  const definition = override.definition;
  return definition && typeof definition === "object" && !Array.isArray(definition)
    ? (definition as JsonRecord)
    : undefined;
}

export function getOverrideSets(override: LootOverrideRecord): JsonRecord[] {
  const sets = override.sets;
  if (!Array.isArray(sets)) return [];
  return sets.filter(
    (item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

export function getSetEntries(set: JsonRecord): JsonRecord[] {
  const entries = set.entries;
  if (!Array.isArray(entries)) return [];
  return entries.filter(
    (item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

export function getEntryOptions(entry: JsonRecord): JsonRecord[] {
  const options = entry.options;
  if (!Array.isArray(options)) return [];
  return options.filter(
    (item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

export function lootDropIdentity(override: LootOverrideRecord): { blueprintId: string; classString: string; label: string } {
  const definition = getOverrideDefinition(override) ?? {};
  return {
    blueprintId: String(definition.blueprintId ?? "").trim(),
    classString: String(definition.classString ?? "").trim(),
    label: String(definition.label ?? "").trim(),
  };
}

export function lootOverrideFingerprint(override: LootOverrideRecord): string {
  const normalizedSets = getOverrideSets(override).map((set) => ({
    label: String(set.label ?? ""),
    minNumItems: Number(set.minNumItems ?? 0),
    maxNumItems: Number(set.maxNumItems ?? 0),
    weight: Number(set.weight ?? 0),
    preventDuplicates: Boolean(set.preventDuplicates),
    entries: getSetEntries(set).map((entry) => ({
      minQuantity: Number(entry.minQuantity ?? 0),
      maxQuantity: Number(entry.maxQuantity ?? 0),
      minQuality: String(entry.minQuality ?? ""),
      maxQuality: String(entry.maxQuality ?? ""),
      blueprintChance: Number(entry.blueprintChance ?? 0),
      weight: Number(entry.weight ?? 0),
      singleItemQuantity: Boolean(entry.singleItemQuantity),
      preventGrinding: Boolean(entry.preventGrinding),
      statClampMultiplier: Number(entry.statClampMultiplier ?? 0),
      options: getEntryOptions(entry).map((option) => {
        const engram = option.engram;
        const record =
          engram && typeof engram === "object" && !Array.isArray(engram) ? (engram as JsonRecord) : {};
        return {
          label: String(record.label ?? ""),
          blueprintId: String(record.blueprintId ?? ""),
          classString: String(record.classString ?? ""),
          weight: Number(option.weight ?? 0),
        };
      }),
    })),
  }));
  return createHash("sha1").update(JSON.stringify(normalizedSets)).digest("hex");
}

export function collectOverrideContentPackIds(override: LootOverrideRecord): string[] {
  const contentPackIds = new Set<string>();
  const definition = getOverrideDefinition(override);
  const definitionPack = String(definition?.contentPackId ?? "").trim();
  if (definitionPack) contentPackIds.add(definitionPack);

  for (const set of getOverrideSets(override)) {
    for (const entry of getSetEntries(set)) {
      for (const option of getEntryOptions(entry)) {
        const engram = option.engram;
        if (engram && typeof engram === "object" && !Array.isArray(engram)) {
          const contentPackId = String((engram as JsonRecord).contentPackId ?? "").trim();
          if (contentPackId) contentPackIds.add(contentPackId);
        }
      }
    }
  }

  return [...contentPackIds];
}

export function mergeRequiredContentPacks(manifest: JsonRecord, overrides: LootOverrideRecord[]): string[] {
  const selections = getModSelections(manifest);
  const enabledIds = new Set<string>();
  for (const override of overrides) {
    for (const contentPackId of collectOverrideContentPackIds(override)) {
      selections[contentPackId] = true;
      enabledIds.add(contentPackId);
    }
  }
  manifest.modSelections = selections;
  return [...enabledIds];
}

export function findOverrideIndex(
  overrides: LootOverrideRecord[],
  matcher: { lootDropId?: string; lootDropClassString?: string }
): number {
  const wantedId = String(matcher.lootDropId ?? "").trim().toLowerCase();
  const wantedClass = String(matcher.lootDropClassString ?? "").trim().toLowerCase();
  return overrides.findIndex((override) => {
    const identity = lootDropIdentity(override);
    return (
      (wantedId.length > 0 && identity.blueprintId.toLowerCase() === wantedId) ||
      (wantedClass.length > 0 && identity.classString.toLowerCase() === wantedClass)
    );
  });
}

export function summarizeLootOverride(override: LootOverrideRecord) {
  const identity = lootDropIdentity(override);
  const sets = getOverrideSets(override);
  const entries = sets.flatMap((set) => getSetEntries(set));
  const options = entries.flatMap((entry) => getEntryOptions(entry));
  const contentPacks = new Map<string, string>();
  for (const option of options) {
    const engram = option.engram;
    if (engram && typeof engram === "object" && !Array.isArray(engram)) {
      const record = engram as JsonRecord;
      const id = String(record.contentPackId ?? "").trim();
      const name = String(record.contentPackName ?? "").trim();
      if (id) contentPacks.set(id, name || id);
    }
  }

  return {
    lootDropId: identity.blueprintId,
    label: identity.label,
    classString: identity.classString,
    minItemSets: Number(override.minItemSets ?? 0),
    maxItemSets: Number(override.maxItemSets ?? 0),
    addToDefaults: Boolean(override.addToDefaults),
    preventDuplicates: Boolean(override.preventDuplicates),
    setCount: sets.length,
    entryCount: entries.length,
    optionCount: options.length,
    contentPacks: [...contentPacks.entries()].map(([contentPackId, contentPackName]) => ({
      contentPackId,
      contentPackName,
    })),
    sampleItems: options.slice(0, 8).map((option) => {
      const engram = option.engram;
      const record =
        engram && typeof engram === "object" && !Array.isArray(engram) ? (engram as JsonRecord) : {};
      return String(record.label ?? record.classString ?? "Item");
    }),
  };
}

export function summarizeLootFamily(overrides: LootOverrideRecord[]) {
  const summary = overrides.map((override) => summarizeLootOverride(override));
  return {
    familyKey: lootOverrideFingerprint(overrides[0]),
    overrides: summary,
    labels: summary.map((item) => item.label),
    classStrings: summary.map((item) => item.classString),
  };
}

export function findLootFamily(
  overrides: LootOverrideRecord[],
  family: string
): { familyKey: string; overrides: LootOverrideRecord[] } | undefined {
  const wanted = family.trim().toLowerCase();
  if (!wanted) return undefined;

  const groups = new Map<string, LootOverrideRecord[]>();
  for (const override of overrides) {
    const key = lootOverrideFingerprint(override);
    const current = groups.get(key) ?? [];
    current.push(override);
    groups.set(key, current);
  }

  for (const [familyKey, familyOverrides] of groups.entries()) {
    if (familyKey.toLowerCase() === wanted) {
      return { familyKey, overrides: familyOverrides };
    }

    if (
      familyOverrides.some((override) => {
        const identity = lootDropIdentity(override);
        return (
          identity.label.toLowerCase() === wanted ||
          identity.classString.toLowerCase() === wanted ||
          identity.blueprintId.toLowerCase() === wanted
        );
      })
    ) {
      return { familyKey, overrides: familyOverrides };
    }
  }

  return undefined;
}

export async function fetchReadableProject(projectId: string): Promise<{ manifest: JsonRecord; v7data: JsonRecord; binary: Buffer }> {
  const binary = await fetchProjectBinary(projectId);
  const parsed = await parseBeaconBinary(binary);
  return { ...parsed, binary };
}

export function validateLootOverrideRecord(override: JsonRecord): { ok: true; value: LootOverrideRecord } | { ok: false; message: string } {
  const definition = getOverrideDefinition(override);
  if (!definition) {
    return { ok: false, message: "Le payload override doit contenir un objet definition." };
  }

  const blueprintId = String(definition.blueprintId ?? "").trim();
  const classString = String(definition.classString ?? "").trim();
  if (!blueprintId && !classString) {
    return {
      ok: false,
      message: "Le payload override doit contenir definition.blueprintId ou definition.classString.",
    };
  }

  const sets = getOverrideSets(override);
  if (sets.length === 0) {
    return { ok: false, message: "Le payload override doit contenir au moins un item set dans sets." };
  }

  return { ok: true, value: override };
}

export function ensureEditor(v7data: JsonRecord, editorName: string): void {
  const editors = Array.isArray(v7data.editors) ? v7data.editors.map(String) : [];
  if (!editors.includes(editorName)) editors.push(editorName);
  v7data.editors = editors;
}

export function buildBlueprintReference(engram: JsonRecord): JsonRecord {
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

export function quoteIniValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function buildNamedEngramEntryOverride(attribute: JsonRecord): string | undefined {
  const entryString = String(attribute["Entry String"] ?? "").trim();
  if (!entryString) return undefined;

  const argumentsList = [`EngramClassName=${quoteIniValue(entryString)}`];
  const level = attribute["Player Level"];
  const points = attribute["Unlock Points"];
  const removePrerequisites = attribute["Remove Prerequisites"];

  // Beacon always emits level + points because the game falls back poorly otherwise.
  argumentsList.push(`EngramLevelRequirement=${Number.isFinite(Number(level)) ? Math.trunc(Number(level)) : 1}`);
  argumentsList.push(`EngramPointsCost=${Number.isFinite(Number(points)) ? Math.trunc(Number(points)) : 0}`);

  if (typeof removePrerequisites === "boolean") {
    argumentsList.push(`RemoveEngramPreReq=${removePrerequisites ? "True" : "False"}`);
  }

  return `OverrideNamedEngramEntries=(${argumentsList.join(",")})`;
}

export function extractEngramOverrideLines(game: ProjectGame, v7data: JsonRecord): string[] {
  const baseConfig = getBaseConfigSet(v7data);
  const controlName = engramControlName(game);
  const control = baseConfig[controlName];
  if (!control || typeof control !== "object" || Array.isArray(control)) return [];

  const overrides = (control as JsonRecord).Overrides;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return [];

  const attributes = (overrides as JsonRecord).Attributes;
  if (!Array.isArray(attributes)) return [];

  return attributes
    .filter((attribute): attribute is JsonRecord => Boolean(attribute) && typeof attribute === "object" && !Array.isArray(attribute))
    .map((attribute) => buildNamedEngramEntryOverride(attribute))
    .filter((line): line is string => typeof line === "string" && line.length > 0);
}

export function appendLinesToShooterGameIni(content: string, lines: string[]): string {
  if (lines.length === 0) return content;

  const sectionHeader = "[/script/shootergame.shootergamemode]";
  const trimmed = content.trimEnd();
  const hasSection = trimmed.toLowerCase().includes(sectionHeader.toLowerCase());

  if (!hasSection) {
    return [trimmed, "", sectionHeader, ...lines].filter((part) => part.length > 0).join("\n");
  }

  const normalized = trimmed.replace(/\r\n/g, "\n");
  const segments = normalized.split("\n");
  const output: string[] = [];
  let inserted = false;

  for (let index = 0; index < segments.length; index += 1) {
    const line = segments[index];
    output.push(line);

    if (!inserted && line.trim().toLowerCase() === sectionHeader.toLowerCase()) {
      let nextIndex = index + 1;
      while (nextIndex < segments.length && !segments[nextIndex].startsWith("[")) {
        output.push(segments[nextIndex]);
        nextIndex += 1;
      }
      output.push(...lines);
      inserted = true;
      index = nextIndex - 1;
    }
  }

  return output.join("\n");
}

export async function buildEffectiveProjectExport(
  projectId: string,
  game: ProjectGame,
  file: "all" | "game" | "gus",
  params: Record<string, unknown>
): Promise<{ gameIni?: string; gameUserSettingsIni?: string; derivedGameIniLines: string[] }> {
  const includeGameIni = file === "all" || file === "game";
  const includeGus = file === "all" || file === "gus";
  const binary = await fetchProjectBinary(projectId);
  const { v7data } = await parseBeaconBinary(binary);
  const derivedGameIniLines = extractEngramOverrideLines(game, v7data);

  const [rawGameIni, gameUserSettingsIni] = await Promise.all([
    includeGameIni ? getProjectConfigFile(projectId, game, "Game.ini", params) : Promise.resolve(undefined),
    includeGus
      ? file === "all"
        ? getProjectConfigFileOptional(projectId, game, "GameUserSettings.ini")
        : getProjectConfigFile(projectId, game, "GameUserSettings.ini")
      : Promise.resolve(undefined),
  ]);

  const gameIni = rawGameIni !== undefined
    ? appendLinesToShooterGameIni(rawGameIni, derivedGameIniLines)
    : undefined;

  return { gameIni, gameUserSettingsIni, derivedGameIniLines };
}

export type ExportFormat = "full" | "overrides_only";

export function buildProjectChatExport(
  projectId: string,
  game: ProjectGame,
  file: "all" | "game" | "gus",
  format: ExportFormat,
  bundle: { gameIni?: string; gameUserSettingsIni?: string; derivedGameIniLines: string[] }
): { message: string; payload: JsonRecord } {
  const { gameIni, gameUserSettingsIni, derivedGameIniLines } = bundle;
  const includeGus = file === "all" || file === "gus";

  if (format === "overrides_only") {
    if (derivedGameIniLines.length === 0) {
      return {
        message: `Aucune ligne d'override dérivée trouvée pour ${gameName(game)} (projet ${projectId}).`,
        payload: {
          projectId,
          game,
          file,
          format,
          derivedGameIniLines,
        },
      };
    }

    return {
      message: [
        `Overrides utiles pour ${gameName(game)} (projet ${projectId}) :`,
        "",
        "```ini",
        derivedGameIniLines.join("\n"),
        "```",
      ].join("\n"),
      payload: {
        projectId,
        game,
        file,
        format,
        derivedGameIniLines,
      },
    };
  }

  const sections: string[] = [];
  if (gameIni !== undefined) {
    sections.push(["[Game.ini]", "```ini", gameIni, "```"].join("\n"));
  }
  if (gameUserSettingsIni !== undefined) {
    sections.push(["[GameUserSettings.ini]", "```ini", gameUserSettingsIni, "```"].join("\n"));
  } else if (includeGus && file === "all") {
    sections.push(
      "[GameUserSettings.ini]\n```text\nNon disponible via l'API Beacon pour ce projet.\n```"
    );
  }

  return {
    message: `Export de configuration pour ${gameName(game)} (projet ${projectId}) :\n\n${sections.join("\n\n")}`,
    payload: {
      projectId,
      game,
      file,
      format,
      derivedGameIniLines,
      files: {
        ...(gameIni !== undefined ? { "Game.ini": gameIni } : {}),
        ...(gameUserSettingsIni !== undefined
          ? { "GameUserSettings.ini": gameUserSettingsIni }
          : includeGus && file === "all"
          ? { "GameUserSettings.ini": null }
          : {}),
      },
    },
  };
}

export function buildProjectFileExport(
  projectId: string,
  projectName: string,
  game: ProjectGame,
  file: "all" | "game" | "gus",
  mapMask: string | undefined,
  format: ExportFormat,
  bundle: { gameIni?: string; gameUserSettingsIni?: string; derivedGameIniLines: string[] }
): { content: string; exportedFiles: Record<string, boolean> } {
  const { gameIni, gameUserSettingsIni, derivedGameIniLines } = bundle;
  const includeGus = file === "all" || file === "gus";

  if (format === "overrides_only") {
    const lines = [
      `Project: ${projectName}`,
      `Project ID: ${projectId}`,
      `Game: ${gameName(game)}`,
      ...(mapMask ? [`Map Mask: ${mapMask}`] : []),
      "",
      "===== OverrideNamedEngramEntries =====",
      ...(derivedGameIniLines.length > 0
        ? derivedGameIniLines
        : ["Aucune ligne d'override dérivée trouvée pour ce projet."]),
      "",
    ];

    return {
      content: lines.join("\n"),
      exportedFiles: {},
    };
  }

  const lines = [
    `Project: ${projectName}`,
    `Project ID: ${projectId}`,
    `Game: ${gameName(game)}`,
    ...(mapMask ? [`Map Mask: ${mapMask}`] : []),
    "",
  ];

  if (gameIni !== undefined) {
    lines.push("===== Game.ini =====", gameIni, "");
  }
  if (gameUserSettingsIni !== undefined) {
    lines.push("===== GameUserSettings.ini =====", gameUserSettingsIni, "");
  } else if (includeGus && file === "all") {
    lines.push(
      "===== GameUserSettings.ini =====",
      "Non disponible via l'API Beacon pour ce projet.",
      ""
    );
  }

  return {
    content: lines.join("\n"),
    exportedFiles: {
      ...(gameIni !== undefined ? { "Game.ini": true } : {}),
      ...(gameUserSettingsIni !== undefined
        ? { "GameUserSettings.ini": true }
        : includeGus && file === "all"
        ? { "GameUserSettings.ini": false }
        : {}),
    },
  };
}




