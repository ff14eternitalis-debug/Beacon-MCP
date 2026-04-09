import { ToolDefinition } from "../../registry.js";
import {
  textResult,
  formatApiError,
  requireGame,
  optionalString,
  invalidParams,
} from "../shared.js";
import type { ProjectGame } from "./shared.js";
import {
  PROJECT_GAMES,
  optionalBoolean,
  resolveProjectReference,
  resolveContentPack,
  assertProjectOwnershipAndGame,
  getModSelections,
  writeProjectBackup,
  saveProjectBinary,
  fetchProjectBinary,
  parseBeaconBinary,
} from "./shared.js";

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
      const resolvedProject = await resolveProjectReference(
        {
          projectId: projectIdResult.value,
          projectName: projectNameResult.value,
        },
        { game }
      );
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

export const modProjectTools: ToolDefinition[] = [setProjectModTool];
