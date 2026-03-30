"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAuthTools = registerAuthTools;
const registry_js_1 = require("../registry.js");
const client_js_1 = require("../api/client.js");
const oauth_js_1 = require("../auth/oauth.js");
const tokens_js_1 = require("../auth/tokens.js");
const EMPTY_INPUT_SCHEMA = { type: "object", properties: {} };
function textResult(text) {
    return { content: [{ type: "text", text }] };
}
const loginTool = {
    name: "beacon_login",
    description: "Démarre la connexion à Beacon via OAuth2 device flow. " +
        "Retourne un code court à entrer sur usebeacon.app/device. " +
        "Appeler beacon_login_check ensuite pour confirmer la connexion.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    handler: async () => {
        try {
            const flow = await (0, oauth_js_1.startDeviceFlow)();
            const minutes = Math.floor(flow.expiresIn / 60);
            return textResult([
                "Connexion Beacon démarrée.",
                "",
                `Code : ${flow.userCode}`,
                `URL  : ${flow.verificationUriComplete}`,
                "",
                "Ouvre l'URL ci-dessus dans ton navigateur et connecte-toi à Beacon.",
                `Le code expire dans ${minutes} minutes.`,
                "",
                "Une fois connecté, appelle beacon_login_check pour finaliser.",
            ].join("\n"));
        }
        catch (err) {
            return textResult(`Impossible de démarrer le flow de connexion : ${String(err)}`);
        }
    },
};
const loginCheckTool = {
    name: "beacon_login_check",
    description: "Vérifie si l'utilisateur a finalisé la connexion Beacon dans son navigateur. " +
        "À appeler après beacon_login. " +
        "Si en attente, appeler à nouveau dans quelques secondes.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    handler: async () => {
        const pending = (0, tokens_js_1.loadPendingFlow)();
        if (!pending) {
            return textResult("Aucune connexion en cours. Appelle beacon_login pour démarrer.");
        }
        try {
            const result = await (0, oauth_js_1.pollDeviceFlow)(pending);
            switch (result.status) {
                case "pending":
                    return textResult("En attente de l'autorisation... L'utilisateur n'a pas encore validé dans son navigateur. Réessaie dans 5 secondes.");
                case "expired":
                    return textResult("Le code a expiré. Appelle beacon_login pour obtenir un nouveau code.");
                case "success":
                    return textResult([
                        "Connecté à Beacon avec succès !",
                        "Les tokens sont sauvegardés et renouvelés automatiquement.",
                        "Tu peux maintenant utiliser tous les tools Beacon.",
                    ].join("\n"));
                default: {
                    const _exhaustive = result;
                    return textResult(`Statut inattendu : ${JSON.stringify(_exhaustive)}`);
                }
            }
        }
        catch (err) {
            return textResult(`Erreur lors de la vérification : ${String(err)}`);
        }
    },
};
const authStatusTool = {
    name: "beacon_auth_status",
    description: "Vérifie l'état de la connexion Beacon. " +
        "Retourne si connecté, l'identifiant utilisateur, et l'expiration des tokens. " +
        "Appeler en premier pour diagnostiquer tout problème d'accès.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    handler: async () => {
        const status = await (0, client_js_1.checkAuthStatus)();
        if (status.connected) {
            const tokens = status.tokens;
            const accessExpiry = new Date(tokens.accessTokenExpiry * 1000).toLocaleString("fr-FR");
            const refreshExpiry = new Date(tokens.refreshTokenExpiry * 1000).toLocaleString("fr-FR");
            return textResult([
                "Connecté à Beacon.",
                `Utilisateur : ${status.userId ?? "inconnu"}`,
                status.email ? `Email       : ${status.email}` : "",
                `Access token expire le  : ${accessExpiry}`,
                `Refresh token expire le : ${refreshExpiry}`,
            ]
                .filter(Boolean)
                .join("\n"));
        }
        return textResult(["Non connecté à Beacon.", `Raison : ${status.error}`, "", "Appelle beacon_login pour te connecter."].join("\n"));
    },
};
const logoutTool = {
    name: "beacon_logout",
    description: "Déconnecte de Beacon en supprimant les tokens locaux.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    handler: async () => {
        (0, tokens_js_1.clearTokens)();
        return textResult("Déconnecté. Les tokens locaux ont été supprimés.");
    },
};
function registerAuthTools(server) {
    for (const tool of [loginTool, loginCheckTool, authStatusTool, logoutTool]) {
        (0, registry_js_1.registerTool)(tool);
        server.tool(tool.name, tool.description, tool.inputSchema.properties, (_args) => tool.handler({}));
    }
}
