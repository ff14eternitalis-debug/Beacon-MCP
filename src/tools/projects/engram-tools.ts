import { ToolDefinition } from "../../registry.js";
import {
  textResult,
  formatApiError,
  gameName,
  requireGame,
  requireString,
  optionalString,
  optionalNumber,
  invalidParams,
} from "../shared.js";
import type { JsonRecord, ProjectGame } from "./shared.js";
import {
  PROJECT_GAMES,
  optionalBoolean,
  resolveContentPack,
  searchEngrams,
  searchProjectsForCurrentUser,
  expectedGameId,
  resolveProjectReference,
  resolveEngramReference,
  assertProjectOwnershipAndGame,
  getModSelections,
  writeProjectBackup,
  getBaseConfigSet,
  engramControlName,
  blueprintAttributeManagerSchema,
  buildBlueprintReference,
  ensureEditor,
  saveProjectBinary,
  fetchProjectBinary,
  parseBeaconBinary,
} from "./shared.js";

const findEngramTool: ToolDefinition = {
  name: "beacon_find_engram",
  description:
    "Recherche un engram Beacon par nom ou fragment de nom, avec filtre optionnel par mod, pour éviter d'avoir à fournir un engramId.",
  inputSchema: {
    type: "object",
    properties: {
      game: {
        type: "string",
        enum: [...PROJECT_GAMES],
        description: "Jeu cible : 'ark' ou 'arksa'",
      },
      query: {
        type: "string",
        description: "Nom complet ou fragment de nom à rechercher",
      },
      contentPackId: {
        type: "string",
        description: "UUID du mod pour filtrer les résultats si nécessaire",
      },
      modName: {
        type: "string",
        description: "Nom du mod pour filtrer les résultats si nécessaire",
      },
      limit: {
        type: "number",
        description: "Nombre maximum de résultats à retourner (défaut : 10, max : 25)",
      },
    },
    required: ["game", "query"],
  },
  handler: async (args) => {
    const gameResult = requireGame(args, "game", PROJECT_GAMES);
    if (!gameResult.ok) return gameResult.result;
    const queryResult = requireString(args, "query");
    if (!queryResult.ok) return queryResult.result;
    const contentPackIdResult = optionalString(args, "contentPackId");
    if (!contentPackIdResult.ok) return contentPackIdResult.result;
    const modNameResult = optionalString(args, "modName");
    if (!modNameResult.ok) return modNameResult.result;
    const limitResult = optionalNumber(args, "limit");
    if (!limitResult.ok) return limitResult.result;

    const game = gameResult.value as ProjectGame;
    const query = queryResult.value.trim();
    const limit = Math.min(25, Math.max(1, Math.floor(limitResult.value ?? 10)));

    try {
      let resolvedContentPackId = contentPackIdResult.value;
      let resolvedPack: JsonRecord | undefined;
      if (!resolvedContentPackId && modNameResult.value) {
        const packResult = await resolveContentPack(game, undefined, modNameResult.value);
        if (!packResult.ok) return packResult.result;
        resolvedPack = packResult.pack;
        resolvedContentPackId = String(packResult.pack.contentPackId ?? packResult.pack.id ?? "").trim() || undefined;
      }

      const matches = await searchEngrams(game, query, {
        contentPackId: resolvedContentPackId,
        pageSize: Math.max(50, limit),
      });
      const normalized = query.toLowerCase();
      const ranked = matches
        .filter((engram) => {
          const haystack = [engram.label, engram.name, engram.classString, engram.entryString]
            .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            .map((value) => value.toLowerCase());
          return haystack.some((value) => value.includes(normalized));
        })
        .sort((a, b) => {
          const aName = String(a.label ?? a.name ?? a.classString ?? "").toLowerCase();
          const bName = String(b.label ?? b.name ?? b.classString ?? "").toLowerCase();
          const aRank = aName === normalized ? 0 : aName.startsWith(normalized) ? 1 : 2;
          const bRank = bName === normalized ? 0 : bName.startsWith(normalized) ? 1 : 2;
          if (aRank !== bRank) return aRank - bRank;
          return aName.localeCompare(bName);
        })
        .slice(0, limit);

      if (ranked.length === 0) {
        return textResult(`Aucun engram trouvé pour "${query}".`, [], {
          count: 0,
          query,
          game,
          contentPackId: resolvedContentPackId,
          modName: modNameResult.value,
        });
      }

      const lines = ranked.map((engram, index) => {
        const id = String(engram.engramId ?? engram.objectId ?? engram.id ?? "?");
        const label = String(engram.label ?? engram.name ?? engram.classString ?? "Sans nom");
        const packName = String(engram.contentPackName ?? engram.contentPackId ?? "jeu de base");
        return `${index + 1}. [${id}] ${label} (${packName})`;
      });

      return textResult(
        `Engrams trouvés pour "${query}" (${ranked.length}) :\n${lines.join("\n")}`,
        ranked,
        {
          count: ranked.length,
          query,
          game,
          contentPackId: resolvedContentPackId,
          modName: modNameResult.value,
          contentPack: resolvedPack,
        }
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
};

const setEngramUnlockTool: ToolDefinition = {
  name: "beacon_set_engram_unlock",
  description:
    "Ajoute ou met à jour un override d'engram dans le projet, par exemple CS Tek Forge niveau 180. " +
    "Accepte engramId ou engramName, avec modName/contentPackId optionnel pour lever les ambiguïtés. " +
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
      engramName: {
        type: "string",
        description: "Nom de l'engram si l'ID n'est pas connu",
      },
      contentPackId: {
        type: "string",
        description: "UUID du mod pour filtrer la recherche d'engram si nécessaire",
      },
      modName: {
        type: "string",
        description: "Nom du mod pour filtrer la recherche d'engram si nécessaire",
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
    required: ["game", "level"],
  },
  handler: async (args) => {
    const projectIdResult = optionalString(args, "projectId");
    if (!projectIdResult.ok) return projectIdResult.result;
    const projectNameResult = optionalString(args, "projectName");
    if (!projectNameResult.ok) return projectNameResult.result;
    const gameResult = requireGame(args, "game", PROJECT_GAMES);
    if (!gameResult.ok) return gameResult.result;
    const engramIdResult = optionalString(args, "engramId");
    if (!engramIdResult.ok) return engramIdResult.result;
    const engramNameResult = optionalString(args, "engramName");
    if (!engramNameResult.ok) return engramNameResult.result;
    const contentPackIdResult = optionalString(args, "contentPackId");
    if (!contentPackIdResult.ok) return contentPackIdResult.result;
    const modNameResult = optionalString(args, "modName");
    if (!modNameResult.ok) return modNameResult.result;
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
    if (!engramIdResult.value && !engramNameResult.value) {
      return invalidParams("Paramètre engramId ou engramName requis.", {
        acceptedFields: ["engramId", "engramName"],
      });
    }

    try {
      const resolvedProject = await resolveProjectReference(
        {
          projectId: projectIdResult.value,
          projectName: projectNameResult.value,
        },
        { game }
      );
      if (!resolvedProject.ok) return resolvedProject.result;
      const projectId = resolvedProject.projectId;
      const engramReference = await resolveEngramReference(game, {
        engramId: engramIdResult.value,
        engramName: engramNameResult.value,
        contentPackId: contentPackIdResult.value,
        modName: modNameResult.value,
      });
      if (!engramReference.ok) return engramReference.result;
      const engram = engramReference.engram;
      const targetEngramId = engramReference.engramId;

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
          requestedEngramName: engramNameResult.value,
          requestedModName: modNameResult.value,
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

export const engramProjectTools: ToolDefinition[] = [findEngramTool, setEngramUnlockTool];
