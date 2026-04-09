import { ToolDefinition } from "../../registry.js";
import {
  textResult,
  formatApiError,
  gameName,
  requireGame,
  requireRawString,
  optionalString,
  optionalNumber,
  invalidParams,
} from "../shared.js";
import type { ExportFormat, ProjectGame } from "./shared.js";
import {
  PROJECT_GAMES,
  CONFIG_OPTION_GAMES,
  resolveProjectReference,
  buildConfigParams,
  buildEffectiveProjectExport,
  buildProjectChatExport,
  buildProjectFileExport,
  sanitizeFileSegment,
  createTimestampSlug,
  writeProjectExportFile,
  getProjectConfigFile,
  putProjectConfigFile,
} from "./shared.js";

const allowedFormats = ["full", "overrides_only"] as const;
const allowedFiles = ["all", "game", "gus"] as const;
const SMART_EXPORT_DEFAULT_CHAR_LIMIT = 12000;

function validateExportOptions(format: string, file: string) {
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
  return undefined;
}

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
      game: { type: "string", enum: [...PROJECT_GAMES], description: "Jeu cible : 'ark' ou 'arksa'" },
      format: { type: "string", enum: [...allowedFormats], description: "Choisir 'full' pour le rendu complet, ou 'overrides_only' pour ne retourner que les lignes utiles comme OverrideNamedEngramEntries. Défaut : full" },
      file: { type: "string", enum: [...allowedFiles], description: "Choisir 'all', 'game' pour Game.ini, ou 'gus' pour GameUserSettings.ini. Défaut : all" },
      qualityScale: { type: "number", description: "Multiplicateur de qualité des items pour la génération Game.ini (optionnel)" },
      difficultyValue: { type: "number", description: "Valeur de difficulté pour la génération Game.ini (optionnel)" },
      mapMask: { type: "string", description: "Masque de carte optionnel pour générer l'export ciblé" },
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
    const validation = validateExportOptions(format, file);
    if (validation) return validation;

    try {
      const resolvedProject = await resolveProjectReference({ projectId: projectIdResult.value, projectName: projectNameResult.value }, { game });
      if (!resolvedProject.ok) return resolvedProject.result;
      const projectId = resolvedProject.projectId;
      const params = buildConfigParams(qualityScaleResult.value, difficultyValueResult.value, mapMaskResult.value);
      const exportBundle = await buildEffectiveProjectExport(projectId, game, file as "all" | "game" | "gus", params);
      const exportView = buildProjectChatExport(projectId, game, file as "all" | "game" | "gus", format as ExportFormat, exportBundle);
      return textResult(exportView.message, exportView.payload, { projectId, game, file, format, mapMask: mapMaskResult.value });
    } catch (err) {
      return formatApiError(err);
    }
  },
};

const exportProjectFileTool: ToolDefinition = {
  name: "beacon_export_project_file",
  description:
    "Exporte la configuration d'un projet Beacon dans un fichier local sans passer par l'interface Beacon. " +
    "Idéal pour les gros projets quand le code serait trop long pour le chat. " +
    "Le MCP écrit un fichier texte local dans ~/.beacon-mcp/exports/ puis retourne son chemin exact.",
  inputSchema: exportProjectCodeTool.inputSchema,
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
    const validation = validateExportOptions(format, file);
    if (validation) return validation;

    try {
      const resolvedProject = await resolveProjectReference({ projectId: projectIdResult.value, projectName: projectNameResult.value }, { game });
      if (!resolvedProject.ok) return resolvedProject.result;
      const projectId = resolvedProject.projectId;
      const params = buildConfigParams(qualityScaleResult.value, difficultyValueResult.value, mapMaskResult.value);
      const exportBundle = await buildEffectiveProjectExport(projectId, game, file as "all" | "game" | "gus", params);
      const projectName = projectNameResult.value ?? projectId;
      const fileExport = buildProjectFileExport(projectId, projectName, game, file as "all" | "game" | "gus", mapMaskResult.value, format as ExportFormat, exportBundle);
      const filename = [sanitizeFileSegment(projectName) || "beacon-project", sanitizeFileSegment(format === "overrides_only" ? "overrides" : file), createTimestampSlug()].join("-") + ".txt";
      const exportPath = await writeProjectExportFile(filename, fileExport.content);
      return textResult([`Export local créé pour ${gameName(game)}.`, `Projet : ${projectName} (${projectId})`, `Fichier : ${exportPath}`].join("\n"), {
        projectId,
        projectName,
        game,
        file,
        format,
        exportPath,
        derivedGameIniLines: exportBundle.derivedGameIniLines,
        exportedFiles: fileExport.exportedFiles,
      }, { projectId, game, file, format, exportPath });
    } catch (err) {
      return formatApiError(err);
    }
  },
};

