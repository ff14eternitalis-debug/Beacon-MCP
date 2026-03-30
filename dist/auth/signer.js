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
exports.buildContentToSign = buildContentToSign;
exports.signContent = signContent;
exports.buildAuthHeader = buildAuthHeader;
exports.createAuthHeader = createAuthHeader;
const crypto = __importStar(require("crypto"));
/**
 * Construit la chaîne à signer selon la spec Beacon :
 * - Ligne 1 : méthode HTTP en majuscules
 * - Ligne 2 : URL complète (avec query string pour GET)
 * - Ligne 3 : corps de la requête (vide si absent, omis pour GET)
 */
function buildContentToSign(method, url, body) {
    const upperMethod = method.toUpperCase();
    const lines = [upperMethod, url];
    if (upperMethod !== "GET") {
        lines.push(body ?? "");
    }
    return lines.join("\n");
}
/**
 * Signe le contenu avec la clé privée RSA et retourne la signature en hex.
 */
function signContent(content, privateKeyPem) {
    const sign = crypto.createSign("SHA256");
    sign.update(content, "utf8");
    sign.end();
    return sign.sign(privateKeyPem, "hex");
}
/**
 * Construit l'en-tête Authorization HTTP Basic.
 * Format : Basic Base64(userId:hexSignature)
 */
function buildAuthHeader(userId, hexSignature) {
    const credentials = `${userId}:${hexSignature}`;
    return `Basic ${Buffer.from(credentials).toString("base64")}`;
}
/**
 * Pipeline complet : contenu → signature → header
 */
function createAuthHeader(method, url, privateKeyPem, userId, body) {
    const content = buildContentToSign(method, url, body);
    const signature = signContent(content, privateKeyPem);
    return buildAuthHeader(userId, signature);
}
