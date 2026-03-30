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
exports.loadCredentials = loadCredentials;
exports.saveCredentials = saveCredentials;
exports.isAuthenticated = isAuthenticated;
exports.getCredentialsPath = getCredentialsPath;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const CREDENTIALS_PATH = path.join(process.env.USERPROFILE || process.env.HOME || ".", ".beacon-mcp", "credentials.json");
/**
 * Charge les credentials depuis :
 * 1. Variables d'environnement (BEACON_USER_ID + BEACON_PRIVATE_KEY)
 * 2. Fichier ~/.beacon-mcp/credentials.json
 *
 * Retourne null si aucune credential n'est disponible.
 */
function loadCredentials() {
    const envUserId = process.env.BEACON_USER_ID;
    const envPrivateKey = process.env.BEACON_PRIVATE_KEY;
    if (envUserId && envPrivateKey) {
        // Permet de stocker la clé PEM dans .env avec \n littéraux
        const privateKey = envPrivateKey.replace(/\\n/g, "\n");
        return { userId: envUserId, privateKey };
    }
    try {
        if (fs.existsSync(CREDENTIALS_PATH)) {
            const raw = fs.readFileSync(CREDENTIALS_PATH, "utf8");
            const parsed = JSON.parse(raw);
            if (parsed.userId && parsed.privateKey) {
                return parsed;
            }
        }
    }
    catch {
        // Fichier absent ou malformé — on continue silencieusement
    }
    return null;
}
/**
 * Sauvegarde les credentials dans ~/.beacon-mcp/credentials.json
 */
function saveCredentials(credentials) {
    const dir = path.dirname(CREDENTIALS_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2), {
        mode: 0o600, // lecture/écriture propriétaire uniquement
    });
}
function isAuthenticated() {
    return loadCredentials() !== null;
}
function getCredentialsPath() {
    return CREDENTIALS_PATH;
}
