import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolDefinition } from "../registry.js";
import { errorResult, textResult, registerToolGroup } from "./shared.js";
import { checkAuthStatus } from "../api/client.js";
import { startDeviceFlow, pollDeviceFlow } from "../auth/oauth.js";
import { loadPendingFlow, clearTokens } from "../auth/tokens.js";

const EMPTY_INPUT_SCHEMA = { type: "object" as const, properties: {} };

const loginTool: ToolDefinition = {
  name: "beacon_login",
  description:
    "Démarre la connexion à Beacon via OAuth2 device flow. " +
    "Retourne un code court à entrer sur usebeacon.app/device. " +
    "Appeler beacon_login_check ensuite pour confirmer la connexion.",
  inputSchema: EMPTY_INPUT_SCHEMA,
  handler: async () => {
    try {
      const flow = await startDeviceFlow();
      const minutes = Math.floor(flow.expiresIn / 60);
      return textResult(
        [
          "Connexion Beacon démarrée.",
          "",
          `Code : ${flow.userCode}`,
          `URL  : ${flow.verificationUriComplete}`,
          "",
          "Ouvre l'URL ci-dessus dans ton navigateur et connecte-toi à Beacon.",
          `Le code expire dans ${minutes} minutes.`,
          "",
          "Une fois connecté, appelle beacon_login_check pour finaliser.",
        ].join("\n"),
        {
          userCode: flow.userCode,
          verificationUri: flow.verificationUri,
          verificationUriComplete: flow.verificationUriComplete,
          interval: flow.interval,
          expiresIn: flow.expiresIn,
        }
      );
    } catch (err) {
      return errorResult(
        `Impossible de démarrer le flow de connexion : ${String(err)}`,
        "auth_start_failed"
      );
    }
  },
};

const loginCheckTool: ToolDefinition = {
  name: "beacon_login_check",
  description:
    "Vérifie si l'utilisateur a finalisé la connexion Beacon dans son navigateur. " +
    "À appeler après beacon_login. " +
    "Si en attente, appeler à nouveau dans quelques secondes.",
  inputSchema: EMPTY_INPUT_SCHEMA,
  handler: async () => {
    const pending = loadPendingFlow();
    if (!pending) {
      return errorResult("Aucune connexion en cours. Appelle beacon_login pour démarrer.", "auth_pending_missing");
    }
    try {
      const result = await pollDeviceFlow(pending);
      switch (result.status) {
        case "pending":
          return textResult(
            "En attente de l'autorisation... L'utilisateur n'a pas encore validé dans son navigateur. Réessaie dans 5 secondes.",
            { status: "pending" }
          );
        case "expired":
          return errorResult("Le code a expiré. Appelle beacon_login pour obtenir un nouveau code.", "auth_code_expired");
        case "success":
          return textResult(
            [
              "Connecté à Beacon avec succès !",
              "Les tokens sont sauvegardés et renouvelés automatiquement.",
              "Tu peux maintenant utiliser tous les tools Beacon.",
            ].join("\n"),
            { status: "success", tokens: result.tokens }
          );
        default: {
          const _exhaustive: never = result;
          return errorResult(`Statut inattendu : ${JSON.stringify(_exhaustive)}`, "auth_unknown_status");
        }
      }
    } catch (err) {
      return errorResult(`Erreur lors de la vérification : ${String(err)}`, "auth_check_failed");
    }
  },
};

const authStatusTool: ToolDefinition = {
  name: "beacon_auth_status",
  description:
    "Vérifie l'état de la connexion Beacon. " +
    "Retourne si connecté, l'identifiant utilisateur, et l'expiration des tokens. " +
    "Appeler en premier pour diagnostiquer tout problème d'accès.",
  inputSchema: EMPTY_INPUT_SCHEMA,
  handler: async () => {
    const status = await checkAuthStatus();
    if (status.connected) {
      const tokens = status.tokens!;
      const accessExpiry = new Date(tokens.accessTokenExpiry * 1000).toLocaleString("fr-FR");
      const refreshExpiry = new Date(tokens.refreshTokenExpiry * 1000).toLocaleString("fr-FR");
      return textResult(
        [
          "Connecté à Beacon.",
          `Utilisateur : ${status.userId ?? "inconnu"}`,
          status.email ? `Email       : ${status.email}` : "",
          `Access token expire le  : ${accessExpiry}`,
          `Refresh token expire le : ${refreshExpiry}`,
        ]
          .filter(Boolean)
          .join("\n"),
        {
          connected: true,
          userId: status.userId,
          email: status.email,
          tokens,
        }
      );
    }
    return errorResult(
      ["Non connecté à Beacon.", `Raison : ${status.error}`, "", "Appelle beacon_login pour te connecter."].join("\n"),
      "auth_not_connected",
      status
    );
  },
};

const logoutTool: ToolDefinition = {
  name: "beacon_logout",
  description: "Déconnecte de Beacon en supprimant les tokens locaux.",
  inputSchema: EMPTY_INPUT_SCHEMA,
  handler: async () => {
    clearTokens();
    return textResult("Déconnecté. Les tokens locaux ont été supprimés.");
  },
};

export function registerAuthTools(server: McpServer): void {
  registerToolGroup(server, [loginTool, loginCheckTool, authStatusTool, logoutTool]);
}
