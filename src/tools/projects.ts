import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import axios from "axios";
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
type LootExportFile = "all" | "game" | "gus";
type LootOverrideRecord = JsonRecord;

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

function createTimestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sanitizeFileSegment(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

async function writeProjectExportFile(filename: string, content: string): Promise<string> {
  const exportDir = join(homedir(), ".beacon-mcp", "exports");
  await mkdir(exportDir, { recursive: true });
  const exportPath = join(exportDir, filename);
  await writeFile(exportPath, content, "utf8");
  return exportPath;
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

async function getProjectConfigFileOptional(
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

function buildConfigParams(
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

async function searchProjectsForCurrentUser(search?: string): Promise<JsonRecord[]> {
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

async function resolveProjectReference(
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

function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function optionalStringArray(args: Record<string, unknown>, key: string) {
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

function optionalRecord(args: Record<string, unknown>, key: string) {
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

function lootDropsConfigName(game: ProjectGame): "Ark.LootDrops" | "ArkSA.LootDrops" {
  return game === "ark" ? "Ark.LootDrops" : "ArkSA.LootDrops";
}

function getLootDropsConfig(v7data: JsonRecord, game: ProjectGame): JsonRecord {
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

function getLootOverrides(v7data: JsonRecord, game: ProjectGame): LootOverrideRecord[] {
  const lootConfig = getLootDropsConfig(v7data, game);
  if (!Array.isArray(lootConfig.overrides)) {
    lootConfig.overrides = [];
  }
  return (lootConfig.overrides as unknown[]).filter(
    (item): item is LootOverrideRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

function setLootOverrides(v7data: JsonRecord, game: ProjectGame, overrides: LootOverrideRecord[]): void {
  const lootConfig = getLootDropsConfig(v7data, game);
  lootConfig.Implicit = false;
  lootConfig.overrides = overrides;
}

function getOverrideDefinition(override: LootOverrideRecord): JsonRecord | undefined {
  const definition = override.definition;
  return definition && typeof definition === "object" && !Array.isArray(definition)
    ? (definition as JsonRecord)
    : undefined;
}

function getOverrideSets(override: LootOverrideRecord): JsonRecord[] {
  const sets = override.sets;
  if (!Array.isArray(sets)) return [];
  return sets.filter(
    (item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

function getSetEntries(set: JsonRecord): JsonRecord[] {
  const entries = set.entries;
  if (!Array.isArray(entries)) return [];
  return entries.filter(
    (item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

function getEntryOptions(entry: JsonRecord): JsonRecord[] {
  const options = entry.options;
  if (!Array.isArray(options)) return [];
  return options.filter(
    (item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

function lootDropIdentity(override: LootOverrideRecord): { blueprintId: string; classString: string; label: string } {
  const definition = getOverrideDefinition(override) ?? {};
  return {
    blueprintId: String(definition.blueprintId ?? "").trim(),
    classString: String(definition.classString ?? "").trim(),
    label: String(definition.label ?? "").trim(),
  };
}

function lootOverrideFingerprint(override: LootOverrideRecord): string {
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

function collectOverrideContentPackIds(override: LootOverrideRecord): string[] {
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

function mergeRequiredContentPacks(manifest: JsonRecord, overrides: LootOverrideRecord[]): string[] {
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

function findOverrideIndex(
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

function summarizeLootOverride(override: LootOverrideRecord) {
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

function summarizeLootFamily(overrides: LootOverrideRecord[]) {
  const summary = overrides.map((override) => summarizeLootOverride(override));
  return {
    familyKey: lootOverrideFingerprint(overrides[0]),
    overrides: summary,
    labels: summary.map((item) => item.label),
    classStrings: summary.map((item) => item.classString),
  };
}

function findLootFamily(
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

async function fetchReadableProject(projectId: string): Promise<{ manifest: JsonRecord; v7data: JsonRecord; binary: Buffer }> {
  const binary = await fetchProjectBinary(projectId);
  const parsed = await parseBeaconBinary(binary);
  return { ...parsed, binary };
}

function validateLootOverrideRecord(override: JsonRecord): { ok: true; value: LootOverrideRecord } | { ok: false; message: string } {
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

function quoteIniValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function buildNamedEngramEntryOverride(attribute: JsonRecord): string | undefined {
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

function extractEngramOverrideLines(game: ProjectGame, v7data: JsonRecord): string[] {
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

function appendLinesToShooterGameIni(content: string, lines: string[]): string {
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

async function buildEffectiveProjectExport(
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

type ExportFormat = "full" | "overrides_only";

function buildProjectChatExport(
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

function buildProjectFileExport(
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

// ---- beacon_find_project ----

const findProjectTool: ToolDefinition = {
  name: "beacon_find_project",
  description:
    "Recherche un projet Beacon par nom ou fragment de nom pour éviter d'avoir à fournir un UUID. " +
    "Peut être filtré par jeu et retourne les meilleurs candidats.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Nom complet ou fragment de nom à rechercher",
      },
      game: {
        type: "string",
        enum: [...PROJECT_GAMES],
        description: "Jeu cible optionnel : 'ark' ou 'arksa'",
      },
      limit: {
        type: "number",
        description: "Nombre maximum de résultats à retourner (défaut : 10, max : 25)",
      },
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
        return textResult(`Aucun projet trouvé pour "${query}".`, [], {
          count: 0,
          query,
          game,
        });
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

// ---- beacon_get_project ----

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
      projectName: { type: "string", description: "Nom du projet Beacon si l'UUID n'est pas connu" },
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
    required: ["game"],
  },
  handler: async (args) => {
    const projectIdResult = optionalString(args, "projectId");
    if (!projectIdResult.ok) return projectIdResult.result;
    const projectNameResult = optionalString(args, "projectName");
    if (!projectNameResult.ok) return projectNameResult.result;
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

    const game = gameResult.value as ProjectGame;
    const enabled = enabledResult.value ?? true;

    try {
      const resolvedProject = await resolveProjectReference({
        projectId: projectIdResult.value,
        projectName: projectNameResult.value,
      }, { game });
      if (!resolvedProject.ok) return resolvedProject.result;
      const projectId = resolvedProject.projectId;
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
      projectName: { type: "string", description: "Nom du projet Beacon si l'UUID n'est pas connu" },
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
    required: ["game", "engramId", "level"],
  },
  handler: async (args) => {
    const projectIdResult = optionalString(args, "projectId");
    if (!projectIdResult.ok) return projectIdResult.result;
    const projectNameResult = optionalString(args, "projectName");
    if (!projectNameResult.ok) return projectNameResult.result;
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

    const game = gameResult.value as ProjectGame;
    const level = levelResult.value;
    if (level === undefined || !Number.isFinite(level) || level < 1) {
      return invalidParams("Paramètre level invalide. Le niveau doit être un nombre supérieur ou égal à 1.", {
        field: "level",
      });
    }

    try {
      const resolvedProject = await resolveProjectReference({
        projectId: projectIdResult.value,
        projectName: projectNameResult.value,
      }, { game });
      if (!resolvedProject.ok) return resolvedProject.result;
      const projectId = resolvedProject.projectId;
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

// ---- beacon_inspect_loot_project ----

const inspectLootProjectTool: ToolDefinition = {
  name: "beacon_inspect_loot_project",
  description:
    "Inspecte la structure loot d'un projet Beacon et résume ses overrides, familles réutilisées, item sets et content packs utiles.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", description: "ID UUID du projet Beacon" },
      projectName: { type: "string", description: "Nom du projet Beacon si l'UUID n'est pas connu" },
      game: {
        type: "string",
        enum: [...PROJECT_GAMES],
        description: "Jeu cible : 'ark' ou 'arksa'",
      },
    },
    required: ["game"],
  },
  handler: async (args) => {
    const projectIdResult = optionalString(args, "projectId");
    if (!projectIdResult.ok) return projectIdResult.result;
    const projectNameResult = optionalString(args, "projectName");
    if (!projectNameResult.ok) return projectNameResult.result;
    const gameResult = requireGame(args, "game", PROJECT_GAMES);
    if (!gameResult.ok) return gameResult.result;

    const game = gameResult.value as ProjectGame;

    try {
      const resolvedProject = await resolveProjectReference({
        projectId: projectIdResult.value,
        projectName: projectNameResult.value,
      }, { game });
      if (!resolvedProject.ok) return resolvedProject.result;
      const projectId = resolvedProject.projectId;
      const source = await fetchReadableProject(projectId);
      const manifestGameId = String(source.manifest.gameId ?? "");
      if (manifestGameId !== expectedGameId(game)) {
        return invalidParams(`Le projet est ${manifestGameId || "inconnu"}, pas ${expectedGameId(game)}.`, {
          projectId,
          game,
          manifestGameId,
        });
      }

      const overrides = getLootOverrides(source.v7data, game);
      const groups = new Map<string, LootOverrideRecord[]>();
      for (const override of overrides) {
        const key = lootOverrideFingerprint(override);
        const current = groups.get(key) ?? [];
        current.push(override);
        groups.set(key, current);
      }

      const familySummaries = [...groups.values()].map((familyOverrides) => summarizeLootFamily(familyOverrides));
      const enabledModSelections = Object.entries(getModSelections(source.manifest))
        .filter(([, enabled]) => enabled)
        .map(([contentPackId]) => contentPackId);
      const contentPacksUsedByLoot = new Map<string, string>();
      for (const override of overrides) {
        for (const contentPackId of collectOverrideContentPackIds(override)) {
          const summary = summarizeLootOverride(override);
          const pack = summary.contentPacks.find((item) => item.contentPackId === contentPackId);
          contentPacksUsedByLoot.set(contentPackId, pack?.contentPackName ?? contentPackId);
        }
      }

      const lines = [
        `Inspection loot du projet ${String(source.manifest.name ?? projectId)} (${projectId})`,
        `Jeu : ${gameName(game)}`,
        `Overrides loot : ${overrides.length}`,
        `Familles réutilisées : ${familySummaries.length}`,
        `Content packs activés : ${enabledModSelections.length}`,
        "",
        ...familySummaries.slice(0, 12).map((family, index) => {
          const labels = family.labels.slice(0, 4).join(", ");
          return `${index + 1}. Famille ${family.familyKey.slice(0, 8)} — ${family.overrides.length} override(s) — ${labels}`;
        }),
      ];

      return textResult(
        lines.join("\n"),
        {
          projectId,
          projectName: source.manifest.name ?? projectId,
          game,
          mapMask: source.manifest.map,
          overrideCount: overrides.length,
          familyCount: familySummaries.length,
          enabledModSelections,
          contentPacksUsedByLoot: [...contentPacksUsedByLoot.entries()].map(([contentPackId, contentPackName]) => ({
            contentPackId,
            contentPackName,
          })),
          families: familySummaries,
          overrides: overrides.map((override) => summarizeLootOverride(override)),
        },
        {
          projectId,
          game,
          overrideCount: overrides.length,
          familyCount: familySummaries.length,
        }
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
};

// ---- beacon_copy_loot_overrides ----

const copyLootOverridesTool: ToolDefinition = {
  name: "beacon_copy_loot_overrides",
  description:
    "Copie un ou plusieurs overrides de loot d'un projet source vers un projet cible, avec garde-fous propriétaire/jeu, backup local et fusion des mods requis.",
  inputSchema: {
    type: "object",
    properties: {
      sourceProjectId: { type: "string", description: "Projet source contenant les overrides loot" },
      sourceProjectName: { type: "string", description: "Nom du projet source si l'UUID n'est pas connu" },
      targetProjectId: { type: "string", description: "Projet cible à modifier" },
      targetProjectName: { type: "string", description: "Nom du projet cible si l'UUID n'est pas connu" },
      game: {
        type: "string",
        enum: [...PROJECT_GAMES],
        description: "Jeu cible : 'ark' ou 'arksa'",
      },
      lootDropIds: {
        type: "array",
        items: { type: "string" },
        description: "Liste optionnelle des blueprintIds de loot drops à copier",
      },
      lootDropClassStrings: {
        type: "array",
        items: { type: "string" },
        description: "Liste optionnelle des class strings de loot drops à copier",
      },
      backupLocal: {
        type: "boolean",
        description: "Créer une sauvegarde locale du projet cible avant écriture. Défaut : true",
      },
      replaceExisting: {
        type: "boolean",
        description: "Remplacer les overrides existants du même loot drop dans le projet cible. Défaut : true",
      },
    },
    required: ["game"],
  },
  handler: async (args) => {
    const sourceProjectIdResult = optionalString(args, "sourceProjectId");
    if (!sourceProjectIdResult.ok) return sourceProjectIdResult.result;
    const sourceProjectNameResult = optionalString(args, "sourceProjectName");
    if (!sourceProjectNameResult.ok) return sourceProjectNameResult.result;
    const targetProjectIdResult = optionalString(args, "targetProjectId");
    if (!targetProjectIdResult.ok) return targetProjectIdResult.result;
    const targetProjectNameResult = optionalString(args, "targetProjectName");
    if (!targetProjectNameResult.ok) return targetProjectNameResult.result;
    const gameResult = requireGame(args, "game", PROJECT_GAMES);
    if (!gameResult.ok) return gameResult.result;
    const lootDropIdsResult = optionalStringArray(args, "lootDropIds");
    if (!lootDropIdsResult.ok) return lootDropIdsResult.result;
    const lootDropClassStringsResult = optionalStringArray(args, "lootDropClassStrings");
    if (!lootDropClassStringsResult.ok) return lootDropClassStringsResult.result;
    const backupLocalResult = optionalBoolean(args, "backupLocal", true);
    if (!backupLocalResult.ok) return backupLocalResult.result;
    const replaceExistingResult = optionalBoolean(args, "replaceExisting", true);
    if (!replaceExistingResult.ok) return replaceExistingResult.result;

    const game = gameResult.value as ProjectGame;
    const wantedIds = new Set((lootDropIdsResult.value ?? []).map((value) => value.toLowerCase()));
    const wantedClasses = new Set((lootDropClassStringsResult.value ?? []).map((value) => value.toLowerCase()));
    const shouldFilter = wantedIds.size > 0 || wantedClasses.size > 0;

    try {
      const [resolvedSource, resolvedTarget] = await Promise.all([
        resolveProjectReference(
          { projectId: sourceProjectIdResult.value, projectName: sourceProjectNameResult.value },
          { game, fieldPrefix: "source" }
        ),
        resolveProjectReference(
          { projectId: targetProjectIdResult.value, projectName: targetProjectNameResult.value },
          { game, fieldPrefix: "target" }
        ),
      ]);
      if (!resolvedSource.ok) return resolvedSource.result;
      if (!resolvedTarget.ok) return resolvedTarget.result;
      const sourceProjectId = resolvedSource.projectId;
      const targetProjectId = resolvedTarget.projectId;
      const [source, target] = await Promise.all([
        fetchReadableProject(sourceProjectId),
        assertProjectOwnershipAndGame(targetProjectId, game),
      ]);
      if (String(source.manifest.gameId ?? "") !== expectedGameId(game)) {
        return invalidParams(`Le projet source est ${String(source.manifest.gameId ?? "inconnu")}, pas ${expectedGameId(game)}.`, {
          sourceProjectId,
          game,
        });
      }

      const sourceOverrides = getLootOverrides(source.v7data, game);
      const selectedOverrides = sourceOverrides
        .filter((override) => {
          if (!shouldFilter) return true;
          const identity = lootDropIdentity(override);
          return (
            wantedIds.has(identity.blueprintId.toLowerCase()) ||
            wantedClasses.has(identity.classString.toLowerCase())
          );
        })
        .map((override) => deepCloneJson(override));

      if (selectedOverrides.length === 0) {
        return invalidParams("Aucun override loot correspondant trouvé dans le projet source.", {
          sourceProjectId,
          lootDropIds: lootDropIdsResult.value,
          lootDropClassStrings: lootDropClassStringsResult.value,
        });
      }

      const nextOverrides = getLootOverrides(target.v7data, game).map((override) => deepCloneJson(override));
      const inserted: string[] = [];
      const replaced: string[] = [];
      for (const override of selectedOverrides) {
        const identity = lootDropIdentity(override);
        const index = findOverrideIndex(nextOverrides, {
          lootDropId: identity.blueprintId,
          lootDropClassString: identity.classString,
        });
        if (index >= 0) {
          if (replaceExistingResult.value ?? true) {
            nextOverrides[index] = override;
            replaced.push(identity.label || identity.classString || identity.blueprintId);
          }
        } else {
          nextOverrides.push(override);
          inserted.push(identity.label || identity.classString || identity.blueprintId);
        }
      }

      setLootOverrides(target.v7data, game, nextOverrides);
      const enabledContentPackIds = mergeRequiredContentPacks(target.manifest, selectedOverrides);
      let backup: { path: string; sha256: string } | undefined;
      if (backupLocalResult.value ?? true) {
        backup = await writeProjectBackup(targetProjectId, target.binary);
      }

      const saveMeta = await saveProjectBinary(target.manifest, target.v7data);
      const confirmation = await assertProjectOwnershipAndGame(targetProjectId, game);
      const confirmedOverrides = getLootOverrides(confirmation.v7data, game);

      return textResult(
        [
          `Overrides loot copiés vers ${targetProjectId}.`,
          `Source : ${sourceProjectId}`,
          `Copiés : ${selectedOverrides.length}`,
          `Ajoutés : ${inserted.length}`,
          `Remplacés : ${replaced.length}`,
          ...(backup ? [`Backup : ${backup.path}`] : []),
        ].join("\n"),
        {
          sourceProjectId,
          targetProjectId,
          game,
          copiedOverrides: selectedOverrides.map((override) => summarizeLootOverride(override)),
          inserted,
          replaced,
          enabledContentPackIds,
          backup,
          revision: saveMeta.revision,
          confirmedOverrideCount: confirmedOverrides.length,
        },
        {
          sourceProjectId,
          targetProjectId,
          game,
          copiedCount: selectedOverrides.length,
        }
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
};

// ---- beacon_copy_loot_family ----

const copyLootFamilyTool: ToolDefinition = {
  name: "beacon_copy_loot_family",
  description:
    "Copie une famille complète de loot drops réutilisés d'un projet source vers un projet cible à partir d'un label, class string ou familyKey.",
  inputSchema: {
    type: "object",
    properties: {
      sourceProjectId: { type: "string", description: "Projet source contenant la famille loot" },
      sourceProjectName: { type: "string", description: "Nom du projet source si l'UUID n'est pas connu" },
      targetProjectId: { type: "string", description: "Projet cible à modifier" },
      targetProjectName: { type: "string", description: "Nom du projet cible si l'UUID n'est pas connu" },
      game: {
        type: "string",
        enum: [...PROJECT_GAMES],
        description: "Jeu cible : 'ark' ou 'arksa'",
      },
      family: {
        type: "string",
        description: "Label, classString, lootDropId ou familyKey de la famille à copier",
      },
      backupLocal: {
        type: "boolean",
        description: "Créer une sauvegarde locale du projet cible avant écriture. Défaut : true",
      },
      replaceExisting: {
        type: "boolean",
        description: "Remplacer les overrides existants du même loot drop dans le projet cible. Défaut : true",
      },
    },
    required: ["game", "family"],
  },
  handler: async (args) => {
    const sourceProjectIdResult = optionalString(args, "sourceProjectId");
    if (!sourceProjectIdResult.ok) return sourceProjectIdResult.result;
    const sourceProjectNameResult = optionalString(args, "sourceProjectName");
    if (!sourceProjectNameResult.ok) return sourceProjectNameResult.result;
    const targetProjectIdResult = optionalString(args, "targetProjectId");
    if (!targetProjectIdResult.ok) return targetProjectIdResult.result;
    const targetProjectNameResult = optionalString(args, "targetProjectName");
    if (!targetProjectNameResult.ok) return targetProjectNameResult.result;
    const gameResult = requireGame(args, "game", PROJECT_GAMES);
    if (!gameResult.ok) return gameResult.result;
    const familyResult = requireString(args, "family");
    if (!familyResult.ok) return familyResult.result;
    const backupLocalResult = optionalBoolean(args, "backupLocal", true);
    if (!backupLocalResult.ok) return backupLocalResult.result;
    const replaceExistingResult = optionalBoolean(args, "replaceExisting", true);
    if (!replaceExistingResult.ok) return replaceExistingResult.result;

    const game = gameResult.value as ProjectGame;
    const family = familyResult.value;

    try {
      const [resolvedSource, resolvedTarget] = await Promise.all([
        resolveProjectReference(
          { projectId: sourceProjectIdResult.value, projectName: sourceProjectNameResult.value },
          { game, fieldPrefix: "source" }
        ),
        resolveProjectReference(
          { projectId: targetProjectIdResult.value, projectName: targetProjectNameResult.value },
          { game, fieldPrefix: "target" }
        ),
      ]);
      if (!resolvedSource.ok) return resolvedSource.result;
      if (!resolvedTarget.ok) return resolvedTarget.result;
      const sourceProjectId = resolvedSource.projectId;
      const targetProjectId = resolvedTarget.projectId;
      const [source, target] = await Promise.all([
        fetchReadableProject(sourceProjectId),
        assertProjectOwnershipAndGame(targetProjectId, game),
      ]);
      if (String(source.manifest.gameId ?? "") !== expectedGameId(game)) {
        return invalidParams(`Le projet source est ${String(source.manifest.gameId ?? "inconnu")}, pas ${expectedGameId(game)}.`, {
          sourceProjectId,
          game,
        });
      }

      const sourceOverrides = getLootOverrides(source.v7data, game);
      const familyMatch = findLootFamily(sourceOverrides, family);
      if (!familyMatch) {
        return invalidParams("Famille loot introuvable dans le projet source.", {
          sourceProjectId,
          family,
        });
      }

      const copiedOverrides = familyMatch.overrides.map((override) => deepCloneJson(override));
      const nextOverrides = getLootOverrides(target.v7data, game).map((override) => deepCloneJson(override));
      for (const override of copiedOverrides) {
        const identity = lootDropIdentity(override);
        const index = findOverrideIndex(nextOverrides, {
          lootDropId: identity.blueprintId,
          lootDropClassString: identity.classString,
        });
        if (index >= 0) {
          if (replaceExistingResult.value ?? true) {
            nextOverrides[index] = override;
          }
        } else {
          nextOverrides.push(override);
        }
      }

      setLootOverrides(target.v7data, game, nextOverrides);
      const enabledContentPackIds = mergeRequiredContentPacks(target.manifest, copiedOverrides);
      let backup: { path: string; sha256: string } | undefined;
      if (backupLocalResult.value ?? true) {
        backup = await writeProjectBackup(targetProjectId, target.binary);
      }

      const saveMeta = await saveProjectBinary(target.manifest, target.v7data);
      const confirmation = await assertProjectOwnershipAndGame(targetProjectId, game);

      return textResult(
        [
          `Famille loot copiée vers ${targetProjectId}.`,
          `Source : ${sourceProjectId}`,
          `Famille : ${familyMatch.familyKey}`,
          `Overrides copiés : ${copiedOverrides.length}`,
          ...(backup ? [`Backup : ${backup.path}`] : []),
        ].join("\n"),
        {
          sourceProjectId,
          targetProjectId,
          game,
          family: familyMatch.familyKey,
          copiedOverrides: copiedOverrides.map((override) => summarizeLootOverride(override)),
          enabledContentPackIds,
          backup,
          revision: saveMeta.revision,
          confirmedOverrideCount: getLootOverrides(confirmation.v7data, game).length,
        },
        {
          sourceProjectId,
          targetProjectId,
          game,
          family: familyMatch.familyKey,
          copiedCount: copiedOverrides.length,
        }
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
};

// ---- beacon_set_loot_override ----

const setLootOverrideTool: ToolDefinition = {
  name: "beacon_set_loot_override",
  description:
    "Ajoute ou remplace un override loot natif Beacon dans un projet. " +
    "Accepte un payload override Beacon complet, fusionne les mods requis, sauvegarde puis relit le projet.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", description: "ID UUID du projet Beacon" },
      projectName: { type: "string", description: "Nom du projet Beacon si l'UUID n'est pas connu" },
      game: {
        type: "string",
        enum: [...PROJECT_GAMES],
        description: "Jeu cible : 'ark' ou 'arksa'",
      },
      override: {
        type: "object",
        description: "Payload native override Beacon (definition, minItemSets, maxItemSets, sets...)",
      },
      lootDropId: {
        type: "string",
        description: "BlueprintId du loot drop à remplacer (optionnel si présent dans override.definition)",
      },
      lootDropClassString: {
        type: "string",
        description: "Class string du loot drop à remplacer (optionnel si présent dans override.definition)",
      },
      backupLocal: {
        type: "boolean",
        description: "Créer une sauvegarde locale du projet avant écriture. Défaut : true",
      },
      enableRequiredMods: {
        type: "boolean",
        description: "Active automatiquement les mods requis par l'override. Défaut : true",
      },
    },
    required: ["game", "override"],
  },
  handler: async (args) => {
    const projectIdResult = optionalString(args, "projectId");
    if (!projectIdResult.ok) return projectIdResult.result;
    const projectNameResult = optionalString(args, "projectName");
    if (!projectNameResult.ok) return projectNameResult.result;
    const gameResult = requireGame(args, "game", PROJECT_GAMES);
    if (!gameResult.ok) return gameResult.result;
    const overrideResult = optionalRecord(args, "override");
    if (!overrideResult.ok) return overrideResult.result;
    if (!overrideResult.value) {
      return invalidParams("Paramètre override requis.", { field: "override" });
    }
    const lootDropIdResult = optionalString(args, "lootDropId");
    if (!lootDropIdResult.ok) return lootDropIdResult.result;
    const lootDropClassStringResult = optionalString(args, "lootDropClassString");
    if (!lootDropClassStringResult.ok) return lootDropClassStringResult.result;
    const backupLocalResult = optionalBoolean(args, "backupLocal", true);
    if (!backupLocalResult.ok) return backupLocalResult.result;
    const enableRequiredModsResult = optionalBoolean(args, "enableRequiredMods", true);
    if (!enableRequiredModsResult.ok) return enableRequiredModsResult.result;

    const game = gameResult.value as ProjectGame;
    const candidateOverride = deepCloneJson(overrideResult.value);
    const validation = validateLootOverrideRecord(candidateOverride);
    if (!validation.ok) {
      return invalidParams(validation.message, { field: "override" });
    }

    const identity = lootDropIdentity(candidateOverride);
    const matcher = {
      lootDropId: lootDropIdResult.value ?? identity.blueprintId,
      lootDropClassString: lootDropClassStringResult.value ?? identity.classString,
    };
    if (!matcher.lootDropId && !matcher.lootDropClassString) {
      return invalidParams("lootDropId ou lootDropClassString requis pour identifier l'override cible.", {
        fields: ["lootDropId", "lootDropClassString"],
      });
    }

    try {
      const resolvedProject = await resolveProjectReference({
        projectId: projectIdResult.value,
        projectName: projectNameResult.value,
      }, { game });
      if (!resolvedProject.ok) return resolvedProject.result;
      const projectId = resolvedProject.projectId;
      const target = await assertProjectOwnershipAndGame(projectId, game);
      const nextOverrides = getLootOverrides(target.v7data, game).map((override) => deepCloneJson(override));
      const index = findOverrideIndex(nextOverrides, matcher);
      if (index >= 0) {
        nextOverrides[index] = candidateOverride;
      } else {
        nextOverrides.push(candidateOverride);
      }

      setLootOverrides(target.v7data, game, nextOverrides);
      const enabledContentPackIds =
        enableRequiredModsResult.value ?? true
          ? mergeRequiredContentPacks(target.manifest, [candidateOverride])
          : [];

      let backup: { path: string; sha256: string } | undefined;
      if (backupLocalResult.value ?? true) {
        backup = await writeProjectBackup(projectId, target.binary);
      }

      const saveMeta = await saveProjectBinary(target.manifest, target.v7data);
      const confirmation = await assertProjectOwnershipAndGame(projectId, game);
      const confirmedIndex = findOverrideIndex(getLootOverrides(confirmation.v7data, game), matcher);

      return textResult(
        [
          `Override loot enregistré dans ${projectId}.`,
          `Loot drop : ${identity.label || identity.classString || identity.blueprintId}`,
          `Mode : ${index >= 0 ? "remplacement" : "ajout"}`,
          ...(backup ? [`Backup : ${backup.path}`] : []),
        ].join("\n"),
        {
          projectId,
          game,
          override: summarizeLootOverride(candidateOverride),
          enabledContentPackIds,
          backup,
          revision: saveMeta.revision,
          confirmed: confirmedIndex >= 0,
        },
        {
          projectId,
          game,
          lootDropId: matcher.lootDropId,
          lootDropClassString: matcher.lootDropClassString,
        }
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
};

// ---- beacon_export_project_code ----

const exportProjectCodeTool: ToolDefinition = {
  name: "beacon_export_project_code",
  description:
    "Exporte directement dans le chat le code de configuration d'un projet Beacon sans passer par l'interface Beacon. " +
    "Retourne Game.ini, GameUserSettings.ini, ou les deux dans un seul résultat. " +
    "Utile quand l'utilisateur demande 'donne-moi le code du projet' ou veut copier/coller la configuration serveur.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", description: "ID du projet" },
      projectName: { type: "string", description: "Nom du projet si l'ID n'est pas connu" },
      game: {
        type: "string",
        enum: [...PROJECT_GAMES],
        description: "Jeu cible : 'ark' ou 'arksa'",
      },
      format: {
        type: "string",
        enum: ["full", "overrides_only"],
        description:
          "Choisir 'full' pour le rendu complet, ou 'overrides_only' pour ne retourner que les lignes utiles comme OverrideNamedEngramEntries. Défaut : full",
      },
      file: {
        type: "string",
        enum: ["all", "game", "gus"],
        description: "Choisir 'all', 'game' pour Game.ini, ou 'gus' pour GameUserSettings.ini. Défaut : all",
      },
      qualityScale: {
        type: "number",
        description: "Multiplicateur de qualité des items pour la génération Game.ini (optionnel)",
      },
      difficultyValue: {
        type: "number",
        description: "Valeur de difficulté pour la génération Game.ini (optionnel)",
      },
      mapMask: {
        type: "string",
        description: "Masque de carte optionnel pour générer l'export ciblé",
      },
    },
    required: ["game"],
  },
  handler: async (args) => {
    const projectIdResult = optionalString(args, "projectId");
    if (!projectIdResult.ok) return projectIdResult.result;
    const projectNameResult = optionalString(args, "projectName");
    if (!projectNameResult.ok) return projectNameResult.result;
    const gameResult = requireGame(args, "game", PROJECT_GAMES);
    if (!gameResult.ok) return gameResult.result;
    const formatResult = optionalString(args, "format");
    if (!formatResult.ok) return formatResult.result;
    const fileResult = optionalString(args, "file");
    if (!fileResult.ok) return fileResult.result;
    const qualityScaleResult = optionalNumber(args, "qualityScale");
    if (!qualityScaleResult.ok) return qualityScaleResult.result;
    const difficultyValueResult = optionalNumber(args, "difficultyValue");
    if (!difficultyValueResult.ok) return difficultyValueResult.result;
    const mapMaskResult = optionalString(args, "mapMask");
    if (!mapMaskResult.ok) return mapMaskResult.result;

    const game = gameResult.value as ProjectGame;
    const format = (formatResult.value ?? "full").toLowerCase();
    const file = (fileResult.value ?? "all").toLowerCase();
    const allowedFormats = ["full", "overrides_only"] as const;
    const allowedFiles = ["all", "game", "gus"] as const;
    if (!allowedFormats.includes(format as (typeof allowedFormats)[number])) {
      return invalidParams("Paramètre format invalide. Valeurs acceptées : full, overrides_only.", {
        field: "format",
        acceptedValues: allowedFormats,
      });
    }
    if (!allowedFiles.includes(file as (typeof allowedFiles)[number])) {
      return invalidParams("Paramètre file invalide. Valeurs acceptées : all, game, gus.", {
        field: "file",
        acceptedValues: allowedFiles,
      });
    }

    try {
      const resolvedProject = await resolveProjectReference({
        projectId: projectIdResult.value,
        projectName: projectNameResult.value,
      }, { game });
      if (!resolvedProject.ok) return resolvedProject.result;
      const projectId = resolvedProject.projectId;
      const params = buildConfigParams(
        qualityScaleResult.value,
        difficultyValueResult.value,
        mapMaskResult.value
      );
      const exportBundle = await buildEffectiveProjectExport(
        projectId,
        game,
        file as "all" | "game" | "gus",
        params
      );
      const exportView = buildProjectChatExport(
        projectId,
        game,
        file as "all" | "game" | "gus",
        format as ExportFormat,
        exportBundle
      );

      return textResult(
        exportView.message,
        exportView.payload,
        {
          projectId,
          game,
          file,
          format,
          mapMask: mapMaskResult.value,
        }
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
};

// ---- beacon_export_project_file ----

const exportProjectFileTool: ToolDefinition = {
  name: "beacon_export_project_file",
  description:
    "Exporte la configuration d'un projet Beacon dans un fichier local sans passer par l'interface Beacon. " +
    "Idéal pour les gros projets quand le code serait trop long pour le chat. " +
    "Le MCP écrit un fichier texte local dans ~/.beacon-mcp/exports/ puis retourne son chemin exact.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", description: "ID du projet" },
      projectName: { type: "string", description: "Nom du projet si l'ID n'est pas connu" },
      game: {
        type: "string",
        enum: [...PROJECT_GAMES],
        description: "Jeu cible : 'ark' ou 'arksa'",
      },
      format: {
        type: "string",
        enum: ["full", "overrides_only"],
        description:
          "Choisir 'full' pour le rendu complet, ou 'overrides_only' pour n'écrire que les lignes utiles comme OverrideNamedEngramEntries. Défaut : full",
      },
      file: {
        type: "string",
        enum: ["all", "game", "gus"],
        description: "Choisir 'all', 'game' pour Game.ini, ou 'gus' pour GameUserSettings.ini. Défaut : all",
      },
      qualityScale: {
        type: "number",
        description: "Multiplicateur de qualité des items pour la génération Game.ini (optionnel)",
      },
      difficultyValue: {
        type: "number",
        description: "Valeur de difficulté pour la génération Game.ini (optionnel)",
      },
      mapMask: {
        type: "string",
        description: "Masque de carte optionnel pour générer l'export ciblé",
      },
    },
    required: ["game"],
  },
  handler: async (args) => {
    const projectIdResult = optionalString(args, "projectId");
    if (!projectIdResult.ok) return projectIdResult.result;
    const projectNameResult = optionalString(args, "projectName");
    if (!projectNameResult.ok) return projectNameResult.result;
    const gameResult = requireGame(args, "game", PROJECT_GAMES);
    if (!gameResult.ok) return gameResult.result;
    const formatResult = optionalString(args, "format");
    if (!formatResult.ok) return formatResult.result;
    const fileResult = optionalString(args, "file");
    if (!fileResult.ok) return fileResult.result;
    const qualityScaleResult = optionalNumber(args, "qualityScale");
    if (!qualityScaleResult.ok) return qualityScaleResult.result;
    const difficultyValueResult = optionalNumber(args, "difficultyValue");
    if (!difficultyValueResult.ok) return difficultyValueResult.result;
    const mapMaskResult = optionalString(args, "mapMask");
    if (!mapMaskResult.ok) return mapMaskResult.result;

    const game = gameResult.value as ProjectGame;
    const format = (formatResult.value ?? "full").toLowerCase();
    const file = (fileResult.value ?? "all").toLowerCase();
    const allowedFormats = ["full", "overrides_only"] as const;
    const allowedFiles = ["all", "game", "gus"] as const;
    if (!allowedFormats.includes(format as (typeof allowedFormats)[number])) {
      return invalidParams("Paramètre format invalide. Valeurs acceptées : full, overrides_only.", {
        field: "format",
        acceptedValues: allowedFormats,
      });
    }
    if (!allowedFiles.includes(file as (typeof allowedFiles)[number])) {
      return invalidParams("Paramètre file invalide. Valeurs acceptées : all, game, gus.", {
        field: "file",
        acceptedValues: allowedFiles,
      });
    }

    try {
      const resolvedProject = await resolveProjectReference({
        projectId: projectIdResult.value,
        projectName: projectNameResult.value,
      }, { game });
      if (!resolvedProject.ok) return resolvedProject.result;
      const projectId = resolvedProject.projectId;
      const params = buildConfigParams(
        qualityScaleResult.value,
        difficultyValueResult.value,
        mapMaskResult.value
      );
      const exportBundle = await buildEffectiveProjectExport(
        projectId,
        game,
        file as "all" | "game" | "gus",
        params
      );
      const projectName = projectNameResult.value ?? projectId;
      const fileExport = buildProjectFileExport(
        projectId,
        projectName,
        game,
        file as "all" | "game" | "gus",
        mapMaskResult.value,
        format as ExportFormat,
        exportBundle
      );

      const filename = [
        sanitizeFileSegment(projectName) || "beacon-project",
        sanitizeFileSegment(format === "overrides_only" ? "overrides" : file),
        createTimestampSlug(),
      ].join("-") + ".txt";

      const exportPath = await writeProjectExportFile(filename, fileExport.content);

      return textResult(
        [
          `Export local créé pour ${gameName(game)}.`,
          `Projet : ${projectName} (${projectId})`,
          `Fichier : ${exportPath}`,
        ].join("\n"),
        {
          projectId,
          projectName,
          game,
          file,
          format,
          exportPath,
          derivedGameIniLines: exportBundle.derivedGameIniLines,
          exportedFiles: fileExport.exportedFiles,
        },
        {
          projectId,
          game,
          file,
          format,
          exportPath,
        }
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
};

// ---- beacon_export_project_smart ----

const SMART_EXPORT_DEFAULT_CHAR_LIMIT = 12000;

const exportProjectSmartTool: ToolDefinition = {
  name: "beacon_export_project_smart",
  description:
    "Exporte intelligemment la configuration d'un projet Beacon. " +
    "Si le rendu est court, il le retourne directement dans le chat. " +
    "Si le rendu devient trop long, il bascule automatiquement vers un fichier local dans ~/.beacon-mcp/exports/.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", description: "ID du projet" },
      projectName: { type: "string", description: "Nom du projet si l'ID n'est pas connu" },
      game: {
        type: "string",
        enum: [...PROJECT_GAMES],
        description: "Jeu cible : 'ark' ou 'arksa'",
      },
      format: {
        type: "string",
        enum: ["full", "overrides_only"],
        description:
          "Choisir 'full' pour le rendu complet, ou 'overrides_only' pour seulement les lignes utiles. Défaut : full",
      },
      file: {
        type: "string",
        enum: ["all", "game", "gus"],
        description: "Choisir 'all', 'game' pour Game.ini, ou 'gus' pour GameUserSettings.ini. Défaut : all",
      },
      qualityScale: {
        type: "number",
        description: "Multiplicateur de qualité des items pour la génération Game.ini (optionnel)",
      },
      difficultyValue: {
        type: "number",
        description: "Valeur de difficulté pour la génération Game.ini (optionnel)",
      },
      mapMask: {
        type: "string",
        description: "Masque de carte optionnel pour générer l'export ciblé",
      },
      maxInlineChars: {
        type: "number",
        description:
          "Nombre maximum de caractères à retourner directement dans le chat avant bascule vers un fichier. Défaut : 12000",
      },
    },
    required: ["game"],
  },
  handler: async (args) => {
    const projectIdResult = optionalString(args, "projectId");
    if (!projectIdResult.ok) return projectIdResult.result;
    const projectNameResult = optionalString(args, "projectName");
    if (!projectNameResult.ok) return projectNameResult.result;
    const gameResult = requireGame(args, "game", PROJECT_GAMES);
    if (!gameResult.ok) return gameResult.result;
    const formatResult = optionalString(args, "format");
    if (!formatResult.ok) return formatResult.result;
    const fileResult = optionalString(args, "file");
    if (!fileResult.ok) return fileResult.result;
    const qualityScaleResult = optionalNumber(args, "qualityScale");
    if (!qualityScaleResult.ok) return qualityScaleResult.result;
    const difficultyValueResult = optionalNumber(args, "difficultyValue");
    if (!difficultyValueResult.ok) return difficultyValueResult.result;
    const mapMaskResult = optionalString(args, "mapMask");
    if (!mapMaskResult.ok) return mapMaskResult.result;
    const maxInlineCharsResult = optionalNumber(args, "maxInlineChars");
    if (!maxInlineCharsResult.ok) return maxInlineCharsResult.result;

    const game = gameResult.value as ProjectGame;
    const format = (formatResult.value ?? "full").toLowerCase();
    const file = (fileResult.value ?? "all").toLowerCase();
    const maxInlineChars = Math.max(
      200,
      Math.floor(maxInlineCharsResult.value ?? SMART_EXPORT_DEFAULT_CHAR_LIMIT)
    );
    const allowedFormats = ["full", "overrides_only"] as const;
    const allowedFiles = ["all", "game", "gus"] as const;
    if (!allowedFormats.includes(format as (typeof allowedFormats)[number])) {
      return invalidParams("Paramètre format invalide. Valeurs acceptées : full, overrides_only.", {
        field: "format",
        acceptedValues: allowedFormats,
      });
    }
    if (!allowedFiles.includes(file as (typeof allowedFiles)[number])) {
      return invalidParams("Paramètre file invalide. Valeurs acceptées : all, game, gus.", {
        field: "file",
        acceptedValues: allowedFiles,
      });
    }

    try {
      const resolvedProject = await resolveProjectReference({
        projectId: projectIdResult.value,
        projectName: projectNameResult.value,
      }, { game });
      if (!resolvedProject.ok) return resolvedProject.result;
      const projectId = resolvedProject.projectId;
      const params = buildConfigParams(
        qualityScaleResult.value,
        difficultyValueResult.value,
        mapMaskResult.value
      );
      const exportBundle = await buildEffectiveProjectExport(
        projectId,
        game,
        file as "all" | "game" | "gus",
        params
      );
      const chatExport = buildProjectChatExport(
        projectId,
        game,
        file as "all" | "game" | "gus",
        format as ExportFormat,
        exportBundle
      );

      if (chatExport.message.length <= maxInlineChars) {
        return textResult(
          chatExport.message,
          {
            ...chatExport.payload,
            delivery: "inline",
            maxInlineChars,
          },
          {
            projectId,
            game,
            file,
            format,
            delivery: "inline",
            maxInlineChars,
          }
        );
      }

      const projectName = projectNameResult.value ?? projectId;
      const fileExport = buildProjectFileExport(
        projectId,
        projectName,
        game,
        file as "all" | "game" | "gus",
        mapMaskResult.value,
        format as ExportFormat,
        exportBundle
      );

      const filename = [
        sanitizeFileSegment(projectName) || "beacon-project",
        sanitizeFileSegment(format === "overrides_only" ? "overrides" : file),
        createTimestampSlug(),
      ].join("-") + ".txt";

      const exportPath = await writeProjectExportFile(filename, fileExport.content);

      return textResult(
        [
          `Export trop volumineux pour le chat, fichier local créé pour ${gameName(game)}.`,
          `Projet : ${projectName} (${projectId})`,
          `Fichier : ${exportPath}`,
        ].join("\n"),
        {
          projectId,
          projectName,
          game,
          file,
          format,
          delivery: "file",
          exportPath,
          maxInlineChars,
          derivedGameIniLines: exportBundle.derivedGameIniLines,
          exportedFiles: fileExport.exportedFiles,
        },
        {
          projectId,
          game,
          file,
          format,
          delivery: "file",
          exportPath,
          maxInlineChars,
        }
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
      projectName: { type: "string", description: "Nom du projet si l'ID n'est pas connu" },
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
    required: ["game"],
  },
  handler: async (args) => {
    const projectIdResult = optionalString(args, "projectId");
    if (!projectIdResult.ok) return projectIdResult.result;
    const projectNameResult = optionalString(args, "projectName");
    if (!projectNameResult.ok) return projectNameResult.result;
    const gameResult = requireGame(args, "game", PROJECT_GAMES);
    if (!gameResult.ok) return gameResult.result;
    const qualityScaleResult = optionalNumber(args, "qualityScale");
    if (!qualityScaleResult.ok) return qualityScaleResult.result;
    const difficultyValueResult = optionalNumber(args, "difficultyValue");
    if (!difficultyValueResult.ok) return difficultyValueResult.result;
    const mapMaskResult = optionalString(args, "mapMask");
    if (!mapMaskResult.ok) return mapMaskResult.result;

    const game = gameResult.value as (typeof PROJECT_GAMES)[number];
    const qualityScale = qualityScaleResult.value;
    const difficultyValue = difficultyValueResult.value;
    const mapMask = mapMaskResult.value;
    try {
      const resolvedProject = await resolveProjectReference({
        projectId: projectIdResult.value,
        projectName: projectNameResult.value,
      });
      if (!resolvedProject.ok) return resolvedProject.result;
      const projectId = resolvedProject.projectId;
      const params = buildConfigParams(qualityScale, difficultyValue, mapMask);

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
      projectName: { type: "string", description: "Nom du projet si l'ID n'est pas connu" },
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
    required: ["game", "content"],
  },
  handler: async (args) => {
    const projectIdResult = optionalString(args, "projectId");
    if (!projectIdResult.ok) return projectIdResult.result;
    const projectNameResult = optionalString(args, "projectName");
    if (!projectNameResult.ok) return projectNameResult.result;
    const gameResult = requireGame(args, "game", PROJECT_GAMES);
    if (!gameResult.ok) return gameResult.result;
    const contentResult = requireRawString(args, "content", "content");
    if (!contentResult.ok) return contentResult.result;

    const game = gameResult.value as (typeof PROJECT_GAMES)[number];
    const content = contentResult.value;
    try {
      const resolvedProject = await resolveProjectReference({
        projectId: projectIdResult.value,
        projectName: projectNameResult.value,
      });
      if (!resolvedProject.ok) return resolvedProject.result;
      const projectId = resolvedProject.projectId;
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
      projectName: { type: "string", description: "Nom du projet si l'ID n'est pas connu" },
      game: {
        type: "string",
        enum: [...PROJECT_GAMES],
        description: "Jeu cible : 'ark' ou 'arksa'",
      },
    },
    required: ["game"],
  },
  handler: async (args) => {
    const projectIdResult = optionalString(args, "projectId");
    if (!projectIdResult.ok) return projectIdResult.result;
    const projectNameResult = optionalString(args, "projectName");
    if (!projectNameResult.ok) return projectNameResult.result;
    const gameResult = requireGame(args, "game", PROJECT_GAMES);
    if (!gameResult.ok) return gameResult.result;

    const game = gameResult.value as (typeof PROJECT_GAMES)[number];
    try {
      const resolvedProject = await resolveProjectReference({
        projectId: projectIdResult.value,
        projectName: projectNameResult.value,
      });
      if (!resolvedProject.ok) return resolvedProject.result;
      const projectId = resolvedProject.projectId;
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
      projectName: { type: "string", description: "Nom du projet si l'ID n'est pas connu" },
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
    required: ["game", "content"],
  },
  handler: async (args) => {
    const projectIdResult = optionalString(args, "projectId");
    if (!projectIdResult.ok) return projectIdResult.result;
    const projectNameResult = optionalString(args, "projectName");
    if (!projectNameResult.ok) return projectNameResult.result;
    const gameResult = requireGame(args, "game", PROJECT_GAMES);
    if (!gameResult.ok) return gameResult.result;
    const contentResult = requireRawString(args, "content", "content");
    if (!contentResult.ok) return contentResult.result;

    const game = gameResult.value as (typeof PROJECT_GAMES)[number];
    const content = contentResult.value;
    try {
      const resolvedProject = await resolveProjectReference({
        projectId: projectIdResult.value,
        projectName: projectNameResult.value,
      });
      if (!resolvedProject.ok) return resolvedProject.result;
      const projectId = resolvedProject.projectId;
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
    findProjectTool,
    getProjectTool,
    createProjectTool,
    setProjectModTool,
    setEngramUnlockTool,
    inspectLootProjectTool,
    copyLootOverridesTool,
    copyLootFamilyTool,
    setLootOverrideTool,
    exportProjectCodeTool,
    exportProjectFileTool,
    exportProjectSmartTool,
    generateGameIniTool,
    putGameIniTool,
    generateGameUserSettingsIniTool,
    putGameUserSettingsIniTool,
    getConfigOptionsTool,
    listCommandLineOptionsTool,
  ]);
}
