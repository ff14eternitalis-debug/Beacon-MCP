import { ToolDefinition } from "../../registry.js";
import {
  textResult,
  formatApiError,
  gameName,
  requireGame,
  requireString,
  optionalString,
  invalidParams,
} from "../shared.js";
import type { JsonRecord, LootOverrideRecord, ProjectGame } from "./shared.js";
import {
  PROJECT_GAMES,
  expectedGameId,
  optionalStringArray,
  optionalRecord,
  optionalBoolean,
  resolveProjectReference,
  fetchReadableProject,
  getLootOverrides,
  lootOverrideFingerprint,
  summarizeLootFamily,
  getModSelections,
  collectOverrideContentPackIds,
  summarizeLootOverride,
  lootDropIdentity,
  deepCloneJson,
  assertProjectOwnershipAndGame,
  findOverrideIndex,
  setLootOverrides,
  mergeRequiredContentPacks,
  writeProjectBackup,
  saveProjectBinary,
  findLootFamily,
  validateLootOverrideRecord,
} from "./shared.js";

const inspectLootProjectTool: ToolDefinition = {
  name: "beacon_inspect_loot_project",
  description:
    "Inspecte la structure loot d'un projet Beacon et résume ses overrides, familles réutilisées, item sets et content packs utiles.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", description: "ID UUID du projet Beacon" },
      projectName: { type: "string", description: "Nom du projet Beacon si l'UUID n'est pas connu" },
      game: { type: "string", enum: [...PROJECT_GAMES], description: "Jeu cible : 'ark' ou 'arksa'" },
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
      const resolvedProject = await resolveProjectReference({ projectId: projectIdResult.value, projectName: projectNameResult.value }, { game });
      if (!resolvedProject.ok) return resolvedProject.result;
      const projectId = resolvedProject.projectId;
      const source = await fetchReadableProject(projectId);
      const manifestGameId = String(source.manifest.gameId ?? "");
      if (manifestGameId !== expectedGameId(game)) {
        return invalidParams(`Le projet est ${manifestGameId || "inconnu"}, pas ${expectedGameId(game)}.`, { projectId, game, manifestGameId });
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

      return textResult(lines.join("\n"), {
        projectId,
        projectName: source.manifest.name ?? projectId,
        game,
        mapMask: source.manifest.map,
        overrideCount: overrides.length,
        familyCount: familySummaries.length,
        enabledModSelections,
        contentPacksUsedByLoot: [...contentPacksUsedByLoot.entries()].map(([contentPackId, contentPackName]) => ({ contentPackId, contentPackName })),
        families: familySummaries,
        overrides: overrides.map((override) => summarizeLootOverride(override)),
      }, { projectId, game, overrideCount: overrides.length, familyCount: familySummaries.length });
    } catch (err) {
      return formatApiError(err);
    }
  },
};

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
      game: { type: "string", enum: [...PROJECT_GAMES], description: "Jeu cible : 'ark' ou 'arksa'" },
      lootDropIds: { type: "array", items: { type: "string" }, description: "Liste optionnelle des blueprintIds de loot drops à copier" },
      lootDropClassStrings: { type: "array", items: { type: "string" }, description: "Liste optionnelle des class strings de loot drops à copier" },
      backupLocal: { type: "boolean", description: "Créer une sauvegarde locale du projet cible avant écriture. Défaut : true" },
      replaceExisting: { type: "boolean", description: "Remplacer les overrides existants du même loot drop dans le projet cible. Défaut : true" },
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
        resolveProjectReference({ projectId: sourceProjectIdResult.value, projectName: sourceProjectNameResult.value }, { game, fieldPrefix: "source" }),
        resolveProjectReference({ projectId: targetProjectIdResult.value, projectName: targetProjectNameResult.value }, { game, fieldPrefix: "target" }),
      ]);
      if (!resolvedSource.ok) return resolvedSource.result;
      if (!resolvedTarget.ok) return resolvedTarget.result;
      const sourceProjectId = resolvedSource.projectId;
      const targetProjectId = resolvedTarget.projectId;
      const [source, target] = await Promise.all([fetchReadableProject(sourceProjectId), assertProjectOwnershipAndGame(targetProjectId, game)]);
      if (String(source.manifest.gameId ?? "") !== expectedGameId(game)) {
        return invalidParams(`Le projet source est ${String(source.manifest.gameId ?? "inconnu")}, pas ${expectedGameId(game)}.`, { sourceProjectId, game });
      }

      const sourceOverrides = getLootOverrides(source.v7data, game);
      const selectedOverrides = sourceOverrides
        .filter((override) => {
          if (!shouldFilter) return true;
          const identity = lootDropIdentity(override);
          return wantedIds.has(identity.blueprintId.toLowerCase()) || wantedClasses.has(identity.classString.toLowerCase());
        })
        .map((override) => deepCloneJson(override));

      if (selectedOverrides.length === 0) {
        return invalidParams("Aucun override loot correspondant trouvé dans le projet source.", { sourceProjectId, lootDropIds: lootDropIdsResult.value, lootDropClassStrings: lootDropClassStringsResult.value });
      }

      const nextOverrides = getLootOverrides(target.v7data, game).map((override) => deepCloneJson(override));
      const inserted: string[] = [];
      const replaced: string[] = [];
      for (const override of selectedOverrides) {
        const identity = lootDropIdentity(override);
        const index = findOverrideIndex(nextOverrides, { lootDropId: identity.blueprintId, lootDropClassString: identity.classString });
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
      if (backupLocalResult.value ?? true) backup = await writeProjectBackup(targetProjectId, target.binary);

      const saveMeta = await saveProjectBinary(target.manifest, target.v7data);
      const confirmation = await assertProjectOwnershipAndGame(targetProjectId, game);
      const confirmedOverrides = getLootOverrides(confirmation.v7data, game);

      return textResult(
        [`Overrides loot copiés vers ${targetProjectId}.`, `Source : ${sourceProjectId}`, `Copiés : ${selectedOverrides.length}`, `Ajoutés : ${inserted.length}`, `Remplacés : ${replaced.length}`, ...(backup ? [`Backup : ${backup.path}`] : [])].join("\n"),
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
        { sourceProjectId, targetProjectId, game, copiedCount: selectedOverrides.length }
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
};

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
      game: { type: "string", enum: [...PROJECT_GAMES], description: "Jeu cible : 'ark' ou 'arksa'" },
      family: { type: "string", description: "Label, classString, lootDropId ou familyKey de la famille à copier" },
      backupLocal: { type: "boolean", description: "Créer une sauvegarde locale du projet cible avant écriture. Défaut : true" },
      replaceExisting: { type: "boolean", description: "Remplacer les overrides existants du même loot drop dans le projet cible. Défaut : true" },
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
        resolveProjectReference({ projectId: sourceProjectIdResult.value, projectName: sourceProjectNameResult.value }, { game, fieldPrefix: "source" }),
        resolveProjectReference({ projectId: targetProjectIdResult.value, projectName: targetProjectNameResult.value }, { game, fieldPrefix: "target" }),
      ]);
      if (!resolvedSource.ok) return resolvedSource.result;
      if (!resolvedTarget.ok) return resolvedTarget.result;
      const sourceProjectId = resolvedSource.projectId;
      const targetProjectId = resolvedTarget.projectId;
      const [source, target] = await Promise.all([fetchReadableProject(sourceProjectId), assertProjectOwnershipAndGame(targetProjectId, game)]);
      if (String(source.manifest.gameId ?? "") !== expectedGameId(game)) {
        return invalidParams(`Le projet source est ${String(source.manifest.gameId ?? "inconnu")}, pas ${expectedGameId(game)}.`, { sourceProjectId, game });
      }

      const sourceOverrides = getLootOverrides(source.v7data, game);
      const familyMatch = findLootFamily(sourceOverrides, family);
      if (!familyMatch) {
        return invalidParams("Famille loot introuvable dans le projet source.", { sourceProjectId, family });
      }

      const copiedOverrides = familyMatch.overrides.map((override) => deepCloneJson(override));
      const nextOverrides = getLootOverrides(target.v7data, game).map((override) => deepCloneJson(override));
      for (const override of copiedOverrides) {
        const identity = lootDropIdentity(override);
        const index = findOverrideIndex(nextOverrides, { lootDropId: identity.blueprintId, lootDropClassString: identity.classString });
        if (index >= 0) {
          if (replaceExistingResult.value ?? true) nextOverrides[index] = override;
        } else {
          nextOverrides.push(override);
        }
      }

      setLootOverrides(target.v7data, game, nextOverrides);
      const enabledContentPackIds = mergeRequiredContentPacks(target.manifest, copiedOverrides);
      let backup: { path: string; sha256: string } | undefined;
      if (backupLocalResult.value ?? true) backup = await writeProjectBackup(targetProjectId, target.binary);

      const saveMeta = await saveProjectBinary(target.manifest, target.v7data);
      const confirmation = await assertProjectOwnershipAndGame(targetProjectId, game);

      return textResult(
        [`Famille loot copiée vers ${targetProjectId}.`, `Source : ${sourceProjectId}`, `Famille : ${familyMatch.familyKey}`, `Overrides copiés : ${copiedOverrides.length}`, ...(backup ? [`Backup : ${backup.path}`] : [])].join("\n"),
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
        { sourceProjectId, targetProjectId, game, family: familyMatch.familyKey, copiedCount: copiedOverrides.length }
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
};

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
      game: { type: "string", enum: [...PROJECT_GAMES], description: "Jeu cible : 'ark' ou 'arksa'" },
      override: { type: "object", description: "Payload native override Beacon (definition, minItemSets, maxItemSets, sets...)" },
      lootDropId: { type: "string", description: "BlueprintId du loot drop à remplacer (optionnel si présent dans override.definition)" },
      lootDropClassString: { type: "string", description: "Class string du loot drop à remplacer (optionnel si présent dans override.definition)" },
      backupLocal: { type: "boolean", description: "Créer une sauvegarde locale du projet avant écriture. Défaut : true" },
      enableRequiredMods: { type: "boolean", description: "Active automatiquement les mods requis par l'override. Défaut : true" },
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
    if (!overrideResult.value) return invalidParams("Paramètre override requis.", { field: "override" });
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
    if (!validation.ok) return invalidParams(validation.message, { field: "override" });

    const identity = lootDropIdentity(candidateOverride);
    const matcher = {
      lootDropId: lootDropIdResult.value ?? identity.blueprintId,
      lootDropClassString: lootDropClassStringResult.value ?? identity.classString,
    };
    if (!matcher.lootDropId && !matcher.lootDropClassString) {
      return invalidParams("lootDropId ou lootDropClassString requis pour identifier l'override cible.", { fields: ["lootDropId", "lootDropClassString"] });
    }

    try {
      const resolvedProject = await resolveProjectReference({ projectId: projectIdResult.value, projectName: projectNameResult.value }, { game });
      if (!resolvedProject.ok) return resolvedProject.result;
      const projectId = resolvedProject.projectId;
      const target = await assertProjectOwnershipAndGame(projectId, game);
      const nextOverrides = getLootOverrides(target.v7data, game).map((override) => deepCloneJson(override));
      const index = findOverrideIndex(nextOverrides, matcher);
      if (index >= 0) nextOverrides[index] = candidateOverride;
      else nextOverrides.push(candidateOverride);

      setLootOverrides(target.v7data, game, nextOverrides);
      const enabledContentPackIds = enableRequiredModsResult.value ?? true ? mergeRequiredContentPacks(target.manifest, [candidateOverride]) : [];
      let backup: { path: string; sha256: string } | undefined;
      if (backupLocalResult.value ?? true) backup = await writeProjectBackup(projectId, target.binary);

      const saveMeta = await saveProjectBinary(target.manifest, target.v7data);
      const confirmation = await assertProjectOwnershipAndGame(projectId, game);
      const confirmedIndex = findOverrideIndex(getLootOverrides(confirmation.v7data, game), matcher);

      return textResult(
        [`Override loot enregistré dans ${projectId}.`, `Loot drop : ${identity.label || identity.classString || identity.blueprintId}`, `Mode : ${index >= 0 ? "remplacement" : "ajout"}`, ...(backup ? [`Backup : ${backup.path}`] : [])].join("\n"),
        {
          projectId,
          game,
          override: summarizeLootOverride(candidateOverride),
          enabledContentPackIds,
          backup,
          revision: saveMeta.revision,
          confirmed: confirmedIndex >= 0,
        },
        { projectId, game, lootDropId: matcher.lootDropId, lootDropClassString: matcher.lootDropClassString }
      );
    } catch (err) {
      return formatApiError(err);
    }
  },
};

export const lootProjectTools: ToolDefinition[] = [
  inspectLootProjectTool,
  copyLootOverridesTool,
  copyLootFamilyTool,
  setLootOverrideTool,
];
