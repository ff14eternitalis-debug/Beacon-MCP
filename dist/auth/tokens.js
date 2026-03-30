"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadTokens = loadTokens;
exports.saveTokens = saveTokens;
exports.clearTokens = clearTokens;
exports.isAccessTokenValid = isAccessTokenValid;
exports.isRefreshTokenValid = isRefreshTokenValid;
exports.savePendingFlow = savePendingFlow;
exports.loadPendingFlow = loadPendingFlow;
exports.clearPendingFlow = clearPendingFlow;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const AUTH_DIR = path.join(process.env.USERPROFILE || process.env.HOME || ".", ".beacon-mcp");
const TOKENS_FILE = path.join(AUTH_DIR, "tokens.json");
const PENDING_FILE = path.join(AUTH_DIR, "pending_flow.json");
function nowUnix() {
    return Math.floor(Date.now() / 1000);
}
function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
    catch {
        return null;
    }
}
function writeJson(filePath, data) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
}
function deleteFile(filePath) {
    try {
        fs.unlinkSync(filePath);
    }
    catch (err) {
        if (err.code !== "ENOENT")
            throw err;
    }
}
function loadTokens() {
    return readJson(TOKENS_FILE);
}
function saveTokens(tokens) {
    writeJson(TOKENS_FILE, tokens);
}
function clearTokens() {
    deleteFile(TOKENS_FILE);
}
function isAccessTokenValid(tokens) {
    return tokens.accessTokenExpiry > nowUnix() + 60;
}
function isRefreshTokenValid(tokens) {
    return tokens.refreshTokenExpiry > nowUnix();
}
function savePendingFlow(flow) {
    writeJson(PENDING_FILE, flow);
}
function loadPendingFlow() {
    const flow = readJson(PENDING_FILE);
    if (!flow)
        return null;
    if (flow.expiresAt < nowUnix()) {
        clearPendingFlow();
        return null;
    }
    return flow;
}
function clearPendingFlow() {
    deleteFile(PENDING_FILE);
}
