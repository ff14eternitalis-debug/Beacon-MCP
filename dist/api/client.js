"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.beaconClient = void 0;
exports.getValidAccessToken = getValidAccessToken;
exports.createBeaconClient = createBeaconClient;
exports.checkAuthStatus = checkAuthStatus;
const axios_1 = __importDefault(require("axios"));
const oauth_js_1 = require("../auth/oauth.js");
const tokens_js_1 = require("../auth/tokens.js");
async function getValidAccessToken() {
    const tokens = (0, tokens_js_1.loadTokens)();
    if (!tokens)
        return null;
    if ((0, tokens_js_1.isAccessTokenValid)(tokens))
        return tokens.accessToken;
    if ((0, tokens_js_1.isRefreshTokenValid)(tokens)) {
        try {
            const refreshed = await (0, oauth_js_1.refreshAccessToken)(tokens.refreshToken);
            return refreshed.accessToken;
        }
        catch {
            return null;
        }
    }
    return null;
}
function createBeaconClient() {
    const client = axios_1.default.create({
        baseURL: oauth_js_1.BEACON_API_BASE,
        headers: { "Content-Type": "application/json" },
        timeout: 30000,
    });
    client.interceptors.request.use(async (config) => {
        const token = await getValidAccessToken();
        if (token)
            config.headers.set("Authorization", `Bearer ${token}`);
        return config;
    });
    return client;
}
exports.beaconClient = createBeaconClient();
async function checkAuthStatus() {
    const token = await getValidAccessToken();
    if (!token) {
        const hasTokens = (0, tokens_js_1.loadTokens)() !== null;
        return {
            connected: false,
            error: hasTokens
                ? "Token expiré — relancez beacon_login"
                : "Aucun token stocké",
        };
    }
    try {
        const response = await exports.beaconClient.get("/user");
        return {
            connected: true,
            userId: response.data?.userId,
            email: response.data?.email,
            tokens: (0, tokens_js_1.loadTokens)(),
        };
    }
    catch (err) {
        if (axios_1.default.isAxiosError(err)) {
            const status = err.response?.status;
            if (status === 401 || status === 403) {
                return {
                    connected: false,
                    error: "Token invalide ou révoqué — relancez beacon_login",
                };
            }
            return { connected: false, error: `Erreur API (${status}): ${err.message}` };
        }
        return { connected: false, error: String(err) };
    }
}
