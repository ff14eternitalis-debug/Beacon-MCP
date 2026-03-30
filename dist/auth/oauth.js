"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BEACON_SCOPES = exports.BEACON_CLIENT_ID = exports.BEACON_API_BASE = void 0;
exports.startDeviceFlow = startDeviceFlow;
exports.pollDeviceFlow = pollDeviceFlow;
exports.refreshAccessToken = refreshAccessToken;
const axios_1 = __importDefault(require("axios"));
const pkce_js_1 = require("./pkce.js");
const tokens_js_1 = require("./tokens.js");
exports.BEACON_API_BASE = process.env.BEACON_API_URL ?? "https://api.usebeacon.app/v4";
// App web officielle Beacon — publique, pas de client_secret requis
exports.BEACON_CLIENT_ID = process.env.BEACON_CLIENT_ID ?? "12877547-7ad0-466f-a001-77815043c96b";
exports.BEACON_SCOPES = "common users:read sentinel:read sentinel:write";
const authClient = axios_1.default.create({
    baseURL: exports.BEACON_API_BASE,
    headers: { "Content-Type": "application/json" },
});
function oauthToStored(r) {
    return {
        accessToken: r.access_token,
        refreshToken: r.refresh_token,
        accessTokenExpiry: r.access_token_expiration,
        refreshTokenExpiry: r.refresh_token_expiration,
    };
}
async function startDeviceFlow() {
    const codeVerifier = (0, pkce_js_1.generateCodeVerifier)();
    const codeChallenge = (0, pkce_js_1.generateCodeChallenge)(codeVerifier);
    const { data } = await authClient.post("/device", {
        client_id: exports.BEACON_CLIENT_ID,
        scope: exports.BEACON_SCOPES,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
    });
    (0, tokens_js_1.savePendingFlow)({
        deviceCode: data.device_code,
        codeVerifier,
        expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
    });
    return {
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        verificationUriComplete: data.verification_uri_complete,
        interval: data.interval,
        expiresIn: data.expires_in,
    };
}
async function pollDeviceFlow(pending) {
    if (pending.expiresAt < Math.floor(Date.now() / 1000)) {
        (0, tokens_js_1.clearPendingFlow)();
        return { status: "expired" };
    }
    try {
        const { data } = await authClient.post("/login", {
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            client_id: exports.BEACON_CLIENT_ID,
            device_code: pending.deviceCode,
            code_verifier: pending.codeVerifier,
        });
        const tokens = oauthToStored(data);
        (0, tokens_js_1.saveTokens)(tokens);
        (0, tokens_js_1.clearPendingFlow)();
        return { status: "success", tokens };
    }
    catch (err) {
        if (axios_1.default.isAxiosError(err) && err.response?.data?.error === "authorization_pending") {
            return { status: "pending" };
        }
        throw err;
    }
}
async function refreshAccessToken(refreshToken) {
    const { data } = await authClient.post("/login", {
        grant_type: "refresh_token",
        client_id: exports.BEACON_CLIENT_ID,
        refresh_token: refreshToken,
    });
    const tokens = oauthToStored(data);
    (0, tokens_js_1.saveTokens)(tokens);
    return tokens;
}