const exportProjectSmartTool: ToolDefinition = {
  name: "beacon_export_project_smart",
  description:
    "Exporte intelligemment la configuration d'un projet Beacon. " +
    "Si le rendu est court, il le retourne directement dans le chat. " +
    "Si le rendu devient trop long, il bascule automatiquement vers un fichier local dans ~/.beacon-mcp/exports/.",
  inputSchema: {
    type: "object",
    properties: {
      ...((exportProjectCodeTool.inputSchema.properties ?? {}) as Record<string, unknown>),
      maxInlineChars: { type: "number", description: "Nombre maximum de caractères à retourner directement dans le chat avant bascule vers un fichier. Défaut : 12000" },
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
    const maxInlineChars = Math.max(200, Math.floor(maxInlineCharsResult.value ?? SMART_EXPORT_DEFAULT_CHAR_LIMIT));
    const validation = validateExportOptions(format, file);
    if (validation) return validation;

    try {
      const resolvedProject = await resolveProjectReference({ projectId: projectIdResult.value, projectName: projectNameResult.value }, { game });
      if (!resolvedProject.ok) return resolvedProject.result;
      const projectId = resolvedProject.projectId;
      const params = buildConfigParams(qualityScaleResult.value, difficultyValueResult.value, mapMaskResult.value);
      const exportBundle = await buildEffectiveProjectExport(projectId, game, file as "all" | "game" | "gus", params);
      const chatExport = buildProjectChatExport(projectId, game, file as "all" | "game" | "gus", format as ExportFormat, exportBundle);
      if (chatExport.message.length <= maxInlineChars) {
        return textResult(chatExport.message, { ...chatExport.payload, delivery: "inline", maxInlineChars }, { projectId, game, file, format, delivery: "inline", maxInlineChars });
      }

      const projectName = projectNameResult.value ?? projectId;
      const fileExport = buildProjectFileExport(projectId, projectName, game, file as "all" | "game" | "gus", mapMaskResult.value, format as ExportFormat, exportBundle);
      const filename = [sanitizeFileSegment(projectName) || "beacon-project", sanitizeFileSegment(format === "overrides_only" ? "overrides" : file), createTimestampSlug()].join("-") + ".txt";
      const exportPath = await writeProjectExportFile(filename, fileExport.content);
      return textResult([`Export trop volumineux pour le chat, fichier local créé pour ${gameName(game)}.`, `Projet : ${projectName} (${projectId})`, `Fichier : ${exportPath}`].join("\n"), {
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
      }, { projectId, game, file, format, delivery: "file", exportPath, maxInlineChars });
    } catch (err) {
      return formatApiError(err);
    }
  },
};

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
      game: { type: "string", enum: [...PROJECT_GAMES], description: "Jeu cible : 'ark' ou 'arksa'" },
      qualityScale: { type: "number", description: "Multiplicateur de qualité des items (optionnel)" },
      difficultyValue: { type: "number", description: "Valeur de difficulté (optionnel)" },
      mapMask: { type: "string", description: "Masque de carte (optionnel)" },
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
    const game = gameResult.value as ProjectGame;
    try {
      const resolvedProject = await resolveProjectReference({ projectId: projectIdResult.value, projectName: projectNameResult.value });
      if (!resolvedProject.ok) return resolvedProject.result;
      const projectId = resolvedProject.projectId;
      const params = buildConfigParams(qualityScaleResult.value, difficultyValueResult.value, mapMaskResult.value);
      const ini = await getProjectConfigFile(projectId, game, "Game.ini", params);
      return textResult(`Game.ini — ${gameName(game)} (projet ${projectId}) :\n\n${ini}`, { projectId, game, file: "Game.ini", content: ini });
    } catch (err) {
      return formatApiError(err);
    }
  },
};

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
      game: { type: "string", enum: [...PROJECT_GAMES], description: "Jeu cible : 'ark' ou 'arksa'" },
      content: { type: "string", description: "Contenu complet du fichier Game.ini (texte brut INI)" },
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
    const game = gameResult.value as ProjectGame;
    try {
      const resolvedProject = await resolveProjectReference({ projectId: projectIdResult.value, projectName: projectNameResult.value });
      if (!resolvedProject.ok) return resolvedProject.result;
      const projectId = resolvedProject.projectId;
      await putProjectConfigFile(projectId, game, "Game.ini", contentResult.value);
      return textResult(`Game.ini mis à jour avec succès pour le projet ${projectId} (${gameName(game)}).`, { projectId, game, file: "Game.ini" });
    } catch (err) {
      return formatApiError(err);
    }
  },
};

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
      const resolvedProject = await resolveProjectReference({ projectId: projectIdResult.value, projectName: projectNameResult.value });
      if (!resolvedProject.ok) return resolvedProject.result;
      const projectId = resolvedProject.projectId;
      const ini = await getProjectConfigFile(projectId, game, "GameUserSettings.ini");
      return textResult(`GameUserSettings.ini — ${gameName(game)} (projet ${projectId}) :\n\n${ini}`, { projectId, game, file: "GameUserSettings.ini", content: ini });
    } catch (err) {
      return formatApiError(err);
    }
  },
};

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
      game: { type: "string", enum: [...CONFIG_OPTION_GAMES], description: "Jeu cible : 'ark', 'arksa', 'palworld' ou '7dtd'" },
      content: { type: "string", description: "Contenu complet du fichier GameUserSettings.ini (texte brut INI)" },
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
    const game = gameResult.value as ProjectGame;
    try {
      const resolvedProject = await resolveProjectReference({ projectId: projectIdResult.value, projectName: projectNameResult.value });
      if (!resolvedProject.ok) return resolvedProject.result;
      const projectId = resolvedProject.projectId;
      await putProjectConfigFile(projectId, game, "GameUserSettings.ini", contentResult.value);
      return textResult(`GameUserSettings.ini mis à jour avec succès pour le projet ${projectId} (${gameName(game)}).`, { projectId, game, file: "GameUserSettings.ini" });
    } catch (err) {
      return formatApiError(err);
    }
  },
};

export const exportProjectTools: ToolDefinition[] = [
  exportProjectCodeTool,
  exportProjectFileTool,
  exportProjectSmartTool,
  generateGameIniTool,
  putGameIniTool,
  generateGameUserSettingsIniTool,
  putGameUserSettingsIniTool,
];
