"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAuthTools = registerAuthTools;
const shared_js_1 = require("./shared.js");
const client_js_1 = require("../api/client.js");
const oauth_js_1 = require("../auth/oauth.js");
const tokens_js_1 = require("../auth/tokens.js");
const EMPTY_INPUT_SCHEMA = { type: "object", properties: {} };
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
            return (0, shared_js_1.textResult)([
                "Connexion Beacon démarrée.",
                "",
                `Code : ${flow.userCode}`,
                `URL  : ${flow.verificationUriComplete}`,
                "",
                "Ouvre l'URL ci-dessus dans ton navigateur et connecte-toi à Beacon.",
                `Le code expire dans ${minutes} minutes.`,
                "",
                "Une fois connecté, appelle beacon_login_check pour finaliser.",
            ].join("\n"), {
                userCode: flow.userCode,
                verificationUri: flow.verificationUri,
                verificationUriComplete: flow.verificationUriComplete,
                interval: flow.interval,
                expiresIn: flow.expiresIn,
            });
        }
        catch (err) {
            return (0, shared_js_1.errorResult)(`Impossible de démarrer le flow de connexion : ${String(err)}`, "auth_start_failed");
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
            return (0, shared_js_1.errorResult)("Aucune connexion en cours. Appelle beacon_login pour démarrer.", "auth_pending_missing");
        }
        try {
            const result = await (0, oauth_js_1.pollDeviceFlow)(pending);
            switch (result.status) {
                case "pending":
                    return (0, shared_js_1.textResult)("En attente de l'autorisation... L'utilisateur n'a pas encore validé dans son navigateur. Réessaie dans 5 secondes.", { status: "pending" });
                case "expired":
                    return (0, shared_js_1.errorResult)("Le code a expiré. Appelle beacon_login pour obtenir un nouveau code.", "auth_code_expired");
                case "success":
                    return (0, shared_js_1.textResult)([
                        "Connecté à Beacon avec succès !",
                        "Les tokens sont sauvegardés et renouvelés automatiquement.",
                        "Tu peux maintenant utiliser tous les tools Beacon.",
                    ].join("\n"), { status: "success", tokens: result.tokens });
                default: {
                    const _exhaustive = result;
                    return (0, shared_js_1.errorResult)(`Statut inattendu : ${JSON.stringify(_exhaustive)}`, "auth_unknown_status");
                }
            }
        }
        catch (err) {
            return (0, shared_js_1.errorResult)(`Erreur lors de la vérification : ${String(err)}`, "auth_check_failed");
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
            return (0, shared_js_1.textResult)([
                "Connecté à Beacon.",
                `Utilisateur : ${status.userId ?? "inconnu"}`,
                status.email ? `Email       : ${status.email}` : "",
                `Access token expire le  : ${accessExpiry}`,
                `Refresh token expire le : ${refreshExpiry}`,
            ]
                .filter(Boolean)
                .join("\n"), {
                connected: true,
                userId: status.userId,
                email: status.email,
                tokens,
            });
        }
        return (0, shared_js_1.errorResult)(["Non connecté à Beacon.", `Raison : ${status.error}`, "", "Appelle beacon_login pour te connecter."].join("\n"), "auth_not_connected", status);
    },
};
const logoutTool = {
    name: "beacon_logout",
    description: "Déconnecte de Beacon en supprimant les tokens locaux.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    handler: async () => {
        (0, tokens_js_1.clearTokens)();
        return (0, shared_js_1.textResult)("Déconnecté. Les tokens locaux ont été supprimés.");
    },
};
function registerAuthTools(server) {
    (0, shared_js_1.registerToolGroup)(server, [loginTool, loginCheckTool, authStatusTool, logoutTool]);
}
